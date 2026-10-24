import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService } from '../dist/auth/auth.service.js';
import { AuthController } from '../dist/auth/auth.controller.js';
import { authUnavailable } from '../dist/auth/auth-errors.js';
import { SessionService } from '../dist/auth/session.service.js';
import { createSessionToken, csrfTokenForSession } from '../dist/auth/session-security.js';
import { RuntimeConfiguration } from '../dist/config/environment.js';
import { DUMMY_PASSWORD_HASH, PasswordHasher } from '../dist/registration/password-hasher.js';

const credentials = { username: '  Commander  ', password: '  private passphrase 🐉  ' };
const user = { id: 'user-id', username: 'Commander', role: 'PLAYER', passwordHash: 'stored encoded hash' };

function expectStatus(status, code) {
  return (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().code, code);
    assert.ok(!JSON.stringify(error.getResponse()).includes(credentials.password));
    return true;
  };
}

test('login normalizes the lookup, verifies exact password and sends no hash to the session response', async () => {
  const observations = [];
  const database = { user: { findUnique: async (query) => { observations.push(query.where); return user; } } };
  const passwords = { verify: async (...args) => { observations.push(args); return true; } };
  const response = { user: { id: user.id, username: user.username, role: user.role } };
  const sessions = { create: async (...args) => { observations.push(args); return response; } };
  const service = new AuthService(database, passwords, sessions);
  assert.equal(await service.login(credentials, 'old-token'), response);
  assert.deepEqual(observations, [
    { normalizedUsername: 'commander' }, [user.passwordHash, credentials.password],
    [{ id: user.id, username: user.username, role: user.role }, 'old-token'],
  ]);
});

test('unknown user and wrong password each perform one verification and return the same generic failure', async () => {
  const responses = [];
  for (const existing of [null, user]) {
    const verifications = [];
    let sessionCreated = false;
    const service = new AuthService({ user: { findUnique: async () => existing } },
      { verify: async (...args) => { verifications.push(args); return existing === null; } },
      { create: async () => { sessionCreated = true; } });
    await assert.rejects(() => service.login(credentials), (error) => {
      assert.ok(expectStatus(401, 'INVALID_CREDENTIALS')(error));
      responses.push(error.getResponse());
      return true;
    });
    assert.deepEqual(verifications, [[existing ? user.passwordHash : DUMMY_PASSWORD_HASH, credentials.password]]);
    assert.equal(sessionCreated, false, 'Even matching the dummy hash must never authenticate an unknown user.');
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(DUMMY_PASSWORD_HASH.split('$')[3].split(',').sort(), ['m=19456', 'p=1', 't=2']);
});

test('invalid login payloads cannot query accounts or create sessions', async () => {
  const fail = () => { throw new Error('Invalid request reached account work.'); };
  const service = new AuthService({ user: { findUnique: fail } }, { verify: fail }, { create: fail });
  for (const value of [null, [], {}, { ...credentials, role: 'ADMIN' }, { username: 42, password: credentials.password },
    { username: 'Commander', password: 'too short' }]) {
    await assert.rejects(() => service.login(value), expectStatus(401, 'INVALID_CREDENTIALS'));
  }
});

test('normalized account budgets count failures across case and whitespace variants', async () => {
  let verifications = 0;
  const service = new AuthService({ user: { findUnique: async () => null } },
    { verify: async () => { verifications += 1; return false; } }, { create: async () => assert.fail() });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => service.login({ ...credentials, username: attempt % 2 ? 'COMMANDER' : ' Commander ' }),
      expectStatus(401, 'INVALID_CREDENTIALS'));
  }
  await assert.rejects(() => service.login(credentials), (error) => {
    assert.ok(expectStatus(429, 'LOGIN_RATE_LIMITED')(error));
    assert.ok(error.retryAfter > 0 && error.retryAfter <= 900);
    return true;
  });
  assert.equal(verifications, 5);
});

test('registration hashing and login verification share the same capacity and recover after completion', async () => {
  const passwords = new PasswordHasher();
  const results = await Promise.allSettled([
    passwords.hash(credentials.password), passwords.verify(DUMMY_PASSWORD_HASH, credentials.password),
    passwords.verify(DUMMY_PASSWORD_HASH, credentials.password),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[1].value, false);
  assert.equal(results[2].status, 'rejected');
  assert.ok(expectStatus(503, 'AUTH_UNAVAILABLE')(results[2].reason));
  assert.equal(await passwords.verify(results[0].value, credentials.password), true);
  await assert.rejects(() => passwords.verify('corrupted stored hash', credentials.password), expectStatus(503, 'AUTH_UNAVAILABLE'));
});

test('account and session storage failures return sanitized 503 responses', async () => {
  const secret = 'postgresql://private:private-password@example.test/db';
  const fail = async () => { throw new Error(secret); };
  const authentication = new AuthService({ user: { findUnique: fail } }, { verify: async () => assert.fail() }, {});
  const sessions = new SessionService({ $queryRaw: fail, $executeRaw: fail, $transaction: fail, session: { deleteMany: fail } });
  for (const operation of [() => authentication.login(credentials), () => sessions.current(createSessionToken()),
    () => sessions.remove(createSessionToken()), () => sessions.create(user), () => sessions.cleanupExpired()]) {
    await assert.rejects(operation, (error) => {
      assert.ok(expectStatus(503, 'AUTH_UNAVAILABLE')(error));
      assert.ok(!JSON.stringify(error.getResponse()).includes(secret));
      return true;
    });
  }
  await assert.rejects(() => sessions.current(undefined), expectStatus(401, 'UNAUTHENTICATED'));
});

test('failed logout deletion cannot clear the client cookie or claim success', async () => {
  const token = createSessionToken();
  const writes = [];
  const response = { setHeader: (...args) => writes.push(args) };
  const sessions = { current: async () => ({}), remove: async () => { throw authUnavailable(); } };
  const controller = new AuthController({}, sessions, new RuntimeConfiguration('unused', 3000));
  await assert.rejects(() => controller.logout(`wargame.sid=${token}`, csrfTokenForSession(token), 'application/json', response),
    expectStatus(503, 'AUTH_UNAVAILABLE'));
  assert.deepEqual(writes, []);
});
