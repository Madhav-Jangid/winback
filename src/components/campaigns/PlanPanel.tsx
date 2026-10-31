'use client';

import { useState } from 'react';
import type { CampaignPlanResult, PlanResponse } from '@/lib/planner/types';

interface PlanPanelProps {
  campaignId?: string;
  /** Why planning is unavailable right now (unsaved changes, locked campaign), if it is. */
  blockedReason: string | null;
  lastSource: string | null;
  lastRationale: string | null;
  onApply: (plan: CampaignPlanResult, withOffer: boolean) => void;
}

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  gemini: { label: 'Gemini', className: 'provider-gemini' },
  demo_fallback: { label: 'Demo fallback', className: 'provider-demo' },
};

export function SourceBadge({ source }: { source: string }) {
  const badge = SOURCE_BADGE[source] ?? { label: source, className: 'provider-demo' };
  return <span className={`provider-badge ${badge.className}`}>{badge.label}</span>;
}

export default function PlanPanel({ campaignId, blockedReason, lastSource, lastRationale, onApply }: PlanPanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<{ message: string; canUseDemo: boolean } | null>(null);

  async function run(useDemo: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ use_demo: useDemo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult(null);
        setError({ message: json.error?.message ?? 'Could not generate a plan.', canUseDemo: json.error?.details?.fallback_available === true });
        return;
      }
      setResult(json);
    } catch {
      setResult(null);
      setError({ message: 'Could not reach the server. Try again.', canUseDemo: false });
    } finally {
      setLoading(false);
    }
  }

  const plan = result?.plan;
  const canRun = Boolean(campaignId) && !blockedReason && !loading;

  return (
    <div className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>Draft with AI</strong>
          <p className="form-help">
            Gemini drafts a message and checks your offer. It only suggests: nothing changes until you apply it and save.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(false)} disabled={!canRun}>
          {loading ? 'Drafting…' : plan ? 'Draft again' : 'Draft message'}
        </button>
      </div>

      {!campaignId && <p className="form-help">Create the draft first, then use AI to write the message.</p>}
      {campaignId && blockedReason && <p className="form-help">{blockedReason}</p>}

      {error && (
        <div className="error-box" role="alert">
          <div>
            <p>{error.message}</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => run(false)} disabled={loading}>Retry</button>
              {error.canUseDemo && (
                <button type="button" className="btn btn-sm btn-warning" onClick={() => run(true)} disabled={loading}>
                  Use demo draft instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {plan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <SourceBadge source={plan.source} />
            {plan.model && <span className="form-help">{plan.model}</span>}
          </div>
          {plan.source === 'demo_fallback' && (
            <div className="info-box">
              <span>This is a fixed demo template, not AI output. {plan.fallback_reason}</span>
            </div>
          )}
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{plan.rationale}</p>
          <p className="form-help">Audience: {plan.target_segment_description}</p>
          <blockquote style={{ borderLeft: '3px solid var(--accent)', padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>
            {plan.message_draft}
          </blockquote>
          <p className="form-help">
            Offer: {result.offer_summary}{result.offer_changed ? ' (differs from your current offer, same cost or cheaper)' : ' (your current offer, unchanged)'}
            {' · '}Measure for {plan.experiment_duration_days} days
          </p>
          {plan.assumptions.length > 0 && (
            <details>
              <summary className="form-help" style={{ cursor: 'pointer' }}>Assumptions ({plan.assumptions.length})</summary>
              <ul style={{ paddingLeft: '1.1rem' }}>{plan.assumptions.map((a) => <li key={a} className="form-help">{a}</li>)}</ul>
            </details>
          )}
          {plan.warnings.length > 0 && (
            <ul style={{ paddingLeft: '1.1rem' }}>{plan.warnings.map((w) => <li key={w} className="form-help" style={{ color: 'var(--warning)' }}>{w}</li>)}</ul>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onApply(plan, false)}>Use this message</button>
            {result.offer_changed && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onApply(plan, true)}>Use message and offer</button>
            )}
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setResult(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {!plan && !error && lastSource && lastRationale && (
        <p className="form-help">
          Last plan: <SourceBadge source={lastSource} /> {lastRationale}
        </p>
      )}
    </div>
  );
}
