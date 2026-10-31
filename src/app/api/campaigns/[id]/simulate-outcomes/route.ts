import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { query, withTransaction } from '@/lib/db/pool';
import { writeAuditEvent } from '@/lib/audit/service';

import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';

function seededRandom(seed: string): number {
  const hash = createHash('sha256').update(seed).digest('hex');
  return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`, [id, DEMO_MERCHANT_ID]);
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }

    const campaign = campaignRes.rows[0] as Record<string, unknown>;
    if (campaign.status !== 'sent' && campaign.status !== 'measuring') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: 'Campaign must be sent before simulating outcomes.' } },
        { status: 409 },
      );
    }

    await query(`UPDATE campaigns SET status = 'measuring', updated_at = NOW() WHERE id = $1`, [id]);

    // Get recipients
    const recipientsRes = await query<{
      customer_id: string;
      group_assignment: string;
      eligibility_status: string;
    }>(`SELECT customer_id, group_assignment, eligibility_status FROM campaign_recipients WHERE campaign_id = $1`, [id]);

    await withTransaction(async (client) => {
      for (const r of recipientsRes.rows) {
        const simulationSeed = `outcome-${id}-${r.customer_id}-v1`;

        // Check if outcome already exists (idempotency)
        const existing = await client.query(
          `SELECT id FROM campaign_outcomes WHERE campaign_id = $1 AND customer_id = $2`,
          [id, r.customer_id],
        );
        if (existing.rows.length > 0) continue;

        // Determine reactivation probability
        // Treatment group: 35% reactivation (simulated lift effect)
        // Control group: 20% baseline
        const baseRate = r.group_assignment === 'treatment' ? 0.35 : 0.20;
        const rand = seededRandom(simulationSeed);
        const reactivated = rand < baseRate && r.eligibility_status === 'eligible';

        // Simulate revenue if reactivated
        const revenueRand = seededRandom(simulationSeed + '-revenue');
        const revenueMajor = reactivated ? Math.round(150 + revenueRand * 200) : 0;
        const revenueMinor = revenueMajor * 100;

        await client.query(
          `INSERT INTO campaign_outcomes 
            (campaign_id, customer_id, group_assignment, reactivated, revenue_minor, occurred_at, simulation_seed)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            r.customer_id,
            r.group_assignment,
            reactivated,
            revenueMinor,
            reactivated ? new Date().toISOString() : null,
            simulationSeed,
          ],
        );
      }

      await client.query(`UPDATE campaigns SET status = 'completed', updated_at = NOW() WHERE id = $1`, [id]);
    });

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: id,
      event_type: 'outcome_simulation_completed',
      entity_type: 'campaign',
      entity_id: id,
    });

    return NextResponse.json({ status: 'completed', message: 'Outcomes simulated successfully.' });
  } catch (err) {
    console.error('[Simulate Outcomes API]', err);
    return NextResponse.json({ error: { code: 'OUTCOME_FAILED', message: 'Outcome simulation failed.' } }, { status: 500 });
  }
}
