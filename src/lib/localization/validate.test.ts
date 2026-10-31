import { describe, expect, it } from 'vitest';
import { VALID_DRAFT, VALID_LOCALIZED } from '@/test/fixtures/campaign';
import { TranslatorError } from './types';
import { validateTranslation } from './validate';

const SOURCE = VALID_DRAFT.original_message;

describe('translation validation', () => {
  it('accepts a translation that keeps the offer numbers, trimmed and without warnings', () => {
    expect(validateTranslation(SOURCE, `  ${VALID_LOCALIZED}\n`, true)).toEqual({ text: VALID_LOCALIZED, warnings: [] });
  });

  it('rejects empty or oversized output', () => {
    for (const bad of ['', '   ', 'x'.repeat(2001)]) {
      expect(() => validateTranslation(SOURCE, bad, true)).toThrow(TranslatorError);
    }
    try { validateTranslation(SOURCE, '', true); } catch (e) { expect((e as TranslatorError).code).toBe('TRANSLATOR_INVALID_RESPONSE'); }
  });

  it('E-16: keeps but flags a translation whose numbers changed', () => {
    const { text, warnings } = validateTranslation(SOURCE, 'हम आपको याद करते हैं! 15% छूट (₹100 तक)', true);
    expect(text).toContain('15%');
    expect(warnings).toEqual([expect.stringMatching(/numbers differ.*\(missing 10; unexpected 15\)/)]);
  });

  it('flags markup or placeholders the English message did not have', () => {
    expect(validateTranslation(SOURCE, `${VALID_LOCALIZED} {name}`, true).warnings.join(' ')).toMatch(/markup or placeholders/);
    expect(validateTranslation(SOURCE, `${VALID_LOCALIZED} <b>`, true).warnings.join(' ')).toMatch(/markup or placeholders/);
    // Not flagged when the English already had them
    expect(validateTranslation(`${SOURCE} {x}`, `${VALID_LOCALIZED} {x}`, true).warnings).toEqual([]);
  });

  it('flags text identical to the English message, except for the demo fallback', () => {
    expect(validateTranslation(SOURCE, SOURCE, true).warnings).toEqual([expect.stringMatching(/identical/)]);
    expect(validateTranslation(SOURCE, SOURCE, false).warnings).toEqual([]);
  });
});
