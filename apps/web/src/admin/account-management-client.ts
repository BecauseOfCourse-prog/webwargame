import { ADMIN_ACCOUNTS_PATH, RESET_PASSWORD_PATH } from '@webwargame/contracts';
import type { AccountAuditAction, AccountAuditEntry, AccountAuditResponse, AdminAccount, AdminAccountResponse, AdminAccountsResponse, AdminResetResponse, ResetPasswordRequest } from '@webwargame/contracts';

const RESPONSE_LIMIT = 32 * 1024;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const username = /^[A-Za-z0-9._-]{3,32}$/;
const codePattern = /^[A-Za-z0-9_-]{43}$/;
const auditActions = new Set<AccountAuditAction>(['ROLE_CHANGED', 'SUSPENDED', 'RESUMED', 'PASSWORD_RESET_ISSUED', 'PASSWORD_RESET_COMPLETED']);
const ambiguousMessage = 'Ответ не подтверждён. Обновите список и историю перед повтором действия.';

export class AccountManagementError extends Error {
  readonly status: number | undefined;
  readonly code: string;
  readonly ambiguous: boolean;
  constructor(message: string, code: string, status?: number, ambiguous = false) {
    super(message); this.name = 'AccountManagementError'; this.status = status; this.code = code; this.ambiguous = ambiguous;
  }
}

export async function getAdminAccounts(search = '', page = 1): Promise<AdminAccountsResponse> {
  if (!/^[A-Za-z0-9._-]{0,32}$/.test(search) || !validPage(page)) throw invalidInput();
  const body = await request(`${ADMIN_ACCOUNTS_PATH}?${new URLSearchParams({ search, page: String(page) })}`);
  if (!isRecord(body) || !Array.isArray(body.accounts) || body.accounts.length > 20 || body.page !== page || body.pageSize !== 20 ||
      !nonnegativeInteger(body.total) || !nonnegativeInteger(body.activeAdministrators) || body.total < body.accounts.length) throw unexpected(false);
  const accounts = body.accounts.map((entry) => account(entry));
  if (new Set(accounts.map((entry) => entry.id)).size !== accounts.length) throw unexpected(false);
  return { accounts, page, pageSize: 20, total: body.total, activeAdministrators: body.activeAdministrators };
}

export async function getAccountAudit(id: string, page = 1): Promise<AccountAuditResponse> {
  if (!uuid.test(id) || !validPage(page)) throw invalidInput();
  const body = await request(`${ADMIN_ACCOUNTS_PATH}/${id}/audit?${new URLSearchParams({ page: String(page) })}`);
  if (!isRecord(body) || !Array.isArray(body.events) || body.events.length > 20 || body.page !== page || body.pageSize !== 20 ||
      !nonnegativeInteger(body.total) || body.total < body.events.length) throw unexpected(false);
  const events = body.events.map((entry) => auditEntry(entry, id));
  if (new Set(events.map((entry) => entry.id)).size !== events.length) throw unexpected(false);
  return { events, page, pageSize: 20, total: body.total };
}

export async function changeAccountRole(id: string, role: 'PLAYER' | 'ADMIN', version: number, csrfToken: string): Promise<AdminAccountResponse> {
  if (role !== 'PLAYER' && role !== 'ADMIN') throw invalidInput();
  return changedAccount(id, 'role', { role, version }, csrfToken);
}

export async function changeAccountSuspension(id: string, suspended: boolean, version: number, csrfToken: string): Promise<AdminAccountResponse> {
  if (typeof suspended !== 'boolean') throw invalidInput();
  return changedAccount(id, 'suspension', { suspended, version }, csrfToken);
}

