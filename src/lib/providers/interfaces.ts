/**
 * Winback AI — AI Provider Interfaces
 */

import { CampaignPlanInput, CampaignPlanResult, TranslationInput, TranslationResult } from '@/types';

export interface CampaignPlanner {
  generatePlan(input: CampaignPlanInput): Promise<CampaignPlanResult>;
}

export interface Translator {
  translate(input: TranslationInput): Promise<TranslationResult>;
}

export interface TextToSpeechProvider {
  synthesize(input: { text: string; language: string }): Promise<{ audioBase64: string; mimeType: string }>;
}
