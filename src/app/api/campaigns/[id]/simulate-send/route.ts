import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import type { ConsentStatus } from '@/types';
import { writeAuditEvent } from '@/lib/audit/service';
import { checkEligibility } from '@/lib/eligibility/service';

import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`, [id, DEMO_MERCHANT_ID]);
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }

    const campaign = campaignRes.rows[0] as Record<string, unknown>;

    // Must be approved and version must match
    if (campaign.status !== 'approved') {
      return NextResponse.json(
        { error: { code: 'CAMPAIGN_APPROVAL_REQUIRED', message: 'Approve the current campaign version before simulating sends.' } },
        { status: 409 },
      );
    }

    if (campaign.approved_version !== campaign.version) {
      return NextResponse.json(
        { error: { code: 'STALE_APPROVAL', message: 'Campaign was modified after approval. Please reapprove.' } },
        { status: 409 },
      );
    }

    // Update to sending state
    await query(`UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1`, [id]);

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: id,
      event_type: 'send_simulation_started',
      entity_type: 'campaign',
      entity_id: id,
    });

    // Get eligible treatment recipients (re-validate at send time)
    const recipientsRes = await query<{
      id: string;
      customer_id: string;
      group_assignment: string;
      eligibility_status: string;
      suppression_reason: string | null;
    }>(
      `SELECT cr.*, c.consent_status, c.opted_out_at
       FROM campaign_recipients cr
       JOIN customers c ON c.id = cr.customer_id
       WHERE cr.campaign_id = $1`,
      [id],
    );

    const offerCostMinor = 500;
    let remainingBudget = campaign.budget_minor as number;
    let sent = 0;
    let suppressed = 0;
    let failed = 0;

    await withTransaction(async (client) => {
      for (const r of recipientsRes.rows) {
        if (r.group_assignment === 'control') continue; // Never message control group

        const customer = r as Record<string, unknown>;
        const elig = checkEligibility(
          { id: r.customer_id, consent_status: customer.consent_status as ConsentStatus, opted_out_at: customer.opted_out_at as string | null },
          { frequency_cap: campaign.frequency_cap as number, cooldown_days: campaign.cooldown_days as number, budget_minor: campaign.budget_minor as number },
          { isControlGroup: false, frequencyRecord: null, remainingBudgetMinor: remainingBudget, offerCostMinor },
        );

        const idempotencyKey = `send-${id}-${r.customer_id}-v${campaign.approved_version}`;

        // Check if already sent (idempotency)
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM campaign_messages WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        if (existing.rows.length > 0) continue;

        if (!elig.eligible) {
          // Update recipient suppression reason if changed
          await client.query(
            `UPDATE campaign_recipients SET suppression_reason = $1, eligibility_status = 'ineligible' WHERE campaign_id = $2 AND customer_id = $3`,
            [elig.reason, id, r.customer_id],
          );
          suppressed++;
          continue;
        }

        // Simulate delivery (deterministic: most succeed)
        const deliverySuccess = Math.random() > 0.05; // 95% delivery rate
        const status = deliverySuccess ? 'delivered' : 'failed';
        const now = new Date().toISOString();

        await client.query(
          `INSERT INTO campaign_messages 
            (campaign_id, customer_id, campaign_version, idempotency_key, status, simulated_cost_minor, sent_at, delivered_at, failure_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            r.customer_id,
            campaign.approved_version,
            idempotencyKey,
            status,
            offerCostMinor,
            now,
            deliverySuccess ? now : null,
            deliverySuccess ? null : 'SIMULATED_DELIVERY_FAILURE',
          ],
        );

        remainingBudget -= offerCostMinor;
        if (deliverySuccess) { sent++; } else { failed++; }
      }

      // Update campaign status
      await client.query(`UPDATE campaigns SET status = 'sent', updated_at = NOW() WHERE id = $1`, [id]);
    });

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: id,
      event_type: 'send_simulation_completed',
      entity_type: 'campaign',
      entity_id: id,
      metadata: { sent, suppressed, failed },
    });

    return NextResponse.json({ sent, suppressed, failed, status: 'sent' });
  } catch (err) {
    console.error('[Simulate Send API]', err);
    await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [id]).catch(() => { });
    return NextResponse.json({ error: { code: 'SEND_FAILED', message: 'Simulation failed.' } }, { status: 500 });
  }
}
