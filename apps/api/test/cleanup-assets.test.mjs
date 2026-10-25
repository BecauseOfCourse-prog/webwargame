import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseCleanupArguments } from '../scripts/cleanup-assets.mjs';

test('cleanup defaults to a bounded non-destructive report and apply is explicit', () => {
  assert.deepEqual(parseCleanupArguments([]), { apply: false, limit: 25 });
  assert.deepEqual(parseCleanupArguments(['--limit', '100']), { apply: false, limit: 100 });
  assert.deepEqual(parseCleanupArguments(['--apply', '--limit', '1']), { apply: true, limit: 1 });
  assert.deepEqual(parseCleanupArguments(['--limit', '5', '--apply']), { apply: true, limit: 5 });
});
test('unknown, repeated or invalid cleanup arguments cannot silently enable deletion', () => {
  for (const args of [['--apply', '--apply'], ['--force'], ['--help', '--apply'], ['--limit'], ['--limit', '0'],
    ['--limit', '101'], ['--limit', '-1'], ['--limit', '1.5'], ['--limit', '1', '--limit', '2'], ['--apply=yes']]) {
    assert.throws(() => parseCleanupArguments(args), /Usage:/);
  }
});
test('cleanup help and invalid input do not load a database or echo supplied private values', () => {
  const script = fileURLToPath(new URL('../scripts/cleanup-assets.mjs', import.meta.url));
  for (const [args, expected] of [[['--help'], 0], [['private-do-not-echo'], 1]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, DATABASE_URL: '', UPLOAD_DIRECTORY: 'invalid-relative-directory' },
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected);
    assert.match(result.stdout + result.stderr, /Usage:/);
    assert.doesNotMatch(result.stdout + result.stderr, /private-do-not-echo|Prisma|Invalid environment/);
  }
});
