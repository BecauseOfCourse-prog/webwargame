import { Body, Controller, Header, Headers, Post, UnsupportedMediaTypeException } from '@nestjs/common';
import type { RegistrationResponse } from '@webwargame/contracts';
import { RegistrationService } from './registration.service.js';

@Controller('auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  register(@Body() body: unknown, @Headers('content-type') contentType?: string): Promise<RegistrationResponse> {
    if (contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException({ code: 'JSON_REQUIRED', message: 'Use application/json.' });
    }
    return this.registration.register(body);
  }
}
