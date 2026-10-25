import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, realpath, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { argon2id, hash } from 'argon2';
import sharp from 'sharp';
import { createApplication } from '../dist/application.js';
import { RuntimeConfiguration, loadConfiguration } from '../dist/config/environment.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { AssetReferencesService } from '../dist/assets/asset-references.service.js';
import { AssetCleanupService } from '../dist/assets/asset-cleanup.service.js';
import { AssetActivity } from '../dist/assets/asset-activity.js';
import { AssetStorage } from '../dist/assets/asset-storage.js';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const publicOrigin = 'http://127.0.0.1:5173';
const password = 'T10 lifecycle fixture passphrase';
const trusted = { Origin: publicOrigin, 'X-Wargame-Request': '1' };
const assetId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const week = 7 * 24 * 60 * 60 * 1000;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function localUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.search || url.hash || !url.username || !url.password || url.pathname.length < 2) throw new Error();
    return url;
  } catch { throw new Error('Asset lifecycle tests require a canonical loopback PostgreSQL URL.'); }
}

async function safe(operation) {
  try { return await operation(); }
  catch { throw new Error('Asset lifecycle database operation failed; private details withheld.'); }
}

function migrate(databaseUrl) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Asset lifecycle migration failed; private details withheld.');
}

function codeOf(error) {
  return error?.getResponse?.().code ?? error?.code;
}

