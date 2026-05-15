import { useState, useEffect } from 'react';
import { AdminLayout } from './components/AdminLayout';
import { Overview } from './pages/Overview';
import { Users } from './pages/Users';
import { FeatureFlags } from './pages/FeatureFlags';
import { System } from './pages/System';
import { DLP } from './pages/DLP';
import { Costs } from './pages/Costs';
import { Errors } from './pages/Errors';
import { Audit } from './pages/Audit';
import { UsageCosts } from './pages/UsageCosts';
import { Plans } from './pages/Plans';
import { Login } from './pages/Login';

const TOKEN_KEY = 'atenna_admin_token';

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [page, setPage] = useState('overview');
  const [dark, setDark] = useState(getSystemDark);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
  }, [dark]);

  function handleLogin(t: string) {
    sessionStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }

  function handleLogout() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setPage('overview');
  }

  if (!token) return <Login onLogin={handleLogin} />;

  const PAGE_MAP: Record<string, React.ReactNode> = {
    overview: <Overview token={token} />,
    users:    <Users token={token} />,
    costs:    <Costs token={token} />,
    dlp:      <DLP token={token} />,
    system:   <System token={token} />,
    flags:    <FeatureFlags token={token} />,
    errors:   <Errors token={token} />,
    audit:    <Audit token={token} />,
    usage:    <UsageCosts token={token} />,
    plans:    <Plans token={token} />,
  };

  return (
    <AdminLayout
      page={page}
      onNavigate={setPage}
      onLogout={handleLogout}
      dark={dark}
      onToggleDark={() => setDark(d => !d)}
    >
      {PAGE_MAP[page] ?? <Overview token={token} />}
    </AdminLayout>
  );
}
