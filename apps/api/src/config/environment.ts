import { z } from 'zod';
import { loadLocalEnvironment } from './load-environment.js';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'is required').refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
        url.hostname.length > 0 &&
        url.username.length > 0 &&
        url.password.length > 0 &&
        url.pathname.length > 1
      );
    } catch {
      return false;
    }
  }, 'must be a PostgreSQL URL with host, database, username and password'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export class RuntimeConfiguration {
  constructor(
    public readonly databaseUrl: string,
    public readonly apiPort: number,
  ) {}
}

export function parseEnvironment(environment: NodeJS.ProcessEnv): RuntimeConfiguration {
  const result = schema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    // Report field names and constraints, never input values or connection URLs.
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return Object.freeze(new RuntimeConfiguration(result.data.DATABASE_URL, result.data.API_PORT));
}

export function loadConfiguration(): RuntimeConfiguration {
  loadLocalEnvironment();
  return parseEnvironment(process.env);
}
