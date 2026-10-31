/**
 * Winback AI — Audit Service
 * Append-only. Metadata holds no secrets, message text, or contact details.
 */

import { getPool } from '@/lib/db/pool';
import type { Queryable } from '@/lib/db/types';
import type { AUDIT_EVENT_TYPES } from './events';

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditInput {
  merchant_id: string;
  campaign_id?: string | null;
  actor_type?: string;
  actor_id?: string;
  event_type: AuditEventType;
  entity_type: string;
  entity_id: string;
  metadata?: Record<string, unknown>;
}

const COLUMNS = 8;

const valuesOf = (e: AuditInput): unknown[] => [
  e.merchant_id,
  e.campaign_id ?? null,
  e.actor_type ?? 'merchant',
  e.actor_id ?? 'demo-merchant',
  e.event_type,
  e.entity_type,
  e.entity_id,
  JSON.stringify(e.metadata ?? {}),
];

export async function writeAuditEvent(params: AuditInput, db: Queryable = getPool()): Promise<void> {
  await writeAuditEvents([params], db);
}

/** Write many events in one statement (one round trip), e.g. one per recipient of a send. */
export async function writeAuditEvents(events: readonly AuditInput[], db: Queryable = getPool()): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    const placeholders = chunk
      .map((_, row) => `(${Array.from({ length: COLUMNS }, (__, c) => `$${row * COLUMNS + c + 1}`).join(', ')})`)
      .join(', ');
    await db.query(
      `INSERT INTO audit_events (merchant_id, campaign_id, actor_type, actor_id, event_type, entity_type, entity_id, metadata)
       VALUES ${placeholders}`,
      chunk.flatMap(valuesOf),
    );
  }
}
