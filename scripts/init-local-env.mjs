import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const password = randomBytes(32).toString('hex');
const content = [
  '# Private local development configuration. Do not commit this file.',
  'POSTGRES_USER=webwargame',
  'POSTGRES_DB=webwargame',
  'POSTGRES_PORT=5432',
  `POSTGRES_PASSWORD=${password}`,
  `DATABASE_URL=postgresql://webwargame:${password}@127.0.0.1:5432/webwargame`,
  'API_PORT=3000',
  'PUBLIC_ORIGIN=http://127.0.0.1:5173',
  '',
].join('\n');

try {
  await writeFile(new URL('../.env', import.meta.url), content, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log('Created private root .env for local development. No credentials were printed.');
} catch (error) {
  if (error.code === 'EEXIST') {
    console.log('Root .env already exists; it was left unchanged.');
  } else {
    throw error;
  }
}
