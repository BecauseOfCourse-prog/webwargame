import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@webwargame/contracts';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok', service: 'wargame-api' };
  }
}
