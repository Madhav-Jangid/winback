-- Winback AI — simulated messaging and outcomes (Phases 8 and 9)

-- Messages: one row per customer per campaign, reused on retry; count delivery attempts.
ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_messages_one_per_customer ON campaign_messages (campaign_id, customer_id);
-- A message is delivered exactly when it has a delivery time.
ALTER TABLE campaign_messages
  ADD CONSTRAINT campaign_messages_delivery_consistent CHECK ((status = 'delivered') = (delivered_at IS NOT NULL));

-- Outcomes: simulated unsubscribes (an event of the simulation only, never a consent change) and
-- the assumptions the results were computed with.
ALTER TABLE campaign_outcomes ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE campaign_outcomes
  ADD CONSTRAINT campaign_outcomes_unsubscribe_treatment_only CHECK (NOT unsubscribed OR group_assignment = 'treatment'),
  ADD CONSTRAINT campaign_outcomes_revenue_needs_reactivation CHECK (reactivated OR revenue_minor = 0);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS results_meta JSONB;
