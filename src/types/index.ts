// ============================================================
// Core domain types for Winback AI
// ============================================================

export type ConsentStatus = 'unknown' | 'consented' | 'revoked';
export type PurchaseStatus = 'completed' | 'refunded' | 'cancelled';
export type CampaignStatus =
  | 'draft'
  | 'planning'
  | 'ready_for_approval'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'measuring'
  | 'completed'
  | 'cancelled'
  | 'failed';
export type GroupAssignment = 'treatment' | 'control';
export type EligibilityStatus = 'eligible' | 'ineligible';
export type SuppressionReason =
  | 'CONSENT_UNKNOWN'
  | 'OPTED_OUT'
  | 'CONTROL_GROUP'
  | 'FREQUENCY_CAP'
  | 'BUDGET_EXCEEDED'
  | 'NOT_ELIGIBLE'
  | 'INSUFFICIENT_HISTORY';
export type OfferType = 'percentage_discount' | 'fixed_discount' | 'free_item' | 'no_offer';
export type Channel = 'whatsapp' | 'sms' | 'email';
export type MessageStatus = 'queued' | 'delivered' | 'failed';
export type ProviderSource = 'gemini' | 'sarvam' | 'demo_fallback';

// ============================================================
// DB Entity Types
// ============================================================

export interface Merchant {
  id: string;
  name: string;
  business_type: string;
  currency: string;
  default_budget_minor: number;
  default_cooldown_days: number;
  default_frequency_cap: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  merchant_id: string;
  display_name: string;
  preferred_language: string;
  consent_status: ConsentStatus;
  opted_out_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Purchase {
  id: string;
  merchant_id: string;
  customer_id: string;
  occurred_at: string;
  amount_minor: number;
  currency: string;
  status: PurchaseStatus;
  source: string;
  created_at: string;
}

export interface OfferConfig {
  type: OfferType;
  value?: number;
  description?: string;
  minimum_order_value_minor?: number;
  max_discount_minor?: number;
}

export interface Campaign {
  id: string;
  merchant_id: string;
  name: string;
  goal: string;
  segment_snapshot: Record<string, unknown> | null;
  offer_config: OfferConfig;
  budget_minor: number;
  frequency_cap: number;
  cooldown_days: number;
  language: string;
  channel: Channel;
  original_message: string | null;
  localized_message: string | null;
  plan_rationale: string | null;
  plan_source: ProviderSource | null;
  translation_source: ProviderSource | null;
  status: CampaignStatus;
  version: number;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  customer_id: string;
  group_assignment: GroupAssignment;
  eligibility_status: EligibilityStatus;
  suppression_reason: SuppressionReason | null;
  created_at: string;
}

export interface CampaignMessage {
  id: string;
  campaign_id: string;
  customer_id: string;
  campaign_version: number;
  idempotency_key: string;
  status: MessageStatus;
  simulated_cost_minor: number;
  sent_at: string | null;
  delivered_at: string | null;
  failure_code: string | null;
  created_at: string;
}

export interface CampaignOutcome {
  id: string;
  campaign_id: string;
  customer_id: string;
  group_assignment: GroupAssignment;
  reactivated: boolean;
  revenue_minor: number;
  occurred_at: string | null;
  simulation_seed: string;
}

export interface AuditEvent {
  id: string;
  merchant_id: string;
  campaign_id: string | null;
  actor_type: string;
  actor_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// Risk / Eligibility
// ============================================================

export type RiskStatus = 'at_risk' | 'healthy' | 'insufficient_history' | 'opted_out';

export interface RiskResult {
  customer_id: string;
  status: RiskStatus;
  last_purchase_at: string | null;
  median_cadence_days: number | null;
  days_since_last_purchase: number | null;
  threshold_days: number | null;
  reason: string;
}

// ============================================================
// Providers
// ============================================================

export interface CampaignPlanInput {
  merchant_type: string;
  goal: string;
  segment_summary: {
    total_eligible: number;
    median_cadence_days: number;
    days_since_typical_purchase: number;
  };
  allowed_offer_types: OfferType[];
  max_offer_value: number;
  budget_minor: number;
  channel: Channel;
  language: string;
  safety_constraints: string[];
}

export interface CampaignPlanResult {
  rationale: string;
  target_segment_description: string;
  offer_type: OfferType;
  offer_value: number | null;
  offer_description: string;
  message_draft: string;
  experiment_duration_days: number;
  assumptions: string[];
  warnings: string[];
  source: ProviderSource;
}

export interface TranslationInput {
  text: string;
  source_language: string;
  target_language: string;
}

export interface TranslationResult {
  original: string;
  translated: string;
  source: ProviderSource;
  status: 'success' | 'failed' | 'fallback';
  error?: string;
}

// ============================================================
// API Response shapes
// ============================================================

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface DashboardStats {
  total_customers: number;
  at_risk_customers: number;
  draft_campaigns: number;
  completed_campaigns: number;
  total_simulated_reactivations: number;
  total_estimated_revenue_minor: number;
  recent_campaigns: Campaign[];
}

export interface CustomerWithRisk extends Customer {
  risk: RiskResult | null;
  purchase_count: number;
  last_purchase_at: string | null;
}

export interface SegmentPreview {
  segment_type: string;
  total: number;
  eligible: number;
  excluded_no_consent: number;
  excluded_opted_out: number;
  excluded_insufficient_history: number;
  excluded_frequency_cap: number;
  excluded_other: number;
}

export interface CampaignResults {
  campaign_id: string;
  treatment_count: number;
  control_count: number;
  treatment_reactivations: number;
  control_reactivations: number;
  treatment_reactivation_rate: number | null;
  control_reactivation_rate: number | null;
  incremental_reactivation_rate: number | null;
  estimated_incremental_reactivations: number | null;
  estimated_incremental_revenue_minor: number | null;
  campaign_cost_minor: number;
  cost_per_reactivated_minor: number | null;
  unsubscribe_rate: number | null;
  is_simulated: true;
}
