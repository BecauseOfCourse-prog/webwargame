import { defineConfig } from 'prisma/config';
import { loadLocalEnvironment } from './src/config/load-environment.js';

loadLocalEnvironment();
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Client generation works without a database or credentials; migration commands
  // require DATABASE_URL and will reject a missing datasource configuration.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
