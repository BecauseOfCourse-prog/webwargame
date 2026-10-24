export const HEALTH_PATH = '/api/health';
export const REGISTRATION_PATH = '/api/auth/register';

export interface RegistrationRequest {
  username: string;
  password: string;
}

export interface RegistrationResponse {
  user: {
    id: string;
    username: string;
    role: 'PLAYER';
    createdAt: string;
  };
}

export interface RegistrationValidationError {
  code: 'INVALID_REGISTRATION';
  message: string;
  fields: Partial<Record<keyof RegistrationRequest | 'body', string[]>>;
}

export interface HealthResponse {
  status: 'ok';
  service: 'wargame-api';
}

export interface ReadinessResponse {
  status: 'ready';
  database: 'ok';
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
