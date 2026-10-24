import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  csrfTokenForSession,
  hashSessionToken,
  isValidCsrfToken,
  readSessionToken,
  sessionCookieName,
} from '../dist/auth/session-security.js';

const token = 'A'.repeat(43);
const otherToken = 'B'.repeat(43);

test('session tokens contain 32 random bytes and successive tokens do not repeat', () => {
  const generated = Array.from({ length: 64 }, () => createSessionToken());
  assert.equal(new Set(generated).size, generated.length);
  for (const value of generated) {
    assert.match(value, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(value, 'base64url').length, 32);
    assert.equal(Buffer.from(value, 'base64url').toString('base64url'), value);
  }
  assert.equal(SESSION_ABSOLUTE_MS, 7 * 24 * 60 * 60 * 1_000);
  assert.equal(SESSION_IDLE_MS, 24 * 60 * 60 * 1_000);
});

test('database digest and session-derived CSRF use distinct cryptographic domains', () => {
  const digest = hashSessionToken(token);
  const csrf = csrfTokenForSession(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, createHash('sha256').update(token).digest('hex'));
  assert.equal(csrf, createHmac('sha256', token).update('webwargame-csrf-v1').digest('base64url'));
  assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(csrf, token);
  assert.notEqual(csrf, createHash('sha256').update(token).digest('base64url'));
  assert.notEqual(hashSessionToken(otherToken), digest);
  assert.notEqual(csrfTokenForSession(otherToken), csrf);
});

test('CSRF verification accepts only the exact token derived from the same session', () => {
  const csrf = csrfTokenForSession(token);
  assert.equal(isValidCsrfToken(token, csrf), true);
  for (const supplied of [
    undefined, '', csrf.slice(1), `${csrf}A`, `${csrf}=`, ` ${csrf}`, `${csrf} `,
    `${csrf}\n`, `${csrf}\r`, `${csrf}\r\n`,
    `${csrf.slice(0, -1)}\n`, `${csrf.slice(0, -1)}é`, `${csrf.slice(0, -1)}.`,
    `${csrf[0] === 'A' ? 'B' : 'A'}${csrf.slice(1)}`,
    token, hashSessionToken(token), csrfTokenForSession(otherToken),
  ]) {
    assert.equal(isValidCsrfToken(token, supplied), false);
  }
});

test('session cookie parser selects only the deployment-specific name and ignores unrelated cookies', () => {
  assert.equal(sessionCookieName(false), 'wargame.sid');
  assert.equal(sessionCookieName(true), '__Host-wargame.sid');
  for (const secure of [false, true]) {
    const name = sessionCookieName(secure);
    const unusedName = sessionCookieName(!secure);
    assert.equal(readSessionToken(`${name}=${token}`, secure), token);
    assert.equal(readSessionToken(`other=x; ${unusedName}=${otherToken}; ${name}=${token}; preference=a=b`, secure), token);
    assert.equal(readSessionToken(`invalid; other=%zz; ${name}=${token}`, secure), token);
    assert.equal(readSessionToken(`${unusedName}=${token}`, secure), undefined);
    assert.equal(readSessionToken(`prefix${name}=${token}`, secure), undefined);
    assert.equal(readSessionToken(`${name.toUpperCase()}=${token}`, secure), undefined);
    assert.equal(readSessionToken(`unrelated=${name}=${token}`, secure), undefined);
  }
  assert.equal(readSessionToken(undefined, false), undefined);
  assert.equal(readSessionToken('', false), undefined);
  assert.equal(readSessionToken(`?wargame.sid=${token}`, false), undefined);
});

test('session cookie parser fails closed on duplicate or malformed selected credentials', () => {
  for (const secure of [false, true]) {
    const name = sessionCookieName(secure);
    for (const value of [
      '', token.slice(1), `${token}A`, `${token}=`, `"${token}"`, `${token} `, ` ${token}`,
      `${token.slice(0, -1)}+`, `${token.slice(0, -1)}/`, `${token.slice(0, -1)}é`,
      `${token.slice(0, -1)}\n`, `${token}\n`, `${token}\r`, `${token}\r\n`,
      `%41${token.slice(1)}`, `${token}\0`,
    ]) {
      assert.equal(readSessionToken(`${name}=${value}`, secure), undefined);
      assert.equal(readSessionToken(`${name}=${value}; ${name}=${token}`, secure), undefined);
      assert.equal(readSessionToken(`${name}=${token}; ${name}=${value}`, secure), undefined);
    }
    assert.equal(readSessionToken(`${name}=${token}; ${name}=${token}`, secure), undefined);
    assert.equal(readSessionToken(`${name}=${token}; ${name}=${otherToken}`, secure), undefined);
    assert.equal(readSessionToken(`${name}`, secure), undefined);
    assert.equal(readSessionToken(`${name} =${token}`, secure), undefined);
    assert.equal(readSessionToken(`\n${name}=${token}`, secure), undefined);
    assert.equal(readSessionToken(`\u00a0${name}=${token}`, secure), undefined);
    assert.equal(readSessionToken(`${name}=${token}; ${name}`, secure), undefined);
    assert.equal(readSessionToken(`${name}; ${name}=${token}`, secure), undefined);
  }
});

test('session cookies have the selected lifetime and browser security attributes', () => {
  const expires = new Date('2026-10-31T09:30:00.000Z');
  for (const secure of [false, true]) {
    const name = sessionCookieName(secure);
    const cookie = buildSessionCookie(token, expires, secure);
    const attributes = cookie.split('; ');
    assert.equal(attributes[0], `${name}=${token}`);
    assert.ok(attributes.includes('Path=/'));
    assert.ok(attributes.includes('HttpOnly'));
    assert.ok(attributes.includes('SameSite=Lax'));
    assert.ok(attributes.includes('Expires=Sat, 31 Oct 2026 09:30:00 GMT'));
    assert.ok(attributes.includes('Max-Age=604800'));
    assert.equal(attributes.includes('Secure'), secure);
    assert.ok(!attributes.some((attribute) => attribute.toLowerCase().startsWith('domain=')));
    assert.equal(readSessionToken(attributes[0], secure), token);

    const cleared = clearSessionCookie(secure).split('; ');
    assert.equal(cleared[0], `${name}=`);
    assert.ok(cleared.includes('Max-Age=0'));
    assert.ok(cleared.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT'));
    for (const flag of ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure']) {
      assert.equal(cleared.includes(flag), attributes.includes(flag));
    }
    assert.ok(!cleared.some((attribute) => attribute.toLowerCase().startsWith('domain=')));
  }
});

test('cookie construction rejects invalid token and expiry inputs', () => {
  const expires = new Date('2026-10-31T09:30:00.000Z');
  assert.throws(() => buildSessionCookie(`${token}; injected=value`, expires, true), TypeError);
  assert.throws(() => buildSessionCookie(token, new Date('invalid'), true), RangeError);
});
