import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reflector } from '@nestjs/core';
import { AdminController } from '../dist/admin/admin.controller.js';
import { unauthenticated, authUnavailable } from '../dist/auth/auth-errors.js';
import { RequireRoles } from '../dist/auth/roles.decorator.js';
import { RolesGuard } from '../dist/auth/roles.guard.js';
import { SessionGuard } from '../dist/auth/session.guard.js';
import { createSessionToken, csrfTokenForSession } from '../dist/auth/session-security.js';
import { RuntimeConfiguration } from '../dist/config/environment.js';

const configuration = new RuntimeConfiguration('unused', 3000);
const token = createSessionToken();
const session = {
  user: { id: 'public-id', username: 'Commander', role: 'ADMIN' },
  csrfToken: csrfTokenForSession(token),
  expiresAt: '2026-10-31T12:00:00.000Z', idleExpiresAt: '2026-10-25T12:00:00.000Z',
};

function context(request, controller = AdminController, handler = AdminController.prototype.overview) {
  return { switchToHttp: () => ({ getRequest: () => request }), getClass: () => controller, getHandler: () => handler };
}

function request(method = 'GET', headers = {}) {
  return { method, headers: { 'x-wargame-request': '1', cookie: `wargame.sid=${token}`, ...headers } };
}

function expectStatus(status, code) {
  return (error) => error.getStatus() === status && error.getResponse().code === code;
}

test('session guard obtains the current database identity and keeps bearer credentials out of the principal', async () => {
  const calls = [];
  const guard = new SessionGuard({ current: async (...args) => { calls.push(args); return session; } }, configuration);
  const req = request();
  assert.equal(await guard.canActivate(context(req)), true);
  assert.deepEqual(calls, [[token]]);
  assert.equal(req.authenticatedSession, session);
  assert.ok(!JSON.stringify(req.authenticatedSession).includes(token));
});

test('missing and ambiguous cookies cannot create a principal, and session failures propagate unchanged', async () => {
  for (const cookie of [undefined, `wargame.sid=${token}; wargame.sid=${token}`]) {
    const guard = new SessionGuard({ current: async (supplied) => {
      assert.equal(supplied, undefined);
      throw unauthenticated();
    } }, configuration);
    const req = request('GET', { cookie });
    await assert.rejects(() => guard.canActivate(context(req)), expectStatus(401, 'UNAUTHENTICATED'));
    assert.equal(req.authenticatedSession, undefined);
  }
  for (const error of [unauthenticated(), authUnavailable()]) {
    const guard = new SessionGuard({ current: async () => { throw error; } }, configuration);
    await assert.rejects(() => guard.canActivate(context(request())), (failure) => failure === error);
  }
});

test('HTTPS guards accept only the secure host-prefixed session cookie', async () => {
  const secure = new RuntimeConfiguration('unused', 3000, 'https://game.example.test');
  const calls = [];
  const guard = new SessionGuard({ current: async (supplied) => { calls.push(supplied); return session; } }, secure);
  await guard.canActivate(context(request('GET', { cookie: `__Host-wargame.sid=${token}` })));
  await guard.canActivate(context(request()));
  assert.deepEqual(calls, [token, undefined]);
});

test('guards reject untrusted request boundaries before accessing session storage', async () => {
  const guard = new SessionGuard({ current: async () => assert.fail('Untrusted request reached storage.') }, configuration);
  for (const req of [request('GET', { 'x-wargame-request': undefined }),
    request('GET', { origin: 'https://foreign.example.test' }),
    request('POST'), request('POST', { origin: 'http://localhost:5173' }),
    request('POST', { origin: configuration.publicOrigin, 'x-wargame-request': ['1', '1'] })]) {
    await assert.rejects(() => guard.canActivate(context(req)), expectStatus(403, 'CSRF_REJECTED'));
  }
});

test('mutations authenticate without idle renewal before rejecting missing or invalid CSRF', async () => {
  for (const supplied of [undefined, 'invalid', csrfTokenForSession(createSessionToken()), [session.csrfToken]]) {
    const calls = [];
    const guard = new SessionGuard({ current: async (...args) => { calls.push(args); return session; } }, configuration);
    const req = request('POST', { origin: configuration.publicOrigin, 'x-csrf-token': supplied });
    await assert.rejects(() => guard.canActivate(context(req)), expectStatus(403, 'CSRF_REJECTED'));
    assert.deepEqual(calls, [[token, false]]);
    assert.equal(req.authenticatedSession, undefined);
  }
});

test('an unauthenticated mutation returns 401 before evaluating CSRF', async () => {
  const guard = new SessionGuard({ current: async (supplied, touch) => {
    assert.equal(supplied, undefined);
    assert.equal(touch, false);
    throw unauthenticated();
  } }, configuration);
  await assert.rejects(() => guard.canActivate(context(request('POST', { origin: configuration.publicOrigin, cookie: undefined }))),
    expectStatus(401, 'UNAUTHENTICATED'));
});

test('valid mutation CSRF permits renewal and attaches the final current identity', async () => {
  const calls = [];
  const renewed = { ...session, user: { ...session.user, role: 'PLAYER' } };
  const guard = new SessionGuard({ current: async (...args) => {
    calls.push(args);
    return calls.length === 1 ? session : renewed;
  } }, configuration);
  const req = request('PATCH', { origin: configuration.publicOrigin, 'x-csrf-token': session.csrfToken });
  assert.equal(await guard.canActivate(context(req)), true);
  assert.deepEqual(calls, [[token, false], [token]]);
  assert.equal(req.authenticatedSession, renewed, 'A role changed between reads must not retain the older identity.');
});

test('role guard protects administrator endpoints and fails closed without roles or authenticated identity', () => {
  const guard = new RolesGuard(new Reflector());
  assert.equal(guard.canActivate(context({ authenticatedSession: session })), true);
  for (const req of [{}, { authenticatedSession: { ...session, user: { ...session.user, role: 'PLAYER' } } }]) {
    assert.throws(() => guard.canActivate(context(req)), expectStatus(403, 'ACCESS_DENIED'));
  }
  class MissingRoles {}
  class EmptyRoles {}
  RequireRoles()(EmptyRoles);
  for (const controller of [MissingRoles, EmptyRoles]) {
    assert.throws(() => guard.canActivate(context({ authenticatedSession: session }, controller, () => {})),
      expectStatus(403, 'ACCESS_DENIED'));
  }
});

test('administrator overview exposes only its small public contract', () => {
  assert.deepEqual(new AdminController().overview({ authenticatedSession: session }), {
    status: 'ready', user: { id: session.user.id, username: session.user.username, role: 'ADMIN' },
  });
});
