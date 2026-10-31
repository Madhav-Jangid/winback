'use client';

/**
 * Screen F — Campaign execution and send progress (FR-10, PRD §12).
 *
 * The page can poll persisted progress while a send is still in progress.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SendProgress } from '@/lib/messaging/progress';
import { SUPPRESSION_LABELS } from '@/lib/eligibility/reasons';
import type { SuppressionReason } from '@/types';

interface SendProgressPanelProps {
  campaignId: string;
  initial: SendProgress;
  /** Auto-refresh interval in ms while in `sending` state (omit to disable). */
  refreshInterval?: number;
}

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((n / total) * 100)} %`;
}

function formatMoney(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

function StatPill({ label, value, accent }: { label: string; value: string | number; accent?: 'success' | 'warning' | 'error' | 'neutral' }) {
  const colours: Record<string, string> = {
    success: 'var(--green)',
    warning: 'var(--yellow)',
    error: 'var(--red)',
    neutral: 'var(--text-secondary)',
  };
  const col = colours[accent ?? 'neutral'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: '6rem' }}>
      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: col }}>{value}</span>
      <span className="form-help" style={{ fontSize: '0.75rem' }}>{label}</span>
    </div>
  );
}

function ReasonList({ map }: { map: Partial<Record<SuppressionReason, number>> }) {
  const entries = (Object.entries(map) as [SuppressionReason, number][]).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <ul style={{ paddingLeft: '1.1rem', margin: '0.25rem 0 0' }}>
      {entries.map(([reason, n]) => (
        <li key={reason} className="form-help" style={{ fontSize: '0.8rem' }}>
          {SUPPRESSION_LABELS[reason]?.label ?? reason}: {n}
        </li>
      ))}
    </ul>
  );
}

export default function SendProgressPanel({ campaignId, initial, refreshInterval }: SendProgressPanelProps) {
  const router = useRouter();
  const [progress, setProgress] = useState<SendProgress>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send-status`);
      const body: SendProgress | { error?: { message?: string } } = await res.json();
      if (!res.ok) {
        setError('error' in body ? body.error?.message ?? 'Could not refresh send progress.' : 'Could not refresh send progress.');
        return;
      }
      setProgress(body as SendProgress);
    } catch {
      setError('Could not refresh send progress. Check your connection and try again.');
    }
  }, [campaignId]);

  useEffect(() => {
    if (refreshInterval && progress.state === 'sending') {
      pollingRef.current = setInterval(poll, refreshInterval);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [progress.state, refreshInterval, poll]);

  async function runSend() {
    setBusy(true);
    setError(null);
    setProgress((current) => ({ ...current, state: 'sending' }));
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/simulate-send`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? 'Simulate send failed.');
        await poll();
        return;
      }
      setProgress(json as SendProgress);
      router.refresh();
    } catch {
      setError('Network error. Nothing was duplicated. Try again.');
      await poll();
    } finally {
      setBusy(false);
    }
  }

  const { state, planned, delivered, failed, suppressed_at_send,
    processed, unresolved, retryable_failed,
    control_not_messaged, budget_not_messaged, suppressed_before_approval,
    suppressed_before_approval_by_reason, suppressed_at_send_by_reason,
    reserved_minor, budget_minor, can_send, can_retry,
    failed_deliveries, send_time_suppressions } = progress;

  const stateLabel: Record<typeof state, string> = {
    not_approved: 'Not approved',
    ready: 'Ready to send',
    sending: 'Sending…',
    interrupted: 'Interrupted — safe to resume',
    sent: 'Sent',
    sent_with_failures: 'Sent with failures',
    finished: 'Finished',
    cancelled: 'Cancelled',
  };

  const stateClass: Record<typeof state, string> = {
    not_approved: 'status-draft',
    ready: 'status-approved',
    sending: 'status-sending',
    interrupted: 'status-failed',
    sent: 'status-sent',
    sent_with_failures: 'status-sent',
    finished: 'status-completed',
    cancelled: 'status-cancelled',
  };

  return (
    <section aria-label="Send progress" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span className={`badge ${stateClass[state]}`}>{stateLabel[state]}</span>
        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Simulation only</span>
        {state === 'sending' && (
          <span className="form-help" style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>Refresh to see latest counts.</span>
        )}
      </div>

      {error && <div className="error-box" role="alert"><span>{error}</span></div>}

      {/* Progress bar */}
      {planned > 0 && (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: '6px',
            background: failed > 0 ? 'var(--red)' : 'var(--green)',
            width: `${pct(processed, planned)}`,
            transition: 'width 0.4s ease',
          }} />
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '1rem' }}>
        <StatPill label="Planned (treatment)" value={planned} accent="neutral" />
        <StatPill label="Delivered" value={delivered} accent="success" />
        {failed > 0 && <StatPill label="Failed" value={failed} accent="error" />}
        {suppressed_at_send > 0 && <StatPill label="Suppressed at send" value={suppressed_at_send} accent="warning" />}
        {retryable_failed > 0 && <StatPill label="Retryable failures" value={retryable_failed} accent="warning" />}
        <StatPill label="Processed" value={`${processed} / ${planned}`} accent="neutral" />
        {unresolved > 0 && <StatPill label="Unresolved" value={unresolved} accent="warning" />}
        <StatPill label="Control (not messaged)" value={control_not_messaged} accent="neutral" />
      </div>

      {/* Budget row */}
      <div className="form-help" style={{ fontSize: '0.8rem' }}>
        Reserved {formatMoney(reserved_minor)} of {formatMoney(budget_minor)} budget.
        {budget_not_messaged > 0 && ` ${budget_not_messaged} customer${budget_not_messaged === 1 ? '' : 's'} not messaged: budget cap.`}
        {suppressed_before_approval > 0 && ` ${suppressed_before_approval} suppressed before approval.`}
      </div>

      {/* Suppression breakdown (pre-approval) */}
      {suppressed_before_approval > 0 && Object.keys(suppressed_before_approval_by_reason).length > 0 && (
        <details>
          <summary className="form-help" style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
            Pre-approval suppressions ({suppressed_before_approval})
          </summary>
          <ReasonList map={suppressed_before_approval_by_reason} />
        </details>
      )}

      {/* Send-time suppressions */}
      {send_time_suppressions.length > 0 && (
        <details open>
          <summary className="form-help" style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
            Send-time suppressions ({suppressed_at_send}) — dropped after approval
          </summary>
          <ReasonList map={suppressed_at_send_by_reason} />
          <ul style={{ paddingLeft: '1.1rem', marginTop: '0.25rem' }}>
            {send_time_suppressions.map((s) => (
              <li key={s.customer_id} className="form-help" style={{ fontSize: '0.8rem' }}>
                {s.display_name}: {SUPPRESSION_LABELS[s.reason]?.label ?? s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Failed deliveries */}
      {failed_deliveries.length > 0 && (
        <details open>
          <summary className="form-help" style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
            Failed deliveries ({failed}) — retryable: {retryable_failed}
          </summary>
          <ul style={{ paddingLeft: '1.1rem', marginTop: '0.25rem' }}>
            {failed_deliveries.map((f) => (
              <li key={f.customer_id} className="form-help" style={{ fontSize: '0.8rem' }}>
                {f.display_name}
                {f.failure_code && f.failure_code !== 'SUPPRESSED_ON_RETRY' ? ` (${f.failure_code})` : ' (suppressed on retry)'}
                {' '}— {f.attempts} attempt{f.attempts !== 1 ? 's' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
        {can_send && (
          <button
            id="btn-simulate-send"
            className="btn btn-success"
            onClick={runSend}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Sending…' : state === 'sending' || state === 'interrupted' ? 'Resume send' : 'Simulate send'}
          </button>
        )}
        {can_retry && (
          <button
            id="btn-retry-send"
            className="btn btn-secondary"
            onClick={runSend}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Retrying…' : `Retry ${retryable_failed} failed delivery${retryable_failed !== 1 ? 's' : ''}`}
          </button>
        )}
        {(state === 'sent' || state === 'finished') && (
          <Link
            href={`/campaigns/${campaignId}/results`}
            className="btn btn-primary"
            id="btn-view-results"
          >
            View results →
          </Link>
        )}
        <Link href={`/campaigns/${campaignId}/review`} className="btn btn-secondary" id="btn-back-to-review">
          Review &amp; approval
        </Link>
      </div>
    </section>
  );
}
