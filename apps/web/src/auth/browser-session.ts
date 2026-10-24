import { AccountApiError } from './account-client.ts';
import { AccountSession } from './account-session.ts';

export const supportsSessionChanges = typeof navigator.locks?.request === 'function';
function createSessionChannel(): BroadcastChannel | null {
  try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel('webwargame-session') : null; }
  catch { return null; }
}
export const sessionChanges = createSessionChannel();

export const browserSession = new AccountSession({
  exclusiveMutation: async (work) => {
    if (!supportsSessionChanges) throw new AccountApiError('Браузер не поддерживает безопасное выполнение входа и выхода.', { code: 'BROWSER_UNSUPPORTED' });
    await navigator.locks.request('webwargame-session-mutation', work);
  },
  onChanged: () => sessionChanges?.postMessage('changed'),
});

if (import.meta.hot) {
  // A new controller must restore once on a fresh mount. React's preserved
  // component effects otherwise keep the old singleton after shared rebuilds.
  import.meta.hot.accept(() => window.location.reload());
  import.meta.hot.dispose(() => sessionChanges?.close());
}
