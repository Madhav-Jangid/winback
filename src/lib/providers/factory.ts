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

export interface TranslatorSelection {
  translator: Translator;
  /** True when a real Sarvam key is configured. */
  live: boolean;
}

/** Sarvam when a key is configured, otherwise the labelled demo translator (SA-04, E-22). */
export function selectTranslator(
  env: Pick<ServerEnv, 'SARVAM_API_KEY' | 'SARVAM_MODEL'>,
  fetchImpl?: typeof fetch,
): TranslatorSelection {
  const apiKey = env.SARVAM_API_KEY?.trim();
  if (apiKey) {
    return { translator: new SarvamTranslator({ apiKey, model: env.SARVAM_MODEL, fetchImpl }), live: true };
  }
  return { translator: new DemoTranslator('SARVAM_API_KEY is not configured, so no real translation was done.'), live: false };
}
