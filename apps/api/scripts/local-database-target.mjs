export function assertLocalDatabaseTarget(connectionString, environment) {
  try {
    const url = new URL(connectionString);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.search !== '' || url.hash !== '' ||
      (url.port || '5432') !== (environment.POSTGRES_PORT || '5432') ||
      decodeURIComponent(url.username) !== environment.POSTGRES_USER ||
      decodeURIComponent(url.password) !== environment.POSTGRES_PASSWORD ||
      decodeURIComponent(url.pathname.slice(1)) !== environment.POSTGRES_DB ||
      !url.username || !url.password || url.pathname.length <= 1
    ) {
      throw new Error();
    }
    return url;
  } catch {
    // Query parameters can override the URL's host/port/user in the pg driver.
    // The opt-in local verifier accepts only the canonical Compose target.
    throw new Error('db:verify requires the matching local Compose URL without query parameters or a fragment.');
  }
}
