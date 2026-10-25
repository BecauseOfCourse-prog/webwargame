import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { AssetActivity, AssetMaintenanceBusyError, AssetWriterActiveError, MAX_ASSET_CONTROL_BYTES, isAssetControlName } from '../dist/assets/asset-activity.js';

const maintenanceName = '.asset-maintenance.json';

async function fixture(run) {
  const parent = await realpath(tmpdir());
  const temporary = await mkdtemp(join(parent, 'webwargame-t10-activity-'));
  const root = await realpath(temporary);
  const inside = relative(parent, root);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
  assert.match(inside, /^webwargame-t10-activity-/);
  try { await run(root); }
  finally {
    const target = resolve(root);
    const child = relative(parent, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    assert.match(child, /^webwargame-t10-activity-/);
    assert.equal(await realpath(target), root);
    await rm(target, { recursive: true, force: true });
  }
}

test('only exact server control names are reserved', () => {
  assert.equal(isAssetControlName(maintenanceName), true);
  assert.equal(isAssetControlName(`.asset-writer-${randomUUID()}.json`), true);
  for (const value of ['.foo', '.asset-writer-invalid.json', '.asset-maintenance.json.old', '.asset-writer-aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa.json',
    '.asset-writer-AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.json', '../.asset-maintenance.json', 'asset-maintenance.json', `${randomUUID()}`]) {
    assert.equal(isAssetControlName(value), false);
  }
});

test('concurrent writers have distinct private markers with bounded public operational metadata', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  const releases = await Promise.all(Array.from({ length: 6 }, () => activity.beginWrite()));
  try {
    const names = await readdir(root);
    assert.equal(names.length, releases.length);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) {
      assert.equal(isAssetControlName(name), true);
      const bytes = await readFile(join(root, name));
      assert.ok(bytes.length <= MAX_ASSET_CONTROL_BYTES);
      const payload = JSON.parse(bytes.toString('utf8'));
      assert.deepEqual(Object.keys(payload).sort(), ['hostname', 'id', 'pid', 'startedAt']);
      assert.equal(name, `.asset-writer-${payload.id}.json`);
      assert.equal(payload.pid, process.pid);
      assert.equal(payload.hostname, hostname());
      assert.equal(new Date(payload.startedAt).toISOString(), payload.startedAt);
      if (process.platform !== 'win32') assert.equal((await lstat(join(root, name))).mode & 0o777, 0o600);
    }
  } finally {
    await Promise.all(releases.flatMap((release) => [release(), release()]));
  }
  assert.deepEqual(await readdir(root), []);
}));

test('maintenance excludes new writers and a second maintenance operation until its idempotent release', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  const release = await activity.beginMaintenance();
  try {
    await assert.rejects(() => activity.beginWrite(), AssetMaintenanceBusyError);
    await assert.rejects(() => new AssetActivity(root).beginMaintenance(), AssetMaintenanceBusyError);
    assert.deepEqual(await readdir(root), [maintenanceName]);
  } finally { await Promise.all([release(), release()]); }
  assert.deepEqual(await readdir(root), []);
  const writerRelease = await activity.beginWrite();
  await writerRelease();
  assert.deepEqual(await readdir(root), []);
}));

test('an existing writer prevents maintenance and a failed maintenance attempt removes only its own gate', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  const release = await activity.beginWrite();
  const original = await readdir(root);
  try {
    await assert.rejects(() => new AssetActivity(root).beginMaintenance(), AssetWriterActiveError);
    assert.deepEqual(await readdir(root), original);
  } finally { await release(); }
  const maintenanceRelease = await activity.beginMaintenance();
  await maintenanceRelease();
  assert.deepEqual(await readdir(root), []);
}));

test('old and incomplete writer markers never expire based on timestamps or process identity', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  for (const body of ['', JSON.stringify({ id: randomUUID(), pid: 2147483647, hostname: 'stopped-container', startedAt: '1970-01-01T00:00:00.000Z' })]) {
    const marker = `.asset-writer-${randomUUID()}.json`;
    await writeFile(join(root, marker), body, { flag: 'wx' });
    await assert.rejects(() => activity.beginMaintenance(), AssetWriterActiveError);
    assert.equal(await readFile(join(root, marker), 'utf8'), body);
    assert.deepEqual(await readdir(root), [marker]);
    await unlink(join(root, marker));
  }
}));

