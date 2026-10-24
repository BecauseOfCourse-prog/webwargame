import type { IncomingMessage } from 'node:http';

export function isTrustedSessionRequest(request: IncomingMessage, publicOrigin: string): boolean {
  const origin = request.headers.origin;
  const mutation = request.method !== 'GET' && request.method !== 'HEAD';
  return request.headers['x-wargame-request'] === '1' &&
    (mutation ? origin === publicOrigin : origin === undefined || origin === publicOrigin);
}
