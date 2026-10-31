import { Suspense } from 'react';
import { ActiveNavLinks, NavLinks } from './SidebarNav';

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">
          <div className="logo-icon" aria-hidden>🔄</div>
          <span className="logo-text">Winback AI</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main">
        <span className="nav-section-label">Navigation</span>
        {/* The current URL is request data, so highlighting the active link waits for it. */}
        <Suspense fallback={<NavLinks pathname={null} />}>
          <ActiveNavLinks />
        </Suspense>
      </nav>

      <div className="sidebar-footer">
        <span className="demo-badge-small">⚡ Demo Mode — Simulated Data</span>
      </div>
    </aside>
  );
}
