import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
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
import { AssetsService } from '../dist/assets/assets.service.js';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const publicOrigin = 'http://127.0.0.1:5173';
const password = 'T09 private image fixture passphrase';
const trusted = { Origin: publicOrigin, 'X-Wargame-Request': '1' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function localUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.search || url.hash || !url.username || !url.password || url.pathname.length < 2) throw new Error();
    return url;
  } catch { throw new Error('Asset integration requires a loopback PostgreSQL URL without query or fragment.'); }
}

async function databaseOperation(operation) {
  try { return await operation(); }
  catch { throw new Error('Asset integration database operation failed; private diagnostics withheld.'); }
}

function migrate(databaseUrl) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Asset integration migration failed; private diagnostics withheld.');
}

function noStore(response) {
  assert.match(response.headers.get('Cache-Control') ?? '', /(?:^|,)\s*no-store\s*(?:,|$)/);
}

async function request(origin, path, options = {}) {
  const response = await fetch(`${origin}/api/${path}`, { ...options, signal: AbortSignal.timeout(10000) });
  noStore(response);
  const bytes = Buffer.from(await response.arrayBuffer());
  const body = (response.headers.get('Content-Type') ?? '').includes('application/json')
    ? JSON.parse(bytes.toString('utf8')) : undefined;
  return { response, body, bytes };
}

// This can deliberately send headers without a body. A rejected request must
// receive its answer before any image bytes or a decoder are available.
function rawUpload(origin, headers, chunks, leaveOpen = false) {
  let outgoing;
  const result = new Promise((accept, reject) => {
    outgoing = httpRequest(`${origin}/api/admin/assets`, { method: 'POST', headers }, (incoming) => {
      const parts = [];
      incoming.on('data', (part) => parts.push(part));
      incoming.on('end', () => {
        const bytes = Buffer.concat(parts);
        const response = { status: incoming.statusCode, headers: new Headers(incoming.headers) };
        try {
          noStore(response);
          accept({ response, body: bytes.length ? JSON.parse(bytes.toString('utf8')) : undefined, bytes });
        } catch (error) { reject(error); }
        finally { outgoing.destroy(); }
      });
      incoming.on('error', () => reject(new Error('Asset integration HTTP response interrupted.')));
    });
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Asset integration HTTP request deadline exceeded.')));
    outgoing.on('error', (error) => reject(error));
    outgoing.flushHeaders();
    for (const chunk of chunks) outgoing.write(chunk);
    if (!leaveOpen) outgoing.end();
  });
  // An intentionally interrupted request may fail before its caller awaits it.
  result.catch(() => {});
  return { result, destroy: () => outgoing.destroy(), end: (bytes) => outgoing.end(bytes) };
}

