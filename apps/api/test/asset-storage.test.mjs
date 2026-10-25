import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, statfs, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { AssetStorage, StorageFullError } from '../dist/assets/asset-storage.js';
import { DEFAULT_UPLOADS } from '../dist/config/environment.js';

async function fixture(run) {
  const parent = await realpath(tmpdir());
  const temporary = await mkdtemp(join(parent, 'webwargame-t09-storage-'));
  const root = await realpath(temporary);
  const child = relative(parent, root);
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
  assert.match(child, /^webwargame-t09-storage-/);
  try { await run(root); }
  finally {
    // Delete only the exact temporary directory created by this fixture.
    const current = resolve(root);
    const inside = relative(parent, current);
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    assert.match(inside, /^webwargame-t09-storage-/);
    assert.equal(await realpath(current), root);
    await rm(current, { recursive: true, force: true });
  }
}

function storage(root, limits = {}) {
  return new AssetStorage({ ...DEFAULT_UPLOADS, directory: join(root, 'uploads'), minFreeBytes: 0, ...limits });
}

async function storedBytes(instance, id, size) {
  const handle = await instance.read(id, size);
  try { return await handle.readFile(); }
  finally { await handle.close(); }
}

async function makeFileSymlink(target, link, context) {
  try { await symlink(target, link, 'file'); return true; }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      context.skip('Windows does not permit file symlinks for this account. Directory junction checks still run.');
      return false;
    }
    throw error;
  }
}

test('private files and exact bytes survive storage reinitialization without probe leftovers', async () => fixture(async (root) => {
  const first = storage(root);
  const id = randomUUID();
  const data = Buffer.from([0, 255, 17, 128, 0, 42]);
  await first.initialize();
  assert.deepEqual(await readdir(join(root, 'uploads')), []);
  await first.write(id, data);
  const second = storage(root);
  await second.initialize();
  assert.deepEqual(await readdir(join(root, 'uploads')), [id]);
  assert.deepEqual(await storedBytes(second, id, data.length), data);
  if (process.platform !== 'win32') {
    assert.equal((await lstat(join(root, 'uploads'))).mode & 0o777, 0o700);
    assert.equal((await lstat(join(root, 'uploads', id))).mode & 0o777, 0o600);
  }
}));

test('quota counts files without database metadata and permits the exact limit only', async () => fixture(async (root) => {
  const instance = storage(root, { maxDiskBytes: 10 });
  await instance.initialize();
  const orphan = join(root, 'uploads', 'crash-orphan');
  await writeFile(orphan, Buffer.alloc(6, 11));
  const id = randomUUID();
  await instance.write(id, Buffer.alloc(4, 22));
  await assert.rejects(() => instance.write(randomUUID(), Buffer.from([1])), StorageFullError);
  assert.deepEqual(await readFile(orphan), Buffer.alloc(6, 11));
  assert.deepEqual(await storedBytes(instance, id, 4), Buffer.alloc(4, 22));
  assert.equal((await readdir(join(root, 'uploads'))).length, 2);
}));

test('pending capacity reservations count missing and partially written bytes exactly once', async () => fixture(async (root) => {
  const instance = storage(root, { maxDiskBytes: 10 });
  await instance.initialize();
  const id = randomUUID();
  const reservations = [{ id, byteSize: 8 }];
  await instance.checkCapacity(2, reservations);
  await assert.rejects(() => instance.checkCapacity(3, reservations), StorageFullError);
  await writeFile(join(root, 'uploads', id), Buffer.alloc(3));
  await instance.checkCapacity(2, reservations);
  await assert.rejects(() => instance.checkCapacity(3, reservations), StorageFullError);
  await writeFile(join(root, 'uploads', id), Buffer.alloc(8));
  await instance.checkCapacity(2, reservations);
  await assert.rejects(() => instance.checkCapacity(3, reservations), StorageFullError);
  // Unexpected extra physical bytes must never be hidden by a reservation.
  await writeFile(join(root, 'uploads', id), Buffer.alloc(9));
  await assert.rejects(() => instance.checkCapacity(2, reservations), StorageFullError);
}));

test('exclusive creation never overwrites a previous asset', async () => fixture(async (root) => {
  const instance = storage(root);
  await instance.initialize();
  const id = randomUUID();
  const original = Buffer.from('original asset');
  await instance.write(id, original);
  await assert.rejects(() => instance.write(id, Buffer.from('replacement')), { code: 'EEXIST' });
  assert.deepEqual(await storedBytes(instance, id, original.length), original);
}));

