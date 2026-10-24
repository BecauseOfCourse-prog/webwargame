import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AdministratorBootstrapError,
  bootstrapAdministrator,
  parseBootstrapUsername,
} from '../dist/admin-provisioning/bootstrap-administrator.js';
import { parseBootstrapArguments } from '../scripts/bootstrap-admin.mjs';

function expectCode(code) {
  return (error) => error instanceof AdministratorBootstrapError && error.code === code;
}

function fixture({ user = { id: 'commander-id', role: 'PLAYER' }, otherAdmin = null, guardCount = 1 } = {}) {
  const calls = [];
  const transaction = {
    $executeRaw: async () => { calls.push('guard'); return guardCount; },
    user: {
      findUnique: async ({ where }) => { calls.push(['lookup', where.normalizedUsername]); return user; },
      findFirst: async () => { calls.push('other-admin'); return otherAdmin; },
      update: async ({ where, data }) => { calls.push(['promote', where.id, data.role]); },
    },
    session: { deleteMany: async ({ where }) => { calls.push(['revoke', where.userId]); } },
  };
  const database = {
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'ReadCommitted');
      return operation(transaction);
    },
  };
  return { database, calls, transaction };
}

test('bootstrap promotes only the named existing player and revokes that account sessions', async () => {
  const { database, calls } = fixture();
  assert.deepEqual(await bootstrapAdministrator(database, '  CoMMander '), { status: 'promoted' });
  assert.deepEqual(calls, ['guard', ['lookup', 'commander'], 'other-admin',
    ['promote', 'commander-id', 'ADMIN'], ['revoke', 'commander-id']]);
});

test('an existing administrator is an idempotent no-op even when other admins exist', async () => {
  const { database, calls } = fixture({ user: { id: 'commander-id', role: 'ADMIN' }, otherAdmin: { id: 'other' } });
  assert.deepEqual(await bootstrapAdministrator(database, 'Commander'), { status: 'already-admin' });
  assert.deepEqual(calls, ['guard', ['lookup', 'commander']]);
});

test('bootstrap refuses an unknown account or a player when another administrator exists', async () => {
  for (const [settings, code] of [[{ user: null }, 'USER_NOT_FOUND'],
    [{ otherAdmin: { id: 'existing-admin' } }, 'ADMIN_ALREADY_EXISTS']]) {
    const { database, calls } = fixture(settings);
    await assert.rejects(() => bootstrapAdministrator(database, 'Commander'), expectCode(code));
    assert.ok(!calls.some((call) => Array.isArray(call) && ['promote', 'revoke'].includes(call[0])));
  }
});

test('missing guard fails closed before reading accounts', async () => {
  const { database, calls } = fixture({ guardCount: 0 });
  await assert.rejects(() => bootstrapAdministrator(database, 'Commander'), expectCode('BOOTSTRAP_UNAVAILABLE'));
  assert.deepEqual(calls, ['guard']);
});

test('bootstrap rejects invalid username values before database work', async () => {
  let queried = false;
  const database = { $transaction: async () => { queried = true; } };
  for (const username of [undefined, null, {}, '', 'ab', 'x'.repeat(33), 'Командир', 'Commander admin', '--reset']) {
    if (username === '--reset') continue; // Hyphens are valid inside an existing account name.
    await assert.rejects(() => bootstrapAdministrator(database, username), expectCode('INVALID_USERNAME'));
  }
  assert.equal(queried, false);
  assert.equal(parseBootstrapUsername('  A.b_C-9  '), 'a.b_c-9');
});

test('database failures from any bootstrap stage are sanitized', async () => {
  const secret = 'postgresql://private-user:private-password@example.test/private-db';
  const fail = async () => { throw new Error(secret); };
  for (const stage of ['transaction', 'guard', 'lookup', 'count', 'promote', 'revoke']) {
    const { database, transaction } = fixture();
    if (stage === 'transaction') database.$transaction = fail;
    if (stage === 'guard') transaction.$executeRaw = fail;
    if (stage === 'lookup') transaction.user.findUnique = fail;
    if (stage === 'count') transaction.user.findFirst = fail;
    if (stage === 'promote') transaction.user.update = fail;
    if (stage === 'revoke') transaction.session.deleteMany = fail;
    await assert.rejects(() => bootstrapAdministrator(database, 'Commander'), (error) => {
      assert.ok(expectCode('BOOTSTRAP_UNAVAILABLE')(error));
      assert.ok(!String(error).includes(secret));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('CLI accepts only an explicit username or help and never password/reset flags', () => {
  assert.deepEqual(parseBootstrapArguments(['--username', ' Commander ']), { username: 'Commander' });
  assert.deepEqual(parseBootstrapArguments(['--help']), { help: true });
  for (const args of [[], ['Commander'], ['--username'], ['--username=Commander'],
    ['--username', 'Commander', '--password', 'secret'], ['--reset'], ['--help', '--username', 'Commander']]) {
    assert.throws(() => parseBootstrapArguments(args), /Usage:/);
  }
});

test('CLI invalid arguments and configuration failures never echo supplied credentials', () => {
  const script = fileURLToPath(new URL('../scripts/bootstrap-admin.mjs', import.meta.url));
  const secret = 'do-not-print-this-database-password';
  for (const args of [['--password', secret], ['--username', 'Commander']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, DATABASE_URL: `postgresql://private:${secret}@example.test/db`, PUBLIC_ORIGIN: 'invalid' },
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
    assert.ok(!result.stderr.includes('postgresql://'));
  }
  const help = spawnSync(process.execPath, [script, '--help'], {
    env: { ...process.env, DATABASE_URL: '', PUBLIC_ORIGIN: 'invalid' },
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
});
