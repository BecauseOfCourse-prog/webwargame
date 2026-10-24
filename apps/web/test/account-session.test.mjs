import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountApiError } from '../src/auth/account-client.ts';
import { AccountSession } from '../src/auth/account-session.ts';

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const session = (username = 'Commander', suffix = '') => ({
  user: { id: '00000000-0000-4000-8000-000000000001', username, role: 'PLAYER' },
  csrfToken: `${'c'.repeat(42)}${suffix || 'c'}`,
  expiresAt: new Date(NOW + 7 * 86_400_000).toISOString(),
  idleExpiresAt: new Date(NOW + 86_400_000).toISOString(),
});
const credentials = { username: 'Commander', password: 'A deliberately long password.' };
const unauthorized = () => new AccountApiError('Sign in.', { code: 'UNAUTHENTICATED', status: 401 });
const network = () => new AccountApiError('No response.', { code: 'NETWORK_ERROR', ambiguous: true });
const unavailable = () => new AccountApiError('Unavailable.', { code: 'AUTH_UNAVAILABLE', status: 503 });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const defaultApi = () => ({
  getCurrentSession: async () => session(),
  loginAccount: async () => session(),
  logoutAccount: async () => undefined,
});

test('restore deduplicates StrictMode-style calls and publishes an authenticated snapshot', async () => {
  const pending = deferred();
  let requests = 0;
  const store = new AccountSession({ api: { ...defaultApi(), getCurrentSession: () => { ++requests; return pending.promise; } } });
  const observed = [];
  const unsubscribe = store.subscribe(() => observed.push(store.getSnapshot().phase));
  const first = store.restore();
  assert.equal(store.restore(), first);
  assert.equal(requests, 1);
  assert.equal(store.getSnapshot().busy, 'restore');
  pending.resolve(session());
  await first;
  assert.equal(store.getSnapshot().phase, 'authenticated');
  assert.equal(store.getSnapshot().busy, null);
  assert.deepEqual(observed, ['checking', 'authenticated']);
  unsubscribe();
});

test('a delayed restore 401 cannot erase a newer login', async () => {
  const oldRead = deferred();
  const store = new AccountSession({ api: { ...defaultApi(), getCurrentSession: () => oldRead.promise } });
  const restore = store.restore();
  await store.login(credentials);
  oldRead.reject(unauthorized());
  await restore;
  assert.equal(store.getSnapshot().phase, 'authenticated');
  assert.equal(store.getSnapshot().session.user.username, 'Commander');
  assert.equal(store.getSnapshot().busy, null);
});

test('a cross-tab change invalidates a read begun before the shared cookie changed', async () => {
  const oldRead = deferred();
  let reads = 0;
  const store = new AccountSession({ api: { ...defaultApi(), getCurrentSession: () => {
    return ++reads === 1 ? oldRead.promise : Promise.resolve(session('OtherCommander'));
  } } });
  const stale = store.restore();
  await store.restore(true);
  assert.equal(store.getSnapshot().session.user.username, 'OtherCommander');
  oldRead.resolve(session('Commander'));
  await stale;
  assert.equal(store.getSnapshot().session.user.username, 'OtherCommander');
  assert.equal(reads, 2);
});

test('login locks synchronously, ignores duplicate intents and blocks restore through reconciliation', async () => {
  const login = deferred();
  const check = deferred();
  const calls = [];
  let lockHeld = false;
  const store = new AccountSession({
    api: {
      loginAccount: () => { calls.push('login'); return login.promise; },
      getCurrentSession: () => { assert.equal(lockHeld, true); calls.push('current'); return check.promise; },
      logoutAccount: async () => { calls.push('logout'); },
    },
    exclusiveMutation: async (action) => { lockHeld = true; try { await action(); } finally { lockHeld = false; } },
  });
  const mutation = store.login(credentials);
  await store.login(credentials);
  await store.logout();
  await store.restore();
  assert.deepEqual(calls, ['login']);
  login.reject(network());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['login', 'current']);
  assert.equal(store.getSnapshot().busy, 'login');
  assert.equal(lockHeld, true);
  check.resolve(session());
  await mutation;
  assert.equal(lockHeld, false);
  assert.equal(store.getSnapshot().phase, 'authenticated');
  assert.equal(store.getSnapshot().busy, null);
  assert.match(store.getSnapshot().notice, /Проверьте восстановленную/);
});

