/**
 * Gemini campaign planner (FR-06). Calls the Gemini REST API directly with fetch: the model id is
 * configurable, a timeout is enforced, and the API key travels only in a header, so it can never
 * appear in a URL or an error message. Output is untrusted and validated; one retry is allowed
 * for an invalid answer (E-12). Failures throw PlannerError. The caller decides about fallback.
 */
import { z } from 'zod';
import { buildPrompt, SYSTEM_INSTRUCTION } from '@/lib/planner/prompt';
import { PlannerError, type CampaignPlanInput, type CampaignPlanResult } from '@/lib/planner/types';
import { contextFromInput, validatePlan } from '@/lib/planner/validate';
import type { CampaignPlanner } from '../interfaces';

/** Verified against ai.google.dev/gemini-api/docs/models on 2026-10-31. Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_TIMEOUT_MS = 20_000;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ATTEMPTS = 2; // the first answer plus at most one retry

const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
  })).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

export interface GeminiPlannerOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** Models sometimes wrap JSON in a code fence even when told not to. */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

export class GeminiCampaignPlanner implements CampaignPlanner {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey: string;

  constructor(options: GeminiPlannerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generatePlan(input: CampaignPlanInput): Promise<CampaignPlanResult> {
    const ctx = contextFromInput(input);
    let feedback: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const text = await this.request(buildPrompt(input, feedback));
      const json = parseJson(text);
      if (!json.ok) {
        feedback = 'the response was not valid JSON';
        continue;
      }
      const result = validatePlan(json.value, ctx);
      if (result.ok) {
        return { ...result.plan, source: 'gemini', model: this.model, fallback_reason: null };
      }
      feedback = result.reason;
    }
    throw new PlannerError('PLANNER_INVALID_RESPONSE', `Gemini did not return a usable plan (${feedback}).`);
  }

  /** One HTTP call. Returns the model's text, or throws a PlannerError with a safe message. */
  private async request(prompt: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new PlannerError('PLANNER_TIMEOUT', `Gemini did not respond within ${Math.max(1, Math.round(this.timeoutMs / 1000))} seconds.`);
      }
      throw new PlannerError('PLANNER_NETWORK_ERROR', 'Could not reach Gemini. Check the network connection.');
    }

    if (!response.ok) {
      // Status only: provider error bodies can echo request details.
      const hint = response.status === 429 ? ' (rate limit or quota)' : response.status === 401 || response.status === 403 ? ' (check GEMINI_API_KEY)' : '';
      throw new PlannerError('PLANNER_HTTP_ERROR', `Gemini returned HTTP ${response.status}${hint}.`);
    }

    let body: z.infer<typeof responseSchema>;
    try {
      body = responseSchema.parse(await response.json());
    } catch {
      throw new PlannerError('PLANNER_INVALID_RESPONSE', 'Gemini returned an unreadable response.');
    }
    if (body.promptFeedback?.blockReason) {
      throw new PlannerError('PLANNER_BLOCKED', 'Gemini declined to answer this request.');
    }
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  }
}
