import { ADMIN_OVERVIEW_PATH } from '@webwargame/contracts';
import type { AdminOverviewResponse } from '@webwargame/contracts';

const RESPONSE_LIMIT = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export class AdminApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

/** The protected endpoint, rather than a cached browser role, grants this view. */
export async function getAdminOverview(): Promise<AdminOverviewResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ADMIN_OVERVIEW_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', 'X-Wargame-Request': '1' },
      signal: controller.signal,
    });
    const body: unknown = await boundedJson(response);
    if (response.status === 401 && isRecord(body) && body.code === 'UNAUTHENTICATED') {
      throw new AdminApiError('Сеанс завершён. Войдите снова.', 401);
    }
    if (response.status === 403 && isRecord(body) && body.code === 'ACCESS_DENIED') {
      throw new AdminApiError('У этой учётной записи нет прав администратора.', 403);
    }
    if (response.status !== 200 || !isRecord(body) || body.status !== 'ready' || !isRecord(body.user) ||
      typeof body.user.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.user.id) ||
      typeof body.user.username !== 'string' || !/^[A-Za-z0-9._-]{3,32}$/.test(body.user.username) || body.user.role !== 'ADMIN') {
      throw new AdminApiError('Не удалось подтвердить права. Повторите проверку.');
    }
    return { status: 'ready', user: { id: body.user.id, username: body.user.username, role: 'ADMIN' } };
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    throw new AdminApiError('Не удалось проверить права. Проверьте соединение и попробуйте ещё раз.');
  } finally {
    clearTimeout(timeout);
  }
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
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
