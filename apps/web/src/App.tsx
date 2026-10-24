import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent, RefObject } from 'react';
import { HEALTH_PATH, isHealthResponse } from '@webwargame/contracts';
import { AccountApiError, registerAccount } from './auth/account-client.ts';
import { browserSession, sessionChanges, supportsSessionChanges } from './auth/browser-session.ts';

type Mode = 'login' | 'register';
type Fields = Partial<Record<'username' | 'password' | 'confirmation', string>>;
function errorMessage(error: unknown): string {
  return error instanceof AccountApiError ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export function App() {
  const snapshot = useSyncExternalStore(browserSession.subscribe, browserSession.getSnapshot);
  const [actionError, setActionError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void browserSession.restore();
    const restore = () => {
      if (document.visibilityState === 'visible') void browserSession.restore(true);
    };
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', restore);
    sessionChanges?.addEventListener('message', restore);
    return () => {
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', restore);
      sessionChanges?.removeEventListener('message', restore);
    };
  }, []);

  useEffect(() => {
    if (snapshot.phase !== 'checking') heading.current?.focus();
  }, [snapshot.phase]);

  useEffect(() => {
    if (!snapshot.session || snapshot.busy) return;
    const deadline = Math.min(Date.parse(snapshot.session.expiresAt), Date.parse(snapshot.session.idleExpiresAt));
    const timer = window.setTimeout(() => browserSession.expireIfNeeded(), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [snapshot.session, snapshot.busy]);

  async function logout() {
    setActionError('');
    try { await browserSession.logout(); } catch (error) { setActionError(errorMessage(error)); }
  }

  return (
    <main className="page">
      <header className="masthead">
        <span className="brand-mark" aria-hidden="true">⚑</span>
        <span>Web Wargame</span>
        <span className="stage">Ваш игровой стол</span>
      </header>
      <section className="account-layout" aria-label="Учётная запись">
        <div className="account-intro">
          <p className="eyebrow">За одним игровым столом</p>
          <h1>Варгейм<br />для друзей.</h1>
          <p className="intro">Место для ваших сражений, карт и армий. Войдите или создайте учётную запись, чтобы присоединиться.</p>
          <p className="intro account-note">Мы готовим площадку для первой партии. Доступ к партиям выдаётся отдельно.</p>
        </div>
        {snapshot.phase === 'checking' || snapshot.phase === 'unavailable' ? (
          <section className="account-panel account-status" aria-labelledby="account-title" aria-busy={snapshot.busy !== null}>
            <h2 id="account-title" ref={heading} tabIndex={-1}>{snapshot.phase === 'checking' ? 'Проверяем сеанс' : 'Не удалось проверить сеанс'}</h2>
            <p role="status">{snapshot.phase === 'checking' ? 'Сейчас откроем ваш игровой стол…' : 'Связь с сервером недоступна или ответ не удалось подтвердить. Повторите проверку, чтобы продолжить.'}</p>
            {snapshot.phase === 'unavailable' && <button type="button" disabled={snapshot.busy !== null} onClick={() => { setActionError(''); void browserSession.restore(); }}>Проверить сеанс</button>}
            {snapshot.notice && <p className="form-message" role="status">{snapshot.notice}</p>}
          </section>
        ) : snapshot.phase === 'authenticated' && snapshot.session ? (
          <section className="session-card" aria-labelledby="account-title" aria-busy={snapshot.busy !== null}>
            <p className="eyebrow">За столом</p>
            <h2 id="account-title" ref={heading} tabIndex={-1}>Добро пожаловать, {snapshot.session.user.username}.</h2>
            <p>Вы вошли в учётную запись. Партии и управление армиями появятся на следующих этапах.</p>
            <dl className="session-details">
              <dt>Имя пользователя</dt><dd>{snapshot.session.user.username}</dd>
              <dt>Роль</dt><dd>{snapshot.session.user.role === 'ADMIN' ? 'Администратор' : 'Игрок'}</dd>
            </dl>
            {snapshot.notice && <p className="form-message" role="status">{snapshot.notice}</p>}
            {actionError && <p className="form-message error" role="alert">{actionError}</p>}
            {!supportsSessionChanges && <CompatibilityMessage />}
            <div className="account-toolbar">
              <button type="button" className="button-secondary" disabled={snapshot.busy !== null} onClick={() => { setActionError(''); void browserSession.restore(); }}>{snapshot.busy === 'restore' ? 'Проверяем…' : 'Проверить сеанс'}</button>
              <button type="button" className="button-secondary" disabled={snapshot.busy === 'login' || snapshot.busy === 'logout' || !supportsSessionChanges} onClick={() => void logout()}>{snapshot.busy === 'logout' ? 'Выходим…' : 'Выйти'}</button>
            </div>
            {snapshot.busy === 'logout' && <p className="field-hint" role="status">Дождитесь ответа сервера. Если ожидание затянулось, обновите страницу и проверьте сеанс.</p>}
          </section>
        ) : <AccountForms busy={snapshot.busy === 'login' || snapshot.busy === 'logout'} notice={snapshot.notice} headingRef={heading} />}
      </section>
      <footer><ConnectionStatus /></footer>
    </main>
  );
}

function CompatibilityMessage() {
  return <p className="form-message error" role="alert">В этом браузере вход и выход недоступны. Обновите Chrome, Edge или Firefox и откройте приложение по HTTPS или по локальному адресу.</p>;
}

function AccountForms({ busy, notice, headingRef }: { busy: boolean; notice: string | null; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const locked = busy || pending;
  const registration = mode === 'register';

  useEffect(() => { headingRef.current?.focus(); }, [mode, headingRef]);
  useEffect(() => {
    if (locked) return;
    const first = (['username', 'password', 'confirmation'] as const).find((field) => fields[field]);
    if (first) document.getElementById(first)?.focus();
    else if (message) document.getElementById('account-message')?.focus();
  }, [fields, message, locked]);

  function changeMode(next: Mode) {
    if (locked) return;
    setMode(next);
    setPassword(''); setConfirmation(''); setFields({}); setMessage(''); setSuccess(''); setShowPassword(false);
  }
  function focusError(errors: Fields) {
    const first = (['username', 'password', 'confirmation'] as const).find((field) => errors[field]);
    if (first) document.getElementById(first)?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || busy || !supportsSessionChanges) return;
    const errors: Fields = {};
    const name = username.trim();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(name)) errors.username = 'От 3 до 32 латинских букв, цифр, точек, дефисов или подчёркиваний.';
    if (!password) errors.password = 'Введите пароль.';
    if (registration) {
      const length = [...password].length;
      if (length < 15 || length > 128 || /[\p{Cc}\p{Cs}]/u.test(password)) errors.password = 'От 15 до 128 символов без управляющих символов. Пробелы разрешены.';
      if (confirmation !== password) errors.confirmation = 'Пароли не совпадают.';
    }
    setFields(errors); setMessage(''); setSuccess('');
    if (Object.keys(errors).length) { focusError(errors); return; }
    const credentials = { username: name, password };
    submitting.current = true;
    setPending(true); setPassword(''); setConfirmation(''); setShowPassword(false);
    try {
      if (registration) {
        const result = await registerAccount(credentials);
        setUsername(result.user.username); setMode('login');
        setSuccess('Учётная запись создана. Войдите с выбранным паролем.');
      } else { await browserSession.login(credentials); }
    } catch (error) {
      setMessage(errorMessage(error));
      if (error instanceof AccountApiError) { setFields(error.fields); focusError(error.fields); }
    } finally { submitting.current = false; setPending(false); }
  }

  return (
    <section className="account-panel" aria-labelledby="account-title" aria-busy={locked}>
      <nav className="account-tabs" aria-label="Действия с учётной записью">
        <button type="button" aria-current={!registration ? 'page' : undefined} disabled={locked} onClick={() => changeMode('login')}>Вход</button>
        <button type="button" aria-current={registration ? 'page' : undefined} disabled={locked} onClick={() => changeMode('register')}>Регистрация</button>
      </nav>
      <h2 id="account-title" ref={headingRef} tabIndex={-1}>{registration ? 'Присоединиться к столу' : 'С возвращением'}</h2>
      <form className="account-form" noValidate onSubmit={(event) => void submit(event)}>
        {notice && <p className="form-message" role="status">{notice}</p>}
        {success && <p className="form-message success" role="status">{success}</p>}
        {message && <p id="account-message" className="form-message error" role="alert" tabIndex={-1}>{message}</p>}
        {!supportsSessionChanges && <CompatibilityMessage />}
        <div className="field">
          <label htmlFor="username">Имя пользователя</label>
          <input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} disabled={locked} required aria-invalid={Boolean(fields.username)} aria-describedby="username-hint username-error" />
          <p id="username-hint" className="field-hint">3–32 символа: латинские буквы, цифры и . _ -</p>
          <span id="username-error" className="field-error">{fields.username}</span>
        </div>
        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={registration ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} disabled={locked} required aria-invalid={Boolean(fields.password)} aria-describedby="password-hint password-error" />
          <p id="password-hint" className="field-hint">{registration ? '15–128 символов. Можно использовать пробелы и длинную фразу.' : 'Введите пароль, указанный при регистрации.'}</p>
          <span id="password-error" className="field-error">{fields.password}</span>
        </div>
        {registration && <div className="field">
          <label htmlFor="confirmation">Повторите пароль</label>
          <input id="confirmation" name="confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={locked} required aria-invalid={Boolean(fields.confirmation)} aria-describedby="confirmation-error" />
          <span id="confirmation-error" className="field-error">{fields.confirmation}</span>
        </div>}
        <div className="form-actions">
          <button type="button" className="button-secondary" aria-pressed={showPassword} disabled={locked} onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Скрыть пароль' : 'Показать пароль'}</button>
          <button type="submit" disabled={locked || !supportsSessionChanges}>{locked ? (registration ? 'Создаём учётную запись…' : 'Входим…') : (registration ? 'Создать учётную запись' : 'Войти')}</button>
        </div>
        {locked && <p className="field-hint" role="status">Дождитесь ответа сервера. Если ожидание затянулось, обновите страницу и проверьте сеанс.</p>}
      </form>
    </section>
  );
}

function ConnectionStatus() {
  const [connection, setConnection] = useState<'checking' | 'connected' | 'unavailable'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    async function check() {
      try {
        const response = await fetch(HEALTH_PATH, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok || !isHealthResponse(await response.json())) throw new Error('Health unavailable.');
        if (!disposed) setConnection('connected');
      } catch { if (!disposed) setConnection('unavailable'); } finally { window.clearTimeout(timeout); }
    }
    void check();
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt]);
  return <div className="connection-summary">
    <p className={connection} role="status"><span className="status-dot" aria-hidden="true" /> {connection === 'checking' ? 'Проверяем связь с сервером…' : connection === 'connected' ? 'Последняя проверка: сервер доступен' : 'Последняя проверка: нет связи с сервером'}</p>
    <button type="button" className="button-secondary" disabled={connection === 'checking'} onClick={() => { setConnection('checking'); setAttempt((value) => value + 1); }}>Проверить соединение</button>
  </div>;
}
