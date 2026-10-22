export const HEALTH_PATH = '/api/health';

export interface HealthResponse {
  status: 'ok';
  service: 'wargame-api';
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok' &&
    'service' in value &&
    value.service === 'wargame-api'
  );
}
