-- Winback AI — fix the control-group rule from 004.
--
-- 004 wrote: group_assignment IS DISTINCT FROM 'control' OR suppression_reason = 'CONTROL_GROUP'.
-- For a control row with no reason, `NULL = 'CONTROL_GROUP'` is unknown, and a CHECK accepts
-- unknown, so a control customer with no suppression reason (which reads as "will be messaged")
-- was allowed. IS NOT DISTINCT FROM treats NULL as a value, so it is rejected.
ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_control_not_messaged;
ALTER TABLE campaign_recipients
  ADD CONSTRAINT campaign_recipients_control_not_messaged
  CHECK (group_assignment IS DISTINCT FROM 'control' OR suppression_reason IS NOT DISTINCT FROM 'CONTROL_GROUP');
