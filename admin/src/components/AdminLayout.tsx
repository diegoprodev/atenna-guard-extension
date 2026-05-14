import type { ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

interface Props {
  children: ReactNode;
  page: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  dark: boolean;
  onToggleDark: () => void;
}

export function AdminLayout({ children, page, onNavigate, onLogout, dark, onToggleDark }: Props) {
  return (
    <div className="admin-layout" data-theme={dark ? 'dark' : undefined}>
      <AdminSidebar page={page} onNavigate={onNavigate} />
      <div className="admin-main">
        <AdminTopbar
          page={page}
          onLogout={onLogout}
          dark={dark}
          onToggleDark={onToggleDark}
        />
        <div className="admin-content">
          {children}
        </div>
      </div>
    </div>
  );
}
