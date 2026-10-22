import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../dist/config/environment.js';

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