export async function issueAccountReset(id: string, version: number, csrfToken: string): Promise<AdminResetResponse> {
  validateMutation(id, version, csrfToken);
  const body = await request(`${ADMIN_ACCOUNTS_PATH}/${id}/password-reset`, { body: { version }, csrfToken, expected: 201 });
  if (!isRecord(body) || typeof body.code !== 'string' || !codePattern.test(body.code) || !timestamp(body.expiresAt)) throw unexpected(true);
  const target = account(body.account, true);
  if (target.id !== id) throw unexpected(true);
  return { account: target, code: body.code, expiresAt: body.expiresAt };
}

export async function completePasswordReset(input: ResetPasswordRequest): Promise<void> {
  if (!codePattern.test(input.code) || !validNewPassword(input.password)) throw new AccountManagementError(
    'Введите код восстановления и пароль от 15 до 128 символов без управляющих символов.', 'INVALID_RESET_INPUT', 400);
  await request(RESET_PASSWORD_PATH, { body: input, expected: 204 });
}

export function validNewPassword(password: string): boolean {
  const length = [...password].length;
  return length >= 15 && length <= 128 && !/[\p{Cc}\p{Cs}]/u.test(password);
}

async function changedAccount(id: string, action: string, body: { version: number } & Record<string, unknown>, csrfToken: string): Promise<AdminAccountResponse> {
  validateMutation(id, body.version, csrfToken);
  const response = await request(`${ADMIN_ACCOUNTS_PATH}/${id}/${action}`, { body, csrfToken });
  if (!isRecord(response)) throw unexpected(true);
  const target = account(response.account, true);
  if (target.id !== id) throw unexpected(true);
  return { account: target };
}

function validateMutation(id: string, version: number, csrfToken: string): void {
  if (!uuid.test(id) || !nonnegativeInteger(version) || !codePattern.test(csrfToken)) throw invalidInput();
}
function validPage(value: number): boolean { return Number.isSafeInteger(value) && value >= 1; }
function nonnegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function role(value: unknown): value is 'PLAYER' | 'ADMIN' { return value === 'PLAYER' || value === 'ADMIN'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invalidInput(): AccountManagementError { return new AccountManagementError('Проверьте выбранное действие и обновите данные.', 'INVALID_ACCOUNT_INPUT', 400); }
function unexpected(mutation: boolean): AccountManagementError { return new AccountManagementError(mutation ? ambiguousMessage : 'Не удалось подтвердить данные. Повторите загрузку.', 'INVALID_RESPONSE', undefined, mutation); }

function account(value: unknown, mutation = false): AdminAccount {
  if (!isRecord(value) || typeof value.id !== 'string' || !uuid.test(value.id) || typeof value.username !== 'string' || !username.test(value.username) ||
      !role(value.role) || !(value.suspendedAt === null || timestamp(value.suspendedAt)) || typeof value.passwordResetRequired !== 'boolean' ||
      !(value.resetExpiresAt === null || timestamp(value.resetExpiresAt)) || !nonnegativeInteger(value.version) || !timestamp(value.createdAt)) throw unexpected(mutation);
  return { id: value.id, username: value.username, role: value.role, suspendedAt: value.suspendedAt,
    passwordResetRequired: value.passwordResetRequired, resetExpiresAt: value.resetExpiresAt, version: value.version, createdAt: value.createdAt };
}

function auditEntry(value: unknown, targetId: string): AccountAuditEntry {
  if (!isRecord(value) || typeof value.id !== 'string' || !uuid.test(value.id) || value.targetId !== targetId ||
      !auditActions.has(value.action as AccountAuditAction) || !role(value.fromRole) || !role(value.toRole) ||
      typeof value.fromSuspended !== 'boolean' || typeof value.toSuspended !== 'boolean' || !timestamp(value.createdAt)) throw unexpected(false);
  let actor: AccountAuditEntry['actor'] = null;
  if (value.actor !== null) {
    if (!isRecord(value.actor) || typeof value.actor.id !== 'string' || !uuid.test(value.actor.id) ||
        typeof value.actor.username !== 'string' || !username.test(value.actor.username)) throw unexpected(false);
    actor = { id: value.actor.id, username: value.actor.username };
  }
  return { id: value.id, actor, targetId, action: value.action as AccountAuditAction, fromRole: value.fromRole,
    toRole: value.toRole, fromSuspended: value.fromSuspended, toSuspended: value.toSuspended, createdAt: value.createdAt };
}

async function request(path: string, options: { body?: object; csrfToken?: string; expected?: number } = {}): Promise<unknown> {
  const mutation = options.body !== undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), mutation ? 15_000 : 10_000);
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Wargame-Request': '1' };
  if (mutation) headers['Content-Type'] = 'application/json';
  if (options.csrfToken !== undefined) headers['X-CSRF-Token'] = options.csrfToken;
  try {
    const response = await fetch(path, { method: mutation ? 'POST' : 'GET', credentials: path === RESET_PASSWORD_PATH ? 'omit' : 'same-origin', cache: 'no-store', redirect: 'error',
      headers, signal: controller.signal, ...(mutation ? { body: JSON.stringify(options.body) } : {}) });
    if (response.status === 204 && options.expected === 204) return undefined;
    const body: unknown = await boundedJson(response);
    if (!response.ok) throw responseError(response.status, body, mutation);
    if (response.status !== (options.expected ?? 200)) throw unexpected(mutation);
    return body;
  } catch (error) {
    if (error instanceof AccountManagementError) throw error;
    throw new AccountManagementError(mutation ? ambiguousMessage : 'Не удалось загрузить данные. Проверьте соединение и попробуйте ещё раз.',
      'NETWORK_ERROR', undefined, mutation);
  } finally { clearTimeout(timeout); }
}

