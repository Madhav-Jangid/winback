import { describe, expect, it } from 'vitest';
import { VALID_LOCALIZED, VALID_TRANSLATION } from '@/test/fixtures/campaign';
import {
  effectiveMessage, extractNumbers, numbersPreserved, translationAfterSave, translationState, type TranslationMeta,
} from './rules';

const base = { language: 'hi', original_message: VALID_TRANSLATION.source_text, localized_message: VALID_LOCALIZED };
const NOW = new Date('2026-10-01T00:00:00Z');

describe('translation state', () => {
  it('is not needed for English, missing without text, stale when the source or language moved on', () => {
    expect(translationState({ ...base, language: 'en', localized_message: '' }, null)).toBe('not_needed');
    expect(translationState({ ...base, localized_message: '  ' }, VALID_TRANSLATION)).toBe('missing');
    expect(translationState(base, VALID_TRANSLATION)).toBe('ready');
    expect(translationState({ ...base, original_message: 'Changed message' }, VALID_TRANSLATION)).toBe('stale');
    expect(translationState({ ...base, language: 'ta' }, VALID_TRANSLATION)).toBe('stale');
    expect(translationState(base, null)).toBe('stale');
  });

  it('ignores surrounding whitespace in the English message', () => {
    expect(translationState({ ...base, original_message: `  ${base.original_message}\n` }, VALID_TRANSLATION)).toBe('ready');
  });

  it('customers receive English as written, or the localized text', () => {
    expect(effectiveMessage({ language: 'en', original_message: ' Hello ', localized_message: 'x' })).toBe('Hello');
    expect(effectiveMessage({ language: 'hi', original_message: 'Hello', localized_message: ' नमस्ते ' })).toBe('नमस्ते');
  });
});

describe('number checks (E-16)', () => {
  it('extracts numbers, ignoring thousands commas and handling native digits', () => {
    expect(extractNumbers('10% off, up to ₹1,000 for 14 days')).toEqual(['10', '1000', '14']);
    expect(extractNumbers('१०% की छूट, ₹१,०००, १४ दिन')).toEqual(['10', '1000', '14']);
    expect(extractNumbers('১০ ੧੦ ୧୦ ௧௦ ౧౦ ೧೦ ൧൦ ૧૦')).toEqual(Array(8).fill('10'));
    expect(extractNumbers('Rs. 99.50 only.')).toEqual(['99.50']);
    expect(extractNumbers('no digits here')).toEqual([]);
  });

  it('passes when the same numbers appear, in any order or script', () => {
    expect(numbersPreserved('10% off up to ₹100', '₹100 तक 10% छूट')).toEqual({ ok: true, missing: [], extra: [] });
    expect(numbersPreserved('10% off up to ₹100', '१०% छूट, ₹१०० तक').ok).toBe(true);
  });

  it('reports missing and unexpected numbers, counting repeats', () => {
    expect(numbersPreserved('10% off up to ₹100', '15% छूट ₹100 तक')).toEqual({ ok: false, missing: ['10'], extra: ['15'] });
    expect(numbersPreserved('Buy 2, get 2 free', 'Buy 2, get free')).toEqual({ ok: false, missing: ['2'], extra: [] });
    expect(numbersPreserved('Valid 7 days', 'Valid 7 days, 7 days')).toEqual({ ok: false, missing: [], extra: ['7'] });
  });
});

describe('provenance after a save', () => {
  const machine: TranslationMeta = { ...VALID_TRANSLATION, source: 'sarvam', model: 'mayura:v1', edited: false, translated_at: '2026-09-30T00:00:00.000Z' };
  const next = (localized: string, extra: Record<string, unknown> = {}) => ({
    localized_message: localized, original_message: '  English message ', language: 'hi', ...extra,
  });

  it('an unchanged text keeps its provenance, even if the English moved on (it just goes stale)', () => {
    expect(translationAfterSave(machine, 'same', next('same'), NOW)).toBe(machine);
    expect(translationAfterSave(null, '', next(''), NOW)).toBeNull();
  });

  it('editing machine text keeps its origin and marks it reviewed against the current English', () => {
    expect(translationAfterSave(machine, 'old', next('new text'), NOW)).toEqual({
      source: 'sarvam', model: 'mayura:v1', language: 'hi', source_text: 'English message', edited: true,
      translated_at: '2026-09-30T00:00:00.000Z', warnings: [], fallback_reason: null,
    });
  });

  it('text written from scratch is manual; clearing it removes the provenance', () => {
    expect(translationAfterSave(null, '', next('typed by hand'), NOW)).toMatchObject({
      source: 'manual', model: null, edited: true, translated_at: NOW.toISOString(),
    });
    expect(translationAfterSave(machine, 'old', next('   '), NOW)).toBeNull();
  });

  it('keeps a demo fallback labelled as such after the merchant edits it', () => {
    const demo = { ...machine, source: 'demo_fallback' as const, model: null, fallback_reason: 'no key' };
    expect(translationAfterSave(demo, 'old', next('hand translated'), NOW)).toMatchObject({
      source: 'demo_fallback', edited: true, fallback_reason: 'no key',
    });
  });
});
