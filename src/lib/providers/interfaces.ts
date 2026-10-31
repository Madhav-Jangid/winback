/**
 * Winback AI — AI Provider Interfaces
 */

import type { CampaignPlanInput, CampaignPlanResult } from '@/lib/planner/types';
import { TranslationInput, TranslationResult } from '@/types';

export interface CampaignPlanner {
  generatePlan(input: CampaignPlanInput): Promise<CampaignPlanResult>;
}

export interface Translator {
  translate(input: TranslationInput): Promise<TranslationResult>;
}

export interface TextToSpeechProvider {
  synthesize(input: { text: string; language: string }): Promise<{ audioBase64: string; mimeType: string }>;
}
