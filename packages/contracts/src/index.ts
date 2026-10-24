export const HEALTH_PATH = '/api/health';
export const REGISTRATION_PATH = '/api/auth/register';
export const LOGIN_PATH = '/api/auth/login';
export const CURRENT_USER_PATH = '/api/auth/me';
export const LOGOUT_PATH = '/api/auth/logout';
export const ADMIN_OVERVIEW_PATH = '/api/admin/overview';

export interface AdminOverviewResponse {
  status: 'ready';
  user: { id: string; username: string; role: 'ADMIN' };
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SessionResponse {
  user: { id: string; username: string; role: 'PLAYER' | 'ADMIN' };
  csrfToken: string;
  expiresAt: string;
  idleExpiresAt: string;
}

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
