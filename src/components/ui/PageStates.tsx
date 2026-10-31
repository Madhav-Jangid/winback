import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="center-content" role="status" aria-live="polite">
      <div className="loading-spinner" />
      <p className="empty-desc">{label}</p>
    </div>
  );
}

export function DatabaseErrorState({ what }: { what: string }) {
  return (
    <div className="error-box" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <strong>Couldn’t load {what}</strong>
        <p style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>
          The database could not be reached. Check <code>DATABASE_URL</code> in <code>.env.local</code>, run{' '}
          <code>npm run db:setup</code>, then reload this page.
        </p>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="center-content" style={{ padding: '2.5rem' }}>
      {icon && <span className="empty-icon" aria-hidden="true">{icon}</span>}
      <p className="empty-title">{title}</p>
      {children && <div className="empty-desc">{children}</div>}
    </div>
  );
}
