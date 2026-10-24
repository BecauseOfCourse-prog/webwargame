import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApplicationRole } from './roles.decorator.js';
import { REQUIRED_ROLES } from './roles.decorator.js';
import type { AuthenticatedRequest } from './session.guard.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<readonly ApplicationRole[]>(REQUIRED_ROLES,
      [context.getHandler(), context.getClass()]);
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().authenticatedSession?.user;
    // Missing metadata or a missing preceding SessionGuard must fail closed.
    if (!user || !roles?.includes(user.role)) {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: 'You do not have access to this resource.' });
    }
    return true;
  }
}
