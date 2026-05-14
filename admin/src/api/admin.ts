const BASE = 'https://atennaplugin.maestro-n8n.site';

function headers(token: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function get<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: headers(token) });
  if (r.status === 403) throw new Error('forbidden');
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function post<T>(path: string, token: string, body: object): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (r.status === 403) throw new Error('forbidden');
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function put<T>(path: string, token: string, body: object): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export const api = {
  overview: (t: string) => get<AdminOverview>('/admin/overview', t),
  users: (t: string, page = 1, search = '') =>
    get<UsersResponse>(`/admin/users?page=${page}&search=${encodeURIComponent(search)}`, t),
  user: (t: string, id: string) => get<AdminUser>(`/admin/users/${id}`, t),
  blockUser: (t: string, id: string) =>
    post('/admin/users/' + id + '/block', t, { confirmed: true }),
  revokeSession: (t: string, id: string) =>
    post('/admin/users/' + id + '/revoke-session', t, { confirmed: true }),
  resetQuota: (t: string, id: string) =>
    post('/admin/users/' + id + '/reset-quota', t, { confirmed: true }),
  updatePlan: (t: string, id: string, plan: string) =>
    put('/admin/users/' + id + '/plan', t, { plan_type: plan, confirmed: true }),
  featureFlags: (t: string) => get<FlagsResponse>('/admin/feature-flags', t),
  setFlag: (t: string, name: string, enabled: boolean) =>
    put('/admin/feature-flags/' + name, t, { enabled, confirmed: true }),
  system: (t: string) => get<SystemInfo>('/admin/system', t),
  dlp: (t: string) => get<DlpStats>('/admin/dlp', t),
  errors: (t: string, page = 1) => get<ErrorsResponse>(`/admin/errors?page=${page}`, t),
  audit: (t: string, page = 1) => get<AuditResponse>(`/admin/audit?page=${page}`, t),
  costs: (t: string) => get<CostSummary>('/admin/costs', t),
};

export interface AdminOverview {
  users_total: number;
  users_active_today: number;
  prompts_today: number;
  uploads_analyzed: number;
  dlp_scans_total: number;
  dlp_protected_total: number;
  errors_5xx_today: number;
  cost_estimate_usd: number;
  status: { backend: string; supabase: string; openai: string; gemini: string };
}

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
  role: string | null;
  plan_type: string | null;
}

export interface UsersResponse {
  data: AdminUser[];
  total: number;
  page: number;
}

export interface FlagRow {
  name: string;
  enabled: boolean;
  description: string;
  updated_by: string | null;
  updated_at: string;
}

export interface FlagsResponse {
  data: FlagRow[];
}

export interface SystemInfo {
  uptime_seconds: number;
  health_latency_ms: number | null;
  memory: { total_mb: number; used_mb: number; free_mb: number };
  disk: { total_gb: number; used_pct: number };
  container_status: string;
  backend_status: string;
}

export interface DlpStats {
  aggregate: {
    scans_total: number;
    protected_count: number;
    tokens_estimated: number;
    users_with_data: number;
  };
}

export interface ErrorEvent {
  id: string;
  status_code: number;
  endpoint: string;
  method: string;
  error_type: string;
  error_message: string;
  severity: string;
  created_at: string;
  correlation_id: string | null;
}

export interface ErrorsResponse { data: ErrorEvent[]; total: number; }

export interface AuditEvent {
  id: string;
  actor_id: string;
  action: string;
  target_id: string | null;
  after: object | null;
  correlation_id: string | null;
  created_at: string;
}

export interface AuditResponse { data: AuditEvent[]; total: number; }

export interface CostSummary {
  tokens_estimated_total: number;
  cost_breakdown: { gemini_usd: number; openai_usd: number };
  note: string;
}
