import { useEffect, useRef, useState } from 'react';
import type { AdminOverviewResponse } from '@webwargame/contracts';
import { browserSession } from '../auth/browser-session.ts';
import { AdminApiError, getAdminOverview } from './admin-client.ts';

type Access = { phase: 'checking' } | { phase: 'allowed'; overview: AdminOverviewResponse } |
  { phase: 'denied' | 'error'; message: string };

export function AdminPanel({ userId }: { userId: string }) {
  const [access, setAccess] = useState<Access>({ phase: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let disposed = false;
    void getAdminOverview().then((overview) => {
      if (disposed) return;
      if (overview.user.id !== userId) {
        setAccess({ phase: 'error', message: 'Учётная запись изменилась. Проверьте сеанс, чтобы продолжить.' });
      } else setAccess({ phase: 'allowed', overview });
    }).catch((error: unknown) => {
      if (disposed) return;
      if (error instanceof AdminApiError && error.status === 401) {
        void browserSession.restore(true);
      }
      setAccess({
        phase: error instanceof AdminApiError && error.status === 403 ? 'denied' : 'error',
        message: error instanceof AdminApiError ? error.message : 'Не удалось проверить права. Повторите проверку.',
      });
    });
    return () => { disposed = true; };
  }, [userId, attempt]);

  useEffect(() => { heading.current?.focus(); }, [access.phase]);

  return <section className="admin-panel" aria-labelledby="admin-title" aria-busy={access.phase === 'checking'}>
    <p className="eyebrow">Управление игровым столом</p>
    <h1 id="admin-title" ref={heading} tabIndex={-1}>{access.phase === 'allowed' ? 'Панель администратора' : access.phase === 'checking' ? 'Проверяем права' : access.phase === 'denied' ? 'Доступ закрыт' : 'Не удалось открыть панель'}</h1>
    {access.phase === 'checking' ? <p role="status">Сервер проверяет ваш сеанс и права администратора…</p> : access.phase === 'allowed' ? <>
      <p>Права администратора подтверждены сервером.</p>
      <dl className="session-details">
        <dt>Учётная запись</dt><dd>{access.overview.user.username}</dd>
        <dt>Роль</dt><dd>Администратор</dd>
      </dl>
      <div className="admin-empty">
        <h2>Готовимся к первой партии</h2>
        <p>Управление правилами, изображениями, армиями и игроками появится на следующих этапах.</p>
      </div>
    </> : <p className="form-message error" role="alert">{access.message}</p>}
    <div className="account-toolbar admin-toolbar">
      <a href="/" className="text-link">К учётной записи</a>
      {access.phase === 'error' && <button type="button" className="button-secondary" onClick={() => { setAccess({ phase: 'checking' }); setAttempt((value) => value + 1); }}>Повторить проверку</button>}
    </div>
  </section>;
}
