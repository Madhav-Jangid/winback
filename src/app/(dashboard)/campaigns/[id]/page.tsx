import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';
import CampaignBuilder from '@/components/campaigns/CampaignBuilder';
import { DatabaseErrorState, LoadingState } from '@/components/ui/PageStates';
import { getCampaignView, type CampaignView } from '@/lib/campaigns/service';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { AppError } from '@/lib/errors';

type Params = Promise<{ id: string }>;

export default function CampaignPage({ params }: { params: Params }) {
  return (
    <div className="fade-in">
      <Link href="/campaigns" className="form-help" style={{ textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' }}>
        ← All campaigns
      </Link>
      <Suspense fallback={<LoadingState label="Loading campaign…" />}>
        <CampaignEditor params={params} />
      </Suspense>
    </div>
  );
}

async function CampaignEditor({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  let view: CampaignView;
  try {
    view = await getCampaignView(getPool(), DEMO_MERCHANT_ID, id, getAppNow());
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    console.error('[Campaign page]', err instanceof Error ? err.message : err);
    return <DatabaseErrorState what="this campaign" />;
  }

  const c = view.campaign;
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{c.name}</h1>
        <p className="page-subtitle">{c.goal}</p>
      </div>
      <CampaignBuilder
        mode="edit"
        campaignId={c.id}
        version={c.version}
        status={c.status}
        approvedVersion={c.approved_version}
        editable={view.editable}
        serverReadiness={view.readiness}
        planSource={c.plan_source}
        planRationale={c.plan_rationale}
        currency={view.currency}
        initial={{
          name: c.name, goal: c.goal, segment_type: c.segment_type, offer: c.offer, budget_minor: c.budget_minor,
          frequency_cap: c.frequency_cap, cooldown_days: c.cooldown_days, language: c.language, channel: c.channel,
          original_message: c.original_message,
        }}
      />
    </>
  );
}
