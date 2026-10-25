import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { test } from 'node:test';
import sharp from 'sharp';
import { normalizeImage, readImageBody } from '../dist/assets/image-input.js';

const limits = { maxBytes: 1024 * 1024, maxSide: 128, maxPixels: 128 * 128 };

function failure(status, code) {
  return (error) => {
    assert.equal(error.getStatus(), status);
    assert.deepEqual(Object.keys(error.getResponse()).sort(), ['code', 'message']);
    assert.equal(error.getResponse().code, code);
    assert.ok(!JSON.stringify(error.getResponse()).includes('private'));
    return true;
  };
}

function pixels(width, height, channels = 3) {
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < data.length; i++) data[i] = (i * 71 + Math.floor(i / 11) * 29) % 256;
  return sharp(data, { raw: { width, height, channels } });
}

function request(headers = {}) {
  const value = new IncomingMessage(new Socket());
  value.headers = { 'content-type': 'image/png', ...headers };
  return value;
}

function finish(value, chunks) {
  for (const chunk of chunks) value.push(chunk);
  value.complete = true;
  value.push(null);
}

// APNG uses PNG's normal CRC and IDAT coding. This makes a genuine two-frame
// file, including fcTL/fdAT sequence numbers, without relying on a remote asset.
function pngChunk(type, data) {
  const name = Buffer.from(type);
  const input = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  input.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function animatedPng(image) {
  const chunks = [];
  for (let offset = 8; offset < image.length;) {
    const size = image.readUInt32BE(offset);
    chunks.push({ type: image.toString('latin1', offset + 4, offset + 8), data: image.subarray(offset + 8, offset + 8 + size) });
    offset += size + 12;
  }
  const header = chunks.find((chunk) => chunk.type === 'IHDR').data;
  const frame = (sequence) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    header.copy(data, 4, 0, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return pngChunk('fcTL', data);
  };
  const control = Buffer.alloc(8);
  control.writeUInt32BE(2);
  const compressed = Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
  const second = Buffer.alloc(compressed.length + 4);
  second.writeUInt32BE(2);
  compressed.copy(second, 4);
  return Buffer.concat([
    image.subarray(0, 8), pngChunk('IHDR', header), pngChunk('acTL', control), frame(0),
    pngChunk('IDAT', compressed), frame(1), pngChunk('fdAT', second), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('static PNG, JPEG and WebP are fully decoded and re-encoded with dimensions and MIME', async () => {
  for (const [format, mimeType] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const input = await pixels(11, 7).toFormat(format).toBuffer();
    const output = await normalizeImage(input, mimeType, limits);
    assert.equal(output.mimeType, mimeType);
    assert.equal(output.width, 11);
    assert.equal(output.height, 7);
    const metadata = await sharp(output.data).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 11);
    assert.equal(metadata.height, 7);
    assert.equal(metadata.hasProfile, false);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    await sharp(output.data, { failOn: 'warning' }).raw().toBuffer();
  }
});

test('normalization preserves exact sRGB PNG pixels, alpha and original dimensions', async () => {
  const input = await pixels(9, 5, 4).png().toBuffer();
  const before = await sharp(input).raw().toBuffer();
  const output = await normalizeImage(input, 'image/png', limits);
  const after = await sharp(output.data).raw().toBuffer();
  assert.deepEqual(after, before);
  assert.equal((await sharp(output.data).metadata()).hasAlpha, true);
  assert.deepEqual([output.width, output.height], [9, 5]);
});

test('EXIF orientation becomes physical pixels and source metadata is stripped', async () => {
  const input = await pixels(12, 7).jpeg().withMetadata({
    orientation: 6, exif: { IFD0: { Artist: 'private image author' } },
  }).toBuffer();
  const source = await sharp(input).metadata();
  assert.equal(source.orientation, 6);
  assert.ok(source.exif);
  assert.equal(source.hasProfile, true);
  const output = await normalizeImage(input, 'image/jpeg', limits);
  assert.deepEqual([output.width, output.height], [7, 12]);
  const metadata = await sharp(output.data).metadata();
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.ok(!output.data.includes(Buffer.from('private image author')));
});

test('only exact supported MIME values and matching allowlisted magic are accepted', async () => {
  const input = await pixels(4, 3).png().toBuffer();
  for (const type of ['image/PNG', 'image/png; charset=utf-8', 'image/jpg', '', 'application/octet-stream']) {
    await assert.rejects(normalizeImage(input, type, limits), failure(415, 'UNSUPPORTED_IMAGE'));
  }
  await assert.rejects(normalizeImage(input, 'image/jpeg', limits), failure(400, 'INVALID_IMAGE'));
  for (const input of [Buffer.from('<svg xmlns="private"><rect/></svg>'), Buffer.from('GIF89aprivate'), Buffer.from('private text')]) {
    await assert.rejects(normalizeImage(input, 'image/png', limits), failure(415, 'UNSUPPORTED_IMAGE'));
  }
  await assert.rejects(normalizeImage(Buffer.alloc(0), 'image/png', limits), failure(400, 'INVALID_IMAGE'));
});

test('truncated containers and damaged raster data fail with sanitized errors', async () => {
  for (const [format, type] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const input = await pixels(32, 24).toFormat(format).toBuffer();
    await assert.rejects(normalizeImage(input.subarray(0, input.length - 12), type, limits), failure(400, 'INVALID_IMAGE'));
  }
  const image = await pixels(64, 64).jpeg({ quality: 100 }).toBuffer();
  const damaged = Buffer.concat([image.subarray(0, Math.floor(image.length / 2)), image.subarray(image.length - 2)]);
  assert.equal((await sharp(damaged).metadata()).width, 64);
  await assert.rejects(normalizeImage(damaged, 'image/jpeg', limits), failure(400, 'INVALID_IMAGE'));
});

test('APNG and animated WebP are rejected before a static first frame can escape validation', async () => {
  const png = await pixels(3, 2).png().toBuffer();
  const apng = animatedPng(png);
  assert.equal((await sharp(apng).metadata()).format, 'png');
  await assert.rejects(normalizeImage(apng, 'image/png', limits), failure(400, 'INVALID_IMAGE'));
  const webp = await sharp([await pixels(3, 2).png().toBuffer(), await pixels(3, 2).negate().png().toBuffer()],
    { join: { animated: true } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
  assert.equal((await sharp(webp, { animated: true }).metadata()).pages, 2);
  await assert.rejects(normalizeImage(webp, 'image/webp', limits), failure(400, 'INVALID_IMAGE'));
});

test('input bytes, side length and pixel count are independently bounded and exact edges pass', async () => {
  const input = await pixels(12, 7).png().toBuffer();
  await assert.rejects(normalizeImage(input, 'image/png', { ...limits, maxBytes: input.length - 1 }), failure(413, 'IMAGE_TOO_LARGE'));
  await assert.rejects(normalizeImage(input, 'image/png', { ...limits, maxSide: 11 }), failure(413, 'IMAGE_TOO_LARGE'));
  await assert.rejects(normalizeImage(input, 'image/png', { ...limits, maxPixels: 83 }), failure(413, 'IMAGE_TOO_LARGE'));
  const output = await normalizeImage(input, 'image/png', { ...limits, maxSide: 12, maxPixels: 84 });
  assert.deepEqual([output.width, output.height], [12, 7]);
  const again = await normalizeImage(output.data, 'image/png', { ...limits, maxBytes: output.data.length });
  assert.equal(again.data.length, output.data.length);
});

test('the encoded output byte limit also applies when normalization expands a compact input', async () => {
  const raw = Buffer.alloc(64 * 64 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = ((i * 29 + Math.floor(i / 197)) % 2) * 255;
  const input = await sharp(raw, { raw: { width: 64, height: 64, channels: 3 } })
    .png({ palette: true, colours: 2, compressionLevel: 9 }).toBuffer();
  const normalized = await normalizeImage(input, 'image/png', limits);
  assert.ok(normalized.data.length > input.length);
  await assert.rejects(normalizeImage(input, 'image/png', { ...limits, maxBytes: input.length }), failure(413, 'IMAGE_TOO_LARGE'));
});

test('body reader accepts exact declared and chunked byte boundaries without content transformation', async () => {
  for (const headers of [{}, { 'content-length': '5' }, { 'content-encoding': 'identity', 'content-length': '5' }]) {
    const body = request(headers);
    const result = readImageBody(body, 5);
    finish(body, [Buffer.from([0, 255]), Buffer.from([128]), Buffer.from([1, 2])]);
    assert.deepEqual(await result, Buffer.from([0, 255, 128, 1, 2]));
    assert.equal(body.listenerCount('data'), 0);
    assert.equal(body.listenerCount('aborted'), 0);
  }
});

test('body metadata is rejected before consuming bytes', async () => {
  for (const headers of [{ 'content-type': 'image/png; charset=binary' }, { 'content-type': undefined },
    { 'content-encoding': 'gzip' }, { 'content-encoding': 'Identity' }, { 'content-encoding': ['identity'] }]) {
    const body = request(headers);
    await assert.rejects(readImageBody(body, 5), failure(415, 'UNSUPPORTED_IMAGE'));
    assert.equal(body.readableFlowing, null);
  }
  for (const value of ['', '-1', 'abc', '1.5', ['1']]) {
    const body = request({ 'content-length': value });
    await assert.rejects(readImageBody(body, 5), failure(400, 'INVALID_IMAGE'));
    assert.equal(body.readableFlowing, null);
  }
  for (const value of ['6', '9007199254740992']) {
    const body = request({ 'content-length': value });
    await assert.rejects(readImageBody(body, 5), failure(413, 'IMAGE_TOO_LARGE'));
    assert.equal(body.readableFlowing, null);
  }
});

test('body reader bounds chunked bytes and verifies the declared length', async () => {
  const chunked = request();
  const oversized = assert.rejects(readImageBody(chunked, 5), failure(413, 'IMAGE_TOO_LARGE'));
  finish(chunked, [Buffer.alloc(3), Buffer.alloc(3)]);
  await oversized;
  assert.equal(chunked.readableFlowing, false);
  const extra = request({ 'content-length': '3' });
  const extraResult = assert.rejects(readImageBody(extra, 5), failure(400, 'INVALID_IMAGE'));
  finish(extra, [Buffer.alloc(4)]);
  await extraResult;
  const short = request({ 'content-length': '5' });
  const shortResult = assert.rejects(readImageBody(short, 5), failure(400, 'UPLOAD_ABORTED'));
  finish(short, [Buffer.alloc(4)]);
  await shortResult;
});

test('body abort, stream error and premature close are sanitized and do not consume later bytes', async () => {
  for (const event of ['aborted', 'error', 'close']) {
    const body = request();
    const result = assert.rejects(readImageBody(body, 10), failure(400, 'UPLOAD_ABORTED'));
    body.emit(event, new Error('private transport details'));
    await result;
    assert.equal(body.readableFlowing, false);
    assert.doesNotThrow(() => body.emit('error', new Error('private late error')));
    body.destroy();
  }
  const alreadyAborted = request();
  alreadyAborted.aborted = true;
  await assert.rejects(readImageBody(alreadyAborted, 10), failure(400, 'UPLOAD_ABORTED'));
});

test('body deadline is absolute even when bytes keep arriving and frees listeners', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const body = request();
  const result = assert.rejects(readImageBody(body, 10), failure(408, 'UPLOAD_TIMEOUT'));
  body.emit('data', Buffer.from([1]));
  context.mock.timers.tick(19_999);
  body.emit('data', Buffer.from([2]));
  context.mock.timers.tick(1);
  await result;
  assert.equal(body.listenerCount('data'), 0);
  assert.equal(body.listenerCount('aborted'), 0);
  assert.equal(body.readableFlowing, false);
  body.destroy();
});
