import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { isAbsolute, parse, relative, resolve } from 'node:path';
import { loadLocalEnvironment } from './load-environment.js';

export const DEFAULT_PUBLIC_ORIGIN = 'http://127.0.0.1:5173';
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export interface UploadConfiguration {
  directory: string;
  maxBytes: number;
  maxSide: number;
  maxPixels: number;
  maxDiskBytes: number;
  minFreeBytes: number;
}
export const DEFAULT_UPLOADS: Readonly<UploadConfiguration> = Object.freeze({
  directory: resolve(repositoryRoot, '.local/uploads'),
  maxBytes: 10 * 1024 * 1024,
  maxSide: 8192,
  maxPixels: 24_000_000,
  maxDiskBytes: 1024 * 1024 * 1024,
  minFreeBytes: 64 * 1024 * 1024,
});

function isPrivateDirectory(value: string): boolean {
  if (!isAbsolute(value) || value.includes('\0') || resolve(value) === parse(value).root ||
      resolve(value) === resolve(repositoryRoot)) return false;
  return !['apps', 'packages', 'node_modules', '.git', 'docs'].some((name) => {
    const child = relative(resolve(repositoryRoot, name), resolve(value));
    return child === '' || (!child.startsWith('..') && !isAbsolute(child));
  });
}

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
  UPLOAD_DIRECTORY: z.string().default(DEFAULT_UPLOADS.directory).refine(isPrivateDirectory,
    'must be an absolute private data directory outside application/source directories'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).max(50 * 1024 * 1024).default(DEFAULT_UPLOADS.maxBytes),
  UPLOAD_MAX_SIDE: z.coerce.number().int().min(1).max(16384).default(DEFAULT_UPLOADS.maxSide),
  UPLOAD_MAX_PIXELS: z.coerce.number().int().min(1).max(64_000_000).default(DEFAULT_UPLOADS.maxPixels),
  UPLOAD_MAX_DISK_BYTES: z.coerce.number().int().min(1).max(1024 ** 4).default(DEFAULT_UPLOADS.maxDiskBytes),
  UPLOAD_MIN_FREE_BYTES: z.coerce.number().int().min(0).max(1024 ** 4).default(DEFAULT_UPLOADS.minFreeBytes),
});

export class RuntimeConfiguration {
  readonly uploads: Readonly<UploadConfiguration>;
  constructor(
    public readonly databaseUrl: string,
    public readonly apiPort: number,
    public readonly publicOrigin: string = DEFAULT_PUBLIC_ORIGIN,
    uploads: Partial<UploadConfiguration> = {},
  ) {
    this.uploads = Object.freeze({ ...DEFAULT_UPLOADS, ...uploads });
  }

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
    new URL(result.data.PUBLIC_ORIGIN).origin, {
      directory: result.data.UPLOAD_DIRECTORY, maxBytes: result.data.UPLOAD_MAX_BYTES,
      maxSide: result.data.UPLOAD_MAX_SIDE, maxPixels: result.data.UPLOAD_MAX_PIXELS,
      maxDiskBytes: result.data.UPLOAD_MAX_DISK_BYTES, minFreeBytes: result.data.UPLOAD_MIN_FREE_BYTES,
    }));
}

export function loadConfiguration(): RuntimeConfiguration {
  loadLocalEnvironment();
  return parseEnvironment(process.env);
}
