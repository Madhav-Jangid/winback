import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { z } from 'zod';
import ApprovePanel from '@/components/campaigns/ApprovePanel';
import { SourceBadge } from '@/components/campaigns/PlanPanel';
import { DatabaseErrorState, LoadingState } from '@/components/ui/PageStates';
import { costAssumption, getApprovalSummary, type ApprovalSummary } from '@/lib/approvals/service';
import { CHANNEL_LABELS, formatMinor, languageLabel } from '@/lib/campaigns/rules';
import { SEGMENTS } from '@/lib/campaigns/segments';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { SUPPRESSION_LABELS } from '@/lib/eligibility/reasons';
import { AppError } from '@/lib/errors';
import { SOURCE_LANGUAGE } from '@/lib/localization/rules';
import { getMerchantSettings } from '@/lib/repositories/merchants';

type Params = Promise<{ id: string }>;

export default function ReviewPage({ params }: { params: Params }) {
  return (
    <div className="fade-in">
      <Suspense fallback={<LoadingState label="Preparing the approval summary…" />}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
      <span className="form-help" style={{ fontSize: '0.8rem' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: strong ? 800 : 500, textAlign: 'right' }}>{children}</span>
    </div>
  );
}

async function Review({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  let summary: ApprovalSummary;
  let timezone = 'Asia/Kolkata';
  try {
    summary = await getApprovalSummary(getPool(), DEMO_MERCHANT_ID, id, getAppNow());
    timezone = (await getMerchantSettings(getPool(), DEMO_MERCHANT_ID))?.timezone ?? timezone;
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    console.error('[Review page]', err instanceof Error ? err.message : err);
    return <DatabaseErrorState what="the approval summary" />;
  }

  const { view, recipients, budget, suppression, held_back, blockers, warnings } = summary;
  const c = view.campaign;
  const localized = c.language !== SOURCE_LANGUAGE;
  const language = languageLabel(c.language);
  const box = { background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.75rem 0.875rem', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' as const };

  return (
    <>
      <Link href={`/campaigns/${c.id}`} className="form-help" style={{ textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' }}>
        ← Back to editing
      </Link>
      <div className="page-header">
        <h1 className="page-title">Review and approve</h1>
        <p className="page-subtitle">{c.name} · version {c.version}</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <span className={`badge status-${c.status}`}>{c.status.replaceAll('_', ' ')}</span>
          <span className="badge badge-warning">Simulation only: no real message is sent</span>
        </div>
      </div>

      {blockers.length > 0 && (
        <div className="error-box" role="alert" style={{ marginBottom: '1rem', flexDirection: 'column' }}>
          <strong>Cannot be approved yet</strong>
          <ul style={{ paddingLeft: '1.1rem' }}>{blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
          <Link href={`/campaigns/${c.id}`} className="btn btn-sm btn-secondary" style={{ alignSelf: 'flex-start' }}>Fix in the editor</Link>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="info-box" style={{ marginBottom: '1rem', flexDirection: 'column' }}>
          <strong>Worth knowing</strong>
          <ul style={{ paddingLeft: '1.1rem' }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <section className="card" aria-labelledby="audience-heading">
          <h2 id="audience-heading" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Audience</h2>
          <p className="form-help" style={{ marginBottom: '0.5rem' }}>{SEGMENTS[c.segment_type].label}: {SEGMENTS[c.segment_type].description}</p>
          <Row label="Match the segment">{recipients.members}</Row>
          <Row label="Can be contacted">{recipients.contactable}</Row>
          <Row label="Will be messaged (treatment)" strong>{recipients.sendable}</Row>
          <Row label="Held back as the comparison group (control)">{recipients.control}</Row>
          <p className="form-help" style={{ margin: '0.75rem 0 0.25rem' }}>Not messaged, by reason</p>
          {suppression.length === 0 ? <p className="form-help">Nobody is suppressed.</p> : suppression.map((s) => <Row key={s.reason} label={s.label}>{s.count}</Row>)}
          {recipients.insufficient_history > 0 && (
            <Row label="Not enough purchase history (not in this segment)">{recipients.insufficient_history}</Row>
          )}
          <p className="form-help" style={{ marginTop: '0.75rem' }}>
            The control group never receives a message; it is how results are compared. Eligibility is checked again when sending, and anyone who has opted out by then is skipped.
          </p>
          {held_back.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary className="form-help" style={{ cursor: 'pointer' }}>Who is not messaged ({held_back.length})</summary>
              <ul style={{ paddingLeft: '1.1rem', marginTop: '0.4rem' }}>
                {held_back.map((h) => (
                  <li key={h.customer_id} className="form-help">{h.display_name}: {SUPPRESSION_LABELS[h.reason].label}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card" aria-labelledby="offer-heading">
          <h2 id="offer-heading" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Offer, budget and limits</h2>
          <Row label="Offer">{view.offer_summary}</Row>
          <Row label="Channel (simulated)">{CHANNEL_LABELS[c.channel]}</Row>
          <Row label="Language">{language}</Row>
          <Row label="Budget">{formatMinor(budget.budget_minor, view.currency)}</Row>
          <Row label="Reserved per message">{budget.cost_per_message_minor === null ? 'Unknown' : formatMinor(budget.cost_per_message_minor, view.currency)}</Row>
          <Row label="Reserved in total">{formatMinor(budget.reserved_minor, view.currency)}</Row>
          <Row label="Left unreserved" strong>{formatMinor(budget.remaining_minor, view.currency)}</Row>
          <Row label="Limits">{c.frequency_cap} message per customer, {c.cooldown_days}-day cooldown</Row>
          <p className="form-help" style={{ marginTop: '0.75rem' }}>{costAssumption(budget, view.currency)}</p>
        </section>
      </div>

      <section className="card" aria-labelledby="message-heading" style={{ marginBottom: '1.5rem' }}>
        <h2 id="message-heading" style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Exact message</h2>
        <div className={localized ? 'side-by-side' : undefined}>
          <div>
            <p className="form-label" style={{ marginBottom: '0.3rem' }}>English</p>
            <div style={box} lang="en">{c.original_message || <em>No message yet</em>}</div>
          </div>
          {localized && (
            <div>
              <p className="form-label" style={{ marginBottom: '0.3rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {language} (what customers receive)
                {c.translation && <SourceBadge source={c.translation.source} />}
                {c.translation?.edited && c.translation.source !== 'manual' && <span className="badge badge-accent">edited</span>}
              </p>
              <div style={box} lang={c.language}>{c.localized_message || <em>No {language} text yet</em>}</div>
            </div>
          )}
        </div>
        <p className="form-help" style={{ marginTop: '0.5rem' }}>Offer terms: {view.offer_summary}. Check that the message states the same offer.</p>
      </section>

      <ApprovePanel
        campaignId={c.id}
        version={c.version}
        canApprove={summary.can_approve}
        blockerCount={blockers.length}
        approval={summary.approval}
        status={c.status}
        timezone={timezone}
      />
    </>
  );
}
