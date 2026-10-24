import type { LoginRequest, SessionResponse } from '@webwargame/contracts';
import { AccountApiError, getCurrentSession, loginAccount, logoutAccount } from './account-client.ts';

export interface AccountSessionSnapshot {
  phase: 'checking' | 'anonymous' | 'authenticated' | 'unavailable';
  session: SessionResponse | null;
  busy: null | 'restore' | 'login' | 'logout';
  notice: string | null;
}

export interface AccountSessionApi {
  getCurrentSession(): Promise<SessionResponse>;
  loginAccount(input: LoginRequest): Promise<SessionResponse>;
  logoutAccount(csrfToken: string): Promise<void>;
}

interface AccountSessionDependencies {
  api?: AccountSessionApi;
  exclusiveMutation?: (action: () => Promise<void>) => Promise<void>;
  onChanged?: () => void;
  now?: () => number;
}

const EXPIRED_NOTICE = 'Сеанс завершён. Войдите снова.';
const UNAVAILABLE_NOTICE = 'Не удалось проверить сеанс. Проверьте соединение и попробуйте ещё раз.';
const SIGNED_OUT_NOTICE = 'Вы вышли из аккаунта.';

/** In-memory browser identity. Cookies and server permissions remain authoritative. */
export class AccountSession {
  private snapshot: AccountSessionSnapshot = { phase: 'checking', session: null, busy: null, notice: null };
  private readonly listeners = new Set<() => void>();
  private readonly api: AccountSessionApi;
  private readonly exclusiveMutation: (action: () => Promise<void>) => Promise<void>;
  private readonly onChanged: () => void;
  private readonly now: () => number;
  private generation = 0;
  private mutating = false;
  private invalidatedDuringMutation = false;
  private restoring: { generation: number; promise: Promise<void> } | undefined;

  constructor(dependencies: AccountSessionDependencies = {}) {
    this.api = dependencies.api ?? { getCurrentSession, loginAccount, logoutAccount };
    this.exclusiveMutation = dependencies.exclusiveMutation ?? ((action) => action());
    this.onChanged = dependencies.onChanged ?? (() => undefined);
    this.now = dependencies.now ?? Date.now;
  }

  getSnapshot = (): AccountSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  restore(invalidatePending = false): Promise<void> {
    if (this.mutating) {
      if (invalidatePending) this.invalidatedDuringMutation = true;
      return Promise.resolve();
    }
    if (invalidatePending) ++this.generation;
    if (this.restoring?.generation === this.generation) return this.restoring.promise;
    const generation = this.generation;
    const previouslyAuthenticated = this.snapshot.session !== null;
    this.publish({ ...this.snapshot, busy: 'restore' });
    const promise = this.api.getCurrentSession().then((session) => {
      if (generation === this.generation) this.authenticated(session, null);
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      if (isUnauthorized(error)) this.anonymous(previouslyAuthenticated ? EXPIRED_NOTICE : this.snapshot.notice, null);
      else this.unavailable(null);
    }).finally(() => {
      if (this.restoring?.generation === generation) this.restoring = undefined;
    });
    this.restoring = { generation, promise };
    return promise;
  }

  async login(credentials: LoginRequest): Promise<void> {
    if (this.mutating) return;
    this.mutating = true;
    this.invalidatedDuringMutation = false;
    const generation = ++this.generation;
    const previous = this.snapshot;
    this.publish({ ...previous, busy: 'login', notice: null });
    try {
      await this.exclusiveMutation(async () => {
        try {
          this.authenticated(await this.api.loginAccount(credentials), 'login');
          this.changed();
        } catch (error) {
          if (!isAmbiguous(error) && this.invalidatedDuringMutation) {
            // A failed login leaves the shared cookie unchanged. A marker or
            // foreground return while waiting for the lock may refer to a
            // different tab's successful action, so the old snapshot is stale.
            const reconciled = await this.reconcile('login');
            if (reconciled === 'authenticated') {
              this.publish({ ...this.snapshot, notice: 'Вход с введёнными данными не выполнен. Восстановлен текущий сеанс.' });
            }
          } else if (isUnauthorized(error) && !isAmbiguous(error)) {
            this.anonymous(null, 'login');
          } else if (isAmbiguous(error)) {
            // A missing/malformed response does not prove that Set-Cookie failed.
            // Keep the mutation lock until the actual cookie has been checked.
            const reconciled = await this.reconcile('login');
            this.changed();
            if (reconciled === 'authenticated') {
              this.publish({ ...this.snapshot, notice: 'Ответ на вход не получен. Проверьте восстановленную учётную запись.' });
              return;
            }
          } else {
            this.publish({ ...previous, phase: previous.phase === 'checking' ? 'anonymous' : previous.phase, busy: 'login' });
          }
          throw error;
        }
      });
    } finally {
      this.invalidatedDuringMutation = false;
      this.mutating = false;
      if (generation === this.generation) this.publish({ ...this.snapshot, busy: null });
    }
  }

