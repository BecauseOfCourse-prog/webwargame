import 'reflect-metadata';
import { isUtf8 } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CURRENT_USER_PATH, LOGIN_PATH, LOGOUT_PATH, REGISTRATION_PATH } from '@webwargame/contracts';
import { AppModule } from './app.module.js';
import type { RuntimeConfiguration } from './config/environment.js';
import { RegistrationLimiter } from './registration/registration-limiter.js';
import { isTrustedSessionRequest } from './auth/session-request-security.js';

export async function createApplication(configuration: RuntimeConfiguration): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(configuration), {
    abortOnError: false, bodyParser: false,
  });
  app.setGlobalPrefix('api');
  app.use('/api/admin/assets', (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    response.setHeader('Cache-Control', 'private, no-store');
    // Upload errors may leave an unread body; finish the response and close this
    // connection instead of draining attacker-controlled bytes indefinitely.
    if (request.method === 'POST') response.setHeader('Connection', 'close');
    next();
  });
  const limiter = new RegistrationLimiter();
  // Run before JSON parsing so malformed/oversized requests also spend a quota.
  // Use the actual TCP peer, never a caller-controlled forwarding header.
  app.use(REGISTRATION_PATH, (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.method !== 'POST') return next();
    response.setHeader('Cache-Control', 'no-store');
    const retry = limiter.consume(request.socket.remoteAddress ?? 'unknown');
    if (retry !== undefined) {
      response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retry) });
      response.end(JSON.stringify({ code: 'REGISTRATION_RATE_LIMITED', message: 'Too many registration attempts. Try again later.' }));
      return;
    }
    next();
  });
  const loginLimiter = new RegistrationLimiter();
  for (const path of [LOGIN_PATH, CURRENT_USER_PATH, LOGOUT_PATH, '/api/admin']) {
    app.use(path, (request: IncomingMessage, response: ServerResponse, next: () => void) => {
      response.setHeader('Cache-Control', path === '/api/admin' ? 'private, no-store' : 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (path === LOGIN_PATH && request.method === 'POST') {
        const retry = loginLimiter.consume(request.socket.remoteAddress ?? 'unknown');
        if (retry !== undefined) {
          response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retry) });
          response.end(JSON.stringify({ code: 'LOGIN_RATE_LIMITED', message: 'Too many login attempts. Try again later.' }));
          return;
        }
      }
      if (!isTrustedSessionRequest(request, configuration.publicOrigin)) {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ code: 'CSRF_REJECTED', message: 'Request verification failed.' }));
        return;
      }
      next();
    });
  }
  app.useBodyParser('json', {
    limit: '4kb', inflate: false,
    type: (request: IncomingMessage) => {
      if (request.method === 'POST' && /^\/api\/admin\/assets\/?$/i.test(request.url?.split('?')[0] ?? '')) return false;
      return request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() === 'application/json';
    },
    verify: (_request: IncomingMessage, _response: ServerResponse, body: Buffer, encoding: string) => {
      // Reject before iconv's replacement decoding can change a password.
      if (encoding !== 'utf-8') {
        throw Object.assign(new Error('Unsupported JSON charset.'), { status: 415 });
      }
      if (!isUtf8(body)) {
        throw Object.assign(new Error('Invalid UTF-8 JSON.'), { status: 400 });
      }
    },
  });
  // Parser messages can contain fragments of a malformed password-bearing body.
  app.use((error: { status?: number }, _request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
    if (response.headersSent) return next(error);
    const status = error.status === 413 ? 413 : error.status === 415 ? 415 : 400;
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({
      code: status === 413 ? 'BODY_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_ENCODING' : 'INVALID_JSON',
      message: status === 413 ? 'Request body is too large.' : status === 415 ? 'Use uncompressed UTF-8 JSON.' : 'Request body must be valid JSON.',
    }));
  });
  app.enableShutdownHooks();
  return app;
}
