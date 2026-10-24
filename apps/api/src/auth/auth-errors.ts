import { HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
}

export function unauthenticated(): UnauthorizedException {
  return new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
}

export function authUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable. Try again shortly.' });
}

export class LoginRateLimitException extends HttpException {
  constructor(public readonly retryAfter: number) {
    super({ code: 'LOGIN_RATE_LIMITED', message: 'Too many login attempts. Try again later.' }, 429);
  }
}
