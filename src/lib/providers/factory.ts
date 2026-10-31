/**
 * Winback AI — Provider Factory
 * Returns real or demo fallback providers based on environment.
 */

import { CampaignPlanner, Translator } from './interfaces';
import { GeminiCampaignPlanner } from './gemini/planner';
import { SarvamTranslator } from './sarvam/translator';
import { DemoCampaignPlanner, DemoTranslator } from './demo';
import { getServerEnv } from '@/lib/env';

export function getCampaignPlanner(): CampaignPlanner {
  const apiKey = getServerEnv().GEMINI_API_KEY;
  if (apiKey) {
    return new GeminiCampaignPlanner(apiKey);
  }
  console.warn('[Providers] GEMINI_API_KEY not set — using demo fallback planner.');
  return new DemoCampaignPlanner();
}

export function getTranslator(): Translator {
  const apiKey = getServerEnv().SARVAM_API_KEY;
  if (apiKey) {
    return new SarvamTranslator(apiKey);
  }
  console.warn('[Providers] SARVAM_API_KEY not set — using demo fallback translator.');
  return new DemoTranslator();
}
