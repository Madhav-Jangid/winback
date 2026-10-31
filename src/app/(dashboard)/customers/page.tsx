import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';
import { FolderOpen, Search } from 'lucide-react';
import { ContactBadge, RiskBadge } from '@/components/customers/badges';
import { DatabaseErrorState, EmptyState, LoadingState } from '@/components/ui/PageStates';
import { getAppNow } from '@/lib/clock';
import {
  customerQuerySchema,
  getCustomerDirectory,
  type CustomerDirectory,
  type CustomerFilter,
  type CustomerQuery,
} from '@/lib/customers/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { formatDate, formatDays, languageName } from '@/lib/format';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_LABELS: Record<CustomerFilter, string> = {
  all: 'All',
  at_risk: 'At risk',
  healthy: 'Healthy',
  insufficient_history: 'Not enough history',
  consented: 'Consented',
  opted_out: 'Opted out',
  no_consent: 'No consent',
  frequency_capped: 'Recently messaged',
};

function parseQuery(raw: Record<string, string | string[] | undefined>): CustomerQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const parsed = customerQuerySchema.safeParse({ filter: first(raw.filter), search: first(raw.search) });
  return parsed.success ? parsed.data : { filter: 'all', search: '' };
}

function hrefFor(query: CustomerQuery): string {
  const params = new URLSearchParams();
  if (query.filter !== 'all') params.set('filter', query.filter);
  if (query.search) params.set('search', query.search);
  const qs = params.toString();
  return qs ? `/customers?${qs}` : '/customers';
}

export default function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Customers</h1>
        <p className="page-subtitle">
          Who is drifting away from their usual buying rhythm, and who you’re allowed to contact.
        </p>
      </div>
      <Suspense fallback={<LoadingState label="Loading customers…" />}>
        <CustomerDirectoryView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CustomerDirectoryView({ searchParams }: { searchParams: SearchParams }) {
  const query = parseQuery(await searchParams);
  let directory: CustomerDirectory;
  try {
    directory = await getCustomerDirectory(getPool(), DEMO_MERCHANT_ID, getAppNow(), query);
  } catch (err) {
    console.error('[Customers page]', err instanceof Error ? err.message : err);
    return <DatabaseErrorState what="customers" />;
  }

  if (!directory.merchant) {
    return (
      <EmptyState icon={<FolderOpen size={28} strokeWidth={1.6} />} title="No demo data loaded">
        Run <code>npm run db:seed</code> or use <Link href="/">Reset demo data</Link> on the dashboard.
      </EmptyState>
    );
  }

  const tz = directory.merchant.timezone;
  const { counts, customers, policy } = directory;

  return (
    <>
      <p className="form-help" style={{ marginBottom: '1rem' }}>
        Calculated as of {formatDate(directory.as_of, tz)}. A customer is <strong>at risk</strong> when the days since their
        last completed purchase reach the larger of 1.5× their typical gap or 14 days. Refunds and cancellations are ignored.
        {policy && <> “Recently messaged” means a campaign message in the last {policy.cooldown_days} days.</>}
      </p>

      <div className="filter-bar">
        <Form action="/customers" className="search-input-wrap" role="search">
          <Search className="search-icon" size={16} aria-hidden="true" />
          <input
            className="form-input"
            name="search"
            type="search"
            placeholder="Search by name…"
            defaultValue={query.search}
            maxLength={100}
            aria-label="Search customers by name"
          />
          {query.filter !== 'all' && <input type="hidden" name="filter" value={query.filter} />}
        </Form>
      </div>

      <nav className="filter-chips" aria-label="Customer filters" style={{ marginBottom: '1.25rem' }}>
        {(Object.keys(FILTER_LABELS) as CustomerFilter[]).map((filter) => (
          <Link
            key={filter}
            href={hrefFor({ ...query, filter })}
            className={`filter-chip ${query.filter === filter ? 'active' : ''}`}
            aria-current={query.filter === filter ? 'page' : undefined}
            style={{ textDecoration: 'none' }}
          >
            {FILTER_LABELS[filter]} ({counts[filter]})
          </Link>
        ))}
      </nav>

      {customers.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Search size={28} strokeWidth={1.6} />} title="No customers match">
            {query.search ? <>Nobody named “{query.search}” in this view. </> : null}
            <Link href="/customers">Show all customers</Link>
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Buying rhythm</th>
                <th>Last purchase</th>
                <th>Typical gap</th>
                <th>Days since</th>
                <th>Contact</th>
                <th>Language</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/customers/${c.id}`} style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}>
                      {c.display_name}
                    </Link>
                  </td>
                  <td>
                    <RiskBadge status={c.risk.status} />
                    <div className="form-help" style={{ marginTop: '0.25rem', maxWidth: '22rem', whiteSpace: 'normal' }}>{c.risk.reason}</div>
                  </td>
                  <td>{formatDate(c.risk.last_purchase_at, tz)}</td>
                  <td>{formatDays(c.risk.median_cadence_days)}</td>
                  <td>{formatDays(c.risk.days_since_last_purchase)}</td>
                  <td><ContactBadge profile={c} /></td>
                  <td>{languageName(c.preferred_language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="form-help" style={{ marginTop: '0.75rem' }}>
        Showing {customers.length} of {counts.all} customers. All names and purchases are synthetic demo data.
      </p>
    </>
  );
}
