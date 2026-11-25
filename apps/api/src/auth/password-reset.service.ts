import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PasswordHasher } from '../registration/password-hasher.js';
import { authUnavailable } from './auth-errors.js';

const invalidCode = () => new BadRequestException({ code: 'RESET_INVALID_OR_EXPIRED', message: 'The reset code is invalid or expired.' });
const invalidInput = () => new BadRequestException({ code: 'INVALID_RESET_INPUT', message: 'Check the reset code and new password.' });
const codePattern = /^[A-Za-z0-9_-]{43}$/;
const digest = (code: string) => createHash('sha256').update(code).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
export class PasswordResetService {
  private readonly attempts = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly database: PrismaService, private readonly passwords: PasswordHasher) {}

  async reset(value: unknown): Promise<void> {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'code,password' || typeof value.code !== 'string' ||
      !codePattern.test(value.code) || typeof value.password !== 'string' || [...value.password].length < 15 ||
      [...value.password].length > 128 || /[\p{Cc}\p{Cs}]/u.test(value.password)) throw invalidInput();
    const code = value.code; const key = digest(code);
    if (!this.consume(key)) throw new HttpException({ code: 'RESET_RATE_LIMITED', message: 'Too many reset attempts.' }, 429);
    let reset;
    try { reset = await this.database.passwordReset.findUnique({ where: { tokenHash: key }, include: { user: true } }); }
    catch { throw authUnavailable(); }
    const now = new Date();
    if (!reset || reset.expiresAt <= now || reset.user.suspendedAt || !reset.user.passwordResetRequired || reset.user.version !== reset.userVersion) throw invalidCode();
    // Argon2 runs outside the account lock, then the code/version/expiry are
    // checked again under the same guard as admin mutations and login.
    const passwordHash = await this.passwords.hash(value.password);
    try { await this.database.$transaction(async (tx) => {
      const guards = await tx.$executeRaw`UPDATE "AdministratorGuard" SET "id" = "id" WHERE "id" = 1`;
      if (guards !== 1) throw authUnavailable();
      const current = await tx.passwordReset.findUnique({ where: { tokenHash: key }, include: { user: true } });
      const checkedAt = new Date();
      if (!current || current.expiresAt <= checkedAt || current.user.suspendedAt || !current.user.passwordResetRequired || current.user.version !== current.userVersion) throw invalidCode();
      await tx.user.update({ where: { id: current.userId }, data: { passwordHash, passwordResetRequired: false } });
      await tx.accountAudit.create({ data: { actorId: null, targetId: current.userId, action: 'PASSWORD_RESET_COMPLETED', fromRole: current.user.role,
        toRole: current.user.role, fromSuspended: false, toSuspended: false } });
    }, { isolationLevel: 'ReadCommitted', timeout: 5000, maxWait: 5000 }); }
    catch (error) {
      if (error instanceof BadRequestException || error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2025','P2034'].includes(error.code)) throw invalidCode();
      throw authUnavailable();
    }
  }

  private consume(key: string): boolean {
    const now = Date.now();
    for (const [stored, state] of this.attempts) if (state.expiresAt <= now) this.attempts.delete(stored);
    let state = this.attempts.get(key);
    if (!state) { if (this.attempts.size >= 4096) return false; state = { count: 0, expiresAt: now + 15 * 60_000 }; this.attempts.set(key, state); }
    if (state.count >= 5) return false; state.count += 1; return true;
  }
}
