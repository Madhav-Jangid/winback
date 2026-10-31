import Link from 'next/link';
import { Suspense } from 'react';
import { DatabaseErrorState, EmptyState, LoadingState } from '@/components/ui/PageStates';
import { CHANNEL_LABELS } from '@/lib/campaigns/rules';
import { SEGMENTS } from '@/lib/campaigns/segments';
import { CAMPAIGN_LIST_FILTERS, listCampaigns, type CampaignListFilter } from '@/lib/campaigns/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { formatDate, languageName } from '@/lib/format';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_LABELS: Record<CampaignListFilter, string> = {
  all: 'All', open: 'Drafts & ready', approved: 'Approved', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled / failed',
};

export default function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">Winback campaigns, from draft to measured results. Sending is simulated.</p>
        </div>
        <Link href="/campaigns/new" className="btn btn-primary">＋ New campaign</Link>
      </div>
      <Suspense fallback={<LoadingState label="Loading campaigns…" />}>
        <CampaignList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CampaignList({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).status;
  const status = (typeof raw === 'string' && raw in CAMPAIGN_LIST_FILTERS ? raw : 'all') as CampaignListFilter;

  let campaigns: Awaited<ReturnType<typeof listCampaigns>>;
  try {
    campaigns = await listCampaigns(getPool(), DEMO_MERCHANT_ID, status);
  } catch (err) {
    console.error('[Campaigns page]', err instanceof Error ? err.message : err);
    return <DatabaseErrorState what="campaigns" />;
  }

  return (
    <>
      <nav className="filter-chips" aria-label="Campaign status" style={{ marginBottom: '1.25rem' }}>
        {(Object.keys(FILTER_LABELS) as CampaignListFilter[]).map((f) => (
          <Link key={f} href={f === 'all' ? '/campaigns' : `/campaigns?status=${f}`} className={`filter-chip ${status === f ? 'active' : ''}`}
            aria-current={status === f ? 'page' : undefined} style={{ textDecoration: 'none' }}>
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>

      {campaigns.length === 0 ? (
        <div className="card">
          <EmptyState icon="📣" title="No campaigns here yet">
            <Link href="/campaigns/new">Create a winback campaign</Link> for your at-risk customers.
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Campaign</th><th>Status</th><th>Audience</th><th>Offer</th><th>Channel</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/campaigns/${c.id}`} style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}>{c.name}</Link>
                    <div className="form-help">v{c.version}</div>
                  </td>
                  <td><span className={`badge status-${c.status}`}>{c.status.replaceAll('_', ' ')}</span></td>
                  <td>
                    {SEGMENTS[c.segment_type].label}
                    {c.eligible !== null && <div className="form-help">{c.eligible} eligible when last saved</div>}
                  </td>
                  <td style={{ maxWidth: '18rem', whiteSpace: 'normal' }}>{c.offer_summary}</td>
                  <td>{CHANNEL_LABELS[c.channel]} · {languageName(c.language)}</td>
                  <td>{formatDate(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
