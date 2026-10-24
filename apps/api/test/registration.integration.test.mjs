import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { verify } from 'argon2';
import { createApplication } from '../dist/application.js';
import { loadConfiguration, RuntimeConfiguration } from '../dist/config/environment.js';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const password = '  пароль для друзей 🐉  ';
const responseMarker = 'registration-input-must-not-be-echoed';

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
    throw new Error('Registration integration requires a loopback PostgreSQL URL without query parameters or a fragment.');
  }
}

function client(connectionString) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
      max: 2,
    }),
    log: [],
  });
}

async function databaseOperation(operation) {
  try {
    return await operation();
  } catch {
    // Driver errors can contain credentials or SQL; never emit them in TAP output.
    throw new Error('Registration integration database operation failed; check local PostgreSQL and migrations.');
  }
}

function migrate(databaseUrl) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    // Neither migration diagnostics nor the child environment belong in test logs.
    throw new Error('Registration integration migration failed; build the API and check local PostgreSQL.');
  }
}

async function post(origin, payload, headers = {}) {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  return { response, body: await response.json() };
}

function publicUser(body, username) {
  assert.deepEqual(Object.keys(body), ['user']);
  assert.deepEqual(Object.keys(body.user).sort(), ['createdAt', 'id', 'role', 'username']);
  assert.equal(body.user.username, username);
  assert.equal(body.user.role, 'PLAYER');
  assert.match(body.user.id, /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i);
  assert.equal(new Date(body.user.createdAt).toISOString(), body.user.createdAt);
}

function safeError(body, secrets = []) {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.equal(typeof body.message, 'string');
  const serialized = JSON.stringify(body);
  assert.ok(serialized.length < 1600, 'Error response must stay bounded.');
  assert.ok(!/(PrismaClient|node_modules|postgres(?:ql)?:\/\/|INSERT INTO|passwordHash|\$argon2)/i.test(serialized),
    'Error response exposed an implementation detail.');
  for (const secret of [responseMarker, password, ...secrets]) {
    assert.ok(!serialized.includes(secret), 'Error response echoed private input or configuration.');
  }
}

function invalidRegistration(result, fields) {
  assert.equal(result.response.status, 400);
  safeError(result.body);
  assert.equal(result.body.code, 'INVALID_REGISTRATION');
  assert.ok(result.body.fields && typeof result.body.fields === 'object');
  for (const field of fields) {
    assert.ok(Array.isArray(result.body.fields[field]), `Missing ${field} validation errors.`);
    assert.ok(result.body.fields[field].length > 0);
    assert.ok(result.body.fields[field].every((message) => typeof message === 'string' && message.length > 0));
  }
}

