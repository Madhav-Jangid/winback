-- Winback AI — approval binding and recipient snapshot (Phase 7)

-- Hash of every material field approved, so a send can prove it is sending what was approved.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approval_hash TEXT;

-- campaign_recipients is the experiment snapshot taken at approval.
--   group_assignment NULL    : not in the experiment (suppressed before assignment)
--   group_assignment treatment: eligible and in the messaged group
--   group_assignment control : eligible and held back; never messaged
-- suppression_reason is why a customer will NOT be messaged (NULL = will be messaged).
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS campaign_version INT NOT NULL DEFAULT 1;
ALTER TABLE campaign_recipients ALTER COLUMN group_assignment DROP NOT NULL;
ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_group_assignment_check;

ALTER TABLE campaign_recipients
  ADD CONSTRAINT campaign_recipients_group_valid
    CHECK (group_assignment IS NULL OR group_assignment IN ('treatment', 'control')),
  ADD CONSTRAINT campaign_recipients_reason_valid
    CHECK (suppression_reason IS NULL OR suppression_reason IN (
      'CONSENT_UNKNOWN', 'OPTED_OUT', 'CONTROL_GROUP', 'FREQUENCY_CAP', 'BUDGET_EXCEEDED', 'NOT_ELIGIBLE', 'INSUFFICIENT_HISTORY')),
  -- A control customer is never messaged, whatever else is true.
  ADD CONSTRAINT campaign_recipients_control_not_messaged
    CHECK (group_assignment IS DISTINCT FROM 'control' OR suppression_reason = 'CONTROL_GROUP'),
  -- Anyone outside the experiment must say why.
  ADD CONSTRAINT campaign_recipients_excluded_has_reason
    CHECK (group_assignment IS NOT NULL OR (eligibility_status = 'ineligible' AND suppression_reason IS NOT NULL));
