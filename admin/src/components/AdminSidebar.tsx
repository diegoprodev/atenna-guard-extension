interface Props {
  page: string;
  onNavigate: (page: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const IconGrid = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
);
const IconUsers = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const IconShield = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IconCpu = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
    <line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/>
    <line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/>
    <line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/>
    <line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="15" x2="22" y2="15"/>
  </svg>
);
const IconDollar = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
);
const IconFlag = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
  </svg>
);
const IconAlert = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const IconLog = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
  </svg>
);

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Principal',
    items: [
      { id: 'overview', label: 'Visão Geral', icon: <IconGrid /> },
    ],
  },
  {
    title: 'Operacional',
    items: [
      { id: 'users', label: 'Usuários', icon: <IconUsers /> },
      { id: 'costs', label: 'Uso e Custos', icon: <IconDollar /> },
      { id: 'dlp', label: 'DLP', icon: <IconShield /> },
      { id: 'system', label: 'Sistema', icon: <IconCpu /> },
    ],
  },
  {
    title: 'Financeiro',
    items: [
      { id: 'usage',  label: 'Custo por Usuário', icon: <IconDollar /> },
      { id: 'plans',  label: 'Planos Pro',         icon: <IconFlag /> },
    ],
  },
  {
    title: 'Controle',
    items: [
      { id: 'flags',  label: 'Feature Flags', icon: <IconFlag /> },
      { id: 'errors', label: 'Erros',         icon: <IconAlert /> },
      { id: 'audit',  label: 'Auditoria',     icon: <IconLog /> },
    ],
  },
];

export function AdminSidebar({ page, onNavigate }: Props) {
  return (
    <nav className="admin-sidebar">
      <div className="admin-sidebar__logo">
        <img src="/nexussafe/logo.png" alt="Atenna" className="admin-sidebar__logo-mark" style={{ borderRadius: 6, objectFit: 'contain' }} />
        <div>
          <div className="admin-sidebar__logo-text">Atenna</div>
          <div className="admin-sidebar__logo-sub">Admin</div>
        </div>
      </div>

      <div className="admin-sidebar__nav">
        {SECTIONS.map(section => (
          <div key={section.title}>
            <div className="admin-sidebar__section">{section.title}</div>
            {section.items.map(item => (
              <button
                key={item.id}
                className={`admin-nav-item${page === item.id ? ' active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
