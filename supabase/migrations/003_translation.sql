-- Winback AI — translation metadata (Phase 6)

-- Provenance of the localized message: who produced it, from which English text, in which
-- language, and whether the merchant edited it. Used to detect a stale translation.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS translation_meta JSONB;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_translation_source_valid
  CHECK (translation_source IS NULL OR translation_source IN ('sarvam', 'demo_fallback', 'manual'));
