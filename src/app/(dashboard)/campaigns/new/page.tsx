import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import CampaignBuilder from '@/components/campaigns/CampaignBuilder';
import { DatabaseErrorState, EmptyState, LoadingState } from '@/components/ui/PageStates';
import type { CampaignDraft } from '@/lib/campaigns/schema';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { getMerchantSettings, type MerchantSettings } from '@/lib/repositories/merchants';

export default function NewCampaignPage() {
  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">New winback campaign</h1>
        <p className="page-subtitle">Choose who to win back and what to offer. Nothing is sent until you approve it, and sending is simulated.</p>
      </div>
      <Suspense fallback={<LoadingState label="Loading merchant defaults…" />}>
        <NewCampaignForm />
      </Suspense>
    </div>
  );
}

async function NewCampaignForm() {
  await connection();
  let merchant: MerchantSettings | null;
  try {
    merchant = await getMerchantSettings(getPool(), DEMO_MERCHANT_ID);
  } catch (err) {
    console.error('[New campaign page]', err instanceof Error ? err.message : err);
    return <DatabaseErrorState what="merchant settings" />;
  }
  if (!merchant) {
    return (
      <EmptyState icon="🗂️" title="No demo data loaded">
        Run <code>npm run db:seed</code> or use <Link href="/">Reset demo data</Link> on the dashboard.
      </EmptyState>
    );
  }

  // Merchant defaults are visible and editable before approval (FR-05).
  const initial: CampaignDraft = {
    name: '',
    goal: 'Bring lapsed regulars back for another visit',
    segment_type: 'at_risk',
    offer: { type: 'percentage_discount', percent: 10, max_discount_minor: 10_000 },
    budget_minor: merchant.default_budget_minor,
    frequency_cap: merchant.default_frequency_cap,
    cooldown_days: merchant.default_cooldown_days,
    language: 'hi',
    channel: 'whatsapp',
    original_message: '',
    localized_message: '',
  };
  return <CampaignBuilder mode="create" initial={initial} currency={merchant.currency} />;
}
