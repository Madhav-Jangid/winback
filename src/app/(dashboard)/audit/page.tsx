import { Suspense } from 'react';
import { connection } from 'next/server';
import { DatabaseErrorState, LoadingState } from '@/components/ui/PageStates';
import AuditTable from '@/components/audit/AuditTable';
import { AUDIT_EVENT_TYPES } from '@/lib/audit/events';
import { listCampaigns } from '@/lib/campaigns/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';

export default function AuditPage() {
  return (
    <div className="fade-in">
      <Suspense fallback={<LoadingState label="Loading audit log…" />}>
        <AuditView />
      </Suspense>
    </div>
  );
}

async function AuditView() {
  await connection();
  let campaigns: Awaited<ReturnType<typeof listCampaigns>>;
  try {
    campaigns = await listCampaigns(getPool(), DEMO_MERCHANT_ID);
  } catch (error) {
    console.error('[Audit page]', error instanceof Error ? error.message : error);
    return <DatabaseErrorState what="audit filters" />;
  }

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Governance</p>
        <h1 className="page-title">Audit log</h1>
        <p className="page-subtitle">A chronological record of campaign decisions and simulated activity.</p>
      </header>
      <div className="demo-banner" role="note">
        <span className="demo-banner-mark" aria-hidden="true">DEMO</span>
        <span><strong>Simulation workspace.</strong> Events contain no message copy or customer contact details.</span>
      </div>
      <AuditTable
        campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
        eventTypes={AUDIT_EVENT_TYPES}
      />
    </>
  );
}