test('registration persists safe player accounts and rejects invalid, competing and limited HTTP requests', {
  timeout: 120000,
}, async (suite) => {
  const configuration = loadConfiguration();
  const sourceUrl = localDatabaseUrl(configuration.databaseUrl);
  const databaseName = `t05_registration_${randomBytes(12).toString('hex')}`;
  assert.match(databaseName, /^t05_registration_[a-f0-9]{24}$/);
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  const admin = client(adminUrl.href);
  let database;
  let created = false;
  const applications = new Set();

  async function withApplication(operation) {
    const app = await createApplication(new RuntimeConfiguration(testUrl.href, configuration.apiPort));
    applications.add(app);
    try {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      await operation(`http://127.0.0.1:${address.port}`);
    } finally {
      await app.close();
      applications.delete(app);
    }
  }

  const countUsers = () => databaseOperation(() => database.user.count());
  const findUser = (normalizedUsername) => databaseOperation(() =>
    database.user.findUnique({ where: { normalizedUsername } }));

  try {
    // SQL identifiers cannot be bound as parameters. Only this generated,
    // strictly checked identifier is ever interpolated, including during cleanup.
    await databaseOperation(() => admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`));
    created = true;
    migrate(testUrl.href);
    migrate(testUrl.href);
    database = client(testUrl.href);

    await suite.test('all committed migrations apply exactly once to the disposable database', async () => {
      const directories = await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true });
      const expected = directories.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      const applied = await databaseOperation(() => database.$queryRaw`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
      `);
      assert.ok(expected.length > 0);
      assert.deepEqual(applied.map((row) => row.migration_name), expected);
      assert.equal(await countUsers(), 0);
    });

    let persistedUser;
    await suite.test('registration trims the display name, persists a player and independently salted Argon2id hashes', async () => {
      await withApplication(async (origin) => {
        const first = await post(origin, { username: '  Commander._-9  ', password });
        assert.equal(first.response.status, 201);
        publicUser(first.body, 'Commander._-9');
        assert.equal(first.response.headers.get('set-cookie'), null, 'Registration must not create a session.');
        persistedUser = first.body.user;

        const row = await findUser('commander._-9');
        assert.equal(row.id, persistedUser.id);
        assert.equal(row.username, 'Commander._-9');
        assert.equal(row.role, 'PLAYER');
        assert.equal(row.createdAt.toISOString(), persistedUser.createdAt);
        assert.ok(row.passwordHash.startsWith('$argon2id$v=19$'));
        assert.deepEqual(row.passwordHash.split('$')[3].split(',').sort(), ['m=19456', 'p=1', 't=2']);
        assert.ok(row.passwordHash !== password);
        assert.ok(await verify(row.passwordHash, password));
        assert.ok(!await verify(row.passwordHash, password.trim()), 'Password spaces must be retained.');

        const second = await post(origin, { username: 'Second.player', password });
        assert.equal(second.response.status, 201);
        publicUser(second.body, 'Second.player');
        const secondRow = await findUser('second.player');
        assert.ok(await verify(secondRow.passwordHash, password));
        assert.ok(secondRow.passwordHash !== row.passwordHash, 'Equal passwords need independent random salts.');
      });
    });

    await suite.test('an application restart retains accounts and rejects case or whitespace duplicates', async () => {
      await withApplication(async (origin) => {
        const before = await countUsers();
        const duplicate = await post(origin, { username: '  COMMANDER._-9 ', password });
        assert.equal(duplicate.response.status, 409);
        safeError(duplicate.body);
        assert.equal(duplicate.body.code, 'USERNAME_TAKEN');
        assert.equal(await countUsers(), before);
        assert.equal((await findUser('commander._-9')).id, persistedUser.id);
      });
    });

    await suite.test('concurrent normalized duplicates create exactly one database row', async () => {
      await withApplication(async (origin) => {
        const before = await countUsers();
        const results = await Promise.all([
          post(origin, { username: 'Race.player', password }),
          post(origin, { username: '  RACE.PLAYER  ', password }),
        ]);
        assert.deepEqual(results.map((result) => result.response.status).sort(), [201, 409]);
        const winner = results.find((result) => result.response.status === 201);
        const loser = results.find((result) => result.response.status === 409);
        publicUser(winner.body, winner.body.user.username);
        safeError(loser.body);
        assert.equal(loser.body.code, 'USERNAME_TAKEN');
        assert.equal(await countUsers(), before + 1);
        assert.equal(await databaseOperation(() => database.user.count({ where: { normalizedUsername: 'race.player' } })), 1);
      });
    });

    await suite.test('username and Unicode password length boundaries are accepted without normalization', async () => {
      await withApplication(async (origin) => {
        for (const [username, exactPassword] of [
          ['x_9', '🐉'.repeat(15)],
          [`B${'x'.repeat(31)}`, '🦊'.repeat(128)],
          ['Unicode.exact', 'e\u0301'.repeat(8)],
          ['Spaces.only', ' '.repeat(15)],
        ]) {
          const result = await post(origin, { username, password: exactPassword });
          assert.equal(result.response.status, 201);
          publicUser(result.body, username);
          const row = await findUser(username.toLowerCase());
          assert.ok(await verify(row.passwordHash, exactPassword));
          if (exactPassword.normalize('NFC') !== exactPassword) {
            assert.ok(!await verify(row.passwordHash, exactPassword.normalize('NFC')));
          }
        }
      });
    });

    const invalidCases = [
      [{}, ['username', 'password']],
      [{ username: 'ab', password }, ['username']],
      [{ username: 'a'.repeat(33), password }, ['username']],
      [{ username: 'Игрок', password }, ['username']],
      [{ username: 'player/name', password }, ['username']],
      [{ username: 'bad\nname', password }, ['username']],
      [{ username: null, password }, ['username']],
      [{ username: 123, password }, ['username']],
      [{ username: 'Invalid.player', password: 'a'.repeat(14) }, ['password']],
      [{ username: 'Invalid.player', password: '🐉'.repeat(129) }, ['password']],
      [{ username: 'Invalid.player', password: 'valid passphrase\u0000' }, ['password']],
      [{ username: 'Invalid.player', password: 'valid passphrase\u007f' }, ['password']],
      [{ username: 'Invalid.player', password: 'valid passphrase\ud800' }, ['password']],
      [{ username: 'Invalid.player', password: 123456789012345 }, ['password']],
      [{ username: 'Invalid.player', password: ['valid passphrase'] }, ['password']],
      [{ username: 'Invalid.player', password: null }, ['password']],
      [{ username: 'Injected.admin', password, role: 'ADMIN' }, ['body']],
      [{ username: 'Injected.id', password, id: '00000000-0000-0000-0000-000000000000' }, ['body']],
      [{ username: 'Injected.hash', password, passwordHash: responseMarker }, ['body']],
      [{ username: 'Unknown.player', password, extra: { secret: responseMarker } }, ['body']],
      [[], ['body']],
    ];
    // Each fresh process-local limiter gets fewer than its ten attempts here.
    // Validation tests must not accidentally turn into rate-limit tests.
    for (let offset = 0; offset < invalidCases.length; offset += 8) {
      await suite.test(`invalid fields and caller-supplied properties do not write users (batch ${offset / 8 + 1})`, async () => {
        const before = await countUsers();
        await withApplication(async (origin) => {
          for (const [payload, fields] of invalidCases.slice(offset, offset + 8)) {
            invalidRegistration(await post(origin, payload), fields);
          }
        });
        assert.equal(await countUsers(), before);
      });
    }

    await suite.test('malformed, oversized and non-JSON requests return bounded errors without echoing input', async () => {
      const before = await countUsers();
      await withApplication(async (origin) => {
        for (const [body, contentType, status] of [
          ['null', 'application/json', 400],
          ['123', 'application/json', 400],
          [JSON.stringify(responseMarker), 'application/json', 400],
          [`{"username":"${responseMarker}","password":`, 'application/json', 400],
          [JSON.stringify({ username: responseMarker, password: 'x'.repeat(5000) }), 'application/json', 413],
          [responseMarker, 'text/plain', 415],
          [`username=${responseMarker}&password=${responseMarker}`, 'application/x-www-form-urlencoded', 415],
        ]) {
          const response = await fetch(`${origin}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body,
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(response.status, status);
          assert.match(response.headers.get('Content-Type'), /^application\/json\b/);
          const errorBody = await response.json();
          safeError(errorBody, [configuration.databaseUrl, decodeURIComponent(sourceUrl.password)]);
          if (errorBody.code === 'INVALID_REGISTRATION') {
            assert.ok(Array.isArray(errorBody.fields?.body));
            assert.ok(errorBody.fields.body.length > 0);
          }
        }
      });
      assert.equal(await countUsers(), before);
    });

    await suite.test('registration rejects malformed UTF-8 and other charsets while preserving valid Unicode bytes', async () => {
      const before = await countUsers();
      await withApplication(async (origin) => {
        const malformedPassword = (bytes) => Buffer.concat([
          Buffer.from('{"username":"Malformed.utf8","password":"valid passphrase'),
          Buffer.from(bytes),
          Buffer.from('"}'),
        ]);
        const invalidRequests = [
          [malformedPassword([0xff]), 'application/json', 400, 'INVALID_JSON'],
          [malformedPassword([0xfe]), 'application/json', 400, 'INVALID_JSON'],
          [malformedPassword([0xed, 0xa0, 0x80]), 'application/json', 400, 'INVALID_JSON'],
          [Buffer.from(JSON.stringify({ username: 'Unsupported.charset', password }), 'utf16le'),
            'application/json; charset=utf-16le', 415, 'UNSUPPORTED_ENCODING'],
        ];
        for (const [body, contentType, status, code] of invalidRequests) {
          const response = await fetch(`${origin}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body,
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(response.status, status);
          const errorBody = await response.json();
          safeError(errorBody, ['valid passphrase']);
          assert.equal(errorBody.code, code);
        }
        assert.equal(await countUsers(), before, 'Invalid encodings must not create accounts.');

        const exactPassword = 'valid passphrase\ufffd\u{1f409}';
        const response = await fetch(`${origin}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: Buffer.from(JSON.stringify({ username: 'Valid.utf8', password: exactPassword }), 'utf8'),
          signal: AbortSignal.timeout(10000),
        });
        assert.equal(response.status, 201);
        publicUser(await response.json(), 'Valid.utf8');
        const row = await findUser('valid.utf8');
        assert.ok(await verify(row.passwordHash, exactPassword));
        assert.ok(!await verify(row.passwordHash, exactPassword.replace('\ufffd', '')),
          'A literal replacement character is valid password content and must be retained.');
      });
      assert.equal(await countUsers(), before + 1);
    });

    await suite.test('socket-address rate limits count parser failures and ignore spoofed forwarding headers', async () => {
      const before = await countUsers();
      await withApplication(async (origin) => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const response = await fetch(`${origin}/api/auth/register`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `192.0.2.${attempt + 1}`,
              'Forwarded': `for=192.0.2.${attempt + 1}`,
              'X-Real-IP': `198.51.100.${attempt + 1}`,
            },
            body: `{"password":"${responseMarker}"`,
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(response.status, 400);
          safeError(await response.json());
        }
        // The limiter runs before body parsing: an oversized eleventh request
        // must receive 429 rather than 413, even with another forwarded address.
        const denied = await post(origin, { username: 'Limited.player', password: 'x'.repeat(5000) }, {
          'X-Forwarded-For': '203.0.113.99',
        });
        assert.equal(denied.response.status, 429);
        safeError(denied.body);
        const retryAfter = denied.response.headers.get('Retry-After');
        assert.ok(/^\d+$/.test(retryAfter));
        assert.ok(Number(retryAfter) > 0 && Number(retryAfter) <= 900);
        const stillDenied = await post(origin, { username: 'Limited.player', password }, {
          'X-Forwarded-For': '203.0.113.100',
        });
        assert.equal(stillDenied.response.status, 429);
        safeError(stillDenied.body);
      });
      assert.equal(await countUsers(), before);
    });
  } finally {
    let cleanupFailed = false;
    for (const app of applications) {
      try {
        await app.close();
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      await databaseOperation(() => database?.$disconnect());
    } catch {
      cleanupFailed = true;
    }
    try {
      if (created) {
        assert.match(databaseName, /^t05_registration_[a-f0-9]{24}$/);
        await databaseOperation(() => admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`));
      }
    } catch {
      cleanupFailed = true;
    } finally {
      try {
        await databaseOperation(() => admin.$disconnect());
      } catch {
        cleanupFailed = true;
      }
    }
    assert.equal(cleanupFailed, false,
      'Registration integration cleanup failed; check disposable database connections and removal.');
  }
});
