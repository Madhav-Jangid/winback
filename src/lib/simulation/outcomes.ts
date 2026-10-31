import { DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { uniform } from './random';

export const OUTCOME_SEED_VERSION = 'winback-outcomes-v1';
export const TREATMENT_REACTIVATION_RATE = 0.35;
export const CONTROL_REACTIVATION_RATE = 0.2;
export const TREATMENT_UNSUBSCRIBE_RATE = 0.025;
export const AVERAGE_ORDER_VALUE_MINOR = 25_000;

export interface OutcomeRecipient {
  customer_id: string;
  group_assignment: 'treatment' | 'control';
  eligibility_status: 'eligible' | 'ineligible';
}

export interface SimulatedOutcome {
  customer_id: string;
  group_assignment: OutcomeRecipient['group_assignment'];
  reactivated: boolean;
  revenue_minor: number;
  occurred_at: Date | null;
  simulation_seed: string;
  unsubscribed: boolean;
}

export function simulateRecipientOutcome(
  campaignId: string,
  campaignVersion: number,
  recipient: OutcomeRecipient,
  deliveredCustomerIds: ReadonlySet<string>,
): SimulatedOutcome {
  const seed = `${OUTCOME_SEED_VERSION}:${campaignId}:v${campaignVersion}:${recipient.customer_id}`;
  const delivered = recipient.group_assignment === 'treatment' && deliveredCustomerIds.has(recipient.customer_id);
  const canReactivate = recipient.eligibility_status === 'eligible' &&
    (recipient.group_assignment === 'control' || delivered);
  const probability = recipient.group_assignment === 'treatment'
    ? TREATMENT_REACTIVATION_RATE
    : CONTROL_REACTIVATION_RATE;
  const reactivated = canReactivate && uniform(`${seed}:reactivated`) < probability;
  const occurredAt = reactivated
    ? new Date(DEMO_REFERENCE_DATE.getTime() + Math.floor(uniform(`${seed}:occurred-at`) * 30) * 86_400_000)
    : null;

  return {
    customer_id: recipient.customer_id,
    group_assignment: recipient.group_assignment,
    reactivated,
    revenue_minor: reactivated ? AVERAGE_ORDER_VALUE_MINOR : 0,
    occurred_at: occurredAt,
    simulation_seed: seed,
    unsubscribed: delivered && uniform(`${seed}:unsubscribed`) < TREATMENT_UNSUBSCRIBE_RATE,
  };
}