test('asset references, archive and retained cleanup preserve used content on PostgreSQL', {
  timeout: 180000,
}, async (suite) => {
  const source = localUrl(loadConfiguration().databaseUrl);
  const databaseName = `t10_assets_${randomBytes(12).toString('hex')}`;
  assert.match(databaseName, /^t10_assets_[a-f0-9]{24}$/);
  const testUrl = new URL(source); testUrl.pathname = `/${databaseName}`;
  const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
  const ownerDatabase = new PrismaService(new RuntimeConfiguration(adminUrl.href, 3000));
  const fixtureParent = await realpath(tmpdir());
  const fixtureRoot = await mkdtemp(join(fixtureParent, 't10-assets-'));
  assert.equal(await realpath(fixtureRoot), fixtureRoot);
  const directory = join(fixtureRoot, 'uploads');
  const configuration = new RuntimeConfiguration(testUrl.href, 3000, publicOrigin, { directory, minFreeBytes: 0 });
  const privateValues = [password, source.href, decodeURIComponent(source.password), fixtureRoot];
  let created = false;
  let database;
  let app;
  let origin;
  let references;
  let cleanup;
  let administrator;
  let adminSession;
  let playerSession;
  let initial;
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#39785c' } }).png().toBuffer();

  async function request(path, options = {}) {
    const response = await fetch(`${origin}/api/${path}`, { ...options, signal: AbortSignal.timeout(10000) });
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
    const content = Buffer.from(await response.arrayBuffer());
    const body = (response.headers.get('Content-Type') ?? '').includes('application/json')
      ? JSON.parse(content.toString('utf8')) : undefined;
    return { response, body, bytes: content };
  }
  const headers = (session = adminSession, extra = {}) => ({
    ...trusted, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...extra,
  });
  const get = (id, suffix = 'lifecycle', session = adminSession, extra = {}) => request(
    `admin/assets/${id}${suffix ? `/${suffix}` : ''}`, { headers: headers(session, extra) });
  const mutate = (id, action, session = adminSession, extra = {}) => request(`admin/assets/${id}/${action}`, {
    method: 'POST', headers: headers(session, extra),
  });
  async function upload() {
    const result = await request('admin/assets', {
      method: 'POST', headers: headers(adminSession, { 'Content-Type': 'image/png' }), body: bytes,
    });
    assert.equal(result.response.status, 201);
    assert.match(result.body.asset.id, assetId);
    return result.body.asset;
  }
  function safeError(result, status, code) {
    assert.equal(result.response.status, status);
    if (code) assert.equal(result.body.code, code);
    assert.equal(typeof result.body.message, 'string');
    assert.equal(result.response.headers.get('Set-Cookie'), null);
    const text = JSON.stringify(result.body);
    assert.ok(text.length < 1600 && !/Prisma|postgres(?:ql)?:\/\/|passwordHash|\$argon2|SELECT |INSERT INTO/i.test(text));
    for (const value of privateValues) assert.ok(!text.includes(value));
  }
  function successfulLifecycle(result) {
    assert.ok([200, 201].includes(result.response.status));
    assert.deepEqual(Object.keys(result.body).sort(), ['archivedAt', 'asset', 'referenceCount', 'unreferencedSince']);
    const state = result.body;
    assert.match(state.asset.id, assetId);
    assert.ok(Number.isSafeInteger(state.referenceCount) && state.referenceCount >= 0);
    for (const field of ['archivedAt', 'unreferencedSince']) {
      assert.ok(state[field] === null || new Date(state[field]).toISOString() === state[field]);
    }
    return state;
  }
  const owner = (slot = 'image') => ({ ownerKind: 'UNIT', ownerId: randomUUID(), slot });
  const transaction = (operation) => database.$transaction(operation, { isolationLevel: 'ReadCommitted', timeout: 15000 });
  const replace = (binding, id) => transaction((tx) => references.replace(tx, binding, id));
  const release = ({ ownerKind, ownerId }) => transaction((tx) => references.releaseOwner(tx, { ownerKind, ownerId }));

  async function clearAssets() {
    await safe(() => database.assetReference.deleteMany());
    await safe(() => database.asset.deleteMany());
    for (const name of await readdir(directory)) {
      // Files are either generated assets seeded by this owned fixture or known
      // harmless test sentinels. Never recursively remove an unexpected entry.
      if (assetId.test(name) || name === 'unknown-name-sentinel') await unlink(join(directory, name));
    }
  }
  async function seed(overrides = {}, { file = true, content = bytes } = {}) {
    const id = randomUUID();
    const row = await safe(() => database.asset.create({ data: {
      id, uploadedById: administrator.id, mimeType: 'image/png', byteSize: content.length,
      width: 8, height: 6, sha256: digest(content), ready: true, ...overrides,
    } }));
    if (file) await writeFile(join(directory, id), content, { flag: 'wx' });
    return row;
  }
  const exists = async (id) => (await readdir(directory)).includes(id);

  try {
    await safe(() => ownerDatabase.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)); created = true;
    migrate(testUrl.href); migrate(testUrl.href);
    database = new PrismaService(configuration);
    await database.onModuleInit();
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 });
    administrator = await safe(() => database.user.create({ data: {
      username: 'Lifecycle.Admin', normalizedUsername: 'lifecycle.admin', passwordHash, role: 'ADMIN',
    } }));
    const player = await safe(() => database.user.create({ data: {
      username: 'Lifecycle.Player', normalizedUsername: 'lifecycle.player', passwordHash,
    } }));
    app = await createApplication(configuration);
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    references = new AssetReferencesService(database);
    cleanup = new AssetCleanupService(database, configuration);
    async function login(user) {
      const result = await request('auth/login', { method: 'POST', headers: {
        ...trusted, 'Content-Type': 'application/json',
      }, body: JSON.stringify({ username: user.username, password }) });
      assert.equal(result.response.status, 200);
      return { cookie: result.response.headers.get('Set-Cookie').split(';')[0], csrfToken: result.body.csrfToken };
    }
    adminSession = await login(administrator); playerSession = await login(player);

    await suite.test('archive, restore and lifecycle HTTP routes enforce current administrator and mutation CSRF checks', async () => {
      initial = await upload();
      for (const action of ['archive', 'restore']) {
        safeError(await mutate(initial.id, action, null), 401, 'UNAUTHENTICATED');
        safeError(await mutate(initial.id, action, playerSession), 403, 'ACCESS_DENIED');
        for (const extra of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': playerSession.csrfToken },
          { Origin: 'https://foreign.example.test' }, { 'X-Wargame-Request': '' }]) {
          safeError(await mutate(initial.id, action, adminSession, extra), 403, 'CSRF_REJECTED');
        }
      }
      safeError(await get(initial.id, 'lifecycle', null), 401, 'UNAUTHENTICATED');
      safeError(await get(initial.id, 'lifecycle', playerSession), 403, 'ACCESS_DENIED');
      safeError(await get(initial.id, 'lifecycle', adminSession, { 'X-Wargame-Request': '' }), 403, 'CSRF_REJECTED');
      for (const id of [randomUUID(), 'not-a-uuid', '..%2f.env']) {
        safeError(await get(id), 404, 'ASSET_NOT_FOUND');
        safeError(await mutate(id, 'archive'), 404, 'ASSET_NOT_FOUND');
      }
      const state = successfulLifecycle(await get(initial.id));
      assert.deepEqual(state.asset, initial);
      assert.equal(state.archivedAt, null); assert.equal(state.referenceCount, 0);
      assert.ok(state.unreferencedSince);
    });

    await suite.test('archive preserves content and metadata, repeats keep its timestamp, restore is idempotent', async () => {
      const archived = successfulLifecycle(await mutate(initial.id, 'archive'));
      assert.ok(archived.archivedAt);
      assert.deepEqual(archived.asset, initial);
      const repeated = successfulLifecycle(await mutate(initial.id, 'archive'));
      assert.equal(repeated.archivedAt, archived.archivedAt);
      const content = await get(initial.id, 'content');
      assert.equal(content.response.status, 200); assert.equal(digest(content.bytes), initial.sha256);
      assert.deepEqual((await get(initial.id, '')).body, { asset: initial });
      const restored = successfulLifecycle(await mutate(initial.id, 'restore'));
      assert.equal(restored.archivedAt, null);
      assert.deepEqual(successfulLifecycle(await mutate(initial.id, 'restore')), restored);
    });

    await suite.test('queued archive and restore recheck roles and sessions after waiting for the asset lock', async (context) => {
      const queuedAdministrator = await safe(() => database.user.create({ data: {
        username: 'Lifecycle.Queued', normalizedUsername: 'lifecycle.queued',
        passwordHash: administrator.passwordHash, role: 'ADMIN',
      } }));
      const outcomes = [];
      for (const action of ['archive', 'restore']) {
        for (const loss of ['role', 'session']) {
          const archivedAt = action === 'restore' ? new Date('2026-01-01T00:00:00.000Z') : null;
          const image = await seed({ archivedAt });
          const session = await login(queuedAdministrator);
          let unlock;
          let lockReady;
          const gate = new Promise((accept) => { unlock = accept; });
          const ready = new Promise((accept) => { lockReady = accept; });
          const blocker = transaction(async (tx) => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
            lockReady();
            await gate;
          });
          blocker.catch(() => {});
          let queued;
          try {
            await Promise.race([ready, delay(3000).then(() => { throw new Error('Authorization fixture did not acquire the asset lock.'); })]);
            queued = mutate(image.id, action, session);
            queued.catch(() => {});
            let waiting = false;
            for (let attempt = 0; attempt < 100; attempt += 1) {
              const locks = await safe(() => database.$queryRaw`
                SELECT count(*)::int AS count FROM pg_locks
                WHERE locktype = 'advisory' AND NOT granted
                  AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
              if (locks[0].count > 0) { waiting = true; break; }
              await delay(20);
            }
            assert.equal(waiting, true, 'The authenticated mutation must wait for the asset lock before revocation.');
            if (loss === 'role') {
              // The original fixture administrator remains, preserving T08's
              // last-administrator invariant while this actor is demoted.
              await safe(() => database.user.update({ where: { id: queuedAdministrator.id }, data: { role: 'PLAYER' } }));
            } else {
              await safe(() => database.session.delete({ where: { tokenHash: digest(session.cookie.split('=')[1]) } }));
            }
            unlock(); await blocker;
            const result = await queued;
            const row = await safe(() => database.asset.findUnique({ where: { id: image.id } }));
            outcomes.push({ action, loss, result, actual: row.archivedAt?.toISOString() ?? null, expected: archivedAt?.toISOString() ?? null });
          } finally {
            unlock();
            await Promise.allSettled([blocker, queued].filter(Boolean));
            await safe(() => database.user.update({ where: { id: queuedAdministrator.id }, data: { role: 'ADMIN' } }));
          }
        }
      }
      context.diagnostic(JSON.stringify(outcomes.map(({ action, loss, result, actual, expected }) => ({
        action, loss, status: result.response.status, changed: actual !== expected,
      }))));
      for (const outcome of outcomes) {
        safeError(outcome.result, outcome.loss === 'role' ? 403 : 401,
          outcome.loss === 'role' ? 'ACCESS_DENIED' : 'UNAUTHENTICATED');
        assert.equal(outcome.actual, outcome.expected, 'A revoked actor cannot mutate archive state after waiting.');
      }
    });

    await suite.test('references reject missing, pending and archived targets while unchanged archived bindings remain valid', async () => {
      const binding = owner();
      await replace(binding, initial.id);
      let state = successfulLifecycle(await get(initial.id));
      assert.equal(state.referenceCount, 1); assert.equal(state.unreferencedSince, null);
      await mutate(initial.id, 'archive');
      await replace(binding, initial.id);
      assert.equal(successfulLifecycle(await get(initial.id)).referenceCount, 1);
      const other = owner();
      await assert.rejects(replace(other, initial.id), (error) => codeOf(error) === 'ASSET_NOT_SELECTABLE');
      await assert.rejects(replace(other, randomUUID()), (error) => codeOf(error) === 'ASSET_NOT_FOUND');
      const pending = await seed({ ready: false });
      await assert.rejects(replace(other, pending.id), (error) => ['ASSET_NOT_FOUND', 'ASSET_NOT_SELECTABLE'].includes(codeOf(error)));
      await mutate(initial.id, 'restore');
      await replace(other, initial.id);
      state = successfulLifecycle(await get(initial.id));
      assert.equal(state.referenceCount, 2);
      const content = await get(initial.id, 'content');
      assert.equal(content.response.status, 200); assert.equal(digest(content.bytes), initial.sha256);
      await release(binding); await release(other);
    });

    await suite.test('reference replacement is atomic and the last detach starts a fresh retention interval', async () => {
      const first = await upload(); const second = await upload();
      const binding = owner();
      await replace(binding, first.id);
      const aborted = new Error('controlled rollback');
      await assert.rejects(transaction(async (tx) => {
        await references.replace(tx, binding, second.id);
        throw aborted;
      }), (error) => error === aborted);
      assert.equal(successfulLifecycle(await get(first.id)).referenceCount, 1);
      assert.equal(successfulLifecycle(await get(second.id)).referenceCount, 0);
      const before = Date.now();
      await replace(binding, second.id);
      assert.equal(successfulLifecycle(await get(first.id)).referenceCount, 0);
      assert.ok(Date.parse(successfulLifecycle(await get(first.id)).unreferencedSince) >= before);
      assert.equal(successfulLifecycle(await get(second.id)).referenceCount, 1);
      await replace(binding, null);
      const detached = successfulLifecycle(await get(second.id));
      assert.equal(detached.referenceCount, 0); assert.ok(Date.parse(detached.unreferencedSince) >= before);
      await release(binding);
    });

    await suite.test('database foreign keys and direct reference writes preserve used assets', async () => {
      const image = await upload();
      const binding = owner();
      await safe(() => database.assetReference.create({ data: { ...binding, assetId: image.id } }));
      assert.equal(successfulLifecycle(await get(image.id)).referenceCount, 1);
      assert.equal(successfulLifecycle(await get(image.id)).unreferencedSince, null);
      await assert.rejects(database.asset.delete({ where: { id: image.id } }));
      assert.equal(await exists(image.id), true);
      await mutate(image.id, 'archive');
      await assert.rejects(database.assetReference.create({ data: { ...owner(), assetId: image.id } }));
      await safe(() => database.assetReference.deleteMany({ where: { assetId: image.id } }));
      assert.ok(successfulLifecycle(await get(image.id)).unreferencedSince);
    });

    await suite.test('dry-run reports only retention-eligible archived unused assets without altering rows or files', async () => {
      await clearAssets();
      const now = new Date('2030-01-08T00:00:00.000Z');
      const cutoff = new Date(now.getTime() - week);
      const eligible = await seed({ archivedAt: cutoff, unreferencedSince: cutoff });
      const freshArchive = await seed({ archivedAt: new Date(cutoff.getTime() + 1), unreferencedSince: new Date(cutoff.getTime() - 1000) });
      const freshDetach = await seed({ archivedAt: new Date(cutoff.getTime() - 1000), unreferencedSince: new Date(cutoff.getTime() + 1) });
      const active = await seed({ archivedAt: null, unreferencedSince: new Date(cutoff.getTime() - week) });
      const used = await seed({ archivedAt: null });
      await replace(owner(), used.id);
      await safe(() => database.asset.update({ where: { id: used.id }, data: { archivedAt: cutoff } }));
      const beforeFiles = (await readdir(directory)).sort();
      const report = await cleanup.run({ apply: false, now });
      assert.equal(report.dryRun, true); assert.equal(report.ready, 1); assert.equal(report.removed, 0);
      assert.deepEqual((await readdir(directory)).sort(), beforeFiles);
      assert.equal(await safe(() => database.asset.count()), 5);
      assert.equal(report.pending, 0); assert.equal(report.orphans, 0);
      for (const row of [eligible, freshArchive, freshDetach, active, used]) assert.equal(await exists(row.id), true);
      const applied = await cleanup.run({ apply: true, now });
      assert.equal(applied.removed, 1); assert.equal(applied.failed, 0);
      assert.equal(await exists(eligible.id), false);
      assert.equal(await safe(() => database.asset.findUnique({ where: { id: eligible.id } })), null);
      for (const row of [freshArchive, freshDetach, active, used]) {
        assert.equal(await exists(row.id), true);
        assert.ok(await safe(() => database.asset.findUnique({ where: { id: row.id } })));
      }
    });

    await suite.test('seven-day pending and generated orphan cleanup preserves fresh and unknown files', async () => {
      await clearAssets();
      const now = new Date('2030-01-08T00:00:00.000Z');
      const cutoff = new Date(now.getTime() - week);
      const oldPending = await seed({ ready: false, createdAt: cutoff });
      const absentPending = await seed({ ready: false, createdAt: cutoff }, { file: false });
      const freshPending = await seed({ ready: false, createdAt: new Date(cutoff.getTime() + 1) });
      const oldOrphan = randomUUID(); const freshOrphan = randomUUID();
      await writeFile(join(directory, oldOrphan), bytes, { flag: 'wx' });
      await writeFile(join(directory, freshOrphan), bytes, { flag: 'wx' });
      await utimes(join(directory, oldOrphan), cutoff, cutoff);
      await utimes(join(directory, freshOrphan), new Date(cutoff.getTime() + 1), new Date(cutoff.getTime() + 1));
      await writeFile(join(directory, 'unknown-name-sentinel'), 'keep');
      await utimes(join(directory, 'unknown-name-sentinel'), cutoff, cutoff);
      const preview = await cleanup.run({ apply: false, now });
      assert.equal(preview.pending, 2); assert.equal(preview.orphans, 1); assert.equal(preview.removed, 0);
      assert.equal(await exists(oldPending.id), true); assert.equal(await exists(oldOrphan), true);
      const applied = await cleanup.run({ apply: true, now });
      assert.equal(applied.removed, 3); assert.equal(applied.failed, 0);
      for (const id of [oldPending.id, absentPending.id]) assert.equal(await safe(() => database.asset.findUnique({ where: { id } })), null);
      assert.equal(await exists(oldPending.id), false); assert.equal(await exists(oldOrphan), false);
      assert.equal(await exists(freshPending.id), true); assert.equal(await exists(freshOrphan), true);
      assert.equal(await readFile(join(directory, 'unknown-name-sentinel'), 'utf8'), 'keep');
    });

    await suite.test('a concurrent restore and reference attachment wins before cleanup can delete the asset', async () => {
      await clearAssets();
      const now = new Date('2030-01-08T00:00:00.000Z');
      const cutoff = new Date(now.getTime() - week);
      const image = await seed({ archivedAt: cutoff, unreferencedSince: cutoff });
      const binding = owner();
      let releaseWriter;
      let writerReady;
      const writerGate = new Promise((accept) => { releaseWriter = accept; });
      const ready = new Promise((accept) => { writerReady = accept; });
      let maintenance;
      const writer = transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(14009, 1)`;
        await tx.asset.update({ where: { id: image.id }, data: { archivedAt: null } });
        await references.replace(tx, binding, image.id);
        writerReady();
        await writerGate;
      });
      writer.catch(() => {});
      try {
        await Promise.race([ready, delay(3000).then(() => { throw new Error('Controlled reference transaction did not become ready.'); })]);
        maintenance = cleanup.run({ apply: true, now });
        maintenance.catch(() => {});
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const locks = await safe(() => database.$queryRaw`
            SELECT count(*)::int AS count FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
          if (locks[0].count > 0) { waiting = true; break; }
          await delay(20);
        }
        assert.equal(waiting, true, 'Cleanup must serialize with the in-progress reference transaction.');
        releaseWriter(); await writer;
        const report = await maintenance;
        assert.equal(report.removed, 0); assert.equal(report.failed, 0);
        assert.equal(await exists(image.id), true);
        assert.equal(await safe(() => database.assetReference.count({ where: { assetId: image.id } })), 1);
        assert.equal(successfulLifecycle(await get(image.id)).referenceCount, 1);
      } finally {
        releaseWriter();
        await Promise.allSettled([writer, maintenance].filter(Boolean));
      }
    });

    await suite.test('cleanup batches are bounded and repeat runs finish without deleting unrelated content', async () => {
      await clearAssets();
      const now = new Date('2030-01-08T00:00:00.000Z');
      const cutoff = new Date(now.getTime() - week);
      const candidates = [];
      for (let index = 0; index < 3; index++) candidates.push(await seed({ archivedAt: cutoff, unreferencedSince: cutoff }));
      const first = await cleanup.run({ apply: true, now, limit: 1 });
      assert.equal(first.removed, 1);
      assert.equal(await safe(() => database.asset.count()), 2);
      const second = await cleanup.run({ apply: true, now, limit: 10 });
      assert.equal(second.removed, 2);
      for (const row of candidates) assert.equal(await exists(row.id), false);
      assert.equal((await cleanup.run({ apply: true, now })).removed, 0);
    });

    await suite.test('operator CLI defaults to preview, applies an explicit batch and refuses an active writer', async () => {
      await clearAssets();
      const old = new Date(Date.now() - week - 60_000);
      const image = await seed({ archivedAt: old, unreferencedSince: old });
      const cli = fileURLToPath(new URL('../scripts/cleanup-assets.mjs', import.meta.url));
      const run = (args) => spawnSync(process.execPath, [cli, ...args], {
        cwd: apiRoot, env: { ...process.env, DATABASE_URL: testUrl.href, UPLOAD_DIRECTORY: directory,
          PUBLIC_ORIGIN: publicOrigin, UPLOAD_MIN_FREE_BYTES: '0' },
        windowsHide: true, encoding: 'utf8', timeout: 20000,
      });
      const activity = new AssetActivity(directory);
      const releaseWriter = await activity.beginWrite();
      try {
        const refused = run(['--apply']);
        assert.ifError(refused.error); assert.equal(refused.status, 1);
        assert.match(refused.stderr, /blocked by asset activity/);
        assert.equal(await exists(image.id), true);
      } finally { await releaseWriter(); }
      const preview = run([]);
      assert.ifError(preview.error); assert.equal(preview.status, 0, 'CLI preview failed; private diagnostics withheld.');
      assert.equal(JSON.parse(preview.stdout).dryRun, true);
      assert.equal(JSON.parse(preview.stdout).ready, 1);
      assert.equal(await exists(image.id), true);
      const applied = run(['--apply', '--limit', '1']);
      assert.ifError(applied.error); assert.equal(applied.status, 0, 'CLI apply failed; private diagnostics withheld.');
      assert.equal(JSON.parse(applied.stdout).removed, 1);
      assert.equal(await exists(image.id), false);
      assert.equal(await safe(() => database.asset.findUnique({ where: { id: image.id } })), null);
      for (const value of privateValues) assert.ok(!(preview.stdout + preview.stderr + applied.stdout + applied.stderr).includes(value));
    });

    await suite.test('writer markers and the maintenance gate exclude cleanup and new uploads until explicitly released', async () => {
      await clearAssets();
      const now = new Date('2030-01-08T00:00:00.000Z');
      const cutoff = new Date(now.getTime() - week);
      const pending = await seed({ ready: false, createdAt: cutoff });
      const activity = new AssetActivity(directory);
      const releaseWriter = await activity.beginWrite();
      try {
        await assert.rejects(cleanup.run({ apply: false, now }), (error) => codeOf(error) === 'CLEANUP_BUSY');
        await assert.rejects(cleanup.run({ apply: true, now }), (error) => codeOf(error) === 'CLEANUP_BUSY');
        assert.equal(await exists(pending.id), true);
        assert.ok(await safe(() => database.asset.findUnique({ where: { id: pending.id } })));
      } finally { await releaseWriter(); }
      const releaseMaintenance = await activity.beginMaintenance();
      try {
        await assert.rejects(cleanup.run({ apply: true, now }), (error) => codeOf(error) === 'CLEANUP_BUSY');
        const refused = await request('admin/assets', {
          method: 'POST', headers: headers(adminSession, { 'Content-Type': 'image/png' }), body: bytes,
        });
        safeError(refused, 503, 'ASSET_MAINTENANCE');
        assert.equal(await exists(pending.id), true);
      } finally { await releaseMaintenance(); }
      const applied = await cleanup.run({ apply: true, now });
      assert.equal(applied.removed, 1); assert.equal(await exists(pending.id), false);
      assert.equal(await safe(() => database.asset.findUnique({ where: { id: pending.id } })), null);
      assert.ok(await upload());
    });

    await suite.test('pending cleanup fences late database finalization before removing the file', async () => {
      await clearAssets();
      const now = new Date('2030-01-08T00:00:00.000Z');
      const cutoff = new Date(now.getTime() - week);
      const pending = await seed({ ready: false, createdAt: cutoff });
      const originalRemove = AssetStorage.prototype.remove;
      let finalized;
      AssetStorage.prototype.remove = async function (id) {
        // A timed-out client can have an ambiguous final DB update even though
        // its filesystem work has completed and its writer marker is gone.
        const result = await database.asset.updateMany({ where: { id, ready: false }, data: { ready: true } });
        finalized = result.count;
        return originalRemove.call(this, id);
      };
      try {
        const report = await cleanup.run({ apply: true, now });
        assert.equal(finalized, 0, 'Removed pending metadata cannot later become a ready row without its file.');
        assert.equal(report.removed, 1); assert.equal(report.failed, 0);
        assert.equal(await safe(() => database.asset.findUnique({ where: { id: pending.id } })), null);
        assert.equal(await exists(pending.id), false);
      } finally { AssetStorage.prototype.remove = originalRemove; }
    });

    await suite.test('unlink failures retain accounted orphan bytes until a later retry succeeds', async () => {
      await clearAssets();
      const now = new Date('2030-01-08T00:00:00.000Z');
      const cutoff = new Date(now.getTime() - week);
      const ready = await seed({ archivedAt: cutoff, unreferencedSince: cutoff });
      const pending = await seed({ ready: false, createdAt: cutoff });
      const originalRemove = AssetStorage.prototype.remove;
      assert.equal(typeof originalRemove, 'function');
      AssetStorage.prototype.remove = async () => { throw Object.assign(new Error('private fixture unlink details'), { code: 'EACCES' }); };
      try {
        const report = await cleanup.run({ apply: true, now });
        assert.equal(report.failed, 2); assert.equal(report.removed, 0);
        // Ready metadata is removed only after a committed reference recheck;
        // both failed unlinks become counted orphans without a live writer.
        assert.equal(await safe(() => database.asset.findUnique({ where: { id: ready.id } })), null);
        assert.equal(await safe(() => database.asset.findUnique({ where: { id: pending.id } })), null);
        assert.deepEqual(await readFile(join(directory, ready.id)), bytes);
        assert.deepEqual(await readFile(join(directory, pending.id)), bytes);
        const capacity = new AssetStorage({ ...configuration.uploads, maxDiskBytes: bytes.length * 2 - 1 });
        await assert.rejects(capacity.checkCapacity(0));
      } finally { AssetStorage.prototype.remove = originalRemove; }
      await utimes(join(directory, ready.id), cutoff, cutoff);
      const retried = await cleanup.run({ apply: true, now });
      assert.equal(retried.failed, 0); assert.equal(retried.removed, 2);
      assert.equal(await exists(ready.id), false); assert.equal(await exists(pending.id), false);
      assert.equal(await safe(() => database.asset.count()), 0);
    });
  } finally {
    let failed = false;
    try { await app?.close(); } catch { failed = true; }
    try { await database?.onModuleDestroy(); } catch { failed = true; }
    try {
      if (created) {
        assert.match(databaseName, /^t10_assets_[a-f0-9]{24}$/);
        await safe(() => ownerDatabase.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`));
      }
    } catch { failed = true; }
    finally { try { await ownerDatabase.onModuleDestroy(); } catch { failed = true; } }
    try {
      const target = resolve(fixtureRoot);
      assert.equal(dirname(target), fixtureParent);
      assert.match(basename(target), /^t10-assets-[A-Za-z0-9_-]+$/);
      assert.equal(await realpath(target), target);
      await rm(target, { recursive: true, force: true });
    } catch { failed = true; }
    assert.equal(failed, false, 'Asset lifecycle fixture cleanup failed; inspect only its generated database and temporary directory.');
  }
});
