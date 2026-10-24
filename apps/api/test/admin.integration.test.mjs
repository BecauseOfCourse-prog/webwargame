import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../dist/application.js';
import { RuntimeConfiguration, loadConfiguration } from '../dist/config/environment.js';
import { PrismaService } from '../dist/database/prisma.service.js';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/bootstrap-admin.mjs', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const publicOrigin = 'http://127.0.0.1:5173';
const password = 'T08 test passphrase with spaces';
const headers = { 'X-Wargame-Request': '1', Origin: publicOrigin };

async function safe(operation) {
  try { return await operation(); }
  catch { throw new Error('Administrator integration database operation failed; details withheld.'); }
}
function localUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.search || url.hash || !url.username || !url.password || url.pathname.length < 2) throw new Error();
    return url;
  } catch { throw new Error('Administrator integration requires a loopback database URL without query or fragment.'); }
}
function migrate(databaseUrl) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Administrator integration migration failed; diagnostics withheld.');
}
function runCli(databaseUrl, username) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--username', username], {
      cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: publicOrigin },
      windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output = (output + chunk).slice(0, 4096); });
    child.stderr.on('data', (chunk) => { output = (output + chunk).slice(0, 4096); });
    child.once('error', () => reject(new Error('Administrator CLI process failed; details withheld.')));
    child.once('close', (status) => resolve({ status, output }));
  });
}
async function expectProtection(operation, marker = 'last administrator') {
  let rejected = false;
  try { await operation(); }
  catch (error) { rejected = `${String(error)} ${JSON.stringify(error)}`.toLowerCase().includes(marker.toLowerCase()); }
  assert.ok(rejected, 'The expected database protection must reject this operation.');
}
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
};