function responseError(status: number, body: unknown, mutation: boolean): AccountManagementError {
  const code = isRecord(body) && typeof body.code === 'string' ? body.code : '';
  const messages: Record<string, { status: number; message: string }> = {
    INVALID_ACCOUNT_INPUT: { status: 400, message: 'Проверьте данные и выбранное действие.' },
    INVALID_RESET_INPUT: { status: 400, message: 'Введите код и пароль от 15 до 128 символов без управляющих символов.' },
    UNAUTHENTICATED: { status: 401, message: 'Сеанс завершён. Войдите снова.' },
    INVALID_CREDENTIALS: { status: 401, message: 'Код восстановления недействителен или истёк. Попросите администратора выдать новый.' },
    RESET_INVALID_OR_EXPIRED: { status: 400, message: 'Код восстановления недействителен или истёк. Попросите администратора выдать новый.' },
    ACCESS_DENIED: { status: 403, message: 'У этой учётной записи нет прав администратора.' },
    CSRF_REJECTED: { status: 403, message: 'Не удалось подтвердить запрос. Проверьте сеанс и попробуйте ещё раз.' },
    ACCOUNT_NOT_FOUND: { status: 404, message: 'Учётная запись не найдена. Обновите список.' },
    ACCOUNT_CONFLICT: { status: 409, message: 'Учётная запись уже изменена. Обновите данные и подтвердите действие снова.' },
    LAST_ACTIVE_ADMIN: { status: 409, message: 'Нельзя закрыть доступ последнему действующему администратору. Сначала подготовьте другого администратора.' },
    RESET_RATE_LIMITED: { status: 429, message: 'Слишком много попыток восстановления. Попробуйте позже.' },
    ACCOUNT_UNAVAILABLE: { status: 503, message: 'Управление аккаунтами временно недоступно. Проверьте состояние перед повтором.' },
    AUTH_UNAVAILABLE: { status: 503, message: 'Сервер временно не может выполнить действие. Проверьте состояние перед повтором.' },
  };
  const known = Object.hasOwn(messages, code) ? messages[code] : undefined;
  if (!known || known.status !== status) return unexpected(mutation);
  return new AccountManagementError(known.message, code, status, mutation && status >= 500);
}

async function boundedJson(response: Response): Promise<unknown> {
  if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || !response.body) throw new Error('Invalid response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0; let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_LIMIT) throw new Error('Oversized response.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
