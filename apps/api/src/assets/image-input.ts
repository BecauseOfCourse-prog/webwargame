import { HttpException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import sharp from 'sharp';

export interface ImageLimits {
  maxBytes: number;
  maxSide: number;
  maxPixels: number;
}

export interface NormalizedImage {
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

type ImageType = NormalizedImage['mimeType'];

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const bodyDeadlineMs = 20_000;
const decoderDeadlineSeconds = 10;

function imageError(code: 'INVALID_IMAGE' | 'UNSUPPORTED_IMAGE' | 'IMAGE_TOO_LARGE'
  | 'UPLOAD_TIMEOUT' | 'UPLOAD_ABORTED'): HttpException {
  const errors = {
    INVALID_IMAGE: [400, 'Provide a valid static image matching its Content-Type.'],
    UNSUPPORTED_IMAGE: [415, 'Use an uncompressed PNG, JPEG or WebP image.'],
    IMAGE_TOO_LARGE: [413, 'The image exceeds the configured upload limits.'],
    UPLOAD_TIMEOUT: [408, 'The image upload took too long.'],
    UPLOAD_ABORTED: [400, 'The image upload was interrupted.'],
  } as const;
  const [status, message] = errors[code];
  return new HttpException({ code, message }, status);
}

function declaredImageType(value: unknown): ImageType {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value;
  throw imageError('UNSUPPORTED_IMAGE');
}

function actualImageType(input: Buffer): ImageType {
  if (input.length >= 8 && input.subarray(0, 8).equals(pngSignature)) return 'image/png';
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'image/jpeg';
  if (input.length >= 12 && input.toString('latin1', 0, 4) === 'RIFF'
    && input.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  throw imageError('UNSUPPORTED_IMAGE');
}

function validateStaticContainer(input: Buffer, type: ImageType): void {
  // libvips can expose an APNG as its static first frame. Inspect the bounded
  // container before opening a decoder so those uploads cannot silently pass.
  if (type === 'image/png') {
    let offset = 8;
    while (offset + 12 <= input.length) {
      const size = input.readUInt32BE(offset);
      const end = offset + size + 12;
      if (end > input.length) throw imageError('INVALID_IMAGE');
      const chunk = input.toString('latin1', offset + 4, offset + 8);
      if (chunk === 'acTL' || chunk === 'fcTL' || chunk === 'fdAT') throw imageError('INVALID_IMAGE');
      if (chunk === 'IEND') {
        if (size !== 0 || end !== input.length) throw imageError('INVALID_IMAGE');
        return;
      }
      offset = end;
    }
    throw imageError('INVALID_IMAGE');
  }
  if (type === 'image/webp') {
    if (input.readUInt32LE(4) + 8 !== input.length) throw imageError('INVALID_IMAGE');
    let offset = 12;
    while (offset + 8 <= input.length) {
      const size = input.readUInt32LE(offset + 4);
      const end = offset + 8 + size + (size % 2);
      if (end > input.length) throw imageError('INVALID_IMAGE');
      const chunk = input.toString('latin1', offset, offset + 4);
      if (chunk === 'ANIM' || chunk === 'ANMF'
        || (chunk === 'VP8X' && size > 0 && (input[offset + 8]! & 0x02) !== 0)) {
        throw imageError('INVALID_IMAGE');
      }
      offset = end;
    }
    if (offset !== input.length) throw imageError('INVALID_IMAGE');
  }
}

function checkDimensions(width: number, height: number, limits: ImageLimits): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw imageError('INVALID_IMAGE');
  }
  if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) {
    throw imageError('IMAGE_TOO_LARGE');
  }
}

