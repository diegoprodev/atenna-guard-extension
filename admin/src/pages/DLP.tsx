import { useEffect, useState } from 'react';
import { api, DlpStats } from '../api/admin';
import { MetricCard } from '../components/MetricCard';

function fmtK(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function DLP({ token }: { token: string }) {
  const [data, setData] = useState<DlpStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.dlp(token)
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  if (error) return <div className="admin-empty"><div className="admin-empty__title">Erro</div><div className="admin-empty__sub">{error}</div></div>;
  if (!data) return <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>;

  const agg = data.aggregate ?? {};
  const protPct = agg.scans_total > 0
    ? Math.round(agg.protected_count / agg.scans_total * 100)
    : 0;

  return (
    <>
      <div className="admin-page-header">
        <h1>DLP</h1>
        <p>Agregações de detecção de dados sensíveis. Nenhum valor bruto é exibido.</p>
      </div>

      <div className="admin-kpi-grid">
        <MetricCard label="Scans Totais" value={fmtK(agg.scans_total ?? 0)} sub="verificações em tempo real" />
        <MetricCard label="Dados Protegidos" value={fmtK(agg.protected_count ?? 0)} sub="substituições realizadas" color="green" />
        <MetricCard
          label="Taxa de Proteção"
          value={`${protPct}%`}
          sub="protegidos / scans"
          color={protPct >= 70 ? 'green' : protPct >= 40 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Tokens Estimados"
          value={fmtK(agg.tokens_estimated ?? 0)}
          sub="dados ofuscados antes do envio"
        />
        <MetricCard label="Usuários com Dados" value={agg.users_with_data ?? 0} sub="com histórico DLP" />
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Nota de privacidade</span>
        </div>
        <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
          Esta tela exibe apenas contadores e percentuais agregados.
          Nenhum dado pessoal, prompt bruto, CPF, e-mail ou token é armazenado ou exibido aqui.
          Os dados são calculados a partir da tabela <span className="mono">user_dlp_stats</span>,
          que contém exclusivamente métricas numéricas por usuário.
        </div>
      </div>
    </>
  );
}
