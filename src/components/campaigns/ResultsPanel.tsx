'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart3, CircleHelp, Info, Play } from 'lucide-react';
import type { CampaignResults } from '@/types';

interface ResultsPanelProps {
  campaignId: string;
  campaignStatus: string;
  initialResults: (CampaignResults & { campaign_name: string; campaign_status: 'completed' }) | null;
}

function rate(value: number | null) {
  return value === null ? 'N/A' : new Intl.NumberFormat('en-IN', { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

function money(value: number | null) {
  return value === null ? 'N/A' : `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function Metric({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <article className={`result-metric ${emphasis ? 'result-metric-emphasis' : ''}`}>
      <p className="result-metric-label">{label}</p>
      <p className="result-metric-value">{value}</p>
      {note && <p className="result-metric-note">{note}</p>}
    </article>
  );
}

function GroupCard({
  name,
  count,
  reactivated,
  resultRate,
  treatment,
}: {
  name: string;
  count: number;
  reactivated: number;
  resultRate: number | null;
  treatment: boolean;
}) {
  const width = resultRate === null ? '0%' : `${Math.max(0, Math.min(100, resultRate * 100))}%`;
  return (
    <article className={`result-group-card ${treatment ? 'treatment' : 'control'}`}>
      <div className="result-group-heading">
        <div>
          <p className="result-group-kicker">{treatment ? 'Received simulated offer' : 'Held-out comparison'}</p>
          <h2>{name}</h2>
        </div>
        <strong className="result-group-rate">{rate(resultRate)}</strong>
      </div>
      <div className="result-rate-track" role="img" aria-label={`${name} reactivation rate ${rate(resultRate)}`}>
        <span style={{ width }} />
      </div>
      <p className="result-group-denominator">
        <strong>{reactivated}</strong> reactivated of <strong>{count}</strong> assigned
      </p>
    </article>
  );
}

export default function ResultsPanel({ campaignId, campaignStatus, initialResults }: ResultsPanelProps) {
  const router = useRouter();
  const [results, setResults] = useState(initialResults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simulateOutcomes() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/simulate-outcomes`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not simulate outcomes.');

      const resultResponse = await fetch(`/api/campaigns/${campaignId}/results`, { cache: 'no-store' });
      const resultBody = await resultResponse.json();
      if (!resultResponse.ok) throw new Error(resultBody.error?.message ?? 'Outcomes were simulated, but results could not be loaded.');
      setResults(resultBody);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not simulate outcomes. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!results) {
    const canSimulate = campaignStatus === 'sent' || campaignStatus === 'measuring';
    return (
      <section className="results-preflight">
        <div className="results-preflight-icon"><BarChart3 size={22} aria-hidden="true" /></div>
        <div className="results-preflight-copy">
          <p className="eyebrow">Measurement setup</p>
          <h2>{canSimulate ? 'Ready to measure the campaign' : 'A completed send is required'}</h2>
          <p>
            {canSimulate
              ? 'Create a reproducible, illustrative comparison across the campaign’s original treatment and control groups.'
              : 'Finish the simulated send before generating treatment and control outcomes.'}
          </p>
        </div>
        {canSimulate && (
          <button type="button" className="btn btn-primary" onClick={simulateOutcomes} disabled={busy}>
            <Play size={15} aria-hidden="true" />
            {busy ? 'Measuring…' : 'Simulate outcomes'}
          </button>
        )}
        {error && <div className="error-box results-action-error" role="alert">{error}</div>}
      </section>
    );
  }

  const lift = results.incremental_reactivation_rate;
  return (
    <div className="results-report">
      <aside className="simulation-caveat" role="note">
        <Info size={18} aria-hidden="true" />
        <div>
          <strong>Illustrative simulation — not evidence of real-world lift.</strong>
          <p>Outcomes are generated from a fixed seed and preset assumptions. They do not represent observed customer behavior.</p>
        </div>
      </aside>

      <section className="results-section" aria-labelledby="group-results-title">
        <div className="results-section-heading">
          <div>
            <p className="eyebrow">Experiment readout</p>
            <h2 id="group-results-title">Reactivation by assigned group</h2>
          </div>
          <span className="badge badge-muted">Intent-to-treat denominators</span>
        </div>
        <div className="result-group-grid">
          <GroupCard
            name="Treatment"
            count={results.treatment_count}
            reactivated={results.treatment_reactivations}
            resultRate={results.treatment_reactivation_rate}
            treatment
          />
          <GroupCard
            name="Control"
            count={results.control_count}
            reactivated={results.control_reactivations}
            resultRate={results.control_reactivation_rate}
            treatment={false}
          />
        </div>
      </section>

      <section className="results-section" aria-labelledby="incremental-title">
        <div className="results-section-heading">
          <div>
            <p className="eyebrow">Estimated impact</p>
            <h2 id="incremental-title">Difference versus control</h2>
          </div>
          <span className="tooltip-wrap" tabIndex={0} aria-label="Treatment rate minus control rate">
            <CircleHelp size={17} aria-hidden="true" />
            <span className="tooltip-content">Treatment reactivation rate minus control reactivation rate.</span>
          </span>
        </div>
        <div className="result-metric-grid result-impact-grid">
          <Metric label="Incremental reactivation rate" value={rate(lift)} note="Treatment rate − control rate" emphasis />
          <Metric
            label="Estimated incremental reactivations"
            value={results.estimated_incremental_reactivations === null
              ? 'N/A'
              : results.estimated_incremental_reactivations.toFixed(1)}
            note={results.estimated_incremental_reactivations === null ? 'Both groups need a denominator' : `Applied to ${results.treatment_count} treatment customers`}
          />
          <Metric
            label="Estimated incremental revenue"
            value={money(results.estimated_incremental_revenue_minor)}
            note={`Incremental reactivations × ${money(results.average_order_value_minor)} average order value`}
          />
        </div>
      </section>

      <section className="results-section" aria-labelledby="economics-title">
        <div className="results-section-heading">
          <div>
            <p className="eyebrow">Campaign economics</p>
            <h2 id="economics-title">Cost and simulated unsubscribes</h2>
          </div>
        </div>
        <div className="result-metric-grid result-economics-grid">
          <Metric label="Campaign cost" value={money(results.campaign_cost_minor)} note="Sum of persisted delivered-message costs" />
          <Metric
            label="Cost per treatment reactivation"
            value={money(results.cost_per_reactivated_minor)}
            note={results.cost_per_reactivated_minor === null
              ? 'No treatment reactivations to divide by'
              : `${money(results.campaign_cost_minor)} ÷ ${results.treatment_reactivations} treatment reactivations`}
          />
          <Metric
            label="Simulated unsubscribe rate"
            value={rate(results.unsubscribe_rate)}
            note={`${results.unsubscribe_count} of ${results.unsubscribe_denominator} attempted treatment messages`}
          />
        </div>
      </section>

      <details className="results-method">
        <summary>How these estimates are calculated</summary>
        <div>
          <p>Group rates use all customers in their original assigned group, including treatment customers not reached by a message.</p>
          <p>Incremental rate = treatment reactivation rate − control reactivation rate.</p>
          <p>Incremental revenue = incremental reactivations × {money(results.average_order_value_minor)} simulated average order value.</p>
          <p>Campaign cost sums stored costs for delivered messages. Cost per reactivation divides that cost by treatment reactivations.</p>
          <p>Unsubscribe rate uses simulated unsubscribe outcomes divided by attempted treatment messages. It never changes customer consent.</p>
        </div>
      </details>

      <footer className="results-footer">
        <span>Generated from persisted campaign outcomes. Re-running the simulation does not create duplicate records.</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={simulateOutcomes} disabled={busy}>
          {busy ? 'Checking…' : 'Verify saved results'}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </footer>
      {error && <div className="error-box" role="alert">{error}</div>}
    </div>
  );
}
