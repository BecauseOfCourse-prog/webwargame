import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entrypoint = fileURLToPath(new URL('../dist/main.js', import.meta.url));

function startApi(databaseUrl) {
  const result = spawnSync(process.execPath, [entrypoint], {
    env: { ...process.env, DATABASE_URL: databaseUrl, API_PORT: '31987' },
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

test('missing DATABASE_URL stops the real API before listening', () => {
  const result = startApi('');
  assert.equal(result.status, 1);
  assert.match(result.output, /Invalid environment configuration:.*DATABASE_URL/);
  assert.doesNotMatch(result.output, /successfully started/);
});

test('unreachable database stops startup without disclosing connection credentials', () => {
  const secret = 'startup-secret-must-not-be-logged';
  const url = `postgresql://test_user:${secret}@127.0.0.1:1/missing_database`;
  const result = startApi(url);
  assert.equal(result.status, 1);
  assert.match(result.output, /Database connection failed/);
  assert.ok(!result.output.includes(secret));
  assert.ok(!result.output.includes(url));
  assert.doesNotMatch(result.output, /successfully started/);
});
