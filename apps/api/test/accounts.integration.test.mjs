import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { argon2id, hash, verify } from 'argon2';
import { createApplication } from '../dist/application.js';
import { RuntimeConfiguration, loadConfiguration } from '../dist/config/environment.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { PasswordHasher } from '../dist/registration/password-hasher.js';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const publicOrigin = 'http://127.0.0.1:5173';
const password = 'T11 account fixture original passphrase';
const replacement = 'Самостоятельный пароль игрока 🔐 27';
const trusted = { Origin: publicOrigin, 'X-Wargame-Request': '1' };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
};

function localUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.search || url.hash || !url.username || !url.password || url.pathname.length < 2) throw new Error();
    return url;
  } catch { throw new Error('Account integration requires a canonical loopback PostgreSQL URL.'); }
}
async function safe(operation) {
  try { return await operation(); }
  catch { throw new Error('Account integration database operation failed; private details withheld.'); }
}
function migrate(databaseUrl) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Account integration migration failed; private details withheld.');
}

test('account administration and one-time password recovery preserve PostgreSQL security invariants', {
  timeout: 180000,
}, async (suite) => {
  const source = localUrl(loadConfiguration().databaseUrl);
  const databaseName = `t11_accounts_${randomBytes(12).toString('hex')}`;
  assert.match(databaseName, /^t11_accounts_[a-f0-9]{24}$/);
  const testUrl = new URL(source); testUrl.pathname = `/${databaseName}`;
  const ownerUrl = new URL(source); ownerUrl.pathname = '/postgres';
  const owner = new PrismaService(new RuntimeConfiguration(ownerUrl.href, 3000));
  const fixtureParent = await realpath(tmpdir());
  const fixtureRoot = await mkdtemp(join(fixtureParent, 't11-accounts-'));
  assert.equal(await realpath(fixtureRoot), fixtureRoot);
  const configuration = new RuntimeConfiguration(testUrl.href, 3000, publicOrigin, {
    directory: join(fixtureRoot, 'uploads'), minFreeBytes: 0,
  });
  const secrets = [password, replacement, source.href, decodeURIComponent(source.password), fixtureRoot];
  let database;
  let created = false;
  let app;
  let origin;
  let passwordHash;
  let administrator;
  let backup;
  let adminSession;
  let playerSession;
  let serial = 0;

  async function start() {
    await app?.close();
    app = await createApplication(configuration);
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  }
  // Each independent scenario gets fresh in-memory quotas. Cookies and all
  // account state remain real database-backed values across app instances.
  const scenario = (name, operation) => suite.test(name, async () => { await start(); await operation(); });
  async function request(path, options = {}) {
    const response = await fetch(`${origin}/api/${path}`, { ...options, signal: AbortSignal.timeout(10000) });
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : undefined };
  }
  const headers = (session = adminSession, extra = {}) => ({
    ...trusted, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...extra,
  });
  const post = (path, body, session = adminSession, extra = {}) => request(path, {
    method: 'POST', headers: headers(session, { 'Content-Type': 'application/json', ...extra }), body: JSON.stringify(body),
  });
  const list = (query = '', session = adminSession, extra = {}) => request(`admin/accounts${query}`, { headers: headers(session, extra) });
  const audit = (id, query = '', session = adminSession) => request(`admin/accounts/${id}/audit${query}`, { headers: headers(session) });
  const mutate = (user, action, body, session = adminSession, extra = {}) => post(`admin/accounts/${user.id}/${action}`, body, session, extra);
  const redeem = (code, chosenPassword = replacement, extra = {}) => post('auth/reset-password', { code, password: chosenPassword }, null, extra);
  const currentUser = (user) => safe(() => database.user.findUniqueOrThrow({ where: { id: user.id } }));
  const workingAdmins = () => safe(() => database.user.count({ where: { role: 'ADMIN', suspendedAt: null, passwordResetRequired: false } }));
  const sessionCount = (user) => safe(() => database.session.count({ where: { userId: user.id } }));
  const events = (user) => safe(() => database.accountAudit.findMany({ where: { targetId: user.id }, orderBy: { createdAt: 'asc' } }));
  const resetRow = (user) => safe(() => database.passwordReset.findUnique({ where: { userId: user.id } }));
  const createUser = (overrides = {}) => {
    serial += 1;
    const username = `Fixture.Player.${String(serial).padStart(2, '0')}`;
    return safe(() => database.user.create({ data: { username, normalizedUsername: username.toLowerCase(), passwordHash, ...overrides } }));
  };
  function sanitized(value) {
    const text = JSON.stringify(value);
    assert.ok(!/Prisma|postgres(?:ql)?:\/\/|passwordHash|tokenHash|\$argon2|SELECT |INSERT INTO/i.test(text));
    for (const secret of secrets) assert.ok(!text.includes(secret), 'A private fixture value escaped in a response.');
  }
  function safeError(result, status, code) {
    assert.equal(result.response.status, status);
    assert.equal(result.body.code, code);
    assert.equal(typeof result.body.message, 'string');
    assert.equal(result.response.headers.get('Set-Cookie'), null);
    assert.ok(JSON.stringify(result.body).length < 1600);
    sanitized(result.body);
  }
  function account(result, status = 200) {
    assert.equal(result.response.status, status);
    assert.equal(result.response.headers.get('Set-Cookie'), null);
    const value = result.body.account;
    assert.deepEqual(Object.keys(value).sort(), ['createdAt', 'id', 'passwordResetRequired', 'resetExpiresAt', 'role', 'suspendedAt', 'username', 'version']);
    assert.ok(Number.isSafeInteger(value.version) && value.version > 0);
    for (const key of ['createdAt', 'suspendedAt', 'resetExpiresAt']) {
      assert.ok(value[key] === null || new Date(value[key]).toISOString() === value[key]);
    }
    sanitized(value);
    return value;
  }
  async function login(user, chosenPassword = password) {
    const result = await post('auth/login', { username: user.username, password: chosenPassword }, null);
    assert.equal(result.response.status, 200);
    const cookie = result.response.headers.get('Set-Cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^wargame\.sid=[A-Za-z0-9_-]{43}$/);
    return { cookie, csrfToken: result.body.csrfToken, user: result.body.user };
  }
  async function issue(user, session = adminSession) {
    const before = await currentUser(user);
    const started = Date.now();
    const result = await mutate(user, 'password-reset', { version: before.version }, session);
    const updated = account(result, 201);
    assert.match(result.body.code, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(updated.passwordResetRequired, true);
    assert.equal(updated.version, before.version + 1);
    assert.equal(updated.resetExpiresAt, result.body.expiresAt);
    assert.ok(Date.parse(result.body.expiresAt) >= started + 30 * 60 * 1000 - 1000);
    assert.ok(Date.parse(result.body.expiresAt) <= Date.now() + 30 * 60 * 1000 + 1000);
    secrets.push(result.body.code);
    return result.body;
  }
  async function waitForGuardWaiter() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const rows = await safe(() => database.$queryRaw`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%AdministratorGuard%') AS waiting
      `);
      if (rows[0].waiting) return;
      await delay(10);
    }
    assert.fail('The controlled account mutation did not reach its database guard wait.');
  }

  try {
    await safe(() => owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)); created = true;
    migrate(testUrl.href); migrate(testUrl.href);
    database = new PrismaService(configuration);
    await database.onModuleInit();
    passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 });
    administrator = await createUser({ username: 'Accounts.Admin', normalizedUsername: 'accounts.admin', role: 'ADMIN' });
    backup = await createUser({ username: 'Accounts.Backup', normalizedUsername: 'accounts.backup', role: 'ADMIN' });
    const player = await createUser();
    await createUser({ username: 'Suspended.Admin', normalizedUsername: 'suspended.admin', role: 'ADMIN', suspendedAt: new Date() });
    await createUser({ username: 'Recovery.Admin', normalizedUsername: 'recovery.admin', role: 'ADMIN', passwordResetRequired: true });
    await start();
    adminSession = await login(administrator);
    playerSession = await login(player);

    await scenario('guards reject anonymous/player access, forged authority, wrong origins and missing CSRF', async () => {
      safeError(await list('', null), 401, 'UNAUTHENTICATED');
      safeError(await list('', playerSession, { 'X-Role': 'ADMIN', 'X-User-Id': administrator.id }), 403, 'ACCESS_DENIED');
      safeError(await audit(player.id, '', playerSession), 403, 'ACCESS_DENIED');
      safeError(await mutate(player, 'role', { role: 'ADMIN', version: player.version }, playerSession), 403, 'ACCESS_DENIED');
      safeError(await request('admin/accounts'), 403, 'CSRF_REJECTED');
      safeError(await list('', adminSession, { Origin: 'https://foreign.example.test' }), 403, 'CSRF_REJECTED');
      safeError(await mutate(player, 'suspension', { suspended: true, version: player.version }, adminSession, { 'X-CSRF-Token': '' }), 403, 'CSRF_REJECTED');
      safeError(await mutate(player, 'password-reset', { version: player.version }, adminSession, { Origin: 'https://foreign.example.test' }), 403, 'CSRF_REJECTED');
      safeError(await redeem('x'.repeat(43), replacement, { Origin: 'https://foreign.example.test' }), 403, 'CSRF_REJECTED');
      safeError(await request('auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), 403, 'CSRF_REJECTED');
      assert.equal(await sessionCount(player), 1);
      assert.equal((await currentUser(player)).role, 'PLAYER');
      assert.equal((await events(player)).length, 0);
    });

    await scenario('listing has fixed pages, literal normalized search, working-admin counts and no secrets', async () => {
      for (let index = 0; index < 24; index += 1) await createUser();
      const literal = await createUser({ username: 'Literal_Name', normalizedUsername: 'literal_name' });
      await createUser({ username: 'LiteralXName', normalizedUsername: 'literalxname' });
      const first = await list();
      assert.equal(first.response.status, 200);
      assert.deepEqual(Object.keys(first.body).sort(), ['accounts', 'activeAdministrators', 'page', 'pageSize', 'total']);
      assert.equal(first.body.page, 1); assert.equal(first.body.pageSize, 20);
      assert.equal(first.body.accounts.length, 20);
      assert.equal(first.body.total, await safe(() => database.user.count()));
      assert.equal(first.body.activeAdministrators, 2);
      sanitized(first.body);
      const second = await list('?page=2');
      assert.equal(second.response.status, 200);
      assert.equal(new Set([...first.body.accounts, ...second.body.accounts].map(({ id }) => id)).size, first.body.total);
      const found = await list('?search=%20LITERAL_%20');
      assert.equal(found.response.status, 200);
      assert.equal(found.body.total, 1); assert.equal(found.body.accounts[0].id, literal.id);
      assert.equal((await list('?search=not-found')).body.total, 0);
      assert.equal((await list('?page=10000')).body.accounts.length, 0);
      for (const query of ['?page=0', '?page=-1', '?page=1.5', '?page=10001', '?search=%D1%8F', `?search=${'a'.repeat(33)}`]) {
        safeError(await list(query), 400, 'INVALID_ACCOUNT_INPUT');
      }
      safeError(await audit(randomUUID()), 404, 'ACCOUNT_NOT_FOUND');
      safeError(await mutate({ id: randomUUID() }, 'role', { role: 'PLAYER', version: 1 }), 404, 'ACCOUNT_NOT_FOUND');
      safeError(await mutate(player, 'role', { role: 'ADMIN' }), 400, 'INVALID_ACCOUNT_INPUT');
      safeError(await mutate(player, 'suspension', { suspended: 'true', version: player.version }), 400, 'INVALID_ACCOUNT_INPUT');
      safeError(await mutate(player, 'password-reset', { version: player.version, code: 'forged' }), 400, 'INVALID_ACCOUNT_INPUT');
    });

    await scenario('role mutations atomically revoke every target session and audit once; matching no-ops preserve state', async () => {
      const target = await createUser();
      const sessions = [await login(target), await login(target)];
      const promoted = account(await mutate(target, 'role', { role: 'ADMIN', version: target.version }));
      assert.equal(promoted.role, 'ADMIN'); assert.equal(promoted.version, target.version + 1);
      assert.equal(await sessionCount(target), 0);
      for (const session of sessions) safeError(await request('auth/me', { headers: headers(session) }), 401, 'UNAUTHENTICATED');
      const fresh = await login(target);
      const noOp = account(await mutate(target, 'role', { role: 'ADMIN', version: promoted.version }));
      assert.equal(noOp.version, promoted.version); assert.equal(await sessionCount(target), 1);
      assert.equal((await request('auth/me', { headers: headers(fresh) })).response.status, 200);
      let history = await audit(target.id);
      assert.equal(history.response.status, 200); assert.equal(history.body.total, 1);
      assert.equal(history.body.events[0].action, 'ROLE_CHANGED');
      assert.deepEqual(history.body.events[0].actor, { id: administrator.id, username: administrator.username });
      assert.equal(history.body.events[0].targetId, target.id);
      assert.equal(history.body.events[0].fromRole, 'PLAYER'); assert.equal(history.body.events[0].toRole, 'ADMIN');
      sanitized(history.body);
      safeError(await mutate(target, 'role', { role: 'PLAYER', version: target.version }), 409, 'ACCOUNT_CONFLICT');
      account(await mutate(target, 'role', { role: 'PLAYER', version: promoted.version }));
      assert.equal(await sessionCount(target), 0);
      history = await audit(target.id);
      assert.equal(history.body.total, 2);
      const before = await events(target);
      await assert.rejects(safe(() => database.accountAudit.update({ where: { id: before[0].id }, data: { action: 'SUSPENDED' } })));
      await assert.rejects(safe(() => database.accountAudit.delete({ where: { id: before[0].id } })));
      assert.deepEqual(await events(target), before);
    });

    await scenario('suspension closes all sessions and blocks login until explicit resumption', async () => {
      const target = await createUser();
      const sessions = [await login(target), await login(target)];
      const suspended = account(await mutate(target, 'suspension', { suspended: true, version: target.version }));
      assert.ok(suspended.suspendedAt); assert.equal(suspended.version, target.version + 1);
      assert.equal(await sessionCount(target), 0);
      for (const session of sessions) safeError(await request('auth/me', { headers: headers(session) }), 401, 'UNAUTHENTICATED');
      safeError(await post('auth/login', { username: target.username, password }, null), 401, 'INVALID_CREDENTIALS');
      const noOp = account(await mutate(target, 'suspension', { suspended: true, version: suspended.version }));
      assert.equal(noOp.version, suspended.version); assert.equal((await events(target)).length, 1);
      const resumed = account(await mutate(target, 'suspension', { suspended: false, version: suspended.version }));
      assert.equal(resumed.suspendedAt, null); assert.equal(resumed.version, suspended.version + 1);
      assert.equal(await sessionCount(target), 0);
      await login(target);
      const history = (await audit(target.id)).body;
      assert.deepEqual(new Set(history.events.map(({ action }) => action)), new Set(['SUSPENDED', 'RESUMED']));
      assert.equal(history.total, 2); sanitized(history);
    });

    await scenario('concurrent stale forms produce one mutation, one conflict and one audit event', async () => {
      const target = await createUser();
      const results = await Promise.all([
        mutate(target, 'suspension', { suspended: true, version: target.version }),
        mutate(target, 'suspension', { suspended: true, version: target.version }),
      ]);
      assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409]);
      safeError(results.find(({ response }) => response.status === 409), 409, 'ACCOUNT_CONFLICT');
      assert.equal((await currentUser(target)).version, target.version + 1);
      assert.equal((await events(target)).length, 1);
    });

    await scenario('recovery stores only a thirty-minute digest, blocks the old password and requires explicit login', async () => {
      const target = await createUser();
      const sessions = [await login(target), await login(target)];
      const issued = await issue(target);
      assert.equal(await sessionCount(target), 0);
      for (const session of sessions) safeError(await request('auth/me', { headers: headers(session) }), 401, 'UNAUTHENTICATED');
      const stored = await resetRow(target);
      assert.equal(stored.tokenHash, digest(issued.code));
      assert.equal(stored.userVersion, issued.account.version);
      assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 30 * 60 * 1000);
      assert.ok(!JSON.stringify(stored).includes(issued.code));
      safeError(await post('auth/login', { username: target.username, password }, null), 401, 'INVALID_CREDENTIALS');
      safeError(await redeem(issued.code, 'short'), 400, 'INVALID_RESET_INPUT');
      assert.ok(await resetRow(target));
      const visible = await list(`?search=${encodeURIComponent(target.username)}`);
      sanitized(visible.body); assert.equal(visible.body.accounts[0].passwordResetRequired, true);
      const completed = await redeem(issued.code);
      assert.equal(completed.response.status, 204); assert.equal(completed.body, undefined);
      assert.equal(completed.response.headers.get('Set-Cookie'), null);
      assert.equal(await sessionCount(target), 0); assert.equal(await resetRow(target), null);
      const updated = await currentUser(target);
      assert.equal(updated.passwordResetRequired, false); assert.equal(updated.version, issued.account.version + 1);
      assert.equal(await verify(updated.passwordHash, replacement), true);
      safeError(await redeem(issued.code), 400, 'RESET_INVALID_OR_EXPIRED');
      safeError(await post('auth/login', { username: target.username, password }, null), 401, 'INVALID_CREDENTIALS');
      await login(target, replacement);
      const history = (await audit(target.id)).body;
      assert.equal(history.total, 2);
      assert.equal(history.events.find(({ action }) => action === 'PASSWORD_RESET_COMPLETED').actor, null);
      assert.deepEqual(history.events.find(({ action }) => action === 'PASSWORD_RESET_ISSUED').actor, { id: administrator.id, username: administrator.username });
      sanitized(history);
    });

    await scenario('reissue, expiry and other security changes invalidate codes without clearing reset-required state', async () => {
      const target = await createUser();
      const first = await issue(target);
      const second = await issue(target);
      assert.notEqual(first.code, second.code);
      assert.equal(await safe(() => database.passwordReset.count({ where: { userId: target.id } })), 1);
      assert.equal((await resetRow(target)).tokenHash, digest(second.code));
      safeError(await redeem(first.code), 400, 'RESET_INVALID_OR_EXPIRED');
      const expiredAt = new Date(Date.now() - 1000);
      await safe(() => database.passwordReset.update({ where: { userId: target.id }, data: {
        createdAt: new Date(expiredAt.getTime() - 30 * 60 * 1000), expiresAt: expiredAt,
      } }));
      safeError(await redeem(second.code), 400, 'RESET_INVALID_OR_EXPIRED');
      const third = await issue(target);
      const suspended = account(await mutate(target, 'suspension', { suspended: true, version: third.account.version }));
      assert.equal(suspended.passwordResetRequired, true); assert.equal(suspended.resetExpiresAt, null);
      assert.equal(await resetRow(target), null);
      safeError(await redeem(third.code), 400, 'RESET_INVALID_OR_EXPIRED');
      safeError(await redeem('x'.repeat(43)), 400, 'RESET_INVALID_OR_EXPIRED');
      assert.equal((await currentUser(target)).passwordHash, passwordHash);
      assert.equal((await events(target)).filter(({ action }) => action === 'PASSWORD_RESET_COMPLETED').length, 0);
    });

    await scenario('a code cannot complete twice, including concurrent attempts', async () => {
      const target = await createUser();
      const issued = await issue(target);
      const results = await Promise.all([redeem(issued.code), redeem(issued.code)]);
      assert.deepEqual(results.map(({ response }) => response.status).sort(), [204, 400]);
      safeError(results.find(({ response }) => response.status === 400), 400, 'RESET_INVALID_OR_EXPIRED');
      assert.equal((await events(target)).filter(({ action }) => action === 'PASSWORD_RESET_COMPLETED').length, 1);
      assert.equal(await resetRow(target), null); assert.equal(await sessionCount(target), 0);
    });

    await scenario('recovery rechecks code replacement after expensive hashing and cannot overwrite the new issue', async () => {
      const target = await createUser();
      const issued = await issue(target);
      const hasher = app.get(PasswordHasher);
      const original = hasher.hash;
      const entered = deferred(); const release = deferred();
      let pending;
      hasher.hash = async function (value) {
        const encoded = await original.call(this, value);
        entered.resolve(); await release.promise;
        return encoded;
      };
      try {
        pending = redeem(issued.code);
        await Promise.race([entered.promise, delay(5000).then(() => assert.fail('Recovery did not reach hashing.'))]);
        const newer = await issue(target);
        release.resolve();
        safeError(await pending, 400, 'RESET_INVALID_OR_EXPIRED');
        const state = await currentUser(target);
        assert.equal(state.version, newer.account.version); assert.equal(state.passwordHash, passwordHash);
        assert.equal(state.passwordResetRequired, true);
        assert.equal((await resetRow(target)).tokenHash, digest(newer.code));
        assert.equal((await events(target)).length, 2);
      } finally {
        release.resolve(); hasher.hash = original;
        if (pending) await Promise.allSettled([pending]);
      }
    });

    await scenario('a previously verified old password cannot create a session after administrative reset', async () => {
      const target = await createUser();
      const hasher = app.get(PasswordHasher);
      const original = hasher.verify;
      const entered = deferred(); const release = deferred();
      let pending;
      hasher.verify = async function (encoded, value) {
        const matches = await original.call(this, encoded, value);
        if (encoded === passwordHash && value === password) { entered.resolve(); await release.promise; }
        return matches;
      };
      try {
        pending = post('auth/login', { username: target.username, password }, null);
        await Promise.race([entered.promise, delay(5000).then(() => assert.fail('Login did not reach password verification.'))]);
        await issue(target);
        release.resolve();
        safeError(await pending, 401, 'INVALID_CREDENTIALS');
        assert.equal(await sessionCount(target), 0);
      } finally {
        release.resolve(); hasher.verify = original;
        if (pending) await Promise.allSettled([pending]);
      }
    });

    await scenario('a queued mutation rechecks actor revocation after the account guard wait', async () => {
      const actor = await createUser({ role: 'ADMIN' });
      const actorSession = await login(actor);
      const target = await createUser();
      const entered = deferred(); const release = deferred();
      let pending;
      const blocker = database.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "AdministratorGuard" SET "id" = "id" WHERE "id" = 1`;
        entered.resolve(); await release.promise;
      }, { isolationLevel: 'ReadCommitted', timeout: 15000 });
      try {
        await entered.promise;
        pending = mutate(target, 'suspension', { suspended: true, version: target.version }, actorSession);
        await waitForGuardWaiter();
        await safe(() => database.session.deleteMany({ where: { userId: actor.id } }));
        release.resolve(); await blocker;
        safeError(await pending, 401, 'UNAUTHENTICATED');
        assert.equal((await currentUser(target)).suspendedAt, null);
        assert.equal((await currentUser(target)).version, target.version);
        assert.equal((await events(target)).length, 0);
      } finally {
        release.resolve();
        await Promise.allSettled([blocker, ...(pending ? [pending] : [])]);
        await safe(() => database.user.update({ where: { id: actor.id }, data: { role: 'PLAYER' } }));
      }
    });

    await scenario('database security changes advance versions and revoke sessions and outstanding codes', async () => {
      const target = await createUser();
      await login(target); await login(target);
      const changed = await safe(() => database.user.update({ where: { id: target.id }, data: { role: 'ADMIN' } }));
      assert.equal(changed.version, target.version + 1); assert.equal(await sessionCount(target), 0);
      const issued = await issue(target);
      const changedAgain = await safe(() => database.user.update({ where: { id: target.id }, data: { role: 'PLAYER' } }));
      assert.equal(changedAgain.version, issued.account.version + 1);
      assert.equal(changedAgain.passwordResetRequired, true); assert.equal(await resetRow(target), null);
      assert.equal((await events(target)).length, 1, 'Raw owner maintenance must not impersonate an authenticated actor.');
    });

    await scenario('per-target issuance and public recovery quotas are bounded and cannot be bypassed by forwarding headers', async () => {
      const target = await createUser();
      for (let attempt = 0; attempt < 5; attempt += 1) await issue(target);
      const before = await currentUser(target);
      const refused = await mutate(target, 'password-reset', { version: before.version });
      safeError(refused, 429, 'RESET_RATE_LIMITED');
      assert.ok(Number(refused.response.headers.get('Retry-After')) > 0);
      assert.equal((await currentUser(target)).version, before.version);
      assert.equal((await events(target)).length, 5);
      await start();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        safeError(await redeem(randomBytes(32).toString('base64url'), replacement, { 'X-Forwarded-For': `198.51.100.${attempt + 1}` }), 400, 'RESET_INVALID_OR_EXPIRED');
      }
      const publicRefused = await redeem(randomBytes(32).toString('base64url'), replacement, { 'X-Forwarded-For': '203.0.113.70' });
      safeError(publicRefused, 429, 'RESET_RATE_LIMITED');
      assert.ok(Number(publicRefused.response.headers.get('Retry-After')) > 0);
    });

    await scenario('last working administrator protection includes concurrent demotion, suspension and self-reset', async () => {
      assert.equal(await workingAdmins(), 2);
      const first = await currentUser(administrator);
      const second = await currentUser(backup);
      const secondSession = await login(backup);
      const results = await Promise.all([
        mutate(first, 'role', { role: 'PLAYER', version: first.version }, adminSession),
        mutate(second, 'role', { role: 'PLAYER', version: second.version }, secondSession),
      ]);
      assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409]);
      safeError(results.find(({ response }) => response.status === 409), 409, 'LAST_ACTIVE_ADMIN');
      assert.equal(await workingAdmins(), 1);
      const survivor = await safe(() => database.user.findFirstOrThrow({ where: { role: 'ADMIN', suspendedAt: null, passwordResetRequired: false } }));
      const session = survivor.id === administrator.id ? adminSession : secondSession;
      safeError(await mutate(survivor, 'suspension', { suspended: true, version: survivor.version }, session), 409, 'LAST_ACTIVE_ADMIN');
      safeError(await mutate(survivor, 'password-reset', { version: survivor.version }, session), 409, 'LAST_ACTIVE_ADMIN');
      assert.equal((await currentUser(survivor)).version, survivor.version);
      assert.equal(await resetRow(survivor), null);
      assert.equal((await events(survivor)).length, 0);
      const before = await safe(() => database.user.findMany({ where: { role: 'ADMIN' }, select: { id: true, role: true, version: true } }));
      await assert.rejects(safe(() => database.user.updateMany({ where: { role: 'ADMIN' }, data: { role: 'PLAYER' } })));
      assert.deepEqual(await safe(() => database.user.findMany({ where: { role: 'ADMIN' }, select: { id: true, role: true, version: true } })), before);
      assert.equal((await list('', session)).body.activeAdministrators, 1);
    });
  } finally {
    let failed = false;
    try { await app?.close(); } catch { failed = true; }
    try { await database?.onModuleDestroy(); } catch { failed = true; }
    try {
      if (created) {
        assert.match(databaseName, /^t11_accounts_[a-f0-9]{24}$/);
        await safe(() => owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`));
      }
    } catch { failed = true; }
    finally { try { await owner.onModuleDestroy(); } catch { failed = true; } }
    try {
      const target = resolve(fixtureRoot);
      assert.equal(dirname(target), fixtureParent);
      assert.match(basename(target), /^t11-accounts-[A-Za-z0-9_-]+$/);
      assert.equal(await realpath(target), target);
      await rm(target, { recursive: true, force: true });
    } catch { failed = true; }
    assert.equal(failed, false, 'Account fixture cleanup failed; inspect only its generated database and temporary directory.');
  }
});