test('administrator provisioning, direct permissions and last-administrator protection work on PostgreSQL', { timeout: 120000 }, async (suite) => {
  const source = localUrl(loadConfiguration().databaseUrl);
  const name = `t08_admin_${randomBytes(12).toString('hex')}`;
  assert.match(name, /^t08_admin_[a-f0-9]{24}$/);
  const testUrl = new URL(source); testUrl.pathname = `/${name}`;
  const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
  const owner = new PrismaService(new RuntimeConfiguration(adminUrl.href, 3000));
  let database;
  let app;
  let created = false;
  let origin;
  let users;
  let administrator;
  let player;
  let playerCookie;
  let adminCookie;
  const countAdmins = () => safe(() => database.user.count({ where: { role: 'ADMIN' } }));
  const promote = (id) => safe(() => database.user.update({ where: { id }, data: { role: 'ADMIN' } }));

  async function request(path, options = {}) {
    const response = await fetch(`${origin}/api/${path}`, { ...options, signal: AbortSignal.timeout(10000) });
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : undefined };
  }
  const post = (path, body) => request(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const overview = (cookie, extra = {}) => request('admin/overview', { headers: { 'X-Wargame-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...extra } });
  async function login(user) {
    const result = await post('auth/login', { username: user.username, password });
    assert.equal(result.response.status, 200);
    const cookie = result.response.headers.get('Set-Cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^wargame\.sid=[A-Za-z0-9_-]{43}$/);
    return cookie;
  }
  function error(result, status, code) {
    assert.equal(result.response.status, status);
    assert.equal(result.body.code, code);
    assert.equal(result.response.headers.get('Set-Cookie'), null);
    const serialized = JSON.stringify(result.body);
    assert.ok(serialized.length < 1000 && !/Prisma|postgres(?:ql)?:|passwordHash|\$argon2/i.test(serialized));
    assert.ok(!serialized.includes(password));
  }

  try {
    await safe(() => owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`)); created = true;
    migrate(testUrl.href); migrate(testUrl.href);
    database = new PrismaService(new RuntimeConfiguration(testUrl.href, 3000));
    await database.onModuleInit();
    app = await createApplication(new RuntimeConfiguration(testUrl.href, 3000, publicOrigin));
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;

    await suite.test('migration seeds only its guard and registration cannot supply administrator roles', async () => {
      assert.equal(await safe(() => database.administratorGuard.count()), 1);
      assert.equal(await countAdmins(), 0);
      error(await post('auth/register', { username: 'Escalation', password, role: 'ADMIN' }), 400, 'INVALID_REGISTRATION');
      users = [];
      for (const username of ['First.Admin', 'Second.Admin', 'Ordinary.Player']) {
        const result = await post('auth/register', { username, password });
        assert.equal(result.response.status, 201);
        assert.equal(result.body.user.role, 'PLAYER');
        users.push(result.body.user);
      }
      player = users[2];
      playerCookie = await login(player);
    });

    await suite.test('direct anonymous and player requests cannot open administrator data or forge a role', async () => {
      error(await overview(), 401, 'UNAUTHENTICATED');
      error(await overview(playerCookie), 403, 'ACCESS_DENIED');
      error(await overview(playerCookie, { 'X-Role': 'ADMIN', 'X-User-Id': users[0].id }), 403, 'ACCESS_DENIED');
      error(await overview('wargame.sid=' + 'x'.repeat(43)), 401, 'UNAUTHENTICATED');
    });

    await suite.test('origin and custom-header boundaries apply to the administrator prefix before parsing', async () => {
      error(await request('admin/overview'), 403, 'CSRF_REJECTED');
      error(await overview(playerCookie, { Origin: 'https://foreign.example.test' }), 403, 'CSRF_REJECTED');
      error(await request('admin/overview', { method: 'POST', headers: { Origin: 'https://foreign.example.test', 'Content-Type': 'application/json' }, body: '{' }), 403, 'CSRF_REJECTED');
    });

    await suite.test('two concurrent CLI grants serialize, and promotion revokes only the winning player sessions', async () => {
      const cookies = await Promise.all(users.slice(0, 2).map(login));
      const grants = await Promise.all(users.slice(0, 2).map((user) => runCli(testUrl.href, ` ${user.username.toUpperCase()} `)));
      assert.deepEqual(grants.map((result) => result.status).sort(), [0, 1]);
      assert.ok(grants.every((result) => !result.output.includes(source.password) && !result.output.includes('postgresql://')));
      assert.equal(await countAdmins(), 1);
      administrator = await safe(() => database.user.findFirst({ where: { role: 'ADMIN' } }));
      const winner = users.findIndex((user) => user.id === administrator.id);
      assert.ok(winner === 0 || winner === 1);
      error(await overview(cookies[winner]), 401, 'UNAUTHENTICATED');
      error(await overview(cookies[1 - winner]), 403, 'ACCESS_DENIED');
      error(await overview(playerCookie), 403, 'ACCESS_DENIED');
      adminCookie = await login(administrator);
    });

    await suite.test('the named administrator is idempotent, while a new player or missing account cannot bootstrap', async () => {
      assert.equal((await runCli(testUrl.href, administrator.username)).status, 0);
      assert.equal((await runCli(testUrl.href, player.username)).status, 1);
      assert.equal((await runCli(testUrl.href, 'Missing.Account')).status, 1);
      assert.equal(await countAdmins(), 1);
      const result = await overview(adminCookie);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, { status: 'ready', user: { id: administrator.id, username: administrator.username, role: 'ADMIN' } });
    });

    await suite.test('expired and revoked cookies cannot open the administrator endpoint', async () => {
      const expired = await login(administrator);
      const tokenHash = createHash('sha256').update(expired.split('=')[1]).digest('hex');
      await safe(() => database.session.update({ where: { tokenHash }, data: {
        createdAt: new Date(Date.now() - 8 * 86400000), idleExpiresAt: new Date(Date.now() - 2 * 86400000), expiresAt: new Date(Date.now() - 86400000),
      } }));
      error(await overview(expired), 401, 'UNAUTHENTICATED');
      await safe(() => database.session.delete({ where: { tokenHash } }));
      error(await overview(expired), 401, 'UNAUTHENTICATED');
    });

    await suite.test('the last administrator cannot be deleted or demoted and rejected changes roll back', async () => {
      await expectProtection(() => database.user.update({ where: { id: administrator.id }, data: { role: 'PLAYER' } }));
      await expectProtection(() => database.user.delete({ where: { id: administrator.id } }));
      assert.equal(await countAdmins(), 1);
      assert.equal((await overview(adminCookie)).response.status, 200);
    });

    await suite.test('role authorization reads current database roles rather than the login response', async () => {
      await promote(player.id);
      assert.equal((await overview(playerCookie)).response.status, 200);
      await safe(() => database.user.update({ where: { id: player.id }, data: { role: 'PLAYER' } }));
      error(await overview(playerCookie), 403, 'ACCESS_DENIED');
    });

    await suite.test('bulk deletion and demotion cannot remove all administrators', async () => {
      await promote(player.id);
      await expectProtection(() => database.user.updateMany({ where: { role: 'ADMIN' }, data: { role: 'PLAYER' } }));
      await expectProtection(() => database.user.deleteMany({ where: { role: 'ADMIN' } }));
      assert.equal(await countAdmins(), 2);
    });

    async function race(isolationLevel, deleting = false) {
      await promote(administrator.id);
      await promote(player.id);
      const locked = deferred(); const release = deferred();
      const first = database.$transaction(async (transaction) => {
        if (deleting) await transaction.user.delete({ where: { id: administrator.id } });
        else await transaction.user.update({ where: { id: administrator.id }, data: { role: 'PLAYER' } });
        locked.resolve(); await release.promise;
      }, { timeout: 8000 });
      const firstResult = first.then(() => true, () => false);
      await Promise.race([locked.promise, first.then(() => { throw new Error('Guard synchronization failed.'); })]);
      let competing;
      try {
        competing = database.$transaction(async (transaction) => {
          // Establish a snapshot before the other transaction commits.
          await transaction.user.count({ where: { role: 'ADMIN' } });
          if (deleting) await transaction.user.delete({ where: { id: player.id } });
          else await transaction.user.update({ where: { id: player.id }, data: { role: 'PLAYER' } });
        }, { isolationLevel, timeout: 8000 }).then(() => false, (failure) => {
          const details = `${String(failure)} ${JSON.stringify(failure)}`;
          return /last administrator|40001|P2034|could not serialize|write conflict/i.test(details);
        });
        const deadline = Date.now() + 2500;
        let waiting = false;
        while (!waiting && Date.now() < deadline) {
          const rows = await safe(() => database.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
          waiting = rows[0].count > 0;
          if (!waiting) await delay(10);
        }
        assert.ok(waiting, 'The competing account change must wait for the guard.');
      } finally { release.resolve(); }
      assert.equal(await firstResult, true);
      assert.equal(await competing, true, 'The final administrator removal must reject or serialize safely.');
      assert.equal(await countAdmins(), 1);
    }

    await suite.test('competing demotions retain an administrator at read committed, repeatable read and serializable', async () => {
      for (const isolation of ['ReadCommitted', 'RepeatableRead', 'Serializable']) await race(isolation);
    });

    await suite.test('competing deletions cannot delete both remaining administrators', async () => { await race('ReadCommitted', true); });

    await suite.test('a missing internal guard fails closed instead of allowing an unprotected account write', async () => {
      await safe(() => database.administratorGuard.delete({ where: { id: 1 } }));
      try {
        await expectProtection(() => database.user.create({ data: { username: 'Guard.Failure', normalizedUsername: 'guard.failure', passwordHash: 'not-a-real-password' } }), 'guard is unavailable');
      } finally { await safe(() => database.administratorGuard.create({ data: { id: 1 } })); }
      assert.equal(await countAdmins(), 1);
    });
  } finally {
    if (app) await app.close();
    if (database) await database.onModuleDestroy();
    try { if (created) await safe(() => owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`)); }
    finally { await owner.onModuleDestroy(); }
  }
});