test('invalid credentials remain generic and anonymous without reading the session', async () => {
  const failure = new AccountApiError('Invalid credentials.', { code: 'INVALID_CREDENTIALS', status: 401 });
  let reads = 0;
  const store = new AccountSession({ api: {
    ...defaultApi(),
    loginAccount: async () => { throw failure; },
    getCurrentSession: async () => { ++reads; return session(); },
  } });
  await assert.rejects(store.login(credentials), (error) => error === failure);
  assert.equal(store.getSnapshot().phase, 'anonymous');
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(store.getSnapshot()).includes(credentials.password), false);
});

test('a marker during a queued or active failed login restores the shared identity under the lock', async () => {
  for (const status of [401, 429, 503]) {
    for (const timing of ['queued', 'active']) {
      const grant = deferred();
      const started = deferred();
      const response = deferred();
      const check = deferred();
      const failure = new AccountApiError('The login failed.', { status, code: 'LOGIN_FAILURE' });
      let reads = 0;
      let lockHeld = false;
      const store = new AccountSession({
        api: {
          ...defaultApi(),
          getCurrentSession: () => {
            if (++reads === 1) return Promise.reject(unauthorized());
            assert.equal(lockHeld, true);
            return check.promise;
          },
          loginAccount: () => { started.resolve(); return response.promise; },
        },
        exclusiveMutation: async (action) => {
          await grant.promise;
          lockHeld = true;
          try { await action(); } finally { lockHeld = false; }
        },
      });
      await store.restore();
      const mutation = store.login(credentials);
      const assertion = assert.rejects(mutation, (error) => error === failure);
      if (timing === 'active') {
        grant.resolve();
        await started.promise;
      }
      // The other tab's cookie has changed; its marker must not be discarded.
      await store.restore(true);
      assert.equal(reads, 1);
      grant.resolve();
      await started.promise;
      response.reject(failure);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(reads, 2, `${status}, ${timing}: reconcile the deferred marker`);
      assert.equal(lockHeld, true);
      assert.equal(store.getSnapshot().busy, 'login');
      check.resolve(session('OtherCommander'));
      await assertion;
      assert.equal(lockHeld, false);
      assert.equal(store.getSnapshot().phase, 'authenticated');
      assert.equal(store.getSnapshot().session.user.username, 'OtherCommander');
      assert.equal(store.getSnapshot().busy, null);
      assert.match(store.getSnapshot().notice, /Вход с введёнными данными не выполнен/);
    }
  }
});

test('deferred login invalidation is consumed and unavailable verification cannot invent a session', async () => {
  for (const readFailure of [unauthorized(), unavailable()]) {
    const response = deferred();
    const failure = unauthorized();
    let reads = 0;
    const store = new AccountSession({ api: {
      ...defaultApi(),
      loginAccount: () => response.promise,
      getCurrentSession: async () => { ++reads; throw readFailure; },
    } });
    const assertion = assert.rejects(store.login(credentials), (error) => error === failure);
    await store.restore(true);
    response.reject(failure);
    await assertion;
    assert.equal(reads, 1);
    assert.equal(store.getSnapshot().phase, readFailure.status === 401 ? 'anonymous' : 'unavailable');
    assert.equal(store.getSnapshot().session, null);
    await assert.rejects(store.login(credentials), (error) => error === failure);
    assert.equal(reads, 1, 'An old marker must not trigger a read during the next login.');
  }
});

test('an obsolete read cannot replace the identity reconciled after a marked failed login', async () => {
  const oldRead = deferred();
  const response = deferred();
  let reads = 0;
  const store = new AccountSession({ api: {
    ...defaultApi(),
    getCurrentSession: () => ++reads === 1 ? oldRead.promise : Promise.resolve(session('OtherCommander')),
    loginAccount: () => response.promise,
  } });
  const restore = store.restore();
  const assertion = assert.rejects(store.login(credentials), (error) => error.status === 401);
  await store.restore(true);
  response.reject(unauthorized());
  await assertion;
  oldRead.resolve(session('Commander'));
  await restore;
  assert.equal(store.getSnapshot().session.user.username, 'OtherCommander');
  assert.equal(store.getSnapshot().busy, null);
});