  async logout(): Promise<void> {
    if (this.mutating) return;
    this.mutating = true;
    this.invalidatedDuringMutation = false;
    const generation = ++this.generation;
    this.publish({ ...this.snapshot, busy: 'logout', notice: null });
    try {
      await this.exclusiveMutation(async () => {
        // Another tab may have changed the shared cookie while this tab waited
        // for its lock. Obtain its current identity and matching CSRF first.
        const current = await this.reconcile('logout');
        if (current === 'anonymous') {
          this.anonymous(SIGNED_OUT_NOTICE, 'logout');
          this.changed();
          return;
        }
        if (current === 'unavailable' || this.snapshot.session === null) {
          throw new AccountApiError(UNAVAILABLE_NOTICE, { code: 'SESSION_UNAVAILABLE' });
        }
        try {
          await this.api.logoutAccount(this.snapshot.session.csrfToken);
          this.anonymous(SIGNED_OUT_NOTICE, 'logout');
          this.changed();
        } catch (error) {
          if (isUnauthorized(error)) {
            this.anonymous(SIGNED_OUT_NOTICE, 'logout');
            this.changed();
            return;
          }
          const reconciled = await this.reconcile('logout');
          this.changed();
          if (reconciled === 'anonymous') {
            this.anonymous(SIGNED_OUT_NOTICE, 'logout');
            return;
          }
          throw error;
        }
      });
    } finally {
      this.invalidatedDuringMutation = false;
      this.mutating = false;
      if (generation === this.generation) this.publish({ ...this.snapshot, busy: null });
    }
  }

  /** Clear stale display at its known deadline without keeping a session alive. */
  expireIfNeeded(): void {
    const { session, busy } = this.snapshot;
    if (session === null || busy !== null) return;
    if (Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt)) <= this.now()) {
      ++this.generation;
      this.anonymous(EXPIRED_NOTICE, null);
    }
  }

  private async reconcile(busy: 'login' | 'logout'): Promise<'authenticated' | 'anonymous' | 'unavailable'> {
    try {
      this.authenticated(await this.api.getCurrentSession(), busy);
      return 'authenticated';
    } catch (error) {
      if (isUnauthorized(error)) {
        this.anonymous(busy === 'logout' ? SIGNED_OUT_NOTICE : null, busy);
        return 'anonymous';
      }
      this.unavailable(busy);
      return 'unavailable';
    }
  }

  private authenticated(session: SessionResponse, busy: AccountSessionSnapshot['busy']): void {
    this.publish({ phase: 'authenticated', session, busy, notice: null });
  }

  private anonymous(notice: string | null, busy: AccountSessionSnapshot['busy']): void {
    this.publish({ phase: 'anonymous', session: null, busy, notice });
  }

  private unavailable(busy: AccountSessionSnapshot['busy']): void {
    this.publish({ phase: 'unavailable', session: null, busy, notice: UNAVAILABLE_NOTICE });
  }

  private changed(): void {
    try { this.onChanged(); } catch { /* A browser notification failure cannot undo a server action. */ }
  }

  private publish(snapshot: AccountSessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof AccountApiError && error.status === 401;
}

function isAmbiguous(error: unknown): boolean {
  return !(error instanceof AccountApiError) || error.ambiguous;
}
