import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { ReadinessController } from './readiness.controller.js';
import { RuntimeConfiguration } from './config/environment.js';
import { PrismaService } from './database/prisma.service.js';

@Module({})
export class AppModule {
  static register(configuration: RuntimeConfiguration): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ReadinessController],
      providers: [
        { provide: RuntimeConfiguration, useValue: configuration },
        PrismaService,
      ],
    };
  }
}
