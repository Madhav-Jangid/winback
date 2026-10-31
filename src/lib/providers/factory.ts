/**
 * Winback AI — Provider Factory
 * Returns real or demo fallback providers based on environment.
 */

import { CampaignPlanner, Translator } from './interfaces';
import { GeminiCampaignPlanner } from './gemini/planner';
import { SarvamTranslator } from './sarvam/translator';
import { DemoCampaignPlanner, DemoTranslator } from './demo';
import { getServerEnv, type ServerEnv } from '@/lib/env';

export interface PlannerSelection {
  planner: CampaignPlanner;
  /** True when a real Gemini key is configured. */
  live: boolean;
}

/** Gemini when a key is configured, otherwise the labelled demo planner (AI-05, E-22). */
export function selectPlanner(
  env: Pick<ServerEnv, 'GEMINI_API_KEY' | 'GEMINI_MODEL'>,
  fetchImpl?: typeof fetch,
): PlannerSelection {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (apiKey) {
    return { planner: new GeminiCampaignPlanner({ apiKey, model: env.GEMINI_MODEL, fetchImpl }), live: true };
  }
  return { planner: new DemoCampaignPlanner('GEMINI_API_KEY is not configured, so a built-in demo draft was used.'), live: false };
}

export function getCampaignPlanner(): CampaignPlanner {
  return selectPlanner(getServerEnv()).planner;
}

export function getTranslator(): Translator {
  const apiKey = getServerEnv().SARVAM_API_KEY;
  if (apiKey) {
    return new SarvamTranslator(apiKey);
  }
  console.warn('[Providers] SARVAM_API_KEY not set — using demo fallback translator.');
  return new DemoTranslator();
}
