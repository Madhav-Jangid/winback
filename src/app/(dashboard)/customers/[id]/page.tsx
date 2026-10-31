import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { z } from 'zod';
import { ContactBadge, RiskBadge } from '@/components/customers/badges';
import OptOutButton from '@/components/customers/OptOutButton';
import { DatabaseErrorState, LoadingState } from '@/components/ui/PageStates';
import { getAppNow } from '@/lib/clock';
import { getCustomerDetail, type CustomerDetail } from '@/lib/customers/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { DEFAULT_RISK_MULTIPLIER, DEFAULT_MIN_DAYS } from '@/lib/risk/engine';
import { formatDate, formatDays, formatMoney, languageName } from '@/lib/format';

type Params = Promise<{ id: string }>;

export default function CustomerDetailPage({ params }: { params: Params }) {
  return (
    <div className="fade-in">
      <Link href="/customers" className="back-link">
        <ArrowLeft size={14} aria-hidden="true" /> All customers
      </Link>
      <Suspense fallback={<LoadingState label="Loading customer…" />}>
        <CustomerDetailView params={params} />
      </Suspense>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
      <span className="form-help" style={{ fontSize: '0.8rem' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem', textAlign: 'right' }}>{children}</span>
    </div>
  );
}

async function CustomerDetailView({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  let detail: CustomerDetail | null;
  try {
    detail = await getCustomerDetail(getPool(), DEMO_MERCHANT_ID, id, getAppNow());
  } catch (err) {
    console.error('[Customer page]', err instanceof Error ? err.message : err);
    return <DatabaseErrorState what="this customer" />;
  }
  if (!detail) notFound();

  const { profile, purchases, messages, policy, merchant } = detail;
  const { risk } = profile;
  const tz = merchant.timezone;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{profile.display_name}</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <RiskBadge status={risk.status} />
          <ContactBadge profile={profile} />
          <span className="badge badge-info">{languageName(profile.preferred_language)}</span>
          <span className="form-help">Synthetic demo customer</span>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <section className="card" aria-labelledby="rhythm-heading">
          <h2 id="rhythm-heading" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Why this status?</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{risk.reason}</p>
          <Row label="Last completed purchase">{formatDate(risk.last_purchase_at, tz)}</Row>
          <Row label="Completed purchases">{profile.completed_purchase_count}</Row>
          <Row label="Typical gap between visits (median)">{formatDays(risk.median_cadence_days)}</Row>
          <Row label="Days since last purchase">{formatDays(risk.days_since_last_purchase)}</Row>
          <Row label="At-risk threshold">{formatDays(risk.threshold_days)}</Row>
          <Row label="Total completed spend">{formatMoney(profile.total_spend_minor, merchant.currency)}</Row>
          <p className="form-help" style={{ marginTop: '0.75rem' }}>
            Rule: at risk when days since the last completed purchase ≥ the larger of {DEFAULT_RISK_MULTIPLIER}× the typical gap
            or {DEFAULT_MIN_DAYS} days. Needs at least 2 completed purchases on different dates.
            {profile.ignored_purchase_count > 0 && <> {profile.ignored_purchase_count} refunded/cancelled purchase(s) ignored.</>}
            {' '}Calculated as of {formatDate(detail.as_of, tz)}. This is a simple rule, not a churn prediction.
          </p>
        </section>

        <section className="card" aria-labelledby="contact-heading">
          <h2 id="contact-heading" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Can we message them?</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{profile.contact.detail}</p>
          <Row label="Marketing consent">{profile.consent_status}</Row>
          <Row label="Opted out">{profile.opted_out_at ? formatDate(profile.opted_out_at, tz) : 'No'}</Row>
          <Row label="Last campaign message">{formatDate(profile.last_message_at, tz)}</Row>
          <Row label="Reason code"><code>{profile.contact.reason ?? 'ELIGIBLE'}</code></Row>
          {!profile.opted_out_at && (
            <div style={{ marginTop: '0.75rem' }}>
              <OptOutButton customerId={profile.id} name={profile.display_name} />
            </div>
          )}
          <p className="form-help" style={{ marginTop: '0.75rem' }}>
            Uses the merchant defaults: at most {policy.frequency_cap} message per {policy.cooldown_days} days across all campaigns.
            Eligibility is checked again when a campaign is approved and when it is sent. Consent can’t be changed from campaign screens.
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby="purchases-heading" style={{ marginBottom: '1.5rem' }}>
        <h2 id="purchases-heading" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Purchase history</h2>
        {purchases.length === 0 ? (
          <p className="empty-desc">No purchases recorded.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Source</th></tr></thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id} style={{ cursor: 'default' }}>
                    <td>{formatDate(p.occurred_at, tz)}</td>
                    <td>{formatMoney(p.amount_minor, p.currency)}</td>
                    <td>
                      {p.status === 'completed'
                        ? <span className="badge badge-success">Completed</span>
                        : <span className="badge badge-muted">{p.status} — ignored</span>}
                    </td>
                    <td>{p.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="messages-heading">
        <h2 id="messages-heading" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Campaign messages (simulated)</h2>
        {messages.length === 0 ? (
          <p className="empty-desc">No campaign messages yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Campaign</th><th>Sent</th><th>Status</th></tr></thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={`${m.campaign_id}-${m.sent_at}`} style={{ cursor: 'default' }}>
                    <td>{m.campaign_name}</td>
                    <td>{formatDate(m.sent_at, tz)}</td>
                    <td><span className="badge badge-muted">{m.status} (simulated)</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
