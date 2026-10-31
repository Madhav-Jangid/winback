import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db/pool';
import type { Customer } from '@/types';
import { writeAuditEvent } from '@/lib/audit/service';
import { assessRisk } from '@/lib/risk/engine';
import { checkEligibility } from '@/lib/eligibility/service';
import { assignGroup } from '@/lib/experiments/assignment';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`, [id, DEMO_MERCHANT_ID]);
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }

    const campaign = campaignRes.rows[0] as Record<string, unknown>;

    if (campaign.status !== 'ready_for_approval' && campaign.status !== 'draft') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: 'Campaign must be in ready_for_approval or draft state to approve.' } },
        { status: 409 },
      );
    }

    if (!campaign.original_message) {
      return NextResponse.json({ error: { code: 'NO_MESSAGE', message: 'Campaign must have a message before approval.' } }, { status: 409 });
    }

    // Calculate recipient preview before approval
    const customersRes = await query<Pick<Customer, 'id' | 'consent_status' | 'opted_out_at'>>(
      `SELECT c.id, c.consent_status, c.opted_out_at FROM customers c WHERE c.merchant_id = $1`,
      [DEMO_MERCHANT_ID],
    );

    const purchasesRes = await query<{ customer_id: string; occurred_at: string; status: string }>(
      `SELECT customer_id, occurred_at, status FROM purchases WHERE merchant_id = $1`,
      [DEMO_MERCHANT_ID],
    );

    const purchasesByCustomer = new Map<string, { occurred_at: string; status: string }[]>();
    for (const p of purchasesRes.rows) {
      if (!purchasesByCustomer.has(p.customer_id)) purchasesByCustomer.set(p.customer_id, []);
      purchasesByCustomer.get(p.customer_id)!.push(p);
    }

    const offerCostMinor = 500; // ₹5 per simulated message
    let remainingBudget = campaign.budget_minor as number;
    let treatmentCount = 0;
    let controlCount = 0;

    const recipients: Array<{
      customer_id: string;
      group_assignment: string;
      eligibility_status: string;
      suppression_reason: string | null;
    }> = [];

    for (const customer of customersRes.rows) {
      const purchases = purchasesByCustomer.get(customer.id) ?? [];
      const completedPurchases = purchases.filter((p) => p.status === 'completed');
      const risk = assessRisk(customer.id, completedPurchases);

      if (risk.status !== 'at_risk') {
        recipients.push({ customer_id: customer.id, group_assignment: 'treatment', eligibility_status: 'ineligible', suppression_reason: 'NOT_ELIGIBLE' });
        continue;
      }

      const group = assignGroup(id, customer.id);
      const elig = checkEligibility(
        customer,
        { frequency_cap: campaign.frequency_cap as number, cooldown_days: campaign.cooldown_days as number, budget_minor: campaign.budget_minor as number },
        { isControlGroup: group === 'control', frequencyRecord: null, remainingBudgetMinor: remainingBudget, offerCostMinor },
      );

      if (elig.eligible) {
        remainingBudget -= offerCostMinor;
        treatmentCount++;
      } else if (group === 'control' && risk.status === 'at_risk') {
        controlCount++;
      }

      recipients.push({
        customer_id: customer.id,
        group_assignment: group,
        eligibility_status: elig.eligible ? 'eligible' : 'ineligible',
        suppression_reason: elig.reason,
      });
    }

    await withTransaction(async (client) => {
      // Save approval
      await client.query(
        `UPDATE campaigns SET
          status = 'approved',
          approved_version = version,
          approved_by = 'demo-merchant',
          approved_at = NOW(),
          updated_at = NOW()
         WHERE id = $1`,
        [id],
      );

      // Upsert recipient assignments
      await client.query(`DELETE FROM campaign_recipients WHERE campaign_id = $1`, [id]);
      for (const r of recipients) {
        await client.query(
          `INSERT INTO campaign_recipients (campaign_id, customer_id, group_assignment, eligibility_status, suppression_reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, r.customer_id, r.group_assignment, r.eligibility_status, r.suppression_reason],
        );
      }
    });

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: id,
      event_type: 'approval_granted',
      entity_type: 'campaign',
      entity_id: id,
      metadata: {
        approved_by: 'demo-merchant',
        treatment_count: treatmentCount,
        control_count: controlCount,
        version: campaign.version,
      },
    });

    const updated = await query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    return NextResponse.json({
      campaign: updated.rows[0],
      treatment_count: treatmentCount,
      control_count: controlCount,
      total_recipients: recipients.length,
    });
  } catch (err) {
    console.error('[Approve API]', err);
    return NextResponse.json({ error: { code: 'APPROVAL_FAILED', message: 'Failed to approve campaign.' } }, { status: 500 });
  }
}
