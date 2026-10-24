import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AdminOverviewResponse } from '@webwargame/contracts';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';

@Controller('admin')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('ADMIN')
export class AdminController {
  @Get('overview')
  overview(@Req() request: AuthenticatedRequest): AdminOverviewResponse {
    const user = request.authenticatedSession!.user;
    return { status: 'ready', user: { id: user.id, username: user.username, role: 'ADMIN' } };
  }
}