export async function normalizeImage(input: Buffer, declaredType: string, limits: ImageLimits): Promise<NormalizedImage> {
  const mimeType = declaredImageType(declaredType);
  if (input.length > limits.maxBytes) throw imageError('IMAGE_TOO_LARGE');
  if (input.length === 0) throw imageError('INVALID_IMAGE');
  const actualType = actualImageType(input);
  if (actualType !== mimeType) throw imageError('INVALID_IMAGE');
  validateStaticContainer(input, actualType);

  try {
    const options = { failOn: 'warning', limitInputPixels: limits.maxPixels, sequentialRead: true } as const;
    const metadata = await sharp(input, options).metadata();
    if (`image/${metadata.format}` !== mimeType || (metadata.pages ?? 1) !== 1) {
      throw imageError('INVALID_IMAGE');
    }
    checkDimensions(metadata.width, metadata.height, limits);

    // Materialise every pixel before encoding. A metadata probe or a decoder's
    // fast format-copy path alone does not prove that all image data is valid.
    const decoded = await sharp(input, options).autoOrient().toColourspace('srgb')
      .timeout({ seconds: decoderDeadlineSeconds }).raw().toBuffer({ resolveWithObject: true });
    checkDimensions(decoded.info.width, decoded.info.height, limits);
    const output = sharp(decoded.data, {
      raw: { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels },
      limitInputPixels: limits.maxPixels,
    }).timeout({ seconds: decoderDeadlineSeconds });
    if (mimeType === 'image/png') output.png();
    else if (mimeType === 'image/jpeg') output.jpeg({ quality: 95, chromaSubsampling: '4:4:4' });
    else output.webp({ lossless: true, effort: 3 });
    // Raw input carries no EXIF, ICC, XMP or user-supplied textual metadata.
    const data = await output.toBuffer();
    if (data.length > limits.maxBytes) throw imageError('IMAGE_TOO_LARGE');
    return { data, mimeType, width: decoded.info.width, height: decoded.info.height };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    // Internal decoder diagnostics never reach an HTTP response.
    if (error instanceof Error && error.message.includes('exceeds pixel limit')) throw imageError('IMAGE_TOO_LARGE');
    if (error instanceof Error && /timeout/i.test(error.message)) throw imageError('UPLOAD_TIMEOUT');
    throw imageError('INVALID_IMAGE');
  }
}

export async function readImageBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  declaredImageType(request.headers['content-type']);
  const encoding = request.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw imageError('UNSUPPORTED_IMAGE');
  const declaredLength = request.headers['content-length'];
  let expected: number | undefined;
  if (declaredLength !== undefined) {
    if (typeof declaredLength !== 'string' || !/^\d+$/.test(declaredLength)) throw imageError('INVALID_IMAGE');
    expected = Number(declaredLength);
    if (!Number.isSafeInteger(expected) || expected > maxBytes) throw imageError('IMAGE_TOO_LARGE');
  }
  if (request.aborted || request.destroyed || request.readableEnded) throw imageError('UPLOAD_ABORTED');

  return new Promise<Buffer>((resolve, reject) => {
    // One bounded allocation also limits overhead for many tiny chunks.
    const body = Buffer.allocUnsafe(expected ?? maxBytes);
    let bytes = 0;
    let settled = false;
    const deadline = setTimeout(() => fail(imageError('UPLOAD_TIMEOUT')), bodyDeadlineMs);
    const cleanup = () => {
      clearTimeout(deadline);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAbort);
      request.off('error', onAbort);
      request.off('close', onClose);
    };
    const ignoreLateError = () => { /* The transport may report an error after a rejected body. */ };
    const fail = (error: HttpException) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Keep the response socket available for Nest's sanitized error response.
      // The controller closes failed-upload connections after sending it.
      request.pause();
      request.on('error', ignoreLateError);
      request.once('close', () => request.off('error', ignoreLateError));
      reject(error);
    };
    const onAbort = () => fail(imageError('UPLOAD_ABORTED'));
    const onClose = () => { if (!request.readableEnded) onAbort(); };
    const onData = (chunk: Buffer) => {
      if (!Buffer.isBuffer(chunk)) return fail(imageError('INVALID_IMAGE'));
      bytes += chunk.length;
      if (bytes > maxBytes) return fail(imageError('IMAGE_TOO_LARGE'));
      if (expected !== undefined && bytes > expected) return fail(imageError('INVALID_IMAGE'));
      chunk.copy(body, bytes - chunk.length);
    };
    const onEnd = () => {
      if (settled) return;
      if (!request.complete || (expected !== undefined && bytes !== expected)) return onAbort();
      settled = true;
      cleanup();
      resolve(body.subarray(0, bytes));
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAbort);
    request.once('error', onAbort);
    request.once('close', onClose);
  });
}
