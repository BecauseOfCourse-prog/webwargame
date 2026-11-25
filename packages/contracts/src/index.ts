export const HEALTH_PATH = '/api/health';
export const REGISTRATION_PATH = '/api/auth/register';
export const LOGIN_PATH = '/api/auth/login';
export const CURRENT_USER_PATH = '/api/auth/me';
export const LOGOUT_PATH = '/api/auth/logout';
export const ADMIN_OVERVIEW_PATH = '/api/admin/overview';
export const ADMIN_ASSETS_PATH = '/api/admin/assets';
export const ADMIN_ACCOUNTS_PATH = '/api/admin/accounts';
export const RESET_PASSWORD_PATH = '/api/auth/reset-password';

export interface AdminAccount {
  id: string;
  username: string;
  role: 'PLAYER' | 'ADMIN';
  suspendedAt: string | null;
  passwordResetRequired: boolean;
  resetExpiresAt: string | null;
  version: number;
  createdAt: string;
}
export interface AdminAccountsResponse {
  accounts: AdminAccount[];
  page: number;
  pageSize: 20;
  total: number;
  activeAdministrators: number;
}
export interface AdminAccountResponse { account: AdminAccount; }
export interface AdminResetResponse extends AdminAccountResponse { code: string; expiresAt: string; }
export type AccountAuditAction = 'ROLE_CHANGED' | 'SUSPENDED' | 'RESUMED' | 'PASSWORD_RESET_ISSUED' | 'PASSWORD_RESET_COMPLETED';
export interface AccountAuditEntry {
  id: string;
  actor: { id: string; username: string } | null;
  targetId: string;
  action: AccountAuditAction;
  fromRole: 'PLAYER' | 'ADMIN';
  toRole: 'PLAYER' | 'ADMIN';
  fromSuspended: boolean;
  toSuspended: boolean;
  createdAt: string;
}
export interface AccountAuditResponse { events: AccountAuditEntry[]; page: number; pageSize: 20; total: number; }
export interface ResetPasswordRequest { code: string; password: string; }

export interface AssetMetadata {
  id: string;
  uploadedById: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  createdAt: string;
}

export interface AssetResponse {
  asset: AssetMetadata;
}

export interface AssetLifecycleResponse extends AssetResponse {
  archivedAt: string | null;
  unreferencedSince: string | null;
  referenceCount: number;
}

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
