import type { Queryable } from '@/lib/db/types';
import type { Offer } from '@/lib/campaigns/rules';
import { SEGMENT_TYPES, type SegmentType } from '@/lib/campaigns/segments';
import type { Channel } from '@/lib/campaigns/rules';
import type { CampaignStatus } from '@/types';

export interface CampaignRecord {
  id: string;
  merchant_id: string;
  name: string;
  goal: string;
  segment_type: SegmentType;
  segment_snapshot: Record<string, unknown>;
  offer: Offer;
  budget_minor: number;
  frequency_cap: number;
  cooldown_days: number;
  language: string;
  channel: Channel;
  original_message: string;
  localized_message: string | null;
  plan_rationale: string | null;
  plan_source: string | null;
  translation_source: string | null;
  status: CampaignStatus;
  version: number;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

type Row = Omit<CampaignRecord, 'segment_type' | 'offer' | 'budget_minor' | 'approved_at' | 'created_at' | 'updated_at' | 'original_message'> & {
  offer_config: Offer;
  budget_minor: string;
  original_message: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `id, merchant_id, name, goal, segment_snapshot, offer_config, budget_minor, frequency_cap, cooldown_days,
  language, channel, original_message, localized_message, plan_rationale, plan_source, translation_source,
  status, version, approved_version, approved_by, approved_at, created_at, updated_at`;

function toRecord(row: Row): CampaignRecord {
  const { offer_config, segment_snapshot, ...rest } = row;
  const snapshot = (segment_snapshot ?? {}) as Record<string, unknown>;
  const type = snapshot.segment_type;
  return {
    ...rest,
    segment_snapshot: snapshot,
    segment_type: (SEGMENT_TYPES as readonly unknown[]).includes(type) ? (type as SegmentType) : 'at_risk',
    offer: offer_config,
    budget_minor: Number(row.budget_minor),
    original_message: row.original_message ?? '',
    approved_at: row.approved_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function getCampaign(
  db: Queryable,
  merchantId: string,
  id: string,
  { forUpdate = false } = {},
): Promise<CampaignRecord | null> {
  const result = await db.query<Row>(
    `SELECT ${COLUMNS} FROM campaigns WHERE merchant_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [merchantId, id],
  );
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

export async function listCampaigns(db: Queryable, merchantId: string, statuses?: readonly CampaignStatus[]): Promise<CampaignRecord[]> {
  const result = await db.query<Row>(
    `SELECT ${COLUMNS} FROM campaigns
      WHERE merchant_id = $1 AND ($2::text[] IS NULL OR status = ANY($2::text[]))
      ORDER BY updated_at DESC, id`,
    [merchantId, statuses ?? null],
  );
  return result.rows.map(toRecord);
}

export interface CampaignWrite {
  name: string;
  goal: string;
  segment_snapshot: Record<string, unknown>;
  offer: Offer;
  budget_minor: number;
  frequency_cap: number;
  cooldown_days: number;
  language: string;
  channel: Channel;
  original_message: string;
  status: CampaignStatus;
}

export async function insertCampaign(db: Queryable, merchantId: string, c: CampaignWrite): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO campaigns (merchant_id, name, goal, segment_snapshot, offer_config, budget_minor, frequency_cap,
       cooldown_days, language, channel, original_message, status, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1)
     RETURNING id`,
    [merchantId, c.name, c.goal, JSON.stringify(c.segment_snapshot), JSON.stringify(c.offer), c.budget_minor,
      c.frequency_cap, c.cooldown_days, c.language, c.channel, c.original_message, c.status],
  );
  return result.rows[0].id;
}

export async function updateCampaignRow(
  db: Queryable,
  merchantId: string,
  id: string,
  c: CampaignWrite & { version: number; clear_approval: boolean },
): Promise<void> {
  await db.query(
    `UPDATE campaigns SET name = $3, goal = $4, segment_snapshot = $5, offer_config = $6, budget_minor = $7,
       frequency_cap = $8, cooldown_days = $9, language = $10, channel = $11, original_message = $12,
       status = $13, version = $14,
       approved_version = CASE WHEN $15 THEN NULL ELSE approved_version END,
       approved_by = CASE WHEN $15 THEN NULL ELSE approved_by END,
       approved_at = CASE WHEN $15 THEN NULL ELSE approved_at END,
       updated_at = NOW()
     WHERE merchant_id = $1 AND id = $2`,
    [merchantId, id, c.name, c.goal, JSON.stringify(c.segment_snapshot), JSON.stringify(c.offer), c.budget_minor,
      c.frequency_cap, c.cooldown_days, c.language, c.channel, c.original_message, c.status, c.version, c.clear_approval],
  );
}

export async function setCampaignStatus(db: Queryable, merchantId: string, id: string, status: CampaignStatus): Promise<void> {
  await db.query(
    'UPDATE campaigns SET status = $3, updated_at = NOW() WHERE merchant_id = $1 AND id = $2',
    [merchantId, id, status],
  );
}
