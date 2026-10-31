'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Megaphone, ScrollText, Users, type LucideIcon } from 'lucide-react';

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/audit', label: 'Audit log', icon: ScrollText },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || (href !== '/' && pathname.startsWith(href));
}

/** Nav links. `pathname` null renders without an active item (used as the Suspense fallback). */
export function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <Icon className="nav-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <NavLinks pathname={usePathname()} onNavigate={onNavigate} />;
}
