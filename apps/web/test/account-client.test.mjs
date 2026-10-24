import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountApiError, getCurrentSession, loginAccount, logoutAccount, registerAccount } from '../src/auth/account-client.ts';

const credentials = { username: 'Commander', password: '  long passphrase with spaces  ' };
const user = { id: 'ac12c56f-e3de-4d88-a7af-f4d5ee731e58', username: 'Commander', role: 'PLAYER' };
const session = {
  user,
  csrfToken: 'c'.repeat(43),
  expiresAt: '2026-10-31T12:00:00.000Z',
  idleExpiresAt: '2026-10-25T12:00:00.000Z',
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

test('login uses same-origin JSON without changing credentials and copies only public session fields', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options });
    return json({ ...session, bearer: 'must not escape', user: { ...user, passwordHash: 'must not escape' } });
  });
  assert.deepEqual(await loginAccount(credentials), session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/auth/login');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['X-Wargame-Request'], '1');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), credentials);
  assert.equal(calls[0].options.signal, undefined);
});

test('registration validates player-only result and never implicitly logs in', async (t) => {
  const registered = { user: { ...user, createdAt: '2026-10-24T12:00:00.000Z' } };
  const fetch = t.mock.method(globalThis, 'fetch', async () => json(registered, 201));
  assert.deepEqual(await registerAccount(credentials), registered);
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(fetch.mock.calls[0].arguments[0], '/api/auth/register');
  fetch.mock.mockImplementation(async () => json({ user: { ...registered.user, role: 'ADMIN' } }, 201));
  await assert.rejects(registerAccount(credentials), (error) => error instanceof AccountApiError &&
    error.code === 'UNEXPECTED_RESPONSE' && !error.ambiguous);
});

test('uncertain registration replies explain possible account creation without implying a session', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  for (const response of [
    new Response('{"private":"server secret","user":', { status: 201, headers: { 'Content-Type': 'application/json' } }),
    json({ user: { ...user, role: 'ADMIN', createdAt: '2026-10-24T12:00:00.000Z', private: 'server secret' } }, 201),
    new Response('<html>server secret</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
  ]) {
    fetch.mock.mockImplementation(async () => response);
    await assert.rejects(registerAccount(credentials), (error) => {
      assert.ok(error instanceof AccountApiError);
      assert.equal(error.code, 'UNEXPECTED_RESPONSE');
      assert.equal(error.ambiguous, false);
      assert.match(error.message, /могла быть создана/);
      assert.match(error.message, /попробуйте войти/i);
      assert.doesNotMatch(error.message, /проверить сеанс|server secret|private|html/);
      return true;
    });
  }
});

test('logout requires the current CSRF token and accepts only an empty 204 success', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.equal(await logoutAccount(session.csrfToken), undefined);
  const [path, options] = fetch.mock.calls[0].arguments;
  assert.equal(path, '/api/auth/logout');
  assert.equal(options.headers['X-CSRF-Token'], session.csrfToken);
  assert.equal(options.headers['X-Wargame-Request'], '1');
  assert.equal(options.body, '{}');
  assert.equal(options.signal, undefined);
  fetch.mock.mockImplementation(async () => json({}, 200));
  await assert.rejects(logoutAccount(session.csrfToken), (error) => error instanceof AccountApiError && error.ambiguous);
});

test('current-session requests send credentials and a custom header but no mutation data', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ ...session, user: { ...user, role: 'ADMIN' } }));
  const current = await getCurrentSession();
  assert.equal(current.user.role, 'ADMIN');
  const [path, options] = fetch.mock.calls[0].arguments;
  assert.equal(path, '/api/auth/me');
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.headers['X-Wargame-Request'], '1');
  assert.equal(options.body, undefined);
  assert.ok(options.signal instanceof AbortSignal);
});

test('registration errors expose local field help without server messages or unknown field names', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({
    code: 'INVALID_REGISTRATION', message: '<script>server details</script>',
    fields: { username: ['server secret'], password: ['server secret'], admin: ['server secret'] },
  }, 400));
  await assert.rejects(registerAccount(credentials), (error) => {
    assert.ok(error instanceof AccountApiError);
    assert.equal(error.code, 'INVALID_REGISTRATION');
    assert.deepEqual(Object.keys(error.fields).sort(), ['password', 'username']);
    assert.match(error.fields.username, /3 до 32/);
    assert.match(error.fields.password, /15 до 128/);
    assert.doesNotMatch(JSON.stringify({ message: error.message, fields: error.fields }), /server|script|secret/);
    assert.equal(error.ambiguous, false);
    return true;
  });
});

