import 'reflect-metadata';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: pnpm admin:bootstrap --username <existing-player-username>';
const messages = {
  INVALID_USERNAME: 'Use an existing username with 3–32 Latin letters, digits, periods, hyphens or underscores.',
  USER_NOT_FOUND: 'Account not found. Register the player first, then run this command with that username.',
  ADMIN_ALREADY_EXISTS: 'An administrator already exists. This command only provisions the first administrator.',
  BOOTSTRAP_UNAVAILABLE: 'Administrator provisioning failed. Check local configuration, database availability and migrations.',
};

export function parseBootstrapArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length !== 2 || args[0] !== '--username' ||
      !/^[A-Za-z0-9._-]{3,32}$/.test(args[1]?.trim() ?? '')) {
    throw new Error(usage);
  }
  return { username: args[1].trim() };
}

export async function main(args = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseBootstrapArguments(args);
  } catch {
    console.error(usage);
    return 1;
  }
  if (parsed.help) {
    console.log(usage);
    return 0;
  }

  let database;
  try {
    const [{ loadConfiguration }, { PrismaService }, { bootstrapAdministrator }] = await Promise.all([
      import('../dist/config/environment.js'),
      import('../dist/database/prisma.service.js'),
      import('../dist/admin-provisioning/bootstrap-administrator.js'),
    ]);
    database = new PrismaService(loadConfiguration());
    await database.onModuleInit();
    const result = await bootstrapAdministrator(database, parsed.username);
    console.log(result.status === 'promoted'
      ? 'Initial administrator assigned. Existing sessions were revoked; sign in again.'
      : 'This account is already the initial administrator. No changes were made.');
    return 0;
  } catch (error) {
    console.error(Object.hasOwn(messages, error?.code) ? messages[error.code] : messages.BOOTSTRAP_UNAVAILABLE);
    return 1;
  } finally {
    if (database) await database.onModuleDestroy().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
