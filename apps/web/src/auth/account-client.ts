import {
  CURRENT_USER_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  REGISTRATION_PATH,
} from '@webwargame/contracts';
import type { LoginRequest, RegistrationRequest, RegistrationResponse, SessionResponse } from '@webwargame/contracts';

type Operation = 'current' | 'login' | 'logout' | 'registration';
type FieldErrors = Partial<Record<'username' | 'password', string>>;

const RESPONSE_LIMIT = 16 * 1024;
const CURRENT_TIMEOUT_MS = 10_000;
const USERNAME_HELP = 'Используйте от 3 до 32 латинских букв, цифр, точек, дефисов или подчёркиваний.';
const PASSWORD_HELP = 'Используйте от 15 до 128 символов без управляющих символов; пробелы разрешены.';

export class AccountApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly fields: FieldErrors;
  readonly retryAfter: number | undefined;
  readonly ambiguous: boolean;

  constructor(message: string, options: {
    code: string;
    status?: number;
    fields?: FieldErrors;
    retryAfter?: number;
    ambiguous?: boolean;
  }) {
    super(message);
    this.name = 'AccountApiError';
    this.code = options.code;
    this.status = options.status;
    this.fields = options.fields ?? {};
    this.retryAfter = options.retryAfter;
    this.ambiguous = options.ambiguous ?? false;
  }
}

export async function registerAccount(input: RegistrationRequest): Promise<RegistrationResponse> {
  const response = await request('registration', REGISTRATION_PATH, input);
  const body = await successfulJson(response, 'registration', 201);
  if (!isRecord(body) || !isRecord(body.user) || !isUser(body.user, true) || !isTimestamp(body.user.createdAt)) {
    throw unexpectedResponse('registration', response.status);
  }
  return { user: { id: body.user.id, username: body.user.username, role: 'PLAYER', createdAt: body.user.createdAt } };
}

export async function loginAccount(input: LoginRequest): Promise<SessionResponse> {
  return sessionResponse(await request('login', LOGIN_PATH, input), 'login');
}

export async function getCurrentSession(): Promise<SessionResponse> {
  // Only reads have a timeout. Aborting a login/logout does not prove that the
  // server stopped: its cookie may still arrive after the next account action.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CURRENT_TIMEOUT_MS);
  try {
    return await sessionResponse(await request('current', CURRENT_USER_PATH, undefined, undefined, controller.signal), 'current');
  } finally {
    clearTimeout(timeout);
  }
}

export async function logoutAccount(csrfToken: string): Promise<void> {
  const response = await request('logout', LOGOUT_PATH, {}, csrfToken);
  if (!response.ok) throw await responseError(response, 'logout');
  if (response.status !== 204) throw unexpectedResponse('logout', response.status);
}

async function request(operation: Operation, path: string, body?: object, csrfToken?: string, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Wargame-Request': '1' };
  const options: RequestInit = {
    method: operation === 'current' ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (csrfToken !== undefined) headers['X-CSRF-Token'] = csrfToken;
  if (signal !== undefined) options.signal = signal;
  try {
    return await fetch(path, options);
  } catch {
    const message = operation === 'registration'
      ? 'Ответ не получен. Учётная запись могла быть создана; попробуйте войти с теми же данными.'
      : operation === 'login' || operation === 'logout'
        ? 'Ответ не получен. Проверяем, завершилось ли действие.'
        : 'Не удалось проверить сеанс. Проверьте соединение и попробуйте ещё раз.';
    throw new AccountApiError(message, { code: 'NETWORK_ERROR', ambiguous: changesCookie(operation) });
  }
}

async function successfulJson(response: Response, operation: Operation, expectedStatus: number): Promise<unknown> {
  if (!response.ok) throw await responseError(response, operation);
  if (response.status !== expectedStatus) throw unexpectedResponse(operation, response.status);
  try {
    return await boundedJson(response);
  } catch {
    throw unexpectedResponse(operation, response.status);
  }
}

async function sessionResponse(response: Response, operation: 'login' | 'current'): Promise<SessionResponse> {
  const body = await successfulJson(response, operation, 200);
  if (!isRecord(body) || !isRecord(body.user) || !isUser(body.user, false) ||
    typeof body.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.csrfToken) ||
    !isTimestamp(body.expiresAt) || !isTimestamp(body.idleExpiresAt) || body.idleExpiresAt > body.expiresAt) {
    throw unexpectedResponse(operation, response.status);
  }
  // Copy only public contract fields, even if a misconfigured server adds others.
  return {
    user: { id: body.user.id, username: body.user.username, role: body.user.role },
    csrfToken: body.csrfToken,
    expiresAt: body.expiresAt,
    idleExpiresAt: body.idleExpiresAt,
  };
}

