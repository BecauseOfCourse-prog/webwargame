import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { SessionResponse } from '@webwargame/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { authUnavailable, unauthenticated } from './auth-errors.js';
import { createSessionToken, csrfTokenForSession, hashSessionToken, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './session-security.js';

interface SessionRow {
  id: string;
  username: string;
  role: 'PLAYER' | 'ADMIN';
  expiresAt: Date;
  idleExpiresAt: Date;
}

export interface SessionIdentity {
  id: string;
  username: string;
  role: 'PLAYER' | 'ADMIN';
}

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly database: PrismaService) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch(() => this.logger.warn('Session cleanup failed; it will be retried.'));
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async create(user: SessionIdentity, previousToken?: string): Promise<{ token: string; response: SessionResponse }> {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    try {
      const deadlines = await this.database.$transaction(async (transaction) => {
        // Replace only the session presented by this browser, after credentials
        // have been verified. A failed insert rolls this deletion back.
        if (previousToken) await transaction.session.deleteMany({ where: { tokenHash: hashSessionToken(previousToken) } });
        return transaction.$queryRaw<Pick<SessionRow, 'expiresAt' | 'idleExpiresAt'>[]>`
          INSERT INTO "Session" ("tokenHash", "userId", "createdAt", "expiresAt", "idleExpiresAt")
          VALUES (${tokenHash}, ${user.id}::uuid, CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + ${SESSION_ABSOLUTE_MS} * INTERVAL '1 millisecond',
            CURRENT_TIMESTAMP + ${SESSION_IDLE_MS} * INTERVAL '1 millisecond')
          RETURNING "expiresAt", "idleExpiresAt"
        `;
      });
      const deadline = deadlines[0];
      if (!deadline) throw new Error('Session was not created.');
      return { token, response: this.response({ ...user, ...deadline }, token) };
    } catch {
      throw authUnavailable();
    }
  }

  async current(token: string | undefined, touch = true): Promise<SessionResponse> {
    if (!token) throw unauthenticated();
    const tokenHash = hashSessionToken(token);
    let rows: SessionRow[];
    try {
      rows = touch ? await this.database.$queryRaw<SessionRow[]>`
        UPDATE "Session" s
        SET "idleExpiresAt" = GREATEST(s."idleExpiresAt", LEAST(s."expiresAt", CURRENT_TIMESTAMP + ${SESSION_IDLE_MS} * INTERVAL '1 millisecond'))
        FROM "User" u
        WHERE s."tokenHash" = ${tokenHash} AND s."userId" = u."id"
          AND s."expiresAt" > CURRENT_TIMESTAMP AND s."idleExpiresAt" > CURRENT_TIMESTAMP
        RETURNING u."id", u."username", u."role", s."expiresAt", s."idleExpiresAt"
      ` : await this.database.$queryRaw<SessionRow[]>`
        SELECT u."id", u."username", u."role", s."expiresAt", s."idleExpiresAt"
        FROM "Session" s JOIN "User" u ON s."userId" = u."id"
        WHERE s."tokenHash" = ${tokenHash} AND s."expiresAt" > CURRENT_TIMESTAMP AND s."idleExpiresAt" > CURRENT_TIMESTAMP
      `;
    } catch {
      throw authUnavailable();
    }
    const row = rows[0];
    if (!row) throw unauthenticated();
    return this.response(row, token);
  }

  async remove(token: string): Promise<void> {
    try {
      await this.database.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    } catch {
      throw authUnavailable();
    }
  }

  async cleanupExpired(): Promise<void> {
    try {
      // Recheck expiry on the target row after any concurrent update/lock wait.
      // A candidate selected from the earlier snapshot may have been renewed.
      await this.database.$executeRaw`
        DELETE FROM "Session"
        WHERE ("expiresAt" <= CURRENT_TIMESTAMP OR "idleExpiresAt" <= CURRENT_TIMESTAMP)
          AND "tokenHash" IN (
          SELECT "tokenHash" FROM "Session"
          WHERE "expiresAt" <= CURRENT_TIMESTAMP OR "idleExpiresAt" <= CURRENT_TIMESTAMP LIMIT 1000
        )
      `;
    } catch {
      throw authUnavailable();
    }
  }

  private response(row: SessionRow, token: string): SessionResponse {
    return {
      user: { id: row.id, username: row.username, role: row.role },
      csrfToken: csrfTokenForSession(token),
      expiresAt: row.expiresAt.toISOString(), idleExpiresAt: row.idleExpiresAt.toISOString(),
    };
  }
}
