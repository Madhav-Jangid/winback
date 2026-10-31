'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Records an opt-out, as if the customer had asked to stop. Consent is managed here, never from campaign screens. */
export default function OptOutButton({ customerId, name }: { customerId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function optOut() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/opt-out`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? 'Could not record the opt-out.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirming(true)}>Record opt-out…</button>;
  }
  return (
    <div role="group" aria-label="Confirm opt-out" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <p className="form-help">
        {name} will no longer receive any campaign, including ones already approved. The demo data reset restores them.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn btn-sm btn-danger" onClick={optOut} disabled={busy}>{busy ? 'Recording…' : 'Yes, record opt-out'}</button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
