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
  createUser: (t: string, payload: { email: string; password?: string; role?: string; plan_type?: string; send_invite?: boolean }) =>
    post('/admin/users', t, payload),
  sendLink: (t: string, id: string) =>
    post('/admin/users/' + id + '/send-link', t, {}),
  editUser: (t: string, id: string, patch: { email?: string; role?: string; plan_type?: string }) =>
    put('/admin/users/' + id, t, { ...patch, confirmed: true }),
  deleteUser: (t: string, id: string) =>
    fetch(`https://atennaplugin.maestro-n8n.site/admin/users/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ confirmed: true }),
    }).then(r => r.json()),
  featureFlags: (t: string) => get<FlagsResponse>('/admin/feature-flags', t),
  setFlag: (t: string, name: string, enabled: boolean) =>
    put('/admin/feature-flags/' + name, t, { enabled, confirmed: true }),
  system: (t: string) => get<SystemInfo>('/admin/system', t),
  dlp: (t: string) => get<DlpStats>('/admin/dlp', t),
  errors: (t: string, page = 1) => get<ErrorsResponse>(`/admin/errors?page=${page}`, t),
  audit: (t: string, page = 1) => get<AuditResponse>(`/admin/audit?page=${page}`, t),
  costs: (t: string) => get<CostSummary>('/admin/costs', t),
  usage: (t: string, search = '', sort = 'cost_desc') =>
    get<UsageResponse>(`/admin/usage?search=${encodeURIComponent(search)}&sort=${sort}`, t),
  plansConfig: (t: string) => get<PlansConfigResponse>('/admin/plans/config', t),
  plansUsers: (t: string, plan = '', status = '', search = '') =>
    get<{ data: PlanUserRow[]; total: number }>(`/admin/plans/users?plan_filter=${plan}&status_filter=${status}&search=${encodeURIComponent(search)}`, t),
  assignPlan: (t: string, payload: { user_id: string; plan_type: string; billing_period: string; status: string; notes: string }) =>
    post('/admin/plans/assign', t, { ...payload, confirmed: true }),
  updatePlanStatus: (t: string, user_id: string, status: string, notes = '') =>
    fetch(`https://atennaplugin.maestro-n8n.site/admin/plans/${user_id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ status, notes, confirmed: true }),
    }).then(r => r.json()),
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
  cost_estimate_brl: number;
  usd_brl_rate: number;
  cf_requests_today: number;
  status: { backend: string; supabase: string; openai: string; gemini: string };
}

export interface UsageRow {
  user_id: string;
  email: string;
  plan: string;
  role: string;
  last_sign_in: string | null;
  scans_total: number;
  protected: number;
  tokens_dlp: number;
  tokens_cf: number;
  cost_usd: number;
  cost_brl: number;
}

export interface UsageResponse {
  data: UsageRow[];
  total_users: number;
  total_cost_usd: number;
  total_cost_brl: number;
  total_tokens: number;
  usd_brl_rate: number;
}

export interface PlanUserRow {
  user_id: string;
  email: string;
  plan_type: string;
  billing_period: string;
  status: string;
  notes: string;
  updated_at: string | null;
  price_brl: number;
  features: string[];
  quota_daily: number;
}

export interface PlanConfig {
  price_brl_monthly: number;
  price_brl_annual: number;
  quota_daily: number;
  features: string[];
}

export interface PlansConfigResponse {
  plans: Record<string, PlanConfig>;
  usd_brl_rate: number;
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

export interface CfProviderStats {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  model: string;
}

export interface CfMetrics {
  error?: string;
  totals?: {
    requests_cached: number;
    requests_errored: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
  };
  by_provider?: Record<string, CfProviderStats>;
}

export interface CostSummary {
  tokens_estimated_total: number;
  cost_breakdown: { gemini_usd: number; openai_usd: number };
  cloudflare: CfMetrics | null;
  note: string;
}
