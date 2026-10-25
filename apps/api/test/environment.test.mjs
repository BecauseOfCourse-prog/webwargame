import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../dist/config/environment.js';
import { resolve } from 'node:path';

const databaseUrl = 'postgresql://test_user:test_password@127.0.0.1:5432/test_database';

test('valid configuration defaults the API port and cannot be mutated', () => {
  const result = parseEnvironment({ DATABASE_URL: databaseUrl });
  assert.equal(result.apiPort, 3000);
  assert.equal(result.databaseUrl, databaseUrl);
  assert.ok(Object.isFrozen(result));
});

test('a valid configured API port is accepted', () => {
  assert.equal(parseEnvironment({ DATABASE_URL: databaseUrl, API_PORT: '3100' }).apiPort, 3100);
});

test('missing database URL and malformed/non-PostgreSQL URLs fail', () => {
  for (const value of [undefined, '', 'not a url', 'https://example.test/db', 'postgresql://localhost/db']) {
    assert.throws(() => parseEnvironment({ DATABASE_URL: value }), /DATABASE_URL/);
  }
});

test('invalid ports fail instead of silently changing the listening port', () => {
  for (const value of ['', '0', '-1', '65536', '3.5', 'abc']) {
    assert.throws(() => parseEnvironment({ DATABASE_URL: databaseUrl, API_PORT: value }), /API_PORT/);
  }
});

test('configuration errors do not reveal a supplied URL or password', () => {
  const secret = 'secret-must-not-be-logged';
  const value = `https://user:${secret}@example.test/database`;
  assert.throws(
    () => parseEnvironment({ DATABASE_URL: value, API_PORT: 'invalid' }),
    (error) => error.message.includes('DATABASE_URL') &&
      error.message.includes('API_PORT') &&
      !error.message.includes(secret) && !error.message.includes(value),
  );
});

test('public origin defaults to local development and HTTPS enables secure cookies', () => {
  const local = parseEnvironment({ DATABASE_URL: databaseUrl });
  assert.equal(local.publicOrigin, 'http://127.0.0.1:5173');
  assert.equal(local.secureCookies, false);
  const secure = parseEnvironment({ DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: 'https://Game.Example.test/' });
  assert.equal(secure.publicOrigin, 'https://game.example.test');
  assert.equal(secure.secureCookies, true);
});

test('only explicit loopback HTTP origins may use cookies without Secure', () => {
  for (const origin of ['http://127.0.0.1:4173', 'http://localhost:5173', 'http://[::1]:5173']) {
    const result = parseEnvironment({ DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: origin });
    assert.equal(result.publicOrigin, origin);
    assert.equal(result.secureCookies, false);
  }
});

test('invalid origins fail closed without exposing supplied URL credentials', () => {
  const secret = 'origin-secret-must-not-be-logged';
  for (const origin of ['', 'null', 'not a URL', 'http://game.example.test', 'https://game.example.test/path',
    'https://game.example.test/?query=value', 'https://game.example.test/#fragment',
    `https://user:${secret}@game.example.test`, 'https://one.test,https://two.test', 'ftp://127.0.0.1']) {
    assert.throws(() => parseEnvironment({ DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: origin }), (error) => {
      assert.match(error.message, /PUBLIC_ORIGIN/);
      assert.ok(!error.message.includes(secret));
      assert.ok(!error.message.includes(origin) || origin === '');
      return true;
    });
  }
});

test('private upload defaults are bounded, absolute and immutable', () => {
  const { uploads } = parseEnvironment({ DATABASE_URL: databaseUrl });
  assert.equal(uploads.maxBytes, 10485760);
  assert.equal(uploads.maxPixels, 24000000);
  assert.equal(uploads.maxSide, 8192);
  assert.equal(uploads.maxDiskBytes, 1073741824);
  assert.ok(Object.isFrozen(uploads));
  assert.equal(uploads.directory, resolve('../../.local/uploads'));
});

test('upload configuration accepts explicit limits and rejects unsafe/invalid settings without echoing values', () => {
  const values = { DATABASE_URL: databaseUrl, UPLOAD_DIRECTORY: resolve('../../.local/test-uploads'),
    UPLOAD_MAX_BYTES: '2000', UPLOAD_MAX_SIDE: '50', UPLOAD_MAX_PIXELS: '1000', UPLOAD_MAX_DISK_BYTES: '5000', UPLOAD_MIN_FREE_BYTES: '0' };
  assert.deepEqual(parseEnvironment(values).uploads, { directory: values.UPLOAD_DIRECTORY,
    maxBytes: 2000, maxSide: 50, maxPixels: 1000, maxDiskBytes: 5000, minFreeBytes: 0 });
  for (const key of ['UPLOAD_MAX_BYTES', 'UPLOAD_MAX_SIDE', 'UPLOAD_MAX_PIXELS', 'UPLOAD_MAX_DISK_BYTES', 'UPLOAD_MIN_FREE_BYTES']) {
    for (const value of ['', '-1', '1.5', 'not-a-number', String(1024 ** 5)]) {
      // Empty means zero under numeric coercion; only the free-space reserve permits zero.
      if (key === 'UPLOAD_MIN_FREE_BYTES' && value === '') continue;
      assert.throws(() => parseEnvironment({ ...values, [key]: value }), new RegExp(key));
    }
  }
  for (const directory of ['relative/private', resolve('../../'), resolve('../../apps/web/public'), resolve('../../apps/api/dist'), resolve('../../.git')]) {
    assert.throws(() => parseEnvironment({ ...values, UPLOAD_DIRECTORY: directory }), /UPLOAD_DIRECTORY/);
  }
});
