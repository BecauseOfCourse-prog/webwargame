import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { argon2id, hash } from 'argon2';
import { createApplication } from '../dist/application.js';
import { SessionService } from '../dist/auth/session.service.js';
import { loadConfiguration, RuntimeConfiguration } from '../dist/config/environment.js';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const publicOrigin = 'http://127.0.0.1:5173';
const password = '  пароль для друзей 🐉  ';
const unicodePassword = 'e\u0301'.repeat(15);
const responseMarker = 'authentication-input-must-not-be-echoed';
const dayMs = 24 * 60 * 60 * 1000;
const trustedHeaders = { Origin: publicOrigin, 'X-Wargame-Request': '1' };

function localDatabaseUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.search !== '' || url.hash !== '' ||
      !url.username || !url.password || url.pathname.length <= 1
    ) {
      throw new Error();
    }
    return url;
  } catch {
    throw new Error('Authentication integration requires a loopback PostgreSQL URL without query parameters or a fragment.');
  }
}

function client(connectionString) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString, connectionTimeoutMillis: 5000,
      query_timeout: 5000, statement_timeout: 5000, max: 2,
    }),
    log: [],
  });
}

async function databaseOperation(operation) {
  try {
    return await operation();
  } catch {
    // Driver errors can contain credentials or SQL; never emit them in TAP output.
    throw new Error('Authentication integration database operation failed; check local PostgreSQL and migrations.');
  }
}

function migrate(databaseUrl) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Authentication integration migration failed; build the API and check local PostgreSQL.');
  }
}

function noStore(response) {
  assert.match(response.headers.get('Cache-Control') ?? '', /(?:^|,)\s*no-store\s*(?:,|$)/);
}

async function request(origin, path, options = {}) {
  const response = await fetch(`${origin}/api/auth/${path}`, {
    ...options, signal: AbortSignal.timeout(10000),
  });
  noStore(response);
  const text = await response.text();
  return { response, body: text === '' ? undefined : JSON.parse(text) };
}

function login(origin, credentials = { username: 'Main.player', password }, headers = {}) {
  return request(origin, 'login', {
    method: 'POST',
    headers: { ...trustedHeaders, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(credentials),
  });
}

function current(origin, cookie, headers = {}) {
  return request(origin, 'me', {
    headers: { 'X-Wargame-Request': '1', Cookie: cookie, ...headers },
  });
}

function logout(origin, session, headers = {}) {
  return request(origin, 'logout', {
    method: 'POST',
    headers: {
      ...trustedHeaders, 'Content-Type': 'application/json', Cookie: session.cookie,
      'X-CSRF-Token': session.body.csrfToken, ...headers,
    },
    body: '{}',
  });
}

function bearerHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function session(result, user, role = 'PLAYER', secure = false) {
  assert.equal(result.response.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), ['csrfToken', 'expiresAt', 'idleExpiresAt', 'user']);
  assert.deepEqual(result.body.user, { id: user.id, username: user.username, role });
  assert.equal(typeof result.body.csrfToken, 'string');
  assert.ok(result.body.csrfToken.length >= 32);
  for (const key of ['expiresAt', 'idleExpiresAt']) {
    assert.equal(new Date(result.body[key]).toISOString(), result.body[key]);
  }
  assert.ok(Date.parse(result.body.idleExpiresAt) <= Date.parse(result.body.expiresAt));
  const setCookie = result.response.headers.get('Set-Cookie');
  assert.equal(typeof setCookie, 'string');
  const match = /^(?:__Host-)?wargame\.sid=([A-Za-z0-9_-]{43});/.exec(setCookie);
  assert.ok(match, 'A session cookie must carry a fresh 256-bit base64url token.');
  const name = secure ? '__Host-wargame.sid' : 'wargame.sid';
  assert.ok(setCookie.startsWith(`${name}=`));
  assert.match(setCookie, /;\s*Path=\/(?:;|$)/i);
  assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
  assert.match(setCookie, /;\s*SameSite=Lax(?:;|$)/i);
  assert.match(setCookie, /;\s*Max-Age=604800(?:;|$)/i);
  assert.equal(/;\s*Secure(?:;|$)/i.test(setCookie), secure);
  assert.ok(!/;\s*Domain=/i.test(setCookie));
  return { ...result, cookie: `${name}=${match[1]}`, token: match[1], tokenHash: bearerHash(match[1]) };
}

