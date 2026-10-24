import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Res, UnsupportedMediaTypeException } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { SessionResponse } from '@webwargame/contracts';
import { RuntimeConfiguration } from '../config/environment.js';
import { LoginRateLimitException } from './auth-errors.js';
import { AuthService } from './auth.service.js';
import { buildSessionCookie, clearSessionCookie, isValidCsrfToken, readSessionToken } from './session-security.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authentication: AuthService, private readonly sessions: SessionService,
    private readonly configuration: RuntimeConfiguration) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Headers('cookie') cookie: string | undefined,
    @Headers('content-type') contentType: string | undefined, @Res({ passthrough: true }) response: ServerResponse): Promise<SessionResponse> {
    this.requireJson(contentType);
    try {
      const result = await this.authentication.login(body, readSessionToken(cookie, this.configuration.secureCookies));
      response.setHeader('Set-Cookie', buildSessionCookie(result.token, new Date(result.response.expiresAt), this.configuration.secureCookies));
      return result.response;
    } catch (error) {
      if (error instanceof LoginRateLimitException) response.setHeader('Retry-After', String(error.retryAfter));
      throw error;
    }
  }

  @Get('me')
  current(@Headers('cookie') cookie: string | undefined): Promise<SessionResponse> {
    // Neither success nor failure changes the cookie: a delayed response from an
    // old session must not erase the cookie issued by a concurrent new login.
    return this.sessions.current(readSessionToken(cookie, this.configuration.secureCookies));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Headers('cookie') cookie: string | undefined, @Headers('x-csrf-token') csrfToken: string | undefined,
    @Headers('content-type') contentType: string | undefined, @Res({ passthrough: true }) response: ServerResponse): Promise<void> {
    this.requireJson(contentType);
    const token = readSessionToken(cookie, this.configuration.secureCookies);
    await this.sessions.current(token, false);
    if (!token || !isValidCsrfToken(token, csrfToken)) {
      throw new ForbiddenException({ code: 'CSRF_REJECTED', message: 'Request verification failed.' });
    }
    await this.sessions.remove(token);
    response.setHeader('Set-Cookie', clearSessionCookie(this.configuration.secureCookies));
  }

  private requireJson(contentType: string | undefined): void {
    if (contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException({ code: 'JSON_REQUIRED', message: 'Use application/json.' });
    }
  }

}
