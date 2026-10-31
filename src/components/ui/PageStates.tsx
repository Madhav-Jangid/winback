import type { ReactNode } from 'react';

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
      <span aria-hidden>⚠️</span>
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

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="center-content" style={{ padding: '2.5rem' }}>
      <span className="empty-icon" aria-hidden>{icon}</span>
      <p className="empty-title">{title}</p>
      {children && <div className="empty-desc">{children}</div>}
    </div>
  );
}
