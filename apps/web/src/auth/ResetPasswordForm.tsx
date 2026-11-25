import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { completePasswordReset, validNewPassword } from '../admin/account-management-client.ts';
import { sessionChanges } from './browser-session.ts';

export function ResetPasswordForm() {
  const [code, setCode] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false); const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current) return;
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) { setMessage('Проверьте код восстановления.'); return; }
    if (!validNewPassword(password)) { setMessage('Введите пароль от 15 до 128 символов без управляющих символов.'); return; }
    if (password !== confirmation) { setMessage('Пароли не совпадают.'); return; }
    submitting.current = true; setBusy(true); setMessage('');
    try { await completePasswordReset({ code, password }); setCode(''); setPassword(''); setConfirmation(''); setSuccess(true);
      setMessage('Пароль изменён. Теперь войдите с новым паролем.'); try { sessionChanges?.postMessage('changed'); } catch { /* Foreground session checks reconcile other tabs. */ }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось изменить пароль.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className="account-panel" aria-labelledby="reset-title" aria-busy={busy}>
    <p className="eyebrow">Восстановление доступа</p><h1 id="reset-title">Новый пароль</h1>
    {success ? <><p className="form-message" role="status">{message}</p><a className="text-link" href="/">Перейти ко входу</a></> : <form className="account-form" onSubmit={submit} noValidate>
      <div className="field"><label htmlFor="reset-code">Одноразовый код</label><input id="reset-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} required /></div>
      <div className="field"><label htmlFor="reset-password">Новый пароль</label><input id="reset-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" disabled={busy} required /><span className="field-hint">15–128 символов. Пробелы разрешены.</span></div>
      <div className="field"><label htmlFor="reset-confirmation">Повторите пароль</label><input id="reset-confirmation" type={showPassword ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" disabled={busy} required /></div>
      <label className="check-field"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} disabled={busy} /> Показать пароль</label>
      {message && <p className="form-message error" role="alert">{message}</p>}<button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль'}</button>
    </form>}
  </section>;
}
