/**
 * Who a campaign reaches (FR-04, FR-08, FR-11). Pure: works on customer profiles, which already
 * carry the consent, opt-out and frequency verdict from the shared eligibility check, evaluated
 * with the campaign's own cooldown and cap.
 *
 * Order of decisions, which is what the stored snapshot records:
 *  1. Not in the segment: not a recipient at all.
 *  2. Not contactable (consent, opt-out, frequency): suppressed, outside the experiment.
 *  3. Contactable: assigned treatment or control by a stable hash. Control is never messaged.
 *  4. Treatment is served in a fixed order (customer id) until the budget runs out; the rest are
 *     suppressed as BUDGET_EXCEEDED. Each message reserves one redemption's cost, so the budget
 *     can never be exceeded (E-09).
 */
import { offerCostPerRedemptionMinor, type Offer } from '@/lib/campaigns/rules';
import { isSegmentMember, previewSegment, type SegmentType } from '@/lib/campaigns/segments';
import type { CustomerProfile } from '@/lib/customers/service';
import { assignGroup } from '@/lib/experiments/assignment';
import type { SuppressionReason } from '@/types';
import type { RecipientRow } from '@/lib/repositories/recipients';

export interface RecipientCampaign {
  id: string;
  segment_type: SegmentType;
  budget_minor: number;
  offer: Offer;
}

export interface BudgetPlan {
  budget_minor: number;
  /** Reserved per message: one redemption's cost. Null when it cannot be determined. */
  cost_per_message_minor: number | null;
  /** Most messages the budget allows; null means unlimited (a zero-cost offer). */
  max_messages: number | null;
  reserved_minor: number;
  remaining_minor: number;
}

export interface RecipientSummary {
  /** Customers matching the segment rule. */
  members: number;
  /** Members who may be contacted (before the control split and the budget). */
  contactable: number;
  treatment: number;
  control: number;
  /** Treatment customers who will actually be messaged. */
  sendable: number;
  suppressed: Partial<Record<SuppressionReason, number>>;
  /** Customers excluded from risk-based segments for lacking a purchase rhythm (not members). */
  insufficient_history: number;
}

export interface RecipientEvaluation {
  decisions: RecipientRow[];
  summary: RecipientSummary;
  budget: BudgetPlan;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function planBudget(budgetMinor: number, costPerMessageMinor: number | null, messages: number): BudgetPlan {
  if (costPerMessageMinor === null) {
    return { budget_minor: budgetMinor, cost_per_message_minor: null, max_messages: 0, reserved_minor: 0, remaining_minor: budgetMinor };
  }
  const max = costPerMessageMinor === 0 ? null : Math.floor(budgetMinor / costPerMessageMinor);
  const sent = max === null ? messages : Math.min(messages, max);
  return {
    budget_minor: budgetMinor,
    cost_per_message_minor: costPerMessageMinor,
    max_messages: max,
    reserved_minor: sent * costPerMessageMinor,
    remaining_minor: budgetMinor - sent * costPerMessageMinor,
  };
}

export function evaluateRecipients(profiles: readonly CustomerProfile[], campaign: RecipientCampaign): RecipientEvaluation {
  const assign = (customerId: string) => assignGroup(campaign.id, customerId);
  const preview = previewSegment([...profiles], campaign.segment_type, assign);
  const members = profiles.filter((p) => isSegmentMember(p, campaign.segment_type)).sort(byId);

  const decisions: RecipientRow[] = [];
  const suppressed: Partial<Record<SuppressionReason, number>> = {};
  const suppress = (reason: SuppressionReason) => { suppressed[reason] = (suppressed[reason] ?? 0) + 1; };
  const treatment: CustomerProfile[] = [];
  let control = 0;

  for (const p of members) {
    if (!p.contact.eligible) {
      const reason = p.contact.reason ?? 'NOT_ELIGIBLE';
      decisions.push({ customer_id: p.id, group_assignment: null, eligibility_status: 'ineligible', suppression_reason: reason });
      suppress(reason);
    } else if (assign(p.id) === 'control') {
      decisions.push({ customer_id: p.id, group_assignment: 'control', eligibility_status: 'eligible', suppression_reason: 'CONTROL_GROUP' });
      suppress('CONTROL_GROUP');
      control += 1;
    } else {
      treatment.push(p);
    }
  }

  const cost = offerCostPerRedemptionMinor(campaign.offer, preview.avg_order_value_minor);
  const budget = planBudget(campaign.budget_minor, cost, treatment.length);
  let sendable = 0;
  for (const p of treatment) { // already in id order
    const withinBudget = budget.max_messages === null || sendable < budget.max_messages;
    if (withinBudget) {
      sendable += 1;
      decisions.push({ customer_id: p.id, group_assignment: 'treatment', eligibility_status: 'eligible', suppression_reason: null });
    } else {
      decisions.push({ customer_id: p.id, group_assignment: 'treatment', eligibility_status: 'eligible', suppression_reason: 'BUDGET_EXCEEDED' });
      suppress('BUDGET_EXCEEDED');
    }
  }

  return {
    decisions,
    summary: {
      members: members.length,
      contactable: treatment.length + control,
      treatment: treatment.length,
      control,
      sendable,
      suppressed,
      insufficient_history: preview.excluded.insufficient_history,
    },
    budget,
  };
}
