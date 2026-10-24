import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminApiError, getAdminOverview } from '../src/admin/admin-client.ts';

const overview = {
  status: 'ready',
  user: { id: 'ac12c56f-e3de-4d88-a7af-f4d5ee731e58', username: 'Commander', role: 'ADMIN' },
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('administrator overview requires a protected same-origin read and copies only the public contract', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ ...overview, private: 'hidden', user: { ...overview.user, passwordHash: 'hidden' } }));
  assert.deepEqual(await getAdminOverview(), overview);
  assert.equal(fetch.mock.calls.length, 1);
  const [path, options] = fetch.mock.calls[0].arguments;
  assert.equal(path, '/api/admin/overview');
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers['X-Wargame-Request'], '1');
  assert.equal(options.body, undefined);
  assert.ok(options.signal instanceof AbortSignal);
});

test('only validated administrator data can open the administrator view', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  for (const body of [
    {}, null, [],
    { ...overview, status: 'ok' },
    { ...overview, user: { ...overview.user, role: 'PLAYER' } },
    { ...overview, user: { ...overview.user, role: 'OWNER' } },
    { ...overview, user: { ...overview.user, id: 'private' } },
    { ...overview, user: { ...overview.user, username: '<script>' } },
  ]) {
    fetch.mock.mockImplementation(async () => json(body));
    await assert.rejects(getAdminOverview(), (error) => error instanceof AdminApiError && error.status === undefined);
  }
  fetch.mock.mockImplementation(async () => json(overview, 201));
  await assert.rejects(getAdminOverview(), AdminApiError);
});

test('recognized authentication and permission failures use safe Russian messages', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  for (const [status, code, message] of [
    [401, 'UNAUTHENTICATED', /Войдите снова/],
    [403, 'ACCESS_DENIED', /нет прав администратора/],
  ]) {
    fetch.mock.mockImplementation(async () => json({ code, message: 'internal secret' }, status));
    await assert.rejects(getAdminOverview(), (error) => error instanceof AdminApiError && error.status === status &&
      message.test(error.message) && !error.message.includes('secret'));
  }
});

test('untrusted server diagnostics and malformed responses never become interface content', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  for (const response of [
    json({ code: 'DATABASE_SECRET', message: 'private diagnostic' }, 503),
    json({ code: 'UNAUTHENTICATED', message: 'private diagnostic' }, 403),
    new Response('<html>private diagnostic</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    new Response('{"private diagnostic":', { headers: { 'Content-Type': 'application/json' } }),
    new Response(Uint8Array.of(0xff), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    fetch.mock.mockImplementation(async () => response);
    await assert.rejects(getAdminOverview(), (error) => error instanceof AdminApiError && error.status === undefined &&
      !/private|secret|DATABASE_SECRET|html/i.test(error.message));
  }
});

test('oversized responses are cancelled and cannot disclose private content', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(getAdminOverview(), AdminApiError);
  assert.equal(cancelled, true);
});

test('chunked UTF-8 responses still validate the complete public payload', async (t) => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...overview, message: 'Приватная строка' }));
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  assert.deepEqual(await getAdminOverview(), overview);
});

test('the administrator read times out after ten seconds without automatic retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = t.mock.method(globalThis, 'fetch', (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const read = getAdminOverview();
  const assertion = assert.rejects(read, (error) => error instanceof AdminApiError && /соединение/.test(error.message));
  t.mock.timers.tick(10_000);
  await assertion;
  assert.equal(fetch.mock.calls.length, 1);
});

test('network errors are sanitized and no request is retried implicitly', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('secret network details'); });
  await assert.rejects(getAdminOverview(), (error) => error instanceof AdminApiError && !error.message.includes('secret'));
  assert.equal(fetch.mock.calls.length, 1);
});
