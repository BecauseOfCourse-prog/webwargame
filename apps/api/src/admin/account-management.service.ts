import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { AccountAuditResponse, AccountAuditEntry, AdminAccount, AdminAccountsResponse } from '@webwargame/contracts';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

const unavailable = () => new ServiceUnavailableException({ code: 'ACCOUNT_UNAVAILABLE', message: 'Account management is temporarily unavailable.' });
const conflict = () => new ConflictException({ code: 'ACCOUNT_CONFLICT', message: 'The account changed. Refresh and try again.' });
const lastAdmin = () => new ConflictException({ code: 'LAST_ACTIVE_ADMIN', message: 'The last administrator with working access cannot be disabled.' });
const validInput = () => new BadRequestException({ code: 'INVALID_ACCOUNT_INPUT', message: 'Check the account action.' });
const pageSize = 20;
type Actor = { id: string; tokenHash: string };

function account(row: { id: string; username: string; role: 'PLAYER' | 'ADMIN'; suspendedAt: Date | null; passwordResetRequired: boolean; version: number; createdAt: Date; passwordReset?: { expiresAt: Date } | null }): AdminAccount {
  return { id: row.id, username: row.username, role: row.role, suspendedAt: row.suspendedAt?.toISOString() ?? null,
    passwordResetRequired: row.passwordResetRequired, resetExpiresAt: row.passwordReset?.expiresAt.toISOString() ?? null,
    version: row.version, createdAt: row.createdAt.toISOString() };
}
function parsePage(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/.test(value)) throw validInput();
  const page = Number(value); if (page > 10_000) throw validInput(); return page;
}
function parseTarget(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Account not found.' });
  return id;
}
function parseVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw validInput(); return value as number;
}

