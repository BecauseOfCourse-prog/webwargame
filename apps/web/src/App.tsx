import { useEffect, useState } from 'react';
import { HEALTH_PATH, isHealthResponse } from '@webwargame/contracts';

type ConnectionState = 'checking' | 'connected' | 'unavailable';

const messages: Record<ConnectionState, string> = {
  checking: 'Проверяем связь с сервером…',
  connected: 'Сервер доступен',
  unavailable: 'Не удалось связаться с сервером. Попробуйте ещё раз.',
};

export function App() {
  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    async function checkConnection(): Promise<void> {
      setConnection('checking');

      try {
        const response = await fetch(HEALTH_PATH, {
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`Health request failed: ${response.status}`);
        }

        const body: unknown = await response.json();

        if (!isHealthResponse(body)) {
          throw new Error('Unexpected health response.');
        }

        if (!disposed) setConnection('connected');
      } catch {
        if (!disposed) setConnection('unavailable');
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkConnection();

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return (
    <main className="page">
      <header className="masthead">
        <span className="brand-mark" aria-hidden="true">⚑</span>
        <span>Web Wargame</span>
        <span className="stage">Начало пути</span>
      </header>

      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">За одним игровым столом</p>
        <h1 id="welcome-title">Варгейм<br />для друзей.</h1>
        <p className="intro">
          Место для ваших сражений, карт и армий.
          Сейчас мы готовим площадку для первой партии.
        </p>

        <div className="connection-card">
          <div className="connection-label">Связь с сервером</div>
          <p className={`connection-state ${connection}`} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {messages[connection]}
          </p>
          <button
            type="button"
            disabled={connection === 'checking'}
            onClick={() => {
              setConnection('checking');
              setAttempt((value) => value + 1);
            }}
          >
            Проверить соединение
          </button>
        </div>
      </section>

      <footer>Карты. Армии. Ваша история.</footer>
    </main>
  );
}
