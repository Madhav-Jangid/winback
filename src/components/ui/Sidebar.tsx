'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { Menu, RefreshCw, X } from 'lucide-react';
import { ActiveNavLinks, NavLinks } from './SidebarNav';

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMenu = () => setMobileOpen(false);

  return (
    <>
      <header className="mobile-topbar">
        <Link href="/" className="logo-mark" onClick={closeMenu}>
          <span className="logo-icon"><RefreshCw size={18} strokeWidth={2.2} aria-hidden="true" /></span>
          <span className="logo-text">Winback</span>
        </Link>
        <button
          type="button"
          className="mobile-menu-button"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </header>

      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={closeMenu} />}

      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <Link href="/" className="logo-mark" onClick={closeMenu}>
            <span className="logo-icon"><RefreshCw size={18} strokeWidth={2.2} aria-hidden="true" /></span>
            <span>
              <span className="logo-text">Winback</span>
              <span className="logo-caption">RETENTION WORKSPACE</span>
            </span>
          </Link>
        </div>

        <nav className="sidebar-nav" id="primary-navigation" aria-label="Main navigation">
          <span className="nav-section-label">Workspace</span>
          <Suspense fallback={<NavLinks pathname={null} onNavigate={closeMenu} />}>
            <ActiveNavLinks onNavigate={closeMenu} />
          </Suspense>
        </nav>

        <div className="sidebar-footer">
          <div className="workspace-status">
            <span className="workspace-status-indicator" aria-hidden="true" />
            <span>
              <strong>Demo workspace</strong>
              <small>All activity is simulated</small>
            </span>
          </div>
          <div className="sidebar-footer-note">Winback · Customer retention</div>
        </div>
      </aside>
    </>
  );
}
