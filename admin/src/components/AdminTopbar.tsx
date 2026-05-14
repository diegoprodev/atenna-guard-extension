const PAGE_LABELS: Record<string, string> = {
  overview: 'Visão Geral',
  users: 'Usuários',
  costs: 'Uso e Custos',
  dlp: 'DLP',
  system: 'Sistema',
  flags: 'Feature Flags',
  errors: 'Erros',
  audit: 'Auditoria',
};

interface Props {
  page: string;
  onLogout: () => void;
  dark: boolean;
  onToggleDark: () => void;
}

export function AdminTopbar({ page, onLogout, dark, onToggleDark }: Props) {
  return (
    <header className="admin-topbar">
      <span className="admin-topbar__title">{PAGE_LABELS[page] ?? page}</span>
      <div className="admin-topbar__right">
        <button className="btn-ghost btn" onClick={onToggleDark} title="Alternar tema">
          {dark ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
        <button className="btn btn-ghost" onClick={onLogout}>Sair</button>
      </div>
    </header>
  );
}
