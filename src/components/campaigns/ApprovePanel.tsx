'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ApprovalSummary } from '@/lib/approvals/service';
import { formatDate } from '@/lib/format';

interface ApprovePanelProps {
  campaignId: string;
  version: number;
  canApprove: boolean;
  blockerCount: number;
  approval: ApprovalSummary['approval'];
  status: string;
  timezone: string;
}

export default function ApprovePanel({ campaignId, version, canApprove, blockerCount, approval, status, timezone }: ApprovePanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_version: version }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? 'Approval failed.');
        if (json.error?.code === 'VERSION_CONFLICT') router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Nothing was approved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (approval.state === 'approved') {
    return (
      <section className="success-box" aria-label="Approval status" style={{ flexDirection: 'column' }}>
        <strong>Approved: version {approval.version}</strong>
        <span>
          By {approval.by} on {formatDate(approval.at, timezone)}. Fingerprint <code>{approval.hash?.slice(0, 12)}</code>. Editing the audience,
          offer, budget, limits, language, channel or any message cancels this approval.
        </span>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
          <button className="btn btn-success" disabled title="Simulated sending is the next build step">Simulate send (coming next)</button>
          <Link href={`/campaigns/${campaignId}`} className="btn btn-secondary">Back to campaign</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-label="Approve this campaign" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <strong style={{ color: 'var(--text-primary)' }}>Approve version {version}?</strong>
      <p className="form-help">
        Approving authorises exactly what is shown on this page. Nothing is sent now, and sending is simulated. Eligibility is checked
        again when the simulated send runs.
      </p>
      {error && <div className="error-box" role="alert"><span>{error}</span></div>}
      {status === 'cancelled' && <p className="form-error">This campaign was cancelled and cannot be approved.</p>}
      {!canApprove && status !== 'cancelled' && (
        <p className="form-error">
          {blockerCount > 0 ? `${blockerCount} issue${blockerCount === 1 ? '' : 's'} must be fixed before this can be approved.` : 'This campaign cannot be approved in its current state.'}
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button className="btn btn-success" onClick={approve} disabled={!canApprove || busy}>
          {busy ? 'Approving…' : `Approve version ${version}`}
        </button>
        <Link href={`/campaigns/${campaignId}`} className="btn btn-secondary">Back to editing</Link>
      </div>
    </section>
  );
}
