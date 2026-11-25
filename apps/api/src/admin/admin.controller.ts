import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { AdminOverviewResponse } from '@webwargame/contracts';
import type { ServerResponse } from 'node:http';
import { RequireRoles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { RuntimeConfiguration } from '../config/environment.js';
import { readSessionToken, hashSessionToken } from '../auth/session-security.js';
import { AccountManagementService } from './account-management.service.js';

@Controller('admin')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('ADMIN')
export class AdminController {
  constructor(private readonly accounts: AccountManagementService, private readonly configuration: RuntimeConfiguration) {}

  @Get('overview')
  overview(@Req() request: AuthenticatedRequest): AdminOverviewResponse {
    const user = request.authenticatedSession!.user;
    return { status: 'ready', user: { id: user.id, username: user.username, role: 'ADMIN' } };
  }

  @Get('accounts') list(@Req() request: AuthenticatedRequest, @Query('search') search: string | undefined,
    @Query('page') page: string | undefined) {
    return this.accounts.list(this.actor(request), search ?? '', page ?? '1');
  }
  @Get('accounts/:id/audit') audit(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Query('page') page: string | undefined) {
    return this.accounts.audit(this.actor(request), id, page ?? '1');
  }
  @Post('accounts/:id/role') @HttpCode(200) role(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.accounts.changeRole(this.actor(request), id, body);
  }
  @Post('accounts/:id/suspension') @HttpCode(200) suspension(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.accounts.changeSuspension(this.actor(request), id, body);
  }
  @Post('accounts/:id/password-reset') @HttpCode(201) async reset(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown,
    @Res({ passthrough: true }) response: ServerResponse) {
    try { return await this.accounts.issueReset(this.actor(request), id, body); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'getStatus' in error && typeof error.getStatus === 'function' && error.getStatus() === 429) {
        response.setHeader('Retry-After', '900');
      }
      throw error;
    }
  }
  private actor(request: AuthenticatedRequest) {
    const token = readSessionToken(request.headers.cookie, this.configuration.secureCookies);
    return { id: request.authenticatedSession!.user.id, tokenHash: hashSessionToken(token!) };
  }
}
