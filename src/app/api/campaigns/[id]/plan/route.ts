import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { getCampaignPlanner } from '@/lib/providers/factory';
import { writeAuditEvent } from '@/lib/audit/service';
import { assessRisk } from '@/lib/risk/engine';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`, [id, DEMO_MERCHANT_ID]);
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }

    const campaign = campaignRes.rows[0] as Record<string, unknown>;
    const sendableStatuses = ['draft', 'planning', 'ready_for_approval'];
    if (!sendableStatuses.includes(campaign.status as string)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Cannot generate plan for campaign in '${campaign.status}' state.` } },
        { status: 409 },
      );
    }

    // Update status to planning
    await query(`UPDATE campaigns SET status = 'planning', updated_at = NOW() WHERE id = $1`, [id]);

    // Get eligible customer data for context (aggregate only, no PII)
    const purchasesRes = await query<{ customer_id: string; occurred_at: string; status: string }>(
      `SELECT p.customer_id, p.occurred_at, p.status 
       FROM purchases p
       JOIN customers c ON c.id = p.customer_id
       WHERE c.merchant_id = $1 AND c.consent_status = 'consented' AND c.opted_out_at IS NULL`,
      [DEMO_MERCHANT_ID],
    );

    const purchasesByCustomer = new Map<string, { occurred_at: string; status: string }[]>();
    for (const p of purchasesRes.rows) {
      if (!purchasesByCustomer.has(p.customer_id)) purchasesByCustomer.set(p.customer_id, []);
      purchasesByCustomer.get(p.customer_id)!.push(p);
    }

    const atRiskCustomers = [];
    for (const [custId, purchases] of purchasesByCustomer.entries()) {
      const completed = purchases.filter((p) => p.status === 'completed');
      const risk = assessRisk(custId, completed);
      if (risk.status === 'at_risk') {
        atRiskCustomers.push({ id: custId, cadence: risk.median_cadence_days, daysSince: risk.days_since_last_purchase });
      }
    }

    const offerConfig = campaign.offer_config as Record<string, unknown>;
    const segmentSnapshot = campaign.segment_snapshot as Record<string, unknown> | null;

    // Determine segment type for context
    const segmentType = segmentSnapshot?.segment_type ?? 'at_risk';
    const eligibleCustomers = segmentType === 'at_risk' ? atRiskCustomers : atRiskCustomers;

    const medianCadence = eligibleCustomers.length > 0
      ? eligibleCustomers.reduce((sum, c) => sum + (c.cadence ?? 30), 0) / eligibleCustomers.length
      : 30;

    const avgDaysSince = eligibleCustomers.length > 0
      ? eligibleCustomers.reduce((sum, c) => sum + (c.daysSince ?? 45), 0) / eligibleCustomers.length
      : 45;

    const merchantRes = await query(`SELECT * FROM merchants WHERE id = $1`, [DEMO_MERCHANT_ID]);
    const merchant = merchantRes.rows[0] as Record<string, unknown>;

    const planner = getCampaignPlanner();
    const planResult = await planner.generatePlan({
      merchant_type: merchant.business_type as string,
      goal: campaign.goal as string,
      segment_summary: {
        total_eligible: eligibleCustomers.length,
        median_cadence_days: Math.round(medianCadence),
        days_since_typical_purchase: Math.round(avgDaysSince),
      },
      allowed_offer_types: ['percentage_discount', 'fixed_discount', 'free_item', 'no_offer'],
      max_offer_value: 50,
      budget_minor: campaign.budget_minor as number,
      channel: campaign.channel as 'whatsapp' | 'sms' | 'email',
      language: campaign.language as string,
      safety_constraints: [
        'Do not promise rewards beyond what is configured',
        'Do not include any customer PII in the message',
        'Do not imply urgency unless an expiry date is explicitly set',
      ],
    });

    // Update campaign with plan results
    await query(
      `UPDATE campaigns SET
        original_message = $1,
        plan_rationale = $2,
        plan_source = $3,
        offer_config = jsonb_set(offer_config, '{type}', $4::jsonb),
        status = 'ready_for_approval',
        version = version + 1,
        approved_version = NULL,
        approved_by = NULL,
        approved_at = NULL,
        updated_at = NOW()
       WHERE id = $5`,
      [
        planResult.message_draft,
        planResult.rationale,
        planResult.source,
        JSON.stringify(planResult.offer_type),
        id,
      ],
    );

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: id,
      event_type: 'plan_generated',
      entity_type: 'campaign',
      entity_id: id,
      metadata: { source: planResult.source, offer_type: planResult.offer_type, warnings: planResult.warnings },
    });

    const updated = await query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    return NextResponse.json({ campaign: updated.rows[0], plan: planResult });
  } catch (err) {
    console.error('[Plan API]', err);
    await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [id]).catch(() => { });
    return NextResponse.json({ error: { code: 'PLAN_FAILED', message: 'Failed to generate campaign plan.' } }, { status: 500 });
  }
}
