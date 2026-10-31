-- Winback AI — Supabase hardening and extra constraints

-- Supabase exposes the public schema through its REST API using the publishable (anon) key,
-- which is shipped to the browser. This app reads and writes Postgres only from the server,
-- as the table owner. Enabling RLS with no policies blocks the API roles entirely while the
-- server connection is unaffected.
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_operations ENABLE ROW LEVEL SECURITY;

-- Defense in depth: also revoke direct grants from Supabase API roles when they exist.
DO $$
DECLARE
  t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOREACH t IN ARRAY ARRAY[
      'merchants', 'customers', 'purchases', 'campaigns', 'campaign_recipients',
      'campaign_messages', 'campaign_outcomes', 'audit_events', 'provider_operations'
    ] LOOP
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', t);
    END LOOP;
  END IF;
END $$;

-- Merchant time zone for date display and cadence-day calculations (PRD E-21).
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- Nonnegative money and sane campaign limits.
ALTER TABLE campaign_messages
  ADD CONSTRAINT campaign_messages_cost_nonnegative CHECK (simulated_cost_minor >= 0);
ALTER TABLE campaign_outcomes
  ADD CONSTRAINT campaign_outcomes_revenue_nonnegative CHECK (revenue_minor >= 0);
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_frequency_cap_positive CHECK (frequency_cap >= 1),
  ADD CONSTRAINT campaigns_cooldown_nonnegative CHECK (cooldown_days >= 0),
  ADD CONSTRAINT campaigns_version_positive CHECK (version >= 1);

-- Frequency caps apply across campaigns (PRD E-26), so look up a customer's recent messages fast.
CREATE INDEX IF NOT EXISTS idx_messages_customer_sent ON campaign_messages(customer_id, sent_at DESC);
