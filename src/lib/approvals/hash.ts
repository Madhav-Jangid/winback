/**
 * What an approval covers. The hash is over every field that changes what customers receive or
 * what it costs, plus the version. Name and goal are internal labels and are not included.
 * Provider timestamps and warnings are not included either: provenance that matters (who wrote
 * the text, from which English, in which language, edited or not) is.
 */
import { createHash } from 'node:crypto';
import type { CampaignRecord } from '@/lib/repositories/campaigns';
import { stableStringify } from '@/lib/stable-json';

export function approvalHash(c: CampaignRecord): string {
  const t = c.translation;
  return createHash('sha256').update(stableStringify({
    version: c.version,
    segment_type: c.segment_type,
    offer: c.offer,
    budget_minor: c.budget_minor,
    frequency_cap: c.frequency_cap,
    cooldown_days: c.cooldown_days,
    language: c.language,
    channel: c.channel,
    original_message: c.original_message,
    localized_message: c.localized_message,
    translation: t && { source: t.source, model: t.model, language: t.language, source_text: t.source_text, edited: t.edited },
  })).digest('hex');
}