@Injectable()
export class AccountManagementService {
  private readonly issueAttempts = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly database: PrismaService) {}

  async list(actor: Actor, rawSearch: unknown, rawPage: unknown): Promise<AdminAccountsResponse> {
    const page = parsePage(rawPage);
    if (typeof rawSearch !== 'string' || rawSearch.length > 32 || !/^[A-Za-z0-9._-]*$/.test(rawSearch.trim())) throw validInput();
    const search = rawSearch.trim().toLowerCase();
    try {
      return await this.database.$transaction(async (tx) => {
        await this.requireActor(tx, actor);
        // Prisma translates contains to LIKE; escape the user's literal wildcard
        // characters so `_` and `%` search for themselves.
        const literalSearch = search.replace(/[\\%_]/g, '\\$&');
        const where = search ? { normalizedUsername: { contains: literalSearch } } : {};
        const [rows, total, activeAdministrators] = await Promise.all([
          tx.user.findMany({ where, orderBy: [{ normalizedUsername: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
            select: { id: true, username: true, role: true, suspendedAt: true, passwordResetRequired: true, version: true, createdAt: true, passwordReset: { select: { expiresAt: true } } } }),
          tx.user.count({ where }),
          tx.user.count({ where: { role: 'ADMIN', suspendedAt: null, passwordResetRequired: false } }),
        ]);
        return { accounts: rows.map(account), page, pageSize, total, activeAdministrators };
      }, { isolationLevel: 'ReadCommitted', timeout: 5000, maxWait: 5000 });
    } catch (error) { if (isHttp(error)) throw error; throw unavailable(); }
  }

  async audit(actor: Actor, targetId: string, rawPage: unknown): Promise<AccountAuditResponse> {
    const id = parseTarget(targetId); const page = parsePage(rawPage);
    try { return await this.database.$transaction(async (tx) => {
      await this.requireActor(tx, actor);
      const target = await tx.user.findUnique({ where: { id }, select: { id: true } });
      if (!target) throw accountNotFound();
      const where = { targetId: id };
      const [rows, total] = await Promise.all([tx.accountAudit.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        include: { actor: { select: { id: true, username: true } } } }), tx.accountAudit.count({ where })]);
      return { events: rows.map((row): AccountAuditEntry => ({ id: row.id, actor: row.actor, targetId: row.targetId, action: row.action,
        fromRole: row.fromRole, toRole: row.toRole, fromSuspended: row.fromSuspended, toSuspended: row.toSuspended, createdAt: row.createdAt.toISOString() })), page, pageSize, total };
    }, { isolationLevel: 'ReadCommitted', timeout: 5000, maxWait: 5000 }); } catch (error) { if (isHttp(error)) throw error; throw unavailable(); }
  }

  async changeRole(actor: Actor, targetId: string, value: unknown): Promise<{ account: AdminAccount }> {
    if (!isObject(value) || Object.keys(value).sort().join(',') !== 'role,version' || !['ADMIN','PLAYER'].includes(String(value.role))) throw validInput();
    return this.mutate(actor, targetId, parseVersion(value.version), 'ROLE_CHANGED', value.role as 'ADMIN' | 'PLAYER');
  }
  async changeSuspension(actor: Actor, targetId: string, value: unknown): Promise<{ account: AdminAccount }> {
    if (!isObject(value) || Object.keys(value).sort().join(',') !== 'suspended,version' || typeof value.suspended !== 'boolean') throw validInput();
    return this.mutate(actor, targetId, parseVersion(value.version), value.suspended ? 'SUSPENDED' : 'RESUMED', value.suspended);
  }

  private async mutate(actor: Actor, targetId: string, version: number, action: 'ROLE_CHANGED' | 'SUSPENDED' | 'RESUMED', next: 'ADMIN' | 'PLAYER' | boolean): Promise<{ account: AdminAccount }> {
    const id = parseTarget(targetId);
    try { return await this.database.$transaction(async (tx) => {
      await this.lockGuard(tx); await this.requireActor(tx, actor);
      const before = await tx.user.findUnique({ where: { id }, select: { id: true, username: true, role: true, suspendedAt: true, passwordResetRequired: true, version: true, createdAt: true, passwordReset: { select: { expiresAt: true } } } });
      if (!before) throw accountNotFound(); if (before.version !== version) throw conflict();
      const role = typeof next === 'boolean' ? before.role : next;
      const suspended = typeof next === 'boolean' ? next : before.suspendedAt !== null;
      if (role === before.role && suspended === (before.suspendedAt !== null)) return { account: account(before) };
      const removingWorkingAdmin = before.role === 'ADMIN' && before.suspendedAt === null && !before.passwordResetRequired && (role !== 'ADMIN' || suspended);
      if (removingWorkingAdmin) {
        const active = await tx.user.count({ where: { role: 'ADMIN', suspendedAt: null, passwordResetRequired: false } });
        if (active <= 1) throw lastAdmin();
      }
      const updated = await tx.user.update({ where: { id }, data: typeof next === 'boolean' ? { suspendedAt: next ? new Date() : null } : { role: next },
        select: { id: true, username: true, role: true, suspendedAt: true, passwordResetRequired: true, version: true, createdAt: true, passwordReset: { select: { expiresAt: true } } } });
      await tx.accountAudit.create({ data: { actorId: actor.id, targetId: id, action, fromRole: before.role, toRole: updated.role,
        fromSuspended: before.suspendedAt !== null, toSuspended: updated.suspendedAt !== null } });
      return { account: account(updated) };
    }, { isolationLevel: 'ReadCommitted', timeout: 5000, maxWait: 5000 }); } catch (error) { if (isHttp(error)) throw error; if (isLastAdminDb(error)) throw lastAdmin(); if (isConflictDb(error)) throw conflict(); throw unavailable(); }
  }

  async issueReset(actor: Actor, targetId: string, value: unknown): Promise<{ account: AdminAccount; code: string; expiresAt: string }> {
    if (!isObject(value) || Object.keys(value).join(',') !== 'version') throw validInput();
    const version = parseVersion(value.version); const id = parseTarget(targetId); const code = randomBytes(32).toString('base64url');
    if (!this.consumeIssueQuota(actor.id, id)) throw new HttpException({ code: 'RESET_RATE_LIMITED', message: 'Too many reset codes were issued.' }, 429);
    const tokenHash = createHash('sha256').update(code).digest('hex'); const now = new Date(); const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    try { const result = await this.database.$transaction(async (tx) => {
      await this.lockGuard(tx); await this.requireActor(tx, actor);
      const before = await tx.user.findUnique({ where: { id }, select: { id: true, username: true, role: true, suspendedAt: true, passwordResetRequired: true, version: true, createdAt: true } });
      if (!before) throw accountNotFound(); if (before.version !== version) throw conflict();
      if (before.suspendedAt) throw validInput();
      if (before.role === 'ADMIN' && before.suspendedAt === null && !before.passwordResetRequired &&
        await tx.user.count({ where: { role: 'ADMIN', suspendedAt: null, passwordResetRequired: false } }) <= 1) throw lastAdmin();
      const updated = await tx.user.update({ where: { id }, data: { passwordResetRequired: true, version: { increment: 1 } }, select: {
        id: true, username: true, role: true, suspendedAt: true, passwordResetRequired: true, version: true, createdAt: true,
      } });
      await tx.passwordReset.create({ data: { tokenHash, userId: id, userVersion: updated.version, createdAt: now, expiresAt } });
      await tx.accountAudit.create({ data: { actorId: actor.id, targetId: id, action: 'PASSWORD_RESET_ISSUED', fromRole: before.role, toRole: updated.role,
        fromSuspended: before.suspendedAt !== null, toSuspended: updated.suspendedAt !== null } });
      return account({ ...updated, passwordReset: { expiresAt } });
    }, { isolationLevel: 'ReadCommitted', timeout: 5000, maxWait: 5000 }); return { account: result, code, expiresAt: expiresAt.toISOString() };
    } catch (error) { if (isHttp(error)) throw error; if (isLastAdminDb(error)) throw lastAdmin(); if (isConflictDb(error)) throw conflict(); throw unavailable(); }
  }

  private async lockGuard(tx: Prisma.TransactionClient): Promise<void> { const count = await tx.$executeRaw`UPDATE "AdministratorGuard" SET "id" = "id" WHERE "id" = 1`; if (count !== 1) throw unavailable(); }
  private consumeIssueQuota(actorId: string, targetId: string): boolean {
    const now = Date.now();
    for (const [key, state] of this.issueAttempts) if (state.expiresAt <= now) this.issueAttempts.delete(key);
    const actorKey = `actor:${actorId}`; const targetKey = `target:${targetId}`;
    const actor = this.issueAttempts.get(actorKey); const target = this.issueAttempts.get(targetKey);
    if (this.issueAttempts.size + (actor ? 0 : 1) + (target ? 0 : 1) > 4096 || (actor?.count ?? 0) >= 20 || (target?.count ?? 0) >= 5) return false;
    const expiry = now + 15 * 60_000;
    this.issueAttempts.set(actorKey, { count: (actor?.count ?? 0) + 1, expiresAt: actor?.expiresAt ?? expiry });
    this.issueAttempts.set(targetKey, { count: (target?.count ?? 0) + 1, expiresAt: target?.expiresAt ?? expiry });
    return true;
  }
  private async requireActor(tx: Prisma.TransactionClient, actor: Actor): Promise<void> {
    const row = await tx.session.findUnique({ where: { tokenHash: actor.tokenHash }, include: { user: true } });
    if (!row || row.expiresAt <= new Date() || row.idleExpiresAt <= new Date()) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
    if (row.user.id !== actor.id || row.user.role !== 'ADMIN' || row.user.suspendedAt || row.user.passwordResetRequired) throw new ForbiddenException({ code: 'ACCESS_DENIED', message: 'Administrator access is required.' });
  }
}
function accountNotFound() { return new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Account not found.' }); }
function isObject(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function isHttp(e: unknown): e is { getStatus(): number } { return e instanceof Error && 'getStatus' in e && typeof (e as {getStatus?: unknown}).getStatus === 'function'; }
function isLastAdminDb(e: unknown): boolean { return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2004'; }
function isConflictDb(e: unknown): boolean { return e instanceof Prisma.PrismaClientKnownRequestError && ['P2025','P2034'].includes(e.code); }
