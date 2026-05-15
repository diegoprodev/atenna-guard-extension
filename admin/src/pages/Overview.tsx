import { useEffect, useState } from 'react';
import { api, AdminOverview } from '../api/admin';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function fmtBRL(brl: number) {
  if (brl === 0) return 'R$ 0,00';
  if (brl < 0.01) return '< R$ 0,01';
  return `R$ ${brl.toFixed(2).replace('.', ',')}`;
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

export function Overview({ token }: { token: string }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.overview(token).then(setData).catch(e => setError(e.message));
  }, [token]);

  if (error) return <div className="admin-empty"><div className="admin-empty__title">Erro ao carregar dados</div><div className="admin-empty__sub">{error}</div></div>;
  if (!data) return <div className="admin-empty"><div className="admin-empty__sub">Carregando dados reais...</div></div>;

  const dlpChartData = [
    { name: 'Scans DLP',      value: data.dlp_scans_total },
    { name: 'Protegidos',     value: data.dlp_protected_total },
    { name: 'Não protegidos', value: Math.max(0, data.dlp_scans_total - data.dlp_protected_total) },
  ];

  const activityData = [
    { name: 'Usuários',      value: data.users_total,        fill: '#6366f1' },
    { name: 'Ativos hoje',   value: data.users_active_today, fill: '#22c55e' },
    { name: 'Scans DLP',     value: data.dlp_scans_total,    fill: '#f59e0b' },
    { name: 'Protegidos',    value: data.dlp_protected_total, fill: '#8b5cf6' },
    { name: 'CF Requests',   value: data.cf_requests_today ?? 0, fill: '#06b6d4' },
  ];

  const usdBrl = data.usd_brl_rate ?? 5.06;
  const costBRL = data.cost_estimate_brl ?? (data.cost_estimate_usd * usdBrl);

  return (
    <>
      <div className="admin-page-header">
        <h1>Visão Geral</h1>
        <p>Dados reais da plataforma Atenna Safe Prompt.</p>
      </div>

      <div className="admin-status-strip">
        <StatusBadge status={data.status.backend}  label={`Backend: ${data.status.backend}`} />
        <StatusBadge status={data.status.supabase} label={`Supabase: ${data.status.supabase}`} />
        <StatusBadge status={data.status.openai}   label={`OpenAI: ${data.status.openai}`} />
        <StatusBadge status={data.status.gemini}   label={`Gemini: ${data.status.gemini}`} />
      </div>

      {/* KPIs */}
      <div className="admin-kpi-grid">
        <MetricCard label="Usuários Total"   value={fmt(data.users_total)}          sub="contas ativas" />
        <MetricCard label="Ativos Hoje"      value={fmt(data.users_active_today)}   sub="último login hoje" />
        <MetricCard label="Scans DLP Hoje"   value={fmt(data.prompts_today)}        sub="eventos DLP registrados" />
        <MetricCard label="Scans DLP Total"  value={fmt(data.dlp_scans_total)}      sub="acumulado" />
        <MetricCard label="Dados Protegidos" value={fmt(data.dlp_protected_total)}  sub="substituições aplicadas" />
        <MetricCard label="CF Requests Hoje" value={fmt(data.cf_requests_today ?? 0)} sub="via AI Gateway" />
        <MetricCard
          label="Erros 5xx Hoje"
          value={String(data.errors_5xx_today)}
          color={data.errors_5xx_today > 0 ? 'red' : 'default'}
          sub="erros de servidor"
        />
        <MetricCard
          label="Custo Total"
          value={fmtBRL(costBRL)}
          sub={`$${data.cost_estimate_usd.toFixed(6)} USD · CF Gateway`}
          color={data.cost_estimate_usd > 10 ? 'amber' : 'default'}
        />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Bar chart — platform activity */}
        <div className="admin-card" style={{ padding: '20px 16px' }}>
          <div className="admin-card__title" style={{ marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            Atividade da Plataforma
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={activityData} barSize={32}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-2)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-2)' }} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-1)', fontWeight: 600 }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {activityData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart — DLP breakdown */}
        <div className="admin-card" style={{ padding: '20px 16px' }}>
          <div className="admin-card__title" style={{ marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            Distribuição DLP
          </div>
          {data.dlp_scans_total === 0 ? (
            <div className="admin-empty" style={{ height: 200 }}>
              <div className="admin-empty__sub">Nenhum scan registrado ainda</div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={dlpChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                  {dlpChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Cost breakdown card */}
      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Custo acumulado · CF Gateway</span>
          <span style={{ fontSize: 12, color: 'var(--green)' }}>● Dados reais</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--border)' }}>
          {[
            { label: 'USD', value: `$${data.cost_estimate_usd.toFixed(6)}` },
            { label: 'BRL', value: fmtBRL(costBRL) },
            { label: 'Taxa hoje', value: `1 USD = R$ ${usdBrl.toFixed(2).replace('.', ',')}` },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--surface)', padding: '14px 20px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