function safeError(result, status, code, secrets = []) {
  assert.equal(result.response.status, status);
  assert.equal(result.body.code, code);
  if (code === 'UNAUTHENTICATED') assert.equal(result.response.headers.get('Set-Cookie'), null);
  assert.equal(typeof result.body.message, 'string');
  const serialized = JSON.stringify(result.body);
  assert.ok(serialized.length < 1600);
  assert.ok(!/(PrismaClient|node_modules|postgres(?:ql)?:\/\/|INSERT INTO|passwordHash|\$argon2)/i.test(serialized));
  for (const secret of [responseMarker, password, unicodePassword, ...secrets]) {
    assert.ok(!serialized.includes(secret), 'Error response echoed private input or configuration.');
  }
}

function clearedCookie(response, secure = false) {
  const value = response.headers.get('Set-Cookie') ?? '';
  const name = secure ? '__Host-wargame.sid' : 'wargame.sid';
  assert.ok(value.startsWith(`${name}=;`));
  assert.match(value, /;\s*(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  assert.match(value, /;\s*Path=\/(?:;|$)/i);
  assert.match(value, /;\s*HttpOnly(?:;|$)/i);
  assert.match(value, /;\s*SameSite=Lax(?:;|$)/i);
  assert.equal(/;\s*Secure(?:;|$)/i.test(value), secure);
  assert.ok(!/;\s*Domain=/i.test(value));
}

test('authentication persists bounded opaque sessions and enforces login, expiry and logout protection', {
  timeout: 120000,
}, async (suite) => {
  const configuration = loadConfiguration();
  const sourceUrl = localDatabaseUrl(configuration.databaseUrl);
  const databaseName = `t06_auth_${randomBytes(12).toString('hex')}`;
  assert.match(databaseName, /^t06_auth_[a-f0-9]{24}$/);
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  const admin = client(adminUrl.href);
  let database;
  let created = false;
  const applications = new Set();
  let mainUser;
  let unicodeUser;

  async function withApplication(operation, configuredOrigin = publicOrigin) {
    const app = await createApplication(new RuntimeConfiguration(testUrl.href, 3000, configuredOrigin));
    applications.add(app);
    try {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      await operation(`http://127.0.0.1:${address.port}`, app);
    } finally {
      await app.close();
      applications.delete(app);
    }
  }

  const findSession = (tokenHash) => databaseOperation(() => database.session.findUnique({ where: { tokenHash } }));
  const countSessions = () => databaseOperation(() => database.session.count());
  const changeSession = (tokenHash, data) => databaseOperation(() =>
    database.session.update({ where: { tokenHash }, data }));

  try {
    // Only this generated, strictly checked identifier is interpolated in SQL.
    await databaseOperation(() => admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`));
    created = true;
    migrate(testUrl.href);
    migrate(testUrl.href);
    database = client(testUrl.href);

    await suite.test('committed migrations apply exactly once and seeded accounts use real Argon2id hashes', async () => {
      const directories = await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true });
      const expected = directories.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      const applied = await databaseOperation(() => database.$queryRaw`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
      `);
      assert.ok(expected.length > 0);
      assert.deepEqual(applied.map((row) => row.migration_name), expected);
      const hashPassword = (value) => hash(value, {
        type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32,
      });
      // Seed directly: registration quotas and HTTP validation have their own suite.
      mainUser = await databaseOperation(async () => database.user.create({ data: {
        username: 'Main.player', normalizedUsername: 'main.player', passwordHash: await hashPassword(password),
      } }));
      unicodeUser = await databaseOperation(async () => database.user.create({ data: {
        username: 'Unicode.player', normalizedUsername: 'unicode.player', passwordHash: await hashPassword(unicodePassword),
      } }));
      assert.equal(await countSessions(), 0);
    });

    let persisted;
    await suite.test('normalized login stores only the token digest and returns bounded public session data', async () => {
      await withApplication(async (origin) => {
        const started = Date.now();
        persisted = session(await login(origin, { username: '  MAIN.PLAYER  ', password }), mainUser);
        const row = await findSession(persisted.tokenHash);
        assert.equal(row.userId, mainUser.id);
        assert.equal(row.tokenHash, persisted.tokenHash);
        assert.equal(row.expiresAt.toISOString(), persisted.body.expiresAt);
        assert.equal(row.idleExpiresAt.toISOString(), persisted.body.idleExpiresAt);
        assert.ok(row.createdAt.getTime() >= started - 1000 && row.createdAt.getTime() <= Date.now());
        assert.ok(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - 7 * dayMs) < 1000);
        assert.ok(Math.abs(row.idleExpiresAt.getTime() - row.createdAt.getTime() - dayMs) < 1000);
        const stored = JSON.stringify(row);
        assert.ok(!stored.includes(persisted.token));
        assert.ok(!stored.includes(persisted.body.csrfToken));
        assert.ok(!stored.includes(password));
      });
    });

    await suite.test('restart retains the session, current-user reads omit cookies and reflect current database roles', async () => {
      await withApplication(async (origin) => {
        const before = await findSession(persisted.tokenHash);
        const result = await current(origin, persisted.cookie);
        assert.equal(result.response.status, 200);
        assert.deepEqual(result.body.user, persisted.body.user);
        assert.equal(result.body.csrfToken, persisted.body.csrfToken);
        assert.equal(result.body.expiresAt, persisted.body.expiresAt);
        assert.equal(result.response.headers.get('Set-Cookie'), null);
        const after = await findSession(persisted.tokenHash);
        assert.ok(after.idleExpiresAt >= before.idleExpiresAt);
        await databaseOperation(() => database.user.update({ where: { id: mainUser.id }, data: { role: 'ADMIN' } }));
        try {
          const changed = await current(origin, persisted.cookie, { Origin: publicOrigin });
          assert.equal(changed.response.status, 200);
          assert.equal(changed.body.user.role, 'ADMIN');
        } finally {
          await databaseOperation(() => database.user.update({ where: { id: mainUser.id }, data: { role: 'PLAYER' } }));
        }
      });
    });

    await suite.test('unknown, incorrect and invalid credentials share a safe error and create no session', async () => {
      const before = await countSessions();
      await withApplication(async (origin) => {
        let generic;
        for (const credentials of [
          { username: 'Unknown.player', password },
          { username: 'Main.player', password: 'different password text' },
          { username: 'Main.player', password: password.trim() },
          { username: 'Main.player', password, role: 'ADMIN' },
          { username: null, password: responseMarker },
          {},
        ]) {
          const result = await login(origin, credentials);
          safeError(result, 401, 'INVALID_CREDENTIALS');
          assert.equal(result.response.headers.get('Set-Cookie'), null);
          generic ??= result.body;
          assert.deepEqual(result.body, generic);
        }
      });
      assert.equal(await countSessions(), before);
    });

    await suite.test('passwords retain spaces and Unicode composition at login', async () => {
      await withApplication(async (origin) => {
        const rejected = await login(origin, { username: unicodeUser.username, password: unicodePassword.normalize('NFC') });
        safeError(rejected, 401, 'INVALID_CREDENTIALS');
        const exact = session(await login(origin, { username: unicodeUser.username, password: unicodePassword }), unicodeUser);
        const ended = await logout(origin, exact);
        assert.equal(ended.response.status, 204);
        assert.equal(ended.body, undefined);
      });
    });

    await suite.test('re-login rotates the request session while preserving another device and failed-login state', async () => {
      await withApplication(async (origin) => {
        const first = session(await login(origin), mainUser);
        const otherDevice = session(await login(origin), mainUser);
        assert.notEqual(first.token, otherDevice.token);
        assert.notEqual(first.body.csrfToken, otherDevice.body.csrfToken);
        const failed = await login(origin, { username: mainUser.username, password: 'incorrect password phrase' }, {
          Cookie: first.cookie,
        });
        safeError(failed, 401, 'INVALID_CREDENTIALS');
        assert.equal((await current(origin, first.cookie)).response.status, 200);
        const rotated = session(await login(origin, undefined, { Cookie: first.cookie }), mainUser);
        assert.notEqual(rotated.token, first.token);
        assert.equal(await findSession(first.tokenHash), null);
        safeError(await current(origin, first.cookie), 401, 'UNAUTHENTICATED');
        assert.equal((await current(origin, rotated.cookie)).response.status, 200);
        assert.equal((await current(origin, otherDevice.cookie)).response.status, 200);
      });
    });

    await suite.test('unknown, tampered and stored digest cookies never authenticate', async () => {
      await withApplication(async (origin) => {
        const tampered = `${persisted.token[0] === 'A' ? 'B' : 'A'}${persisted.token.slice(1)}`;
        const unknown = `wargame.sid=${randomBytes(32).toString('base64url')}`;
        for (const cookie of [
          '', unknown,
          `wargame.sid=${tampered}`, `wargame.sid=${persisted.tokenHash}`,
          'wargame.sid=malformed%token',
          `${persisted.cookie}; ${unknown}`, `${unknown}; ${persisted.cookie}`,
          `${persisted.cookie}; ${persisted.cookie}`,
        ]) {
          safeError(await current(origin, cookie), 401, 'UNAUTHENTICATED', [persisted.token]);
        }
        assert.equal((await current(origin, persisted.cookie)).response.status, 200);
      });
    });

    await suite.test('trusted origin, custom header and session-bound CSRF protect authentication actions', async () => {
      await withApplication(async (origin) => {
        const active = session(await login(origin), mainUser);
        const before = await countSessions();
        for (const headers of [
          { Origin: 'https://untrusted.example' },
          { Origin: '' },
          { Origin: 'null' },
          { 'X-Wargame-Request': '' },
        ]) {
          safeError(await login(origin, undefined, headers), 403, 'CSRF_REJECTED');
        }
        safeError(await request(origin, 'login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Wargame-Request': '1' },
          body: JSON.stringify({ username: mainUser.username, password }),
        }), 403, 'CSRF_REJECTED');
        safeError(await current(origin, active.cookie, { Origin: 'https://untrusted.example' }), 403, 'CSRF_REJECTED');
        safeError(await current(origin, active.cookie, { 'X-Wargame-Request': '' }), 403, 'CSRF_REJECTED');
        for (const headers of [
          { 'X-CSRF-Token': '' },
          { 'X-CSRF-Token': responseMarker },
          { 'X-CSRF-Token': persisted.body.csrfToken },
          { Origin: 'https://untrusted.example' },
          { 'X-Wargame-Request': '' },
        ]) {
          safeError(await logout(origin, active, headers), 403, 'CSRF_REJECTED');
        }
        assert.equal(await countSessions(), before, 'Rejected requests must neither create nor delete sessions.');
        assert.equal((await current(origin, active.cookie)).response.status, 200);
        const ended = await logout(origin, active);
        assert.equal(ended.response.status, 204);
        assert.equal(ended.body, undefined);
        clearedCookie(ended.response);
        assert.equal(await findSession(active.tokenHash), null);
        safeError(await current(origin, active.cookie), 401, 'UNAUTHENTICATED');
        safeError(await logout(origin, active), 401, 'UNAUTHENTICATED');
      });
    });

    await suite.test('either server-side lifetime expires a session regardless of the cookie', async () => {
      await withApplication(async (origin) => {
        for (const mode of ['absolute', 'idle']) {
          const active = session(await login(origin), mainUser);
          const now = Date.now();
          const data = mode === 'absolute'
            ? { createdAt: new Date(now - 8 * dayMs), expiresAt: new Date(now - dayMs), idleExpiresAt: new Date(now - dayMs) }
            : { createdAt: new Date(now - 2 * dayMs), expiresAt: new Date(now + 5 * dayMs), idleExpiresAt: new Date(now - 1000) };
          await changeSession(active.tokenHash, data);
          safeError(await current(origin, active.cookie), 401, 'UNAUTHENTICATED');
          safeError(await logout(origin, active), 401, 'UNAUTHENTICATED');
        }
      });
    });

    await suite.test('current-user activity slides idle expiry and clamps it to the unchanged absolute limit', async () => {
      await withApplication(async (origin) => {
        const active = session(await login(origin), mainUser);
        const now = Date.now();
        const futureIdle = new Date(now + dayMs + 5000);
        await changeSession(active.tokenHash, { idleExpiresAt: futureIdle });
        const monotonic = await current(origin, active.cookie);
        assert.equal(monotonic.response.status, 200);
        assert.ok(Date.parse(monotonic.body.idleExpiresAt) >= futureIdle.getTime(),
          'An earlier concurrent request must not shorten the last recorded idle deadline.');
        await changeSession(active.tokenHash, {
          createdAt: new Date(now - 2 * dayMs), expiresAt: new Date(now + 5 * dayMs), idleExpiresAt: new Date(now + 60000),
        });
        const first = await current(origin, active.cookie);
        assert.equal(first.response.status, 200);
        const touched = await findSession(active.tokenHash);
        assert.ok(touched.idleExpiresAt.getTime() >= now + dayMs - 1000);
        assert.equal(touched.idleExpiresAt.toISOString(), first.body.idleExpiresAt);
        const absoluteLimit = new Date(Date.now() + 60000);
        await changeSession(active.tokenHash, { expiresAt: absoluteLimit, idleExpiresAt: new Date(Date.now() + 30000) });
        const clamped = await current(origin, active.cookie);
        assert.equal(clamped.response.status, 200);
        assert.equal(clamped.body.expiresAt, absoluteLimit.toISOString());
        assert.equal(clamped.body.idleExpiresAt, absoluteLimit.toISOString());
        assert.equal(clamped.response.headers.get('Set-Cookie'), null);
      });
    });

    await suite.test('competing current-user reads cannot resurrect a logged-out session', async () => {
      await withApplication(async (origin) => {
        const active = session(await login(origin), mainUser);
        const [read, ended] = await Promise.all([current(origin, active.cookie), logout(origin, active)]);
        assert.ok([200, 401].includes(read.response.status));
        if (read.response.status === 200) assert.equal(read.response.headers.get('Set-Cookie'), null);
        assert.equal(ended.response.status, 204);
        assert.equal(await findSession(active.tokenHash), null);
        safeError(await current(origin, active.cookie), 401, 'UNAUTHENTICATED');
      });
    });

    await suite.test('malformed JSON, oversized bodies and malformed UTF-8 remain bounded and private', async () => {
      const before = await countSessions();
      await withApplication(async (origin) => {
        const malformedUtf8 = Buffer.concat([
          Buffer.from('{"username":"Main.player","password":"valid passphrase'),
          Buffer.from([0xff]), Buffer.from('"}'),
        ]);
        for (const [body, contentType, status, code] of [
          [`{"password":"${responseMarker}"`, 'application/json', 400, 'INVALID_JSON'],
          [JSON.stringify({ username: 'Main.player', password: 'x'.repeat(5000) }), 'application/json', 413, 'BODY_TOO_LARGE'],
          [malformedUtf8, 'application/json', 400, 'INVALID_JSON'],
          [Buffer.from('{}', 'utf16le'), 'application/json; charset=utf-16le', 415, 'UNSUPPORTED_ENCODING'],
        ]) {
          const result = await request(origin, 'login', {
            method: 'POST', headers: { ...trustedHeaders, 'Content-Type': contentType }, body,
          });
          safeError(result, status, code, [configuration.databaseUrl, decodeURIComponent(sourceUrl.password)]);
        }
      });
      assert.equal(await countSessions(), before);
    });

    await suite.test('HTTPS public origins issue and clear the host-prefixed Secure cookie', async () => {
      const httpsOrigin = 'https://friends.example';
      await withApplication(async (origin) => {
        const active = session(await login(origin, undefined, { Origin: httpsOrigin }), mainUser, 'PLAYER', true);
        const result = await current(origin, active.cookie, { Origin: httpsOrigin });
        assert.equal(result.response.status, 200);
        assert.equal(result.response.headers.get('Set-Cookie'), null);
        const ended = await logout(origin, active, { Origin: httpsOrigin });
        assert.equal(ended.response.status, 204);
        clearedCookie(ended.response, true);
        safeError(await current(origin, active.cookie, { Origin: httpsOrigin }), 401, 'UNAUTHENTICATED');
      }, httpsOrigin);
    });

    await suite.test('bounded cleanup removes expired rows in batches without affecting live sessions', async () => {
      await withApplication(async (origin, app) => {
        await databaseOperation(() => database.session.deleteMany());
        const active = session(await login(origin), mainUser);
        const now = Date.now();
        await databaseOperation(() => database.session.createMany({ data: Array.from({ length: 1002 }, () => ({
          tokenHash: bearerHash(randomBytes(32).toString('base64url')), userId: mainUser.id,
          createdAt: new Date(now - 8 * dayMs), expiresAt: new Date(now - dayMs), idleExpiresAt: new Date(now - dayMs),
        })) }));
        assert.equal(await countSessions(), 1003);
        await app.get(SessionService).cleanupExpired();
        assert.equal(await countSessions(), 3);
        assert.equal((await current(origin, active.cookie)).response.status, 200);
        await app.get(SessionService).cleanupExpired();
        assert.equal(await countSessions(), 1);
        assert.ok(await findSession(active.tokenHash));
      });
    });

    await suite.test('cleanup waiting behind an admitted renewal cannot delete the renewed session', async () => {
      await withApplication(async (origin, app) => {
        const active = session(await login(origin), mainUser);
        const oldIdle = new Date(Date.now() + 3000);
        await changeSession(active.tokenHash, { idleExpiresAt: oldIdle });
        let release;
        const released = new Promise((resolve) => { release = resolve; });
        let acquired;
        const locked = new Promise((resolve) => { acquired = resolve; });
        const guard = databaseOperation(() => database.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT "tokenHash" FROM "Session" WHERE "tokenHash" = ${active.tokenHash} FOR UPDATE`;
          acquired();
          await released;
        }, { timeout: 8000 }));
        let reading;
        let cleaning;
        const waitForLock = async (fragment) => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const rows = await databaseOperation(() => database.$queryRaw`
              SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query LIKE ${`%${fragment}%`}
            `);
            if (rows[0].count > 0) return;
            await delay(20);
          }
          assert.fail('Expected the test query to wait on the controlled session lock.');
        };
        try {
          await Promise.race([locked, guard]);
          reading = current(origin, active.cookie);
          await waitForLock('UPDATE "Session" s');
          await delay(Math.max(0, oldIdle.getTime() - Date.now() + 100));
          cleaning = app.get(SessionService).cleanupExpired();
          await waitForLock('DELETE FROM "Session"');
        } finally {
          release();
          await guard;
          // Drain both operations even if a synchronization assertion fails.
          await Promise.allSettled([reading, cleaning].filter(Boolean));
        }
        const read = await reading;
        await cleaning;
        assert.equal(read.response.status, 200, 'The renewal was admitted before idle expiry.');
        assert.ok(await findSession(active.tokenHash), 'Cleanup must retain the newly renewed session.');
        assert.equal((await current(origin, active.cookie)).response.status, 200);
      });
    });

    await suite.test('normalized account attempts are limited across case and whitespace variants', async () => {
      await withApplication(async (origin) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          safeError(await login(origin, {
            username: attempt % 2 ? '  MAIN.PLAYER  ' : 'Main.player', password: 'incorrect password phrase',
          }), 401, 'INVALID_CREDENTIALS');
        }
        const denied = await login(origin);
        assert.equal(denied.response.status, 429);
        assert.ok(/^\d+$/.test(denied.response.headers.get('Retry-After')));
        assert.ok(Number(denied.response.headers.get('Retry-After')) > 0);
        assert.ok(Number(denied.response.headers.get('Retry-After')) <= 900);
        const unrelated = session(await login(origin, { username: unicodeUser.username, password: unicodePassword }), unicodeUser);
        assert.equal((await current(origin, unrelated.cookie)).response.status, 200);
      });
    });

    await suite.test('socket limits count rejected origins and parser failures before trusting forwarded addresses', async () => {
      const before = await countSessions();
      await withApplication(async (origin) => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const badOrigin = attempt % 2 === 0;
          const result = await request(origin, 'login', {
            method: 'POST',
            headers: {
              ...trustedHeaders, 'Content-Type': 'application/json',
              Origin: badOrigin ? 'https://untrusted.example' : publicOrigin,
              'X-Forwarded-For': `192.0.2.${attempt + 1}`,
              Forwarded: `for=192.0.2.${attempt + 1}`,
              'X-Real-IP': `198.51.100.${attempt + 1}`,
            },
            body: `{"password":"${responseMarker}"`,
          });
          safeError(result, badOrigin ? 403 : 400, badOrigin ? 'CSRF_REJECTED' : 'INVALID_JSON');
        }
        const denied = await login(origin, { username: 'Limited.player', password: 'x'.repeat(5000) }, {
          'X-Forwarded-For': '203.0.113.99',
        });
        assert.equal(denied.response.status, 429);
        assert.ok(/^\d+$/.test(denied.response.headers.get('Retry-After')));
        assert.ok(Number(denied.response.headers.get('Retry-After')) > 0);
        assert.ok(Number(denied.response.headers.get('Retry-After')) <= 900);
      });
      assert.equal(await countSessions(), before);
    });
  } finally {
    let cleanupFailed = false;
    for (const app of applications) {
      try { await app.close(); } catch { cleanupFailed = true; }
    }
    try { await databaseOperation(() => database?.$disconnect()); } catch { cleanupFailed = true; }
    try {
      if (created) {
        assert.match(databaseName, /^t06_auth_[a-f0-9]{24}$/);
        await databaseOperation(() => admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`));
      }
    } catch {
      cleanupFailed = true;
    } finally {
      try { await databaseOperation(() => admin.$disconnect()); } catch { cleanupFailed = true; }
    }
    assert.equal(cleanupFailed, false,
      'Authentication integration cleanup failed; check disposable database connections and removal.');
  }
});
