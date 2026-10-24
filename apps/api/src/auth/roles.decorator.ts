import { SetMetadata } from '@nestjs/common';
import type { SessionResponse } from '@webwargame/contracts';

export type ApplicationRole = SessionResponse['user']['role'];
export const REQUIRED_ROLES = 'wargame:required-roles';

export const RequireRoles = (...roles: ApplicationRole[]) => SetMetadata(REQUIRED_ROLES, roles);
