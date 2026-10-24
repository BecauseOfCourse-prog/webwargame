import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1_000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CSRF_CONTEXT = 'webwargame-csrf-v1';

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfTokenForSession(token: string): string {
  return createHmac('sha256', token).update(CSRF_CONTEXT).digest('base64url');
}

export function isValidCsrfToken(token: string, supplied: string | undefined): boolean {
  if (supplied === undefined || !hasTokenFormat(supplied)) return false;

  return timingSafeEqual(Buffer.from(supplied), Buffer.from(csrfTokenForSession(token)));
}

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-wargame.sid' : 'wargame.sid';
}

export function readSessionToken(cookieHeader: string | undefined, secure: boolean): string | undefined {
  if (cookieHeader === undefined) return undefined;

  const expectedName = sessionCookieName(secure);
  let selected: string | undefined;

  for (const segment of cookieHeader.split(';')) {
    const pair = segment.replace(/^[ \t]+/, '');
    const separator = pair.indexOf('=');
    const name = separator === -1 ? pair : pair.slice(0, separator);
    if (name.trim() !== expectedName) continue;

    // Ambiguous or malformed credentials must not select a different valid cookie.
    if (selected !== undefined || separator === -1 || name !== expectedName) return undefined;
    const value = pair.slice(separator + 1);
    if (!hasTokenFormat(value)) return undefined;
    selected = value;
  }

  return selected;
}

export function buildSessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  if (!hasTokenFormat(token)) throw new TypeError('Invalid session token');
  if (!Number.isFinite(expiresAt.getTime())) throw new RangeError('Invalid session expiry');

  return `${sessionCookieName(secure)}=${token}; ${cookieAttributes(expiresAt, SESSION_ABSOLUTE_MS / 1_000, secure)}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${sessionCookieName(secure)}=; ${cookieAttributes(new Date(0), 0, secure)}`;
}

function cookieAttributes(expiresAt: Date, maxAge: number, secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function hasTokenFormat(value: string): boolean {
  return value.length === 43 && TOKEN_PATTERN.test(value);
}
