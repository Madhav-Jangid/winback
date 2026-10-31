/**
 * Winback AI — Audit Service
 */

import { query } from '@/lib/db/pool';

export type AuditEventType =
  | 'campaign_created'
  | 'campaign_updated'
  | 'plan_generated'
  | 'translation_requested'
  | 'translation_completed'
  | 'translation_failed'
  | 'approval_granted'
  | 'approval_invalidated'
  | 'send_simulation_started'
  | 'send_simulation_completed'
  | 'send_simulation_failed'
  | 'recipient_sent'
  | 'recipient_suppressed'
  | 'opt_out_recorded'
  | 'outcome_simulation_completed'
  | 'demo_reset';

export async function writeAuditEvent(params: {
  merchant_id: string;
  campaign_id?: string | null;
  actor_type?: string;
  actor_id?: string;
  event_type: AuditEventType;
  entity_type: string;
  entity_id: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO audit_events 
      (merchant_id, campaign_id, actor_type, actor_id, event_type, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.merchant_id,
      params.campaign_id ?? null,
      params.actor_type ?? 'merchant',
      params.actor_id ?? 'demo-merchant',
      params.event_type,
      params.entity_type,
      params.entity_id,
      JSON.stringify(params.metadata ?? {}),
    ],
  );
}
