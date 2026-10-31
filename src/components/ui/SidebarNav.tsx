'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/customers', label: 'Customers', icon: '👥' },
  { href: '/campaigns', label: 'Campaigns', icon: '📣' },
  { href: '/audit', label: 'Audit Log', icon: '📋' },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || (href !== '/' && pathname.startsWith(href));
}

/** Nav links. `pathname` null renders without an active item (used as the Suspense fallback). */
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}
