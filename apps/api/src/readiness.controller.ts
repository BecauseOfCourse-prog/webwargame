import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { ReadinessResponse } from '@webwargame/contracts';
import { PrismaService } from './database/prisma.service.js';

@Controller('ready')
export class ReadinessController {
  constructor(private readonly database: PrismaService) {}

  @Get()
  async getReadiness(): Promise<ReadinessResponse> {
    try {
      await this.database.checkConnection();
      return { status: 'ready', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database is unavailable.');
    }
  }
}