test('client-like paths and malformed identifiers cannot escape the generated flat namespace', async () => fixture(async (root) => {
  const instance = storage(root);
  await instance.initialize();
  const outside = join(root, 'sentinel');
  await writeFile(outside, 'keep');
  for (const id of ['../sentinel', '..\\sentinel', outside, 'sentinel', `${randomUUID()}/child`, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', '00000000-0000-0000-0000-000000000000']) {
    await assert.rejects(() => instance.write(id, Buffer.from('changed')));
    await assert.rejects(() => instance.read(id, 4));
  }
  assert.equal(await readFile(outside, 'utf8'), 'keep');
  assert.deepEqual(await readdir(join(root, 'uploads')), []);
}));

test('reads reject missing files, metadata size mismatches and directories', async () => fixture(async (root) => {
  const instance = storage(root);
  await instance.initialize();
  const id = randomUUID();
  await instance.write(id, Buffer.from('saved'));
  for (const size of [0, 4, 6, -1, NaN]) await assert.rejects(() => instance.read(id, size));
  await assert.rejects(() => instance.read(randomUUID(), 5), { code: 'ENOENT' });
  const directoryId = randomUUID();
  await mkdir(join(root, 'uploads', directoryId));
  await assert.rejects(() => instance.read(directoryId, 0));
}));

test('nonregular storage roots and roots that become directory junctions fail closed', async () => fixture(async (root) => {
  const fileRoot = join(root, 'not-a-directory');
  await writeFile(fileRoot, 'sentinel');
  await assert.rejects(() => storage(root, { directory: fileRoot }).initialize());
  const target = join(root, 'real-target');
  await mkdir(target);
  const link = join(root, 'root-link');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  const instance = storage(root, { directory: link });
  await assert.rejects(() => instance.initialize());
  await assert.rejects(() => instance.write(randomUUID(), Buffer.from('blocked')));
  await assert.rejects(() => instance.read(randomUUID(), 1));
  assert.deepEqual(await readdir(target), []);
  assert.equal(await readFile(fileRoot, 'utf8'), 'sentinel');
}));

test('a symlinked parent cannot redirect the private directory', async () => fixture(async (root) => {
  const target = join(root, 'parent-target');
  await mkdir(target);
  const link = join(root, 'parent-link');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  const instance = storage(root, { directory: join(link, 'uploads') });
  await assert.rejects(() => instance.initialize());
  await assert.rejects(() => instance.write(randomUUID(), Buffer.from('blocked')));
  assert.deepEqual(await readdir(join(target, 'uploads')), []);
}));

test('unexpected subdirectories and linked children prevent new writes', async () => fixture(async (root) => {
  const instance = storage(root);
  await instance.initialize();
  const target = join(root, 'external-directory');
  await mkdir(target);
  const link = join(root, 'uploads', 'linked-child');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => instance.write(randomUUID(), Buffer.from('blocked')));
  assert.deepEqual(await readdir(target), []);
  const ordinary = storage(root, { directory: join(root, 'other-uploads') });
  await ordinary.initialize();
  await mkdir(join(root, 'other-uploads', 'unexpected-directory'));
  await assert.rejects(() => ordinary.write(randomUUID(), Buffer.from('blocked')));
  assert.deepEqual(await readdir(join(root, 'other-uploads')), ['unexpected-directory']);
}));

test('symlinked file entries cannot be read or followed while writing', async (context) => fixture(async (root) => {
  const instance = storage(root);
  await instance.initialize();
  const target = join(root, 'external-file');
  const bytes = Buffer.from('private external bytes');
  await writeFile(target, bytes);
  const id = randomUUID();
  if (!await makeFileSymlink(target, join(root, 'uploads', id), context)) return;
  await assert.rejects(() => instance.read(id, bytes.length));
  await assert.rejects(() => instance.write(randomUUID(), Buffer.from('blocked')));
  assert.deepEqual(await readFile(target), bytes);
}));

test('insufficient free-space reserve rejects a write without creating a file', async () => fixture(async (root) => {
  const disk = await statfs(root, { bigint: true });
  const reserve = Number(disk.blocks * disk.bsize) + 1;
  assert.ok(Number.isSafeInteger(reserve));
  const instance = storage(root, { minFreeBytes: reserve });
  await instance.initialize();
  await assert.rejects(() => instance.write(randomUUID(), Buffer.from('blocked')), StorageFullError);
  assert.deepEqual(await readdir(join(root, 'uploads')), []);
}));
