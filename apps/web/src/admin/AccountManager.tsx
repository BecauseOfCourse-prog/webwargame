import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import type { AccountAuditEntry, AccountAuditResponse, AdminAccount, AdminAccountsResponse } from '@webwargame/contracts';
import { browserSession, sessionChanges } from '../auth/browser-session.ts';
import { AccountManagementError, changeAccountRole, changeAccountSuspension, getAccountAudit, getAdminAccounts, issueAccountReset } from './account-management-client.ts';

type Load<T> = { phase: 'loading' } | { phase: 'ready'; data: T } | { phase: 'error'; message: string };
type Confirmation = { action: 'role' | 'suspension' | 'reset'; account: AdminAccount };
type IssuedCode = { username: string; code: string; expiresAt: string };

export function AccountManager({ userId }: { userId: string }) {
  const session = useSyncExternalStore(browserSession.subscribe, browserSession.getSnapshot);
  const identity = useRef({ userId, csrfToken: session.session?.csrfToken });
  const alive = useRef(false);
  const listGeneration = useRef(0);
  const auditGeneration = useRef(0);
  const submitting = useRef(false);
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [query, setQuery] = useState({ search: '', page: 1 });
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<Load<AdminAccountsResponse>>({ phase: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [audit, setAudit] = useState<Load<AccountAuditResponse>>({ phase: 'loading' });
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [issuedCode, setIssuedCode] = useState<IssuedCode | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const [denied, setDenied] = useState('');
  const cancelButton = useRef<HTMLButtonElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const selected = list.phase === 'ready' ? list.data.accounts.find((entry) => entry.id === selectedId) : undefined;
  const locked = pending || session.busy !== null;
  const mayAct = !locked && !reviewRequired && audit.phase === 'ready';

  const sameIdentity = useCallback(() => {
    const current = browserSession.getSnapshot();
    return current.phase === 'authenticated' && current.session?.user.id === identity.current.userId &&
      current.session.user.role === 'ADMIN' && current.session.csrfToken === identity.current.csrfToken &&
      current.busy !== 'login' && current.busy !== 'logout';
  }, []);
  const currentIdentity = useCallback(async () => {
    if (browserSession.getSnapshot().busy === 'restore') await browserSession.restore();
    return alive.current && sameIdentity();
  }, [sameIdentity]);
  const failure = useCallback((error: unknown): string => {
    return error instanceof AccountManagementError ? error.message : 'Не удалось подтвердить ответ. Обновите данные.';
  }, []);
  const handleDenied = useCallback((error: unknown) => {
    if (!(error instanceof AccountManagementError) || !(error.status === 401 || error.code === 'ACCESS_DENIED')) return;
    setDenied(error.message); setList({ phase: 'loading' }); setAudit({ phase: 'loading' }); setConfirmation(null); setIssuedCode(null);
    void browserSession.restore(true);
  }, []);
  const invalidateReads = useCallback(() => { listGeneration.current += 1; auditGeneration.current += 1; }, []);

  useEffect(() => {
    alive.current = true;
    const unsubscribe = browserSession.subscribe(() => {
      if (!sameIdentity()) {
        invalidateReads();
        setIssuedCode(null); setConfirmation(null); setList({ phase: 'loading' }); setAudit({ phase: 'loading' });
      }
    });
    return () => { alive.current = false; invalidateReads(); unsubscribe(); };
  }, [invalidateReads, sameIdentity]);

  useEffect(() => {
    const generation = ++listGeneration.current;
    setList({ phase: 'loading' });
    void (async () => {
      await browserSession.restore();
      if (!await currentIdentity() || generation !== listGeneration.current) return;
      try {
        const data = await getAdminAccounts(query.search, query.page);
        if (await currentIdentity() && generation === listGeneration.current) setList({ phase: 'ready', data });
      } catch (error) {
        if (!await currentIdentity() || generation !== listGeneration.current) return;
        handleDenied(error); setList({ phase: 'error', message: failure(error) });
      }
    })();
    return () => { ++listGeneration.current; };
  }, [query, attempt, currentIdentity, failure, handleDenied]);

  useEffect(() => {
    const generation = ++auditGeneration.current;
    setAudit({ phase: 'loading' });
    if (!selectedId) return;
    void (async () => {
      await browserSession.restore();
      if (!await currentIdentity() || generation !== auditGeneration.current) return;
      try {
        const data = await getAccountAudit(selectedId, auditPage);
        if (await currentIdentity() && generation === auditGeneration.current) setAudit({ phase: 'ready', data });
      } catch (error) {
        if (!await currentIdentity() || generation !== auditGeneration.current) return;
        handleDenied(error); setAudit({ phase: 'error', message: failure(error) });
      }
    })();
    return () => { ++auditGeneration.current; };
  }, [selectedId, auditPage, attempt, currentIdentity, failure, handleDenied]);

  useEffect(() => { if (confirmation) cancelButton.current?.focus(); }, [confirmation]);
  useEffect(() => { if (selectedId) detailHeading.current?.focus(); }, [selectedId]);
  useEffect(() => { if (issuedCode || message) result.current?.focus(); }, [issuedCode, message]);

  function clearSelection() {
    setSelectedId(null); setConfirmation(null); setIssuedCode(null); setMessage(''); setReviewRequired(false); setAuditPage(1);
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const value = search.trim();
    if (!/^[A-Za-z0-9._-]{0,32}$/.test(value)) {
      setSearchError('До 32 латинских букв, цифр и знаков . _ -');
      document.getElementById('account-search')?.focus(); return;
    }
    setSearchError(''); clearSelection(); setQuery({ search: value, page: 1 });
  }
  function refresh() {
    if (locked) return;
    setConfirmation(null); setIssuedCode(null); setReviewRequired(false); setAttempt((value) => value + 1);
  }
  function prepare(action: Confirmation['action'], target: AdminAccount) {
    if (!mayAct || !sameIdentity()) return;
    setIssuedCode(null); setMessage(''); setConfirmation({ action, account: target });
  }
  async function mutate() {
    if (!confirmation || !mayAct || submitting.current) return;
    const choice = confirmation;
    submitting.current = true; setPending(true); setMessage(''); setIssuedCode(null);
    let code: IssuedCode | null = null;
    let messageText = '';
    let uncertain = false;
    try {
      await browserSession.restore(true);
      if (!await currentIdentity()) return;
      const token = browserSession.getSnapshot().session?.csrfToken;
      if (!token) return;
      const target = choice.account;
      if (choice.action === 'role') await changeAccountRole(target.id, target.role === 'ADMIN' ? 'PLAYER' : 'ADMIN', target.version, token);
      else if (choice.action === 'suspension') await changeAccountSuspension(target.id, !target.suspendedAt, target.version, token);
      else {
        const response = await issueAccountReset(target.id, target.version, token);
        code = { username: target.username, code: response.code, expiresAt: response.expiresAt };
      }
      messageText = choice.action === 'reset' ? 'Код восстановления создан. Предыдущий код больше не действует.' : 'Изменение сохранено. Прежние сеансы этой учётной записи завершены.';
      notifyTabs(); await browserSession.restore(true);
    } catch (error) {
      uncertain = !(error instanceof AccountManagementError) || error.ambiguous;
      messageText = failure(error);
      if (uncertain || error instanceof AccountManagementError && [401, 403, 409].includes(error.status ?? 0)) {
        notifyTabs(); await browserSession.restore(true);
      }
      if (await currentIdentity()) handleDenied(error);
    } finally {
      submitting.current = false;
      if (await currentIdentity()) {
        setPending(false); setConfirmation(null); setIssuedCode(code); setMessage(messageText);
        setReviewRequired(uncertain); setAttempt((value) => value + 1);
      }
    }
  }

  if (denied) return <p className="form-message error" role="alert">{denied}</p>;
  return <section className="account-manager" aria-labelledby="accounts-title">
    <h2 id="accounts-title">Учётные записи</h2>
    <p className="field-hint">Найдите игрока по имени, затем выберите действие. На странице до 20 записей.</p>
    <form className="account-search" onSubmit={submitSearch} noValidate>
      <div className="field">
        <label htmlFor="account-search">Поиск по имени пользователя</label>
        <input id="account-search" type="search" autoComplete="off" autoCapitalize="none" spellCheck={false} value={search} disabled={locked} onChange={(event) => setSearch(event.target.value)} aria-invalid={Boolean(searchError)} aria-describedby="account-search-error" />
        <span id="account-search-error" className="field-error">{searchError}</span>
      </div>
      <button type="submit" disabled={locked}>Найти</button>
    </form>
    <div ref={result} tabIndex={-1} className="account-result">
      {message && <p className={`form-message ${reviewRequired ? 'error' : ''}`} role="status">{message}</p>}
      {issuedCode && <section className="reset-code" aria-labelledby="issued-code-title">
        <h3 id="issued-code-title">Код для {issuedCode.username}</h3>
        <p>Передайте этот код игроку лично. Он показывается только сейчас и действует до {date(issuedCode.expiresAt)}.</p>
        <p className="recovery-secret"><code>{issuedCode.code}</code></p>
        <p className="field-hint">Игрок открывает /reset-password и выбирает свой новый пароль. После закрытия код нельзя посмотреть снова; можно выдать новый.</p>
        <button className="button-secondary" type="button" onClick={() => setIssuedCode(null)}>Скрыть код</button>
      </section>}
    </div>
    {reviewRequired && <p className="form-message error">Исход действия неизвестен. Перед следующим действием обновите список и историю. Утерянный код нельзя получить повторно; новый код отменит предыдущий.</p>}
    <div className="account-toolbar">
      <button type="button" className="button-secondary" disabled={locked} onClick={refresh}>Обновить список и историю</button>
    </div>
    <div aria-busy={list.phase === 'loading'}>
      {list.phase === 'loading' ? <p role="status">Загружаем учётные записи…</p> : list.phase === 'error' ? <p className="form-message error" role="alert">{list.message}</p> : <>
        <p className="field-hint">Найдено: {list.data.total}. Действующих администраторов: {list.data.activeAdministrators}.</p>
        {list.data.accounts.length ? <ul className="managed-accounts">
          {list.data.accounts.map((entry) => <li key={entry.id}><button type="button" className="account-row button-secondary" aria-pressed={selectedId === entry.id} disabled={locked} onClick={() => {
            setSelectedId(entry.id); setAuditPage(1); setConfirmation(null); setIssuedCode(null); setMessage('');
          }}><strong>{entry.username}{entry.id === userId ? ' (вы)' : ''}</strong><span>{roleName(entry.role)} · {statusName(entry)}</span></button></li>)}
        </ul> : <p>Учётных записей по этому запросу нет.</p>}
        <Pagination label="Страницы учётных записей" page={query.page} total={list.data.total} disabled={locked} change={(page) => { clearSelection(); setQuery({ ...query, page }); }} />
      </>}
    </div>
    {selected && <section className="managed-account" aria-labelledby="selected-account-title">
      <h3 id="selected-account-title" ref={detailHeading} tabIndex={-1}>{selected.username}</h3>
      <dl className="session-details account-metadata">
        <dt>Роль</dt><dd>{roleName(selected.role)}</dd>
        <dt>Состояние</dt><dd>{statusName(selected)}</dd>
        <dt>Создана</dt><dd>{date(selected.createdAt)}</dd>
        {selected.resetExpiresAt && <><dt>Срок текущего кода</dt><dd>{date(selected.resetExpiresAt)}</dd></>}
      </dl>
      <p className="field-hint">Изменение роли, приостановка и выдача кода завершают прежние сеансы игрока. Последний действующий администратор защищён сервером.</p>
      <div className="account-toolbar account-actions">
        <button type="button" className="button-secondary" disabled={!mayAct || lastAdministrator(selected, list)} onClick={() => prepare('role', selected)}>{selected.role === 'ADMIN' ? 'Сделать игроком' : 'Назначить администратором'}</button>
        <button type="button" className="button-secondary" disabled={!mayAct || !selected.suspendedAt && lastAdministrator(selected, list)} onClick={() => prepare('suspension', selected)}>{selected.suspendedAt ? 'Возобновить доступ' : 'Приостановить доступ'}</button>
        <button type="button" className="button-secondary" disabled={!mayAct || selected.id === userId || Boolean(selected.suspendedAt) || lastAdministrator(selected, list)} aria-describedby={selected.id === userId ? 'own-reset-hint' : undefined} onClick={() => prepare('reset', selected)}>Выдать код восстановления</button>
      </div>
      {selected.suspendedAt && <p className="field-hint">Чтобы восстановить пароль, сначала возобновите доступ. Код должен быть выдан активной учётной записи.</p>}
      {selected.id === userId && <p id="own-reset-hint" className="field-hint">Для восстановления своего пароля обратитесь к другому администратору: выдача кода завершит ваш сеанс и закроет его показ.</p>}
      {lastAdministrator(selected, list) && <p className="field-hint">Это последний действующий администратор. Сначала назначьте другого администратора с открытым доступом и действующим паролем.</p>}
      {confirmation && <section className="account-confirmation" aria-labelledby="confirmation-title">
        <h4 id="confirmation-title">{confirmationTitle(confirmation)} — {confirmation.account.username}?</h4>
        <p>{confirmation.action === 'reset' ? 'Старый пароль перестанет работать. Игрок получит доступ после ввода нового пароля с одноразовым кодом.' : 'Прежние сеансы этой учётной записи будут завершены.'}{confirmation.account.id === userId ? ' Это ваша учётная запись: панель закроется, потребуется новый вход.' : ''}</p>
        <div className="account-toolbar">
          <button type="button" className="button-secondary" ref={cancelButton} disabled={pending} onClick={() => { setConfirmation(null); detailHeading.current?.focus(); }}>Отмена</button>
          <button type="button" disabled={!mayAct} onClick={() => void mutate()}>{pending ? 'Сохраняем…' : 'Подтвердить'}</button>
        </div>
      </section>}
      <section className="account-audit" aria-labelledby="account-audit-title" aria-busy={audit.phase === 'loading'}>
        <h4 id="account-audit-title">История действий</h4>
        {audit.phase === 'loading' ? <p role="status">Загружаем историю…</p> : audit.phase === 'error' ? <p className="form-message error" role="alert">{audit.message}</p> : <>
          {audit.data.events.length ? <ol className="audit-events">{audit.data.events.map((entry) => <li key={entry.id}>
            <p>{auditDescription(entry)}</p><p className="field-hint"><time dateTime={entry.createdAt}>{date(entry.createdAt)}</time> · {entry.actor?.username ?? 'Игрок через код восстановления'}</p>
          </li>)}</ol> : <p className="field-hint">Действий пока нет.</p>}
          <Pagination label="Страницы истории" page={auditPage} total={audit.data.total} disabled={locked} change={(page) => { setAuditPage(page); setConfirmation(null); }} />
        </>}
      </section>
    </section>}
    {selectedId && !selected && list.phase === 'ready' && <p className="field-hint">Выбранная запись отсутствует на этой странице. Найдите её заново.</p>}
  </section>;
}

function Pagination({ label, page, total, disabled, change }: { label: string; page: number; total: number; disabled: boolean; change: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / 20));
  return <nav className="account-pagination" aria-label={label}>
    <button type="button" className="button-secondary" disabled={disabled || page <= 1} onClick={() => change(page - 1)}>Назад</button>
    <span>Страница {page} из {last}</span>
    <button type="button" className="button-secondary" disabled={disabled || page >= last} onClick={() => change(page + 1)}>Далее</button>
  </nav>;
}
function lastAdministrator(account: AdminAccount, list: Load<AdminAccountsResponse>): boolean {
  return account.role === 'ADMIN' && !account.suspendedAt && !account.passwordResetRequired && list.phase === 'ready' && list.data.activeAdministrators <= 1;
}
function roleName(role: 'ADMIN' | 'PLAYER'): string { return role === 'ADMIN' ? 'Администратор' : 'Игрок'; }
function statusName(account: AdminAccount): string {
  return [account.suspendedAt ? 'Доступ приостановлен' : 'Доступ открыт', ...(account.passwordResetRequired ? ['Требуется новый пароль'] : [])].join(' · ');
}
function date(value: string): string { return new Date(value).toLocaleString('ru-RU'); }
function confirmationTitle(choice: Confirmation): string {
  if (choice.action === 'role') return choice.account.role === 'ADMIN' ? 'Сделать игроком' : 'Назначить администратором';
  if (choice.action === 'suspension') return choice.account.suspendedAt ? 'Возобновить доступ' : 'Приостановить доступ';
  return 'Выдать новый код восстановления';
}
function auditDescription(entry: AccountAuditEntry): string {
  if (entry.action === 'ROLE_CHANGED') return `Роль изменена: ${roleName(entry.fromRole)} → ${roleName(entry.toRole)}.`;
  if (entry.action === 'SUSPENDED') return 'Доступ приостановлен.';
  if (entry.action === 'RESUMED') return 'Доступ возобновлён.';
  return entry.action === 'PASSWORD_RESET_ISSUED' ? 'Выдан код восстановления пароля.' : 'Новый пароль установлен.';
}
function notifyTabs(): void { try { sessionChanges?.postMessage('changed'); } catch { /* The next foreground check also restores the session. */ } }
