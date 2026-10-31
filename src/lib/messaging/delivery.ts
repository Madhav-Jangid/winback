/**
 * Simulated delivery. Nothing here talks to a messaging provider: a message is "delivered" or
 * "failed" by a seeded draw, and the results are labelled simulated everywhere they are shown.
 * The seed makes every run reproducible; each retry attempt is an independent draw.
 */
import { uniform } from '@/lib/simulation/random';

/** Share of simulated messages that fail on an attempt. */
export const DELIVERY_FAILURE_RATE = 0.05;
export const DELIVERY_FAILURE_CODE = 'SIMULATED_DELIVERY_FAILURE';

export interface DeliveryAttempt {
  campaign_id: string;
  customer_id: string;
  /** 1 for the first attempt, 2 for the first retry, and so on. */
  attempt: number;
}

export type DeliveryResult = { ok: true } | { ok: false; code: string };
export type DeliverFn = (attempt: DeliveryAttempt) => DeliveryResult;

export function simulatedDelivery(seed: string, failureRate: number = DELIVERY_FAILURE_RATE): DeliverFn {
  return ({ campaign_id, customer_id, attempt }) =>
    uniform(`delivery:${seed}:${campaign_id}:${customer_id}:${attempt}`) < failureRate
      ? { ok: false, code: DELIVERY_FAILURE_CODE }
      : { ok: true };
}

/** Idempotency key: at most one message per campaign version and customer, whatever happens. */
export const messageKey = (campaignId: string, customerId: string, version: number): string =>
  `${campaignId}:${customerId}:v${version}`;
