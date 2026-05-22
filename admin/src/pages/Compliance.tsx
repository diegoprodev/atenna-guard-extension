import { useEffect, useState } from 'react';
import {
  api,
  ComplianceSummaryData,
  ComplianceTrendPoint,
  ComplianceEventRow,
} from '../api/admin';
import { MetricCard } from '../components/MetricCard';

const RISK_LABELS: Record<string, string> = {
  HIGH: 'Alto', MEDIUM: 'Médio', LOW: 'Baixo', NONE: 'Nenhum', UNKNOWN: 'Desconhecido',
};

const RISK_COLORS: Record<string, string> = {
  HIGH: '#ef4444', MEDIUM: '#f97316', LOW: '#eab308', NONE: '#6b7280', UNKNOWN: '#6b7280',
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

const BASE = 'https://atennaplugin.maestro-n8n.site';

export function Compliance({ token }: { token: string }) {
  const [days, setDays] = useState(30);
  const [riskFilter, setRiskFilter] = useState('');
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<ComplianceSummaryData | null>(null);
  const [trend, setTrend] = useState<ComplianceTrendPoint[]>([]);
  const [events, setEvents] = useState<ComplianceEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const LIMIT = 50;

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api.compliance(token, days),
      api.complianceEvents(token, days, page, riskFilter),
    ])
      .then(([sumData, evData]) => {
        if (sumData.error) { setError(sumData.error); return; }
        setSummary(sumData.summary);
        setTrend(sumData.trend ?? []);
        setRetentionDays(sumData.retention_days ?? 90);
        setEvents(evData.data ?? []);
        setTotal(evData.total ?? 0);
      })
      .catch(e => setError(e.message ?? 'Erro ao carregar dados.'))
      .finally(() => setLoading(false));
  }, [token, days, page, riskFilter]);

  function handleExportCSV() {
    const url = `${BASE}/admin/compliance/export.csv?days=${days}${riskFilter ? `&risk_level=${riskFilter}` : ''}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dlp-audit-${days}d.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => {});
  }

  const totalPages = Math.ceil(total / LIMIT);

  if (error) return (
    <div className="admin-empty">
      <div className="admin-empty__title">Erro</div>
      <div className="admin-empty__sub">{error}</div>
    </div>
  );

  return (
    <>
      <div className="admin-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>Compliance</h1>
          <p>Audit Trail DLP — retenção de {retentionDays} dias (LGPD art. 37)</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={days}
            onChange={e => { setDays(Number(e.target.value)); setPage(1); }}
            style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)' }}
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button
            onClick={handleExportCSV}
            style={{ fontSize: 13, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer' }}
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {loading && !summary ? (
        <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
      ) : summary && (
        <>
          <div className="admin-kpi-grid">
            <MetricCard label="Total de Eventos" value={summary.total_events} sub={`últimos ${days} dias`} />
            <MetricCard label="Alto Risco" value={summary.high_risk_events} sub="detecções HIGH" color={summary.high_risk_events > 0 ? 'amber' : 'default'} />
            <MetricCard label="Taxa de Proteção" value={`${summary.protection_rate}%`} sub="eventos com reescrita" color={summary.protection_rate >= 50 ? 'green' : 'default'} />
            <MetricCard label="Usuários Ativos" value={summary.unique_users} sub="com eventos DLP" />
          </div>

          {summary.top_entity_types.length > 0 && (
            <div className="admin-card">
              <div className="admin-card__header">
                <span className="admin-card__title">PII Mais Detectados</span>
              </div>
              <div style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {summary.top_entity_types.map(et => (
                  <span key={et.type} style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    background: 'var(--bg-3)', border: '1px solid var(--border)',
                    color: 'var(--text-1)',
                  }}>
                    {et.type} <span style={{ color: 'var(--text-2)', marginLeft: 4 }}>{et.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {trend.length > 0 && (
            <div className="admin-card">
              <div className="admin-card__header">
                <span className="admin-card__title">Tendência ({days} dias)</span>
              </div>
              <div style={{ padding: '12px 20px', display: 'flex', gap: 4, alignItems: 'flex-end', height: 60 }}>
                {(() => {
                  const maxVal = Math.max(...trend.map(t => t.total), 1);
                  return trend.map(t => (
                    <div key={t.date} title={`${t.date}: ${t.total} total, ${t.high_risk} alto risco`}
                      style={{
                        flex: 1, minWidth: 2, maxWidth: 12,
                        height: `${Math.max(4, Math.round((t.total / maxVal) * 100))}%`,
                        background: t.high_risk > 0 ? '#ef4444' : '#6366f1',
                        borderRadius: 2, opacity: 0.8,
                      }}
                    />
                  ));
                })()}
              </div>
              <div style={{ padding: '4px 20px 12px', fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ marginRight: 12 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#6366f1', marginRight: 4 }} />
                  Normal
                </span>
                <span>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#ef4444', marginRight: 4 }} />
                  Alto Risco
                </span>
              </div>
            </div>
          )}
        </>
      )}

      <div className="admin-card">
        <div className="admin-card__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="admin-card__title">Audit Trail — {total.toLocaleString('pt-BR')} eventos</span>
          <select
            value={riskFilter}
            onChange={e => { setRiskFilter(e.target.value); setPage(1); }}
            style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)' }}
          >
            <option value="">Todos os riscos</option>
            <option value="HIGH">Alto</option>
            <option value="MEDIUM">Médio</option>
            <option value="LOW">Baixo</option>
            <option value="NONE">Nenhum</option>
          </select>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Data/Hora', 'Usuário', 'Risco', 'PII Detectado', 'Protegido', 'Plataforma'].map(h => (
                <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>Nenhum evento encontrado.</td></tr>
            ) : events.map(ev => (
              <tr key={ev.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 16px', color: 'var(--text-1)', fontFamily: 'monospace', fontSize: 12 }}>{fmtDate(ev.created_at)}</td>
                <td style={{ padding: '8px 16px', color: 'var(--text-2)', fontFamily: 'monospace', fontSize: 12 }}>{ev.user_id ? ev.user_id.slice(0, 8) + '…' : '—'}</td>
                <td style={{ padding: '8px 16px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                    color: '#fff', background: RISK_COLORS[ev.risk_level] ?? RISK_COLORS.UNKNOWN,
                  }}>
                    {RISK_LABELS[ev.risk_level] ?? ev.risk_level}
                  </span>
                </td>
                <td style={{ padding: '8px 16px', color: 'var(--text-1)', fontSize: 12 }}>{ev.entity_types?.join(', ') || '—'}</td>
                <td style={{ padding: '8px 16px', fontSize: 12 }}>
                  {ev.was_rewritten
                    ? <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ Sim</span>
                    : <span style={{ color: 'var(--text-2)' }}>Não</span>}
                </td>
                <td style={{ padding: '8px 16px', color: 'var(--text-2)', fontSize: 12 }}>{ev.platform ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-2)' }}>
            <span>Página {page} de {totalPages}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1}
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>
                Anterior
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1 }}>
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="admin-card">
        <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
          Esta tela exibe metadados de eventos DLP (tipo, risco, plataforma).
          Nenhum prompt bruto, CPF, e-mail ou valor pessoal é armazenado ou exibido.
          User IDs são truncados. Exportação CSV para auditoria LGPD (art. 37).
        </div>
      </div>
    </>
  );
}
