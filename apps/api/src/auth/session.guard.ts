import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { SessionResponse } from '@webwargame/contracts';
import type { IncomingMessage } from 'node:http';
import { RuntimeConfiguration } from '../config/environment.js';
import { isTrustedSessionRequest } from './session-request-security.js';
import { isValidCsrfToken, readSessionToken } from './session-security.js';
import { SessionService } from './session.service.js';

export interface AuthenticatedRequest extends IncomingMessage {
  authenticatedSession?: SessionResponse;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService, private readonly configuration: RuntimeConfiguration) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!isTrustedSessionRequest(request, this.configuration.publicOrigin)) throw requestRejected();

    const token = readSessionToken(request.headers.cookie, this.configuration.secureCookies);
    const mutation = request.method !== 'GET' && request.method !== 'HEAD';
    if (mutation) {
      // Authenticate without extending idle time until the CSRF check succeeds.
      // A later transaction must still enforce its own domain permissions.
      await this.sessions.current(token, false);
      const supplied = request.headers['x-csrf-token'];
      if (!token || typeof supplied !== 'string' || !isValidCsrfToken(token, supplied)) throw requestRejected();
    }
    request.authenticatedSession = await this.sessions.current(token);
    return true;
  }
}

function requestRejected(): ForbiddenException {
  return new ForbiddenException({ code: 'CSRF_REJECTED', message: 'Request verification failed.' });
}
