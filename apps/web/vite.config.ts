import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Read only API-prefixed configuration into this Node-side Vite config.
  // DATABASE_URL and PostgreSQL credentials are never passed to browser code.
  const environment = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), 'API_');
  const port = Number(environment.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid environment configuration: API_PORT must be an integer from 1 to 65535.');
  }
  const proxy = { '/api': { target: `http://127.0.0.1:${port}` } };

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy,
    },
  };
});