test('ambiguous login plus 401 reports the original failure; unavailable reconciliation never claims success', async () => {
  for (const readError of [unauthorized(), unavailable()]) {
    const failure = network();
    let changed = 0;
    const store = new AccountSession({ api: {
      ...defaultApi(),
      loginAccount: async () => { throw failure; },
      getCurrentSession: async () => { throw readError; },
    }, onChanged: () => { ++changed; } });
    await assert.rejects(store.login(credentials), (error) => error === failure);
    assert.equal(store.getSnapshot().phase, readError.status === 401 ? 'anonymous' : 'unavailable');
    assert.equal(store.getSnapshot().session, null);
    assert.equal(store.getSnapshot().busy, null);
    assert.equal(changed, 1);
  }
});

test('logout obtains CSRF for the current shared cookie after acquiring its mutation lock', async () => {
  const grant = deferred();
  const calls = [];
  const store = new AccountSession({
    api: {
      ...defaultApi(),
      getCurrentSession: async () => { calls.push('current'); return session('OtherCommander', 'x'); },
      logoutAccount: async (csrf) => { calls.push(csrf); },
    },
    exclusiveMutation: async (action) => { await grant.promise; await action(); },
  });
  const mutation = store.logout();
  assert.deepEqual(calls, []);
  assert.equal(store.getSnapshot().busy, 'logout');
  grant.resolve();
  await mutation;
  assert.deepEqual(calls, ['current', session('OtherCommander', 'x').csrfToken]);
  assert.equal(store.getSnapshot().phase, 'anonymous');
  assert.match(store.getSnapshot().notice, /вышли/);
});

test('failed logout reconciles the still-valid identity and does not claim success', async () => {
  const failure = unavailable();
  let reads = 0;
  const store = new AccountSession({ api: {
    ...defaultApi(),
    getCurrentSession: async () => { ++reads; return session(); },
    logoutAccount: async () => { throw failure; },
  } });
  await assert.rejects(store.logout(), (error) => error === failure);
  assert.equal(reads, 2);
  assert.equal(store.getSnapshot().phase, 'authenticated');
  assert.equal(store.getSnapshot().notice, null);
  assert.equal(store.getSnapshot().busy, null);
});

test('an uncertain logout becomes successful only when the cookie is confirmed anonymous', async () => {
  let reads = 0;
  const store = new AccountSession({ api: {
    ...defaultApi(),
    getCurrentSession: async () => { if (++reads === 1) return session(); throw unauthorized(); },
    logoutAccount: async () => { throw network(); },
  } });
  await store.logout();
  assert.equal(reads, 2);
  assert.equal(store.getSnapshot().phase, 'anonymous');
  assert.match(store.getSnapshot().notice, /вышли/);
});

test('restore differentiates expired sessions from unavailable verification and can recover', async () => {
  let result = session();
  const store = new AccountSession({ api: { ...defaultApi(), getCurrentSession: async () => {
    if (result instanceof Error) throw result;
    return result;
  } } });
  await store.restore();
  result = unauthorized();
  await store.restore();
  assert.equal(store.getSnapshot().phase, 'anonymous');
  assert.match(store.getSnapshot().notice, /завершён/);
  result = unavailable();
  await store.restore();
  assert.equal(store.getSnapshot().phase, 'unavailable');
  assert.equal(store.getSnapshot().session, null);
  result = session();
  await store.restore();
  assert.equal(store.getSnapshot().phase, 'authenticated');
  assert.equal(store.getSnapshot().notice, null);
});

test('known deadline expiration clears the display without a keepalive request', async () => {
  let now = NOW;
  let reads = 0;
  const store = new AccountSession({ now: () => now, api: {
    ...defaultApi(), getCurrentSession: async () => { ++reads; return session(); },
  } });
  await store.restore();
  now += 86_400_000;
  store.expireIfNeeded();
  assert.equal(store.getSnapshot().phase, 'anonymous');
  assert.match(store.getSnapshot().notice, /завершён/);
  assert.equal(reads, 1);
});