test('private static image uploads remain bounded, persisted and administrator-only on PostgreSQL', {
  timeout: 180000,
}, async (suite) => {
  const source = localUrl(loadConfiguration().databaseUrl);
  const databaseName = `t09_assets_${randomBytes(12).toString('hex')}`;
  assert.match(databaseName, /^t09_assets_[a-f0-9]{24}$/);
  const testUrl = new URL(source); testUrl.pathname = `/${databaseName}`;
  const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
  const owner = new PrismaService(new RuntimeConfiguration(adminUrl.href, 3000));
  const fixtureParent = await realpath(tmpdir());
  const fixtureRoot = await mkdtemp(join(fixtureParent, 't09-assets-'));
  const applications = new Set();
  const privateValues = [password, source.href, decodeURIComponent(source.password), fixtureRoot];
  let database;
  let created = false;
  let directoryNumber = 0;
  let administrator;
  let player;
  let adminSession;
  let playerSession;
  let persisted;
  const formats = {};
  const countAssets = () => databaseOperation(() => database.asset.count());

  function safeError(result, status, code) {
    assert.equal(result.response.status, status);
    if (code) assert.equal(result.body.code, code);
    assert.equal(result.response.headers.get('Set-Cookie'), null);
    assert.equal(typeof result.body.message, 'string');
    const text = JSON.stringify(result.body);
    assert.ok(text.length < 1600);
    assert.ok(!/Prisma|node_modules|postgres(?:ql)?:\/\/|passwordHash|\$argon2|SELECT |INSERT INTO/i.test(text));
    for (const value of privateValues) assert.ok(!text.includes(value), 'Asset response exposed private configuration or input.');
  }

  async function newDirectory() {
    const directory = join(fixtureRoot, `uploads-${directoryNumber++}`);
    await mkdir(directory);
    return directory;
  }

  async function start(directory, limits = {}) {
    const configuration = new RuntimeConfiguration(testUrl.href, 3000, publicOrigin, { directory, ...limits });
    const app = await createApplication(configuration);
    applications.add(app);
    await app.listen(0, '127.0.0.1');
    return { app, origin: `http://127.0.0.1:${app.getHttpServer().address().port}` };
  }

  async function stop(running) {
    await running.app.close(); applications.delete(running.app);
  }

  async function withApplication(operation, limits = {}, directory) {
    const running = await start(directory ?? await newDirectory(), limits);
    try { return await operation(running.origin, running.app); }
    finally { await stop(running); }
  }

  async function login(origin, user) {
    const result = await request(origin, 'auth/login', {
      method: 'POST', headers: { ...trusted, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password }),
    });
    assert.equal(result.response.status, 200);
    const cookie = result.response.headers.get('Set-Cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^wargame\.sid=[A-Za-z0-9_-]{43}$/);
    return { cookie, csrfToken: result.body.csrfToken };
  }

  const uploadHeaders = (session = adminSession, mime = 'image/png', extra = {}) => ({
    ...trusted, 'Content-Type': mime, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...extra,
  });
  const upload = (origin, bytes = formats.png, mime = 'image/png', session = adminSession, extra = {}) =>
    request(origin, 'admin/assets', { method: 'POST', headers: uploadHeaders(session, mime, extra), body: bytes });
  const read = (origin, id, content = false, session = adminSession, extra = {}) => request(origin,
    `admin/assets/${id}${content ? '/content' : ''}`, {
      headers: { 'X-Wargame-Request': '1', ...(session ? { Cookie: session.cookie } : {}), ...extra },
    });

  function metadata(result, expectedMime, user = administrator) {
    assert.deepEqual(Object.keys(result.body), ['asset']);
    const asset = result.body.asset;
    assert.deepEqual(Object.keys(asset).sort(), ['byteSize', 'createdAt', 'height', 'id', 'mimeType', 'sha256', 'uploadedById', 'width']);
    assert.match(asset.id, uuid);
    assert.equal(asset.mimeType, expectedMime);
    assert.equal(asset.uploadedById, user.id);
    assert.ok(Number.isInteger(asset.byteSize) && asset.byteSize > 0);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(new Date(asset.createdAt).toISOString(), asset.createdAt);
    return asset;
  }

  try {
    await databaseOperation(() => owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)); created = true;
    migrate(testUrl.href); migrate(testUrl.href);
    database = new PrismaService(new RuntimeConfiguration(testUrl.href, 3000));
    await database.onModuleInit();
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 });
    administrator = await databaseOperation(() => database.user.create({ data: {
      username: 'Asset.Admin', normalizedUsername: 'asset.admin', passwordHash, role: 'ADMIN',
    } }));
    await databaseOperation(() => database.user.create({ data: {
      username: 'Asset.Keeper', normalizedUsername: 'asset.keeper', passwordHash, role: 'ADMIN',
    } }));
    player = await databaseOperation(() => database.user.create({ data: {
      username: 'Asset.Player', normalizedUsername: 'asset.player', passwordHash,
    } }));
    for (const format of ['png', 'jpeg', 'webp']) {
      formats[format] = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#39785c' } })[format]().toBuffer();
    }
    const persistentDirectory = await newDirectory();

    await suite.test('real PNG, JPEG and WebP uploads store generated metadata and normalized private bytes', async () => {
      await withApplication(async (origin) => {
        adminSession = await login(origin, administrator); playerSession = await login(origin, player);
        for (const [format, bytes] of Object.entries(formats)) {
          const mime = `image/${format}`;
          const result = await upload(origin, bytes, mime);
          assert.equal(result.response.status, 201);
          const asset = metadata(result, mime);
          assert.equal(asset.width, 8); assert.equal(asset.height, 6);
          const row = await databaseOperation(() => database.asset.findUnique({ where: { id: asset.id } }));
          assert.equal(row.ready, true);
          assert.equal(row.uploadedById, administrator.id);
          assert.equal(row.mimeType, mime); assert.equal(row.byteSize, asset.byteSize);
          assert.equal(row.width, 8); assert.equal(row.height, 6); assert.equal(row.sha256, asset.sha256);
          assert.equal(row.createdAt.toISOString(), asset.createdAt);
          const content = await read(origin, asset.id, true);
          assert.equal(content.response.status, 200);
          assert.equal(content.response.headers.get('Content-Type'), mime);
          assert.match(content.response.headers.get('Cache-Control') ?? '', /private/);
          assert.equal(content.response.headers.get('X-Content-Type-Options'), 'nosniff');
          assert.match(content.response.headers.get('Content-Disposition') ?? '', /^inline;.*filename="?[a-f0-9-]+\.(?:png|jpe?g|webp)"?$/);
          assert.equal(content.bytes.length, asset.byteSize); assert.equal(digest(content.bytes), asset.sha256);
          const decoded = await sharp(content.bytes).metadata();
          assert.equal(decoded.width, 8); assert.equal(decoded.height, 6); assert.equal(decoded.format, format);
          assert.equal(decoded.exif, undefined); assert.equal(decoded.xmp, undefined); assert.equal(decoded.iptc, undefined);
          assert.deepEqual(await readFile(join(persistentDirectory, asset.id)), content.bytes);
          assert.ok((await stat(join(persistentDirectory, asset.id))).isFile());
          const info = await read(origin, asset.id);
          assert.equal(info.response.status, 200); assert.deepEqual(info.body, result.body);
          if (format === 'png') persisted = { asset, bytes: content.bytes };
        }
        const files = await readdir(persistentDirectory);
        assert.equal(files.length, 3); assert.ok(files.every((name) => uuid.test(name)));
      }, {}, persistentDirectory);
    });

    await suite.test('a replacement application retains metadata, sessions and byte content in the same storage directory', async () => {
      await withApplication(async (origin) => {
        const info = await read(origin, persisted.asset.id);
        assert.equal(info.response.status, 200); assert.deepEqual(info.body.asset, persisted.asset);
        const content = await read(origin, persisted.asset.id, true);
        assert.equal(content.response.status, 200); assert.deepEqual(content.bytes, persisted.bytes);
      }, {}, persistentDirectory);
    });

    await suite.test('authorization and CSRF reject upload headers before consuming an oversized image body', async () => {
      const before = await countAssets();
      await withApplication(async (origin) => {
        for (const [session, extra, status, code] of [
          [null, {}, 401, 'UNAUTHENTICATED'],
          [playerSession, {}, 403, 'ACCESS_DENIED'],
          [adminSession, { 'X-CSRF-Token': '' }, 403, 'CSRF_REJECTED'],
          [adminSession, { 'X-CSRF-Token': playerSession.csrfToken }, 403, 'CSRF_REJECTED'],
          [adminSession, { Origin: 'https://foreign.example.test' }, 403, 'CSRF_REJECTED'],
          [adminSession, { 'X-Wargame-Request': '' }, 403, 'CSRF_REJECTED'],
        ]) {
          const pending = rawUpload(origin, uploadHeaders(session, 'image/png', { 'Content-Length': '99999999', ...extra }), [], true);
          try { safeError(await pending.result, status, code); }
          finally { pending.destroy(); }
        }
        for (const content of [false, true]) {
          safeError(await read(origin, persisted.asset.id, content, null), 401, 'UNAUTHENTICATED');
          safeError(await read(origin, persisted.asset.id, content, playerSession), 403, 'ACCESS_DENIED');
          safeError(await read(origin, persisted.asset.id, content, adminSession, { 'X-Wargame-Request': '' }), 403, 'CSRF_REJECTED');
          safeError(await read(origin, persisted.asset.id, content, adminSession, { Origin: 'https://foreign.example.test' }), 403, 'CSRF_REJECTED');
        }
      }, {}, persistentDirectory);
      assert.equal(await countAssets(), before);
    });

    await suite.test('administrator access follows live demotion and revoked sessions for reads and uploads', async () => {
      const before = await countAssets();
      await withApplication(async (origin) => {
        await databaseOperation(() => database.user.update({ where: { id: administrator.id }, data: { role: 'PLAYER' } }));
        try {
          safeError(await upload(origin), 403, 'ACCESS_DENIED');
          for (const content of [false, true]) safeError(await read(origin, persisted.asset.id, content), 403, 'ACCESS_DENIED');
        } finally {
          await databaseOperation(() => database.user.update({ where: { id: administrator.id }, data: { role: 'ADMIN' } }));
        }
        const revoked = await login(origin, administrator);
        const tokenHash = digest(revoked.cookie.split('=')[1]);
        await databaseOperation(() => database.session.delete({ where: { tokenHash } }));
        safeError(await upload(origin, formats.png, 'image/png', revoked), 401, 'UNAUTHENTICATED');
        for (const content of [false, true]) safeError(await read(origin, persisted.asset.id, content, revoked), 401, 'UNAUTHENTICATED');
      }, {}, persistentDirectory);
      assert.equal(await countAssets(), before);
    });

    await suite.test('a demotion or revocation while the body is arriving prevents the pending upload from committing', async () => {
      const before = await countAssets();
      const directory = await newDirectory();
      await withApplication(async (origin) => {
        for (const mode of ['demotion', 'revocation']) {
          const active = mode === 'revocation' ? await login(origin, administrator) : adminSession;
          const held = rawUpload(origin, uploadHeaders(active, 'image/png', { 'Content-Length': String(formats.png.length) }),
            [formats.png.subarray(0, 20)], true);
          try {
            await delay(80);
            if (mode === 'demotion') {
              await databaseOperation(() => database.user.update({ where: { id: administrator.id }, data: { role: 'PLAYER' } }));
            } else {
              const tokenHash = digest(active.cookie.split('=')[1]);
              await databaseOperation(() => database.session.delete({ where: { tokenHash } }));
            }
            held.end(formats.png.subarray(20));
            safeError(await held.result, mode === 'demotion' ? 403 : 401, mode === 'demotion' ? 'ACCESS_DENIED' : 'UNAUTHENTICATED');
          } finally {
            held.destroy();
            if (mode === 'demotion') {
              await databaseOperation(() => database.user.update({ where: { id: administrator.id }, data: { role: 'ADMIN' } }));
            }
          }
        }
      }, {}, directory);
      assert.equal(await countAssets(), before); assert.deepEqual(await readdir(directory), []);
    });

    await suite.test('unknown and malformed asset identifiers cannot select arbitrary filesystem paths', async () => {
      await withApplication(async (origin) => {
        for (const id of [randomUUID(), 'not-a-uuid', '00000000-0000-0000-0000-000000000000', '..%2f..%2f.env', '%2e%2e%5c.env']) {
          for (const content of [false, true]) safeError(await read(origin, id, content), 404, 'ASSET_NOT_FOUND');
        }
      }, {}, persistentDirectory);
    });

    await suite.test('strict full decoding rejects mismatched, unsupported, corrupt and truncated bytes without persistence', async () => {
      const before = await countAssets();
      const directory = await newDirectory();
      await withApplication(async (origin) => {
        const animatedWebp = await sharp([formats.png, await sharp(formats.png).negate().png().toBuffer()],
          { join: { animated: true } }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
        assert.equal((await sharp(animatedWebp, { animated: true }).metadata()).pages, 2);
        const invalid = [
          [formats.jpeg, 'image/png', 400, 'INVALID_IMAGE'],
          [formats.png, 'image/jpeg', 400, 'INVALID_IMAGE'],
          [formats.png, 'image/png; charset=utf-8', 415, 'UNSUPPORTED_IMAGE'],
          [formats.png, 'application/octet-stream', 415, 'UNSUPPORTED_IMAGE'],
          [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 415, 'UNSUPPORTED_IMAGE'],
          [Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'image/gif', 415, 'UNSUPPORTED_IMAGE'],
          [Buffer.alloc(0), 'image/png', 400, 'INVALID_IMAGE'],
          [formats.png.subarray(0, 40), 'image/png', 400, 'INVALID_IMAGE'],
          [formats.jpeg.subarray(0, formats.jpeg.length - 20), 'image/jpeg', 400, 'INVALID_IMAGE'],
          [formats.webp.subarray(0, formats.webp.length - 12), 'image/webp', 400, 'INVALID_IMAGE'],
          [animatedWebp, 'image/webp', 400, 'INVALID_IMAGE'],
        ];
        for (const [bytes, mime, status, code] of invalid) safeError(await upload(origin, bytes, mime), status, code);
      }, {}, directory);
      assert.equal(await countAssets(), before); assert.deepEqual(await readdir(directory), []);
    });

    await suite.test('orientation is normalized and image metadata is removed without resizing artwork', async () => {
      const rotated = await sharp({ create: { width: 7, height: 4, channels: 3, background: '#39785c' } })
        .jpeg().withMetadata({ orientation: 6 }).toBuffer();
      await withApplication(async (origin) => {
        const result = await upload(origin, rotated, 'image/jpeg');
        assert.equal(result.response.status, 201);
        const asset = metadata(result, 'image/jpeg');
        assert.equal(asset.width, 4); assert.equal(asset.height, 7);
        const content = await read(origin, asset.id, true);
        const decoded = await sharp(content.bytes).metadata();
        assert.equal(decoded.width, 4); assert.equal(decoded.height, 7);
        assert.equal(decoded.orientation, undefined); assert.equal(decoded.exif, undefined); assert.equal(decoded.icc, undefined);
        const { data, info } = await sharp(content.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.channels, 3);
        for (let index = 0; index < data.length; index += 3) {
          assert.ok(Math.abs(data[index] - 57) <= 4 && Math.abs(data[index + 1] - 120) <= 4 && Math.abs(data[index + 2] - 92) <= 4,
            'sRGB normalization must preserve the uploaded artwork colors within JPEG rounding.');
        }
      });
    });

    await suite.test('encoded size, side and total pixel bounds reject uploads before persistence', async () => {
      const before = await countAssets();
      for (const limits of [{ maxBytes: formats.png.length - 1 }, { maxSide: 7 }, { maxPixels: 47 }]) {
        const directory = await newDirectory();
        await withApplication(async (origin) => safeError(await upload(origin), 413, 'IMAGE_TOO_LARGE'), limits, directory);
        assert.deepEqual(await readdir(directory), []);
      }
      assert.equal(await countAssets(), before);
    });

    await suite.test('chunked oversized bodies and interrupted uploads cannot leave metadata or partial files', async () => {
      const before = await countAssets();
      const directory = await newDirectory();
      await withApplication(async (origin) => {
        const large = rawUpload(origin, uploadHeaders(adminSession, 'image/png', { 'Transfer-Encoding': 'chunked' }),
          [Buffer.alloc(600), Buffer.alloc(600)]);
        safeError(await large.result, 413, 'IMAGE_TOO_LARGE');
        const interrupted = rawUpload(origin, uploadHeaders(adminSession, 'image/png', { 'Content-Length': String(formats.png.length) }),
          [formats.png.subarray(0, 20)], true);
        await delay(50); interrupted.destroy();
        await interrupted.result.catch(() => {});
        await delay(50);
        assert.equal(await countAssets(), before); assert.deepEqual(await readdir(directory), []);
      }, { maxBytes: 1024 }, directory);
    });

    await suite.test('one active upload pipeline rejects competing work and releases its slot after interruption', async () => {
      const directory = await newDirectory();
      const before = await countAssets();
      await withApplication(async (origin) => {
        const held = rawUpload(origin, uploadHeaders(adminSession, 'image/png', { 'Content-Length': String(formats.png.length) }),
          [formats.png.subarray(0, 20)], true);
        try {
          await delay(80);
          const busy = await upload(origin);
          safeError(busy, 429, 'ASSET_UPLOAD_BUSY');
          assert.equal(await countAssets(), before); assert.deepEqual(await readdir(directory), []);
        } finally { held.destroy(); await held.result.catch(() => {}); }
        let result;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          result = await upload(origin);
          if (result.response.status !== 429) break;
          await delay(20);
        }
        assert.equal(result.response.status, 201);
        assert.equal(await countAssets(), before + 1); assert.equal((await readdir(directory)).length, 1);
      }, {}, directory);
    });

    await suite.test('the disk budget counts orphan files and still allows existing content reads when full', async () => {
      const directory = await newDirectory();
      await writeFile(join(directory, 'orphan-from-interrupted-commit'), persisted.bytes, { flag: 'wx' });
      const before = await countAssets();
      await withApplication(async (origin) => safeError(await upload(origin), 507, 'ASSET_STORAGE_FULL'),
        { maxDiskBytes: persisted.asset.byteSize * 2 - 1 }, directory);
      assert.equal(await countAssets(), before);
      assert.deepEqual(await readdir(directory), ['orphan-from-interrupted-commit']);
      await withApplication(async (origin) => {
        safeError(await upload(origin), 507, 'ASSET_STORAGE_FULL');
        const content = await read(origin, persisted.asset.id, true);
        assert.equal(content.response.status, 200); assert.deepEqual(content.bytes, persisted.bytes);
      }, { maxDiskBytes: 1 }, persistentDirectory);
    });

    await suite.test('pending reservations consume their full future size and expose neither metadata nor partial content', async () => {
      const directory = await newDirectory();
      const before = await countAssets();
      const id = randomUUID();
      await databaseOperation(() => database.asset.create({ data: {
        id, uploadedById: administrator.id, mimeType: 'image/png', byteSize: persisted.asset.byteSize,
        width: persisted.asset.width, height: persisted.asset.height, sha256: persisted.asset.sha256, ready: false,
      } }));
      try {
        await withApplication(async (origin) => {
          for (const partial of [false, true]) {
            if (partial) await writeFile(join(directory, id), persisted.bytes.subarray(0, Math.floor(persisted.bytes.length / 2)), { flag: 'wx' });
            for (const content of [false, true]) safeError(await read(origin, id, content), 404, 'ASSET_NOT_FOUND');
            safeError(await upload(origin), 507, 'ASSET_STORAGE_FULL');
            assert.equal(await countAssets(), before + 1);
            assert.deepEqual(await readdir(directory), partial ? [id] : []);
          }
        }, { maxDiskBytes: persisted.asset.byteSize * 2 - 1 }, directory);
      } finally {
        // Remove only the incomplete row explicitly seeded by this fixture.
        await databaseOperation(() => database.asset.delete({ where: { id } }));
      }
      assert.equal(await countAssets(), before);
    });

    await suite.test('two application instances serialize a shared disk budget and cannot both consume its final capacity', async () => {
      const directory = await newDirectory();
      const limits = { maxDiskBytes: persisted.asset.byteSize * 2 - 1 };
      const first = await start(directory, limits);
      let second;
      const before = await countAssets();
      try {
        second = await start(directory, limits);
        const results = await Promise.all([upload(first.origin), upload(second.origin)]);
        assert.deepEqual(results.map((result) => result.response.status).sort(), [201, 507]);
        safeError(results.find((result) => result.response.status === 507), 507, 'ASSET_STORAGE_FULL');
        assert.equal(await countAssets(), before + 1);
        const files = await readdir(directory);
        assert.equal(files.length, 1); assert.match(files[0], uuid);
        assert.equal((await stat(join(directory, files[0]))).size, persisted.asset.byteSize);
      } finally { if (second) await stop(second); await stop(first); }
    });

    await suite.test('quota reservations use a fresh snapshot after waiting for the lock even with a stricter database default', async () => {
      const directory = await newDirectory();
      const limits = { maxDiskBytes: persisted.asset.byteSize * 2 - 1 };
      const before = await countAssets();
      let first;
      let second;
      let firstRequest;
      let secondRequest;
      let reservedId;
      let releaseReservation;
      let releaseWrite;
      let capacityReached;
      const reservationGate = new Promise((accept) => { releaseReservation = accept; });
      const writeGate = new Promise((accept) => { releaseWrite = accept; });
      const capacitySignal = new Promise((accept) => { capacityReached = accept; });
      // This database belongs solely to this test suite. Existing fixture
      // connections keep their old default; newly started API pools inherit it.
      await databaseOperation(() => database.$executeRawUnsafe(
        `ALTER DATABASE "${databaseName}" SET default_transaction_isolation TO 'repeatable read'`));
      try {
        first = await start(directory, limits);
        second = await start(directory, limits);
        const storage = first.app.get(AssetsService).storage;
        const checkCapacity = storage.checkCapacity.bind(storage);
        const write = storage.write.bind(storage);
        let holdReservation = true;
        storage.checkCapacity = async (...arguments_) => {
          await checkCapacity(...arguments_);
          if (holdReservation) {
            holdReservation = false;
            capacityReached();
            await reservationGate;
          }
        };
        storage.write = async (id, bytes) => {
          reservedId = id;
          // The first reservation is committed, but no corresponding file is
          // visible until the competing request has made its quota decision.
          await writeGate;
          return write(id, bytes);
        };
        firstRequest = upload(first.origin);
        firstRequest.catch(() => {});
        await Promise.race([capacitySignal, delay(3000).then(() => {
          throw new Error('First upload did not reach its controlled quota check.');
        })]);
        secondRequest = upload(second.origin);
        secondRequest.catch(() => {});
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const locks = await databaseOperation(() => database.$queryRaw`
            SELECT count(*)::int AS count FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
          if (locks[0].count > 0) { waiting = true; break; }
          await delay(20);
        }
        assert.equal(waiting, true, 'Competing upload must wait for the reservation advisory lock.');
        releaseReservation();
        safeError(await secondRequest, 507, 'ASSET_STORAGE_FULL');
        releaseWrite();
        const accepted = await firstRequest;
        assert.equal(accepted.response.status, 201);
        assert.equal(await countAssets(), before + 1);
        const files = await readdir(directory);
        assert.deepEqual(files, [accepted.body.asset.id]);
      } finally {
        // Release every controlled operation before closing either app, even
        // when the pre-fix assertion fails with an unexpected 201 response.
        releaseReservation(); releaseWrite();
        await Promise.allSettled([firstRequest, secondRequest].filter(Boolean));
        try {
          if (reservedId) {
            await databaseOperation(() => database.asset.deleteMany({ where: { id: reservedId, ready: false } }));
          }
          if (second) await stop(second);
          if (first) await stop(first);
        } finally {
          await databaseOperation(() => database.$executeRawUnsafe(
            `ALTER DATABASE "${databaseName}" RESET default_transaction_isolation`));
        }
      }
    });

    await suite.test('missing and nonregular stored files fail closed with sanitized errors', async () => {
      const path = join(persistentDirectory, persisted.asset.id);
      const backup = join(persistentDirectory, `${persisted.asset.id}.fixture-backup`);
      await withApplication(async (origin) => {
        await rename(path, backup);
        try {
          safeError(await read(origin, persisted.asset.id, true), 503, 'ASSET_UNAVAILABLE');
          assert.equal((await read(origin, persisted.asset.id)).response.status, 200);
          await mkdir(path);
          try { safeError(await read(origin, persisted.asset.id, true), 503, 'ASSET_UNAVAILABLE'); }
          finally { await rmdir(path); }
        } finally { await rename(backup, path); }
      }, {}, persistentDirectory);
    });

    await suite.test('a metadata database failure exposes no SQL, storage paths or credentials', async () => {
      await withApplication(async (origin) => {
        await databaseOperation(() => database.$executeRawUnsafe('ALTER TABLE "Asset" RENAME TO "AssetT09Unavailable"'));
        try { safeError(await read(origin, persisted.asset.id), 503, 'ASSET_UNAVAILABLE'); }
        finally { await databaseOperation(() => database.$executeRawUnsafe('ALTER TABLE "AssetT09Unavailable" RENAME TO "Asset"')); }
      }, {}, persistentDirectory);
    });
  } finally {
    let cleanupFailed = false;
    for (const app of applications) { try { await app.close(); } catch { cleanupFailed = true; } }
    try { await database?.onModuleDestroy(); } catch { cleanupFailed = true; }
    try {
      if (created) {
        assert.match(databaseName, /^t09_assets_[a-f0-9]{24}$/);
        await databaseOperation(() => owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`));
      }
    } catch { cleanupFailed = true; }
    finally { try { await owner.onModuleDestroy(); } catch { cleanupFailed = true; } }
    try {
      // Resolve and check the exact generated fixture before recursive removal.
      const target = resolve(fixtureRoot);
      assert.equal(dirname(target), fixtureParent); assert.match(basename(target), /^t09-assets-[A-Za-z0-9_-]+$/);
      assert.equal(await realpath(target), target);
      await rm(target, { recursive: true, force: true });
    } catch { cleanupFailed = true; }
    assert.equal(cleanupFailed, false, 'Asset integration cleanup failed; inspect only this disposable database and generated fixture directory.');
  }
});
