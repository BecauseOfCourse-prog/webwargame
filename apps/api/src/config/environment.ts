import { z } from 'zod';
import { loadLocalEnvironment } from './load-environment.js';

export const DEFAULT_PUBLIC_ORIGIN = 'http://127.0.0.1:5173';

function isPublicOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
  } catch {
    return false;
  }
}

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
  PUBLIC_ORIGIN: z.string().default(DEFAULT_PUBLIC_ORIGIN).refine(isPublicOrigin,
    'must be one HTTPS origin, or a loopback HTTP origin, without credentials, path, query or fragment'),
});

export class RuntimeConfiguration {
  constructor(
    public readonly databaseUrl: string,
    public readonly apiPort: number,
    public readonly publicOrigin: string = DEFAULT_PUBLIC_ORIGIN,
  ) {}

  get secureCookies(): boolean {
    return new URL(this.publicOrigin).protocol === 'https:';
  }
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

  return Object.freeze(new RuntimeConfiguration(result.data.DATABASE_URL, result.data.API_PORT,
    new URL(result.data.PUBLIC_ORIGIN).origin));
}

export function loadConfiguration(): RuntimeConfiguration {
  loadLocalEnvironment();
  return parseEnvironment(process.env);
}
