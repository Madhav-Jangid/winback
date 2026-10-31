-- Winback AI — Database Schema Migration
-- Run this to set up all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- merchants
-- ============================================================
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  default_budget_minor BIGINT NOT NULL DEFAULT 1000000,
  default_cooldown_days INT NOT NULL DEFAULT 30,
  default_frequency_cap INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- customers
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','consented','revoked')),
  opted_out_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_merchant_consent ON customers(merchant_id, consent_status);

-- ============================================================
-- purchases
-- ============================================================
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','refunded','cancelled')),
  source TEXT NOT NULL DEFAULT 'demo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchases_customer_date ON purchases(customer_id, occurred_at DESC);

-- ============================================================
-- campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  segment_snapshot JSONB,
  offer_config JSONB NOT NULL DEFAULT '{}',
  budget_minor BIGINT NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),
  frequency_cap INT NOT NULL DEFAULT 1,
  cooldown_days INT NOT NULL DEFAULT 30,
  language TEXT NOT NULL DEFAULT 'en',
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms','email')),
  original_message TEXT,
  localized_message TEXT,
  plan_rationale TEXT,
  plan_source TEXT,
  translation_source TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','planning','ready_for_approval','approved','sending','sent','measuring','completed','cancelled','failed'
  )),
  version INT NOT NULL DEFAULT 1,
  approved_version INT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_merchant_status ON campaigns(merchant_id, status, created_at DESC);

-- ============================================================
-- campaign_recipients
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  group_assignment TEXT NOT NULL CHECK (group_assignment IN ('treatment','control')),
  eligibility_status TEXT NOT NULL CHECK (eligibility_status IN ('eligible','ineligible')),
  suppression_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);

-- ============================================================
-- campaign_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  campaign_version INT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivered','failed')),
  simulated_cost_minor BIGINT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON campaign_messages(campaign_id);

-- ============================================================
-- campaign_outcomes
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  group_assignment TEXT NOT NULL CHECK (group_assignment IN ('treatment','control')),
  reactivated BOOLEAN NOT NULL DEFAULT FALSE,
  revenue_minor BIGINT NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ,
  simulation_seed TEXT NOT NULL,
  UNIQUE (campaign_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_outcomes_campaign ON campaign_outcomes(campaign_id);

-- ============================================================
-- audit_events
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_merchant ON audit_events(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_campaign ON audit_events(campaign_id) WHERE campaign_id IS NOT NULL;

-- ============================================================
-- provider_operations
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  request_fingerprint TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
