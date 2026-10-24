import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { ReadinessController } from './readiness.controller.js';
import { RuntimeConfiguration } from './config/environment.js';
import { PrismaService } from './database/prisma.service.js';
import { PasswordHasher } from './registration/password-hasher.js';
import { RegistrationController } from './registration/registration.controller.js';
import { RegistrationService } from './registration/registration.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionService } from './auth/session.service.js';

@Module({})
export class AppModule {
  static register(configuration: RuntimeConfiguration): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ReadinessController, RegistrationController, AuthController],
      providers: [
        { provide: RuntimeConfiguration, useValue: configuration },
        PrismaService,
        PasswordHasher,
        RegistrationService,
        AuthService,
        SessionService,
      ],
    };
  }
}
