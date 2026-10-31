import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';
import SendProgressPanel from '@/components/campaigns/SendProgressPanel';
import { DatabaseErrorState, LoadingState } from '@/components/ui/PageStates';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { AppError } from '@/lib/errors';
import { getSendProgress } from '@/lib/messaging/service';
import { getCampaign } from '@/lib/repositories/campaigns';
import type { SendProgress } from '@/lib/messaging/progress';

type Params = Promise<{ id: string }>;

export default function SendPage({ params }: { params: Params }) {
  return (
    <div className="fade-in">
      <Suspense fallback={<LoadingState label="Loading send progress…" />}>
        <SendView params={params} />
      </Suspense>
    </div>
  );
}

async function SendView({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  let loaded: { campaignName: string; campaignVersion: number; progress: SendProgress } | null = null;

  try {
    const db = getPool();
    const campaign = await getCampaign(db, DEMO_MERCHANT_ID, id);
    if (campaign) {
      loaded = {
        campaignName: campaign.name,
        campaignVersion: campaign.version,
        progress: await getSendProgress(db, DEMO_MERCHANT_ID, id),
      };
    }
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    console.error('[Send page]', err instanceof Error ? err.message : err);
    return <DatabaseErrorState what="the send progress" />;
  }

  if (!loaded) notFound();
  const { campaignName, campaignVersion, progress } = loaded;

  return (
    <>
      <Link href={`/campaigns/${id}/review`} className="back-link">
        <ArrowLeft size={14} aria-hidden="true" /> Review &amp; approval
      </Link>
      <div className="page-header">
        <h1 className="page-title">Simulate send</h1>
        <p className="page-subtitle">{campaignName} · version {campaignVersion}</p>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="form-help" style={{ marginBottom: '0.75rem' }}>
          Nothing is sent to real customers. Each message is a simulated delivery record with a seeded delivery outcome.
          Repeating this action is safe — it resumes where it left off and never duplicates a send.
        </p>
        <SendProgressPanel
          campaignId={id}
          initial={progress}
          refreshInterval={3000}
        />
      </div>
    </>
  );
}
