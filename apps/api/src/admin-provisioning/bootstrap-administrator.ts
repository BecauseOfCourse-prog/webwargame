import { PrismaService } from '../database/prisma.service.js';

export type AdministratorBootstrapErrorCode =
  | 'INVALID_USERNAME'
  | 'USER_NOT_FOUND'
  | 'ADMIN_ALREADY_EXISTS'
  | 'BOOTSTRAP_UNAVAILABLE';

export class AdministratorBootstrapError extends Error {
  constructor(public readonly code: AdministratorBootstrapErrorCode) {
    // Never retain driver details, environment values or supplied arguments.
    super(code);
  }
}

export function parseBootstrapUsername(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{3,32}$/.test(value.trim())) {
    throw new AdministratorBootstrapError('INVALID_USERNAME');
  }
  return value.trim().toLowerCase();
}

export interface AdministratorBootstrapResult {
  status: 'promoted' | 'already-admin';
}

/** Initial provisioning only. Later administrator management belongs to T11. */
export async function bootstrapAdministrator(
  database: PrismaService,
  username: unknown,
): Promise<AdministratorBootstrapResult> {
  const normalizedUsername = parseBootstrapUsername(username);
  try {
    return await database.$transaction(async (transaction) => {
      // Share the migration's statement-trigger protocol before touching users.
      // A real row update also makes higher-isolation conflicts fail safely.
      const guards = await transaction.$executeRaw`
        UPDATE "AdministratorGuard" SET "id" = "id" WHERE "id" = 1
      `;
      if (guards !== 1) throw new AdministratorBootstrapError('BOOTSTRAP_UNAVAILABLE');

      const user = await transaction.user.findUnique({
        where: { normalizedUsername }, select: { id: true, role: true },
      });
      if (!user) throw new AdministratorBootstrapError('USER_NOT_FOUND');
      if (user.role === 'ADMIN') return { status: 'already-admin' };
      const otherAdministrator = await transaction.user.findFirst({
        where: { role: 'ADMIN', id: { not: user.id } }, select: { id: true },
      });
      if (otherAdministrator) throw new AdministratorBootstrapError('ADMIN_ALREADY_EXISTS');

      await transaction.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      // A player session must not gain administrator rights without a new login.
      await transaction.session.deleteMany({ where: { userId: user.id } });
      return { status: 'promoted' };
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 5000 });
  } catch (error) {
    if (error instanceof AdministratorBootstrapError) throw error;
    throw new AdministratorBootstrapError('BOOTSTRAP_UNAVAILABLE');
  }
}
