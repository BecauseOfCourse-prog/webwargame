import { loadEnvFile } from 'node:process';

export function loadLocalEnvironment(): void {
  try {
    // src/config and dist/config are equally deep below the repository root.
    loadEnvFile(new URL('../../../../.env', import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line preserve-caught-error -- Keep raw environment-file details out of startup logs.
      throw new Error('Could not read the root .env file. Check its path and permissions.');
    }
    // Deployments and tests can provide environment variables without an .env file.
  }
}
