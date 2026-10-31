'use client';

import { useState } from 'react';
import { languageLabel } from '@/lib/campaigns/rules';
import { numbersPreserved, SOURCE_LANGUAGE, translationState, type TranslationMeta } from '@/lib/localization/rules';
import type { TranslateResponse } from '@/lib/localization/types';
import { SourceBadge } from './PlanPanel';

interface TranslationPanelProps {
  campaignId?: string;
  language: string;
  /** Current form values (may be unsaved). */
  englishMessage: string;
  localized: string;
  onLocalizedChange: (value: string) => void;
  /** Provenance as the form currently implies it (edited text counts as reviewed). */
  translation: TranslationMeta | null;
  channelLabel: string;
  channelLimit: number;
  offerSummary: string | null;
  /** Why translating is unavailable right now (unsaved changes, locked campaign), if it is. */
  blockedReason: string | null;
  onAdopt: (response: TranslateResponse) => void;
}

interface RequestOptions { force?: boolean; useDemo?: boolean }

const boxStyle = {
  background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px',
  padding: '0.625rem 0.875rem', fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' as const, minHeight: '8.5rem',
};

export default function TranslationPanel(props: TranslationPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; canUseDemo: boolean } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [lastOptions, setLastOptions] = useState<RequestOptions>({});
  const name = languageLabel(props.language);

  if (props.language === SOURCE_LANGUAGE) {
    return (
      <div className="card card-sm">
        <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>Localization</strong>
        <p className="form-help">English is selected, so customers receive the message above. No translation is needed.</p>
      </div>
    );
  }

  const english = props.englishMessage.trim();
  const localized = props.localized.trim();
  const state = translationState(
    { language: props.language, original_message: props.englishMessage, localized_message: props.localized },
    props.translation,
  );
  const numbers = localized ? numbersPreserved(english, localized) : null;
  const meta = props.translation;
  const canRun = Boolean(props.campaignId) && !props.blockedReason && !loading && Boolean(english);

  async function run(options: RequestOptions) {
    setLoading(true);
    setError(null);
    setConfirmReplace(false);
    setLastOptions(options);
    try {
      const res = await fetch(`/api/campaigns/${props.campaignId}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: options.force === true, use_demo: options.useDemo === true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError({ message: json.error?.message ?? 'Translation failed.', canUseDemo: json.error?.details?.fallback_available === true });
        return;
      }
      props.onAdopt(json);
    } catch {
      setError({ message: 'Could not reach the server. Your texts are unchanged. Try again.', canUseDemo: false });
    } finally {
      setLoading(false);
    }
  }

  // Replacing existing text (possibly hand-edited) needs an explicit confirmation.
  function onTranslateClick() {
    if (localized) setConfirmReplace(true);
    else run({});
  }

  return (
    <div className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>Localization: {name}</strong>
          <p className="form-help">Customers receive the {name} text. Review it and save: the offer terms below must read the same in both languages.</p>
        </div>
        {!confirmReplace && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onTranslateClick} disabled={!canRun}>
            {loading ? 'Translating…' : localized ? `Re-translate to ${name}` : `Translate to ${name}`}
          </button>
        )}
      </div>

      {confirmReplace && (
        <div className="info-box" role="group" aria-label="Confirm re-translation">
          <div>
            <p>This replaces the current {name} text, including any edits you made.</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => run({ force: true })}>Replace it</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmReplace(false)}>Keep my text</button>
            </div>
          </div>
        </div>
      )}

      {!props.campaignId && <p className="form-help">Create the draft first, then translate the message.</p>}
      {props.campaignId && props.blockedReason && <p className="form-help">{props.blockedReason}</p>}
      {props.campaignId && !english && !props.blockedReason && <p className="form-help">Write the English message first.</p>}

      {error && (
        <div className="error-box" role="alert">
          <div>
            <p>{error.message}</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => run(lastOptions)} disabled={loading}>Retry</button>
              {error.canUseDemo && (
                <button type="button" className="btn btn-sm btn-warning" onClick={() => run({ ...lastOptions, useDemo: true })} disabled={loading}>
                  Use demo draft instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {state === 'missing' && !error && <p className="form-help">No {name} text yet. Translate with one click, or type it yourself below.</p>}
      {state === 'stale' && (
        <div className="info-box" role="status">
          <span>The English message or language changed since this {name} text was made. Re-translate it, or review it and save to confirm it still matches.</span>
        </div>
      )}

      <div className="side-by-side">
        <div className="form-group">
          <span className="form-label">English message (source)</span>
          <div style={boxStyle} lang="en">{english || <em style={{ color: 'var(--text-muted)' }}>Write the English message above.</em>}</div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="localized-message">{name} message (editable)</label>
          <textarea
            id="localized-message" lang={props.language} className="form-textarea" rows={6} value={props.localized}
            onChange={(e) => props.onLocalizedChange(e.target.value)} placeholder={`The ${name} text customers will receive`}
          />
          <div className={`char-counter ${localized.length > props.channelLimit ? 'over' : ''}`}>
            {localized.length} / {props.channelLimit} characters for {props.channelLabel}
          </div>
        </div>
      </div>

      {meta && localized && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <SourceBadge source={meta.source} />
          {meta.model && <span className="form-help">{meta.model}</span>}
          {meta.edited && meta.source !== 'manual' && <span className="badge badge-accent">edited by you</span>}
          {meta.source === 'manual' && <span className="form-help">written by you</span>}
        </div>
      )}
      {meta?.source === 'demo_fallback' && !meta.edited && (
        <div className="info-box">
          <span>This is a demo fallback, not a Sarvam translation. {meta.fallback_reason}</span>
        </div>
      )}

      {props.offerSummary && (
        <p className="form-help">
          <strong>Offer terms (not changed by translation):</strong> {props.offerSummary}
        </p>
      )}
      {numbers && !numbers.ok && (
        <div className="info-box" role="status">
          <span>
            Check the offer numbers: {numbers.missing.length > 0 && <>the English message has {numbers.missing.join(', ')} that the {name} text lacks. </>}
            {numbers.extra.length > 0 && <>The {name} text has {numbers.extra.join(', ')} that the English message does not.</>}
          </span>
        </div>
      )}
      {meta && !meta.edited && meta.warnings.length > 0 && (
        <ul style={{ paddingLeft: '1.1rem' }}>
          {meta.warnings.map((w) => <li key={w} className="form-help" style={{ color: 'var(--warning)' }}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