async function responseError(response: Response, operation: Operation): Promise<AccountApiError> {
  let body: unknown;
  try {
    body = await boundedJson(response);
  } catch {
    return unexpectedResponse(operation, response.status, false);
  }
  const code = isRecord(body) && typeof body.code === 'string' ? body.code : '';
  const fields: FieldErrors = {};
  let message: string | undefined;
  if (response.status === 400 && code === 'INVALID_REGISTRATION' && operation === 'registration') {
    message = 'Проверьте данные регистрации.';
    if (isRecord(body) && isRecord(body.fields)) {
      if (Array.isArray(body.fields.username) && body.fields.username.length > 0) fields.username = USERNAME_HELP;
      if (Array.isArray(body.fields.password) && body.fields.password.length > 0) fields.password = PASSWORD_HELP;
    }
  } else if (response.status === 409 && code === 'USERNAME_TAKEN' && operation === 'registration') {
    message = 'Это имя пользователя уже занято.';
    fields.username = message;
  } else if (response.status === 401 && code === 'INVALID_CREDENTIALS' && operation === 'login') {
    message = 'Неверное имя пользователя или пароль.';
  } else if (response.status === 401 && code === 'UNAUTHENTICATED') {
    message = 'Сеанс завершён. Войдите снова.';
  } else if (response.status === 403 && code === 'CSRF_REJECTED') {
    message = 'Не удалось подтвердить запрос. Проверьте сеанс и попробуйте ещё раз.';
  } else if (response.status === 429 && (code === 'LOGIN_RATE_LIMITED' || code === 'REGISTRATION_RATE_LIMITED')) {
    message = 'Слишком много попыток. Попробуйте позже.';
  } else if (response.status === 503 && (code === 'AUTH_UNAVAILABLE' || code === 'REGISTRATION_UNAVAILABLE')) {
    message = 'Сервер временно не может выполнить действие. Попробуйте позже.';
  } else if ([400, 413, 415].includes(response.status) &&
    ['BODY_TOO_LARGE', 'INVALID_JSON', 'UNSUPPORTED_ENCODING', 'JSON_REQUIRED'].includes(code)) {
    message = 'Не удалось отправить данные. Обновите страницу и попробуйте ещё раз.';
  }
  if (message === undefined) return unexpectedResponse(operation, response.status, false);
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
  return new AccountApiError(message, {
    code,
    status: response.status,
    fields,
    ...(retryAfter === undefined ? {} : { retryAfter }),
  });
}

function unexpectedResponse(operation: Operation, status: number, ambiguous = changesCookie(operation)): AccountApiError {
  const message = operation === 'registration'
    ? 'Сервер вернул неожиданный ответ. Учётная запись могла быть создана; попробуйте войти с теми же данными.'
    : 'Сервер вернул неожиданный ответ. Попробуйте проверить сеанс ещё раз.';
  return new AccountApiError(message, {
    code: 'UNEXPECTED_RESPONSE', status, ambiguous,
  });
}

async function boundedJson(response: Response): Promise<unknown> {
  if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || !response.body) {
    throw new Error('Invalid JSON response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_LIMIT) throw new Error('Response exceeds the size limit.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function changesCookie(operation: Operation): boolean {
  return operation === 'login' || operation === 'logout';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUser(value: Record<string, unknown>, playerOnly: boolean): value is {
  id: string; username: string; role: 'PLAYER' | 'ADMIN'; createdAt?: unknown;
} {
  return typeof value.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) &&
    typeof value.username === 'string' && /^[A-Za-z0-9._-]{3,32}$/.test(value.username) &&
    (value.role === 'PLAYER' || (!playerOnly && value.role === 'ADMIN'));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d{1,5}$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > 0 && seconds <= 86_400 ? seconds : undefined;
}
