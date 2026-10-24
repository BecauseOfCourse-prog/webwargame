import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RegistrationResponse } from '@webwargame/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PasswordHasher } from './password-hasher.js';
import { parseRegistrationInput } from './registration-input.js';

function isUsernameConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  if (Array.isArray(error.meta?.target) && error.meta.target.includes('normalizedUsername')) return true;
  // Prisma's PostgreSQL adapter can retain the constraint inside the original
  // driver error rather than returning the older meta.target field list.
  const adapterError = error.meta?.driverAdapterError;
  if (typeof adapterError !== 'object' || adapterError === null || !('cause' in adapterError)) return false;
  const cause = adapterError.cause;
  if (typeof cause !== 'object' || cause === null || !('constraint' in cause)) return false;
  const constraint = cause.constraint;
  return typeof constraint === 'object' && constraint !== null && 'index' in constraint &&
    constraint.index === 'User_normalizedUsername_key';
}

@Injectable()
export class RegistrationService {
  constructor(private readonly database: PrismaService, private readonly passwords: PasswordHasher) {}

  async register(value: unknown): Promise<RegistrationResponse> {
    const input = parseRegistrationInput(value);
    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.database.user.create({
        data: {
          username: input.username,
          normalizedUsername: input.username.toLowerCase(),
          passwordHash,
          role: 'PLAYER',
        },
        select: { id: true, username: true, createdAt: true },
      });
      return { user: { ...user, role: 'PLAYER', createdAt: user.createdAt.toISOString() } };
    } catch (error) {
      if (isUsernameConflict(error)) {
        throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'This username is already taken.' });
      }
      // Raw Prisma/driver diagnostics may include data or connection details.
      throw new ServiceUnavailableException({
        code: 'REGISTRATION_UNAVAILABLE', message: 'Registration is temporarily unavailable. Try again shortly.',
      });
    }
  }
}