test('known credential, conflict, expiry, CSRF, rate and availability failures have safe Russian messages', async (t) => {
  const scenarios = [
    [401, 'INVALID_CREDENTIALS', () => loginAccount(credentials), /Неверное/],
    [409, 'USERNAME_TAKEN', () => registerAccount(credentials), /занято/],
    [401, 'UNAUTHENTICATED', getCurrentSession, /Сеанс завершён/],
    [403, 'CSRF_REJECTED', () => logoutAccount(session.csrfToken), /подтвердить/],
    [429, 'LOGIN_RATE_LIMITED', () => loginAccount(credentials), /много попыток/],
    [429, 'REGISTRATION_RATE_LIMITED', () => registerAccount(credentials), /много попыток/],
    [503, 'AUTH_UNAVAILABLE', () => loginAccount(credentials), /временно/],
    [503, 'REGISTRATION_UNAVAILABLE', () => registerAccount(credentials), /временно/],
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  for (const [status, code, operation, message] of scenarios) {
    fetch.mock.mockImplementation(async () => json({ code, message: 'internal secret' }, status, { 'Retry-After': '90' }));
    await assert.rejects(operation(), (error) => {
      assert.ok(error instanceof AccountApiError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /internal secret/);
      assert.equal(error.retryAfter, 90);
      assert.equal(error.ambiguous, false);
      return true;
    });
  }
});

test('unknown and malformed server errors never disclose raw response data', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ code: 'INTERNAL_SECRET', message: 'private details' }, 500));
  for (const response of [
    json({ code: 'INTERNAL_SECRET', message: 'private details' }, 500),
    new Response('<html>private details</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    new Response('{private details', { status: 400, headers: { 'Content-Type': 'application/json' } }),
  ]) {
    fetch.mock.mockImplementation(async () => response);
    await assert.rejects(loginAccount(credentials), (error) => error instanceof AccountApiError &&
      error.code === 'UNEXPECTED_RESPONSE' && !error.ambiguous && !/private|INTERNAL_SECRET/.test(error.message));
  }
});

test('unrecognized success payloads are ambiguous only when they could change the session cookie', async (t) => {
  const invalid = [
    { ...session, user: { ...user, role: 'OWNER' } },
    { ...session, csrfToken: 'bad' },
    { ...session, expiresAt: 'not a date' },
    { ...session, idleExpiresAt: '2026-11-01T12:00:00.000Z' },
    { ...session, user: { ...user, id: 'not a uuid' } },
    { ...session, user: { ...user, username: '<script>' } },
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  for (const body of invalid) {
    fetch.mock.mockImplementation(async () => json(body));
    await assert.rejects(loginAccount(credentials), (error) => error instanceof AccountApiError && error.ambiguous);
    await assert.rejects(getCurrentSession(), (error) => error instanceof AccountApiError && !error.ambiguous);
  }
});

test('bounded response parsing cancels an oversized stream and handles chunked UTF-8 safely', async (t) => {
  let cancelled = false;
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(loginAccount(credentials), (error) => error instanceof AccountApiError && error.ambiguous);
  assert.equal(cancelled, true);
  const body = new TextEncoder().encode(JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'Секрет' }));
  fetch.mock.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of body) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  }), { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  await assert.rejects(loginAccount(credentials), (error) => error instanceof AccountApiError && error.code === 'INVALID_CREDENTIALS');
});

test('network failures are never retried and mark cookie-changing actions for reconciliation', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('secret network diagnostic'); });
  for (const operation of [() => loginAccount(credentials), () => logoutAccount(session.csrfToken)]) {
    await assert.rejects(operation(), (error) => error instanceof AccountApiError && error.code === 'NETWORK_ERROR' &&
      error.ambiguous && !error.message.includes('secret'));
  }
  await assert.rejects(registerAccount(credentials), (error) => error instanceof AccountApiError &&
    !error.ambiguous && error.message.includes('могла быть создана'));
  await assert.rejects(getCurrentSession(), (error) => error instanceof AccountApiError && !error.ambiguous);
  assert.equal(fetch.mock.calls.length, 4);
});

test('GET timeout aborts the read; mutation remains pending until its original response arrives', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = t.mock.method(globalThis, 'fetch', (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const current = getCurrentSession();
  const assertion = assert.rejects(current, (error) => error instanceof AccountApiError && error.code === 'NETWORK_ERROR');
  t.mock.timers.tick(10_000);
  await assertion;
  let release;
  let settled = false;
  fetch.mock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const login = loginAccount(credentials).then((value) => { settled = true; return value; });
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(settled, false);
  release(json(session));
  assert.deepEqual(await login, session);
});
