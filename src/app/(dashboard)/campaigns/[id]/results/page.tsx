import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { connection } from 'next/server';
import { z } from 'zod';
import ResultsPanel from '@/components/campaigns/ResultsPanel';
import { DatabaseErrorState, LoadingState } from '@/components/ui/PageStates';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { AppError } from '@/lib/errors';
import { getCampaignResults, type CampaignResultsView } from '@/lib/metrics/service';
import { getCampaign } from '@/lib/repositories/campaigns';
import type { CampaignRecord } from '@/lib/repositories/campaigns';

type Params = Promise<{ id: string }>;

export default function CampaignResultsPage({ params }: { params: Params }) {
  return (
    <div className="fade-in">
      <Suspense fallback={<LoadingState label="Loading campaign results…" />}>
        <CampaignResultsView params={params} />
      </Suspense>
    </div>
  );
}

async function CampaignResultsView({ params }: { params: Params }) {
  await connection();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  let campaign: CampaignRecord | null = null;
  let results: CampaignResultsView | null = null;
  try {
    const db = getPool();
    campaign = await getCampaign(db, DEMO_MERCHANT_ID, id);
    if (campaign?.status === 'completed') results = await getCampaignResults(db, DEMO_MERCHANT_ID, id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    console.error('[Campaign results page]', error instanceof Error ? error.message : error);
    return <DatabaseErrorState what="campaign results" />;
  }
  if (!campaign) notFound();

  return (
    <>
      <Link href={`/campaigns/${id}/send`} className="back-link">Campaign execution</Link>
      <header className="page-header results-page-header">
        <p className="eyebrow">Campaign measurement</p>
        <h1 className="page-title">{campaign.name}</h1>
        <p className="page-subtitle">Treatment and control outcomes for this simulated winback campaign.</p>
      </header>
      <ResultsPanel campaignId={id} campaignStatus={campaign.status} initialResults={results} />
    </>
  );
}
