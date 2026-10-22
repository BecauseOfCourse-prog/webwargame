import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { loadConfiguration } from '../dist/config/environment.js';
import { assertLocalDatabaseTarget } from './local-database-target.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const composeFile = fileURLToPath(new URL('../../../compose.yaml', import.meta.url));
const configuration = loadConfiguration();
const sourceUrl = assertLocalDatabaseTarget(configuration.databaseUrl, process.env);
const databaseName = `t02_verify_${randomBytes(12).toString('hex')}`;
const marker = randomBytes(24).toString('hex');
const migrationEntries = await readdir(new URL('../prisma/migrations/', import.meta.url), {
  withFileTypes: true,
});
const expectedMigrations = migrationEntries.filter((entry) => entry.isDirectory()).length;

assert.match(databaseName, /^t02_verify_[a-f0-9]{24}$/);

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    // Avoid dumping environment variables or raw driver errors/URLs on failure.
    throw new Error('Database verification command failed; check local Docker and migration status.');
  }
  return result.stdout.trim();
}

function compose(args) {
  return run('docker', ['compose', '--project-name', 'webwargame-local', '--file', composeFile, ...args]);
}

function adminSql(sql) {
  return compose([
    'exec', '-T', 'postgres', 'psql', '-U', process.env.POSTGRES_USER,
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ]);
}

function migrate(url) {
  const executable = process.env.npm_execpath;
  assert.ok(executable, 'Run this check through pnpm db:verify.');
  const nativeExecutable = executable.endsWith('.exe');
  run(
    nativeExecutable ? executable : process.execPath,
    [...(nativeExecutable ? [] : [executable]), '--filter', '@webwargame/api', 'db:migrate'],
    { ...process.env, DATABASE_URL: url },
  );
}

function client(url) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 1 }),
    log: [],
  });
}

let created = false;
let database;

try {
  adminSql(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;

  migrate(testUrl.href);
  migrate(testUrl.href);
  database = client(testUrl.href);
  const migrations = await database.$queryRaw`
    SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
  `;
  assert.ok(expectedMigrations > 0, 'At least one committed migration is required.');
  assert.equal(migrations[0].count, expectedMigrations, 'Each committed migration must apply exactly once.');

  await database.$executeRaw`CREATE SCHEMA t02_verification`;
  await database.$executeRaw`CREATE TABLE t02_verification.marker (id integer PRIMARY KEY, value text NOT NULL)`;
  await database.$executeRaw`INSERT INTO t02_verification.marker (id, value) VALUES (1, ${marker})`;
  await database.$disconnect();
  database = undefined;

  const previousContainer = compose(['ps', '-q', 'postgres']);
  console.log('Disposable database migrated twice; marker written. Recreating the local container, retaining its volume.');
  compose(['up', '-d', '--wait', '--force-recreate', 'postgres']);
  const nextContainer = compose(['ps', '-q', 'postgres']);
  assert.ok(previousContainer && nextContainer && previousContainer !== nextContainer);

  database = client(testUrl.href);
  const rows = await database.$queryRaw`SELECT value FROM t02_verification.marker WHERE id = 1`;
  assert.equal(rows[0].value, marker);
  console.log('PASS: container ID changed, but the stored marker survived on the retained volume.');
} finally {
  await database?.$disconnect();
  if (created) {
    // Only the unpredictable database created by this run may be dropped.
    adminSql(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    console.log('Removed this run\'s disposable verification database; project database and volume retained.');
  }
}