test('an old maintenance gate remains exclusive and is never automatically recovered', async () => fixture(async (root) => {
  const gate = join(root, maintenanceName);
  const body = JSON.stringify({ id: randomUUID(), pid: 2147483647, hostname: 'old-container', startedAt: '1970-01-01T00:00:00.000Z' });
  await writeFile(gate, body, { flag: 'wx' });
  const activity = new AssetActivity(root);
  await assert.rejects(() => activity.beginWrite(), AssetMaintenanceBusyError);
  await assert.rejects(() => activity.beginMaintenance(), AssetMaintenanceBusyError);
  assert.equal(await readFile(gate, 'utf8'), body);
}));

test('writer and maintenance admission races never admit both before either operation releases', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  for (let iteration = 0; iteration < 30; iteration++) {
    const outcomes = await Promise.allSettled([activity.beginWrite(), activity.beginMaintenance()]);
    const admitted = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    try {
      assert.ok(admitted.length <= 1, 'Writer and maintenance cannot own storage concurrently.');
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          assert.ok(outcome.reason instanceof AssetMaintenanceBusyError || outcome.reason instanceof AssetWriterActiveError);
        }
      }
    } finally { await Promise.all(admitted.map((outcome) => outcome.value())); }
    assert.deepEqual(await readdir(root), []);
  }
}));

test('ordinary assets and unknown regular names do not become activity markers', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  const names = [randomUUID(), '.unrelated', '.asset-writer-not-a-uuid.json'];
  for (const name of names) await writeFile(join(root, name), 'retained');
  const release = await activity.beginMaintenance();
  await release();
  assert.deepEqual((await readdir(root)).sort(), names.sort());
  for (const name of names) assert.equal(await readFile(join(root, name), 'utf8'), 'retained');
}));

test('nonregular controls and oversized control files fail closed without being removed', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  await mkdir(join(root, maintenanceName));
  await assert.rejects(() => activity.beginWrite());
  await assert.rejects(() => activity.beginMaintenance());
  assert.ok((await lstat(join(root, maintenanceName))).isDirectory());
  await rmdir(join(root, maintenanceName));
  const marker = `.asset-writer-${randomUUID()}.json`;
  await writeFile(join(root, marker), Buffer.alloc(MAX_ASSET_CONTROL_BYTES + 1));
  await assert.rejects(() => activity.beginMaintenance());
  assert.deepEqual(await readdir(root), [marker]);
  assert.equal((await lstat(join(root, marker))).size, MAX_ASSET_CONTROL_BYTES + 1);
}));

test('directory junction controls and linked roots cannot redirect activity writes', async () => fixture(async (root) => {
  const target = join(root, 'target');
  await mkdir(target);
  const linkedRoot = join(root, 'root-link');
  await symlink(target, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedActivity = new AssetActivity(linkedRoot);
  await assert.rejects(() => linkedActivity.beginWrite());
  await assert.rejects(() => linkedActivity.beginMaintenance());
  assert.deepEqual(await readdir(target), []);
  const controls = join(root, 'controls');
  await mkdir(controls);
  const marker = `.asset-writer-${randomUUID()}.json`;
  await symlink(target, join(controls, marker), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => new AssetActivity(controls).beginMaintenance());
  assert.deepEqual(await readdir(controls), [marker]);
  assert.deepEqual(await readdir(target), []);
}));

test('release refuses a control whose token or regular-file identity changed', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  const release = await activity.beginWrite();
  const marker = (await readdir(root))[0];
  const path = join(root, marker);
  const payload = JSON.parse(await readFile(path, 'utf8'));
  payload.id = randomUUID();
  await writeFile(path, JSON.stringify(payload));
  await assert.rejects(release, /ownership changed/);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).id, payload.id);
  await unlink(path);

  const releaseSecond = await activity.beginWrite();
  const second = (await readdir(root))[0];
  const secondPath = join(root, second);
  const original = await readFile(secondPath);
  await rename(secondPath, join(root, 'retained-original'));
  await writeFile(secondPath, original, { flag: 'wx' });
  await assert.rejects(releaseSecond, /ownership changed/);
  assert.deepEqual(await readFile(secondPath), original);
  assert.deepEqual(await readFile(join(root, 'retained-original')), original);
}));

test('release remains idempotent if the exact owned marker has already disappeared', async () => fixture(async (root) => {
  const activity = new AssetActivity(root);
  const release = await activity.beginWrite();
  const marker = (await readdir(root))[0];
  await unlink(join(root, marker));
  await Promise.all([release(), release()]);
  assert.deepEqual(await readdir(root), []);
}));
