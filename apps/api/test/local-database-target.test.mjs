import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalDatabaseTarget } from '../scripts/local-database-target.mjs';

const environment = {
  POSTGRES_USER: 'local_user',
  POSTGRES_PASSWORD: 'local_password',
  POSTGRES_DB: 'local_database',
  POSTGRES_PORT: '5432',
};
const url = 'postgresql://local_user:local_password@127.0.0.1:5432/local_database';

test('matching canonical local Compose target is accepted', () => {
  assert.equal(assertLocalDatabaseTarget(url, environment).href, url);
});

test('driver query overrides are rejected before any database operation', () => {
  for (const query of ['host=example.invalid', 'port=6543', 'user=other', 'schema=public']) {
    assert.throws(() => assertLocalDatabaseTarget(`${url}?${query}`, environment), /without query parameters/);
  }
});

test('remote, mismatched or malformed targets fail without disclosing the input', () => {
  for (const value of [
    url.replace('127.0.0.1', 'example.invalid'),
    url.replace('local_password', 'different-secret'),
    url.replace('local_database', 'different_database'),
    `${url}#fragment`,
    'invalid URL',
  ]) {
    assert.throws(() => assertLocalDatabaseTarget(value, environment), (error) =>
      error.message.startsWith('db:verify requires') &&
      !error.message.includes(value) && !error.message.includes('different-secret'));
  }
});
