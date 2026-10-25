import 'reflect-metadata';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: pnpm assets:cleanup [--apply] [--limit <1-100>]';
export function parseCleanupArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  let apply = false;
  let limit = 25;
  let suppliedLimit = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--apply' && !apply) apply = true;
    else if (args[index] === '--limit' && !suppliedLimit && /^[1-9]\d{0,2}$/.test(args[index + 1] ?? '')) {
      limit = Number(args[++index]); suppliedLimit = true;
      if (limit > 100) throw new Error(usage);
    } else throw new Error(usage);
  }
  return { apply, limit };
}

export async function main(args = process.argv.slice(2)) {
  let parsed;
  try { parsed = parseCleanupArguments(args); }
  catch { console.error(usage); return 1; }
  if (parsed.help) { console.log(usage); return 0; }
  let database;
  try {
    const [{ loadConfiguration }, { PrismaService }, { AssetCleanupService }] = await Promise.all([
      import('../dist/config/environment.js'), import('../dist/database/prisma.service.js'), import('../dist/assets/asset-cleanup.service.js'),
    ]);
    const configuration = loadConfiguration();
    database = new PrismaService(configuration);
    await database.onModuleInit();
    const report = await new AssetCleanupService(database, configuration).run(parsed);
    console.log(JSON.stringify(report));
    return report.failed > 0 ? 1 : 0;
  } catch (error) {
    console.error(error?.code === 'CLEANUP_BUSY'
      ? 'Cleanup is blocked by asset activity or maintenance. Stop writers and follow the documented offline recovery steps for stale markers.'
      : 'Asset cleanup failed. Check configuration, private storage access, database availability and migrations.');
    return 1;
  } finally { await database?.onModuleDestroy().catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
