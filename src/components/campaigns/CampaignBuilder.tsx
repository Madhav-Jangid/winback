'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { checkReadiness, type ReadinessIssue } from '@/lib/campaigns/readiness';
import {
  CHANNEL_LABELS, CHANNEL_MESSAGE_LIMITS, CHANNELS, CONTROL_SHARE, LANGUAGES, LIMITS, OFFER_TYPE_LABELS, OFFER_TYPES,
  describeOffer, formatMinor, minorToRupeesInput, offerCostPerRedemptionMinor, rupeesToMinor,
  type Channel, type OfferType,
} from '@/lib/campaigns/rules';
import { campaignDraftSchema, fieldErrors, type CampaignDraft } from '@/lib/campaigns/schema';
import { SEGMENT_TYPES, SEGMENTS, type SegmentPreview, type SegmentType } from '@/lib/campaigns/segments';
import type { CampaignStatus } from '@/types';
import type { CampaignPlanResult } from '@/lib/planner/types';
import { frequencyWindowDays } from '@/lib/campaigns/rules';
import type { TranslateResponse } from '@/lib/localization/types';
import type { TranslationMeta } from '@/lib/localization/rules';
import PlanPanel from './PlanPanel';
import TranslationPanel from './TranslationPanel';

type PreviewCounts = Omit<SegmentPreview, 'eligible_customer_ids'>;

interface FormState {
  name: string; goal: string; segment_type: SegmentType; offer_type: OfferType;
  percent: string; max_discount: string; amount: string; item_name: string; item_cost: string;
  min_order: string; expiry_days: string; budget: string; frequency_cap: string; cooldown_days: string;
  language: string; channel: Channel; original_message: string; localized_message: string;
}

/** Form field → key used in server validation errors. */
const ERROR_KEY: Partial<Record<keyof FormState, string>> = {
  percent: 'offer.percent', max_discount: 'offer.max_discount_minor', amount: 'offer.amount_minor',
  item_name: 'offer.item_name', item_cost: 'offer.item_cost_minor', min_order: 'offer.minimum_order_value_minor',
  expiry_days: 'offer.expiry_days', budget: 'budget_minor',
};
const keyFor = (field: keyof FormState) => ERROR_KEY[field] ?? field;

const EXCLUSION_LABELS: Record<keyof SegmentPreview['excluded'], string> = {
  no_consent: 'No consent (unknown or revoked)',
  opted_out: 'Opted out',
  insufficient_history: 'Not enough purchase history',
  frequency_cap: 'Messaged within the cooldown',
  other: 'Other rules',
};

type OfferFields = Pick<FormState, 'offer_type' | 'percent' | 'max_discount' | 'amount' | 'item_name' | 'item_cost' | 'min_order' | 'expiry_days'>;

function offerFields(o: CampaignDraft['offer']): OfferFields {
  const minOrder = o.type === 'no_offer' ? undefined : o.minimum_order_value_minor;
  const expiry = o.type === 'no_offer' ? undefined : o.expiry_days;
  return {
    offer_type: o.type,
    percent: o.type === 'percentage_discount' ? String(o.percent) : '10',
    max_discount: o.type === 'percentage_discount' ? minorToRupeesInput(o.max_discount_minor) : '',
    amount: o.type === 'fixed_discount' ? minorToRupeesInput(o.amount_minor) : '',
    item_name: o.type === 'free_item' ? o.item_name : '',
    item_cost: o.type === 'free_item' ? minorToRupeesInput(o.item_cost_minor) : '',
    min_order: minorToRupeesInput(minOrder),
    expiry_days: expiry === undefined ? '' : String(expiry),
  };
}

function toForm(d: CampaignDraft): FormState {
  return {
    ...offerFields(d.offer),
    name: d.name, goal: d.goal, segment_type: d.segment_type,
    budget: minorToRupeesInput(d.budget_minor), frequency_cap: String(d.frequency_cap), cooldown_days: String(d.cooldown_days),
    language: d.language, channel: d.channel, original_message: d.original_message, localized_message: d.localized_message,
  };
}

/** Form → validated draft, using the same schema as the server. */
function fromForm(f: FormState): { draft: CampaignDraft | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const money = (field: keyof FormState, required: boolean): number | undefined => {
    const raw = f[field].trim();
    if (!raw) {
      if (required) errors[keyFor(field)] = 'Enter an amount';
      return undefined;
    }
    const minor = rupeesToMinor(raw);
    if (minor === null) errors[keyFor(field)] = 'Enter rupees, e.g. 150 or 99.50';
    return minor ?? undefined;
  };
  const int = (raw: string) => (raw.trim() === '' ? undefined : Number(raw));

  const common = { minimum_order_value_minor: money('min_order', false), expiry_days: int(f.expiry_days) };
  let offer: Record<string, unknown>;
  switch (f.offer_type) {
    case 'percentage_discount': offer = { type: f.offer_type, percent: int(f.percent), max_discount_minor: money('max_discount', false), ...common }; break;
    case 'fixed_discount': offer = { type: f.offer_type, amount_minor: money('amount', true), ...common }; break;
    case 'free_item': offer = { type: f.offer_type, item_name: f.item_name, item_cost_minor: money('item_cost', true), ...common }; break;
    default: offer = { type: 'no_offer' };
  }
  for (const k of Object.keys(offer)) if (offer[k] === undefined) delete offer[k];

  const parsed = campaignDraftSchema.safeParse({
    name: f.name, goal: f.goal, segment_type: f.segment_type, offer,
    budget_minor: money('budget', true) ?? -1,
    frequency_cap: int(f.frequency_cap), cooldown_days: int(f.cooldown_days),
    language: f.language, channel: f.channel, original_message: f.original_message, localized_message: f.localized_message,
  });
  if (!parsed.success) Object.assign(errors, { ...fieldErrors(parsed.error), ...errors });
  return { draft: parsed.success && Object.keys(errors).length === 0 ? parsed.data : null, errors };
}

export interface CampaignBuilderProps {
  mode: 'create' | 'edit';
  initial: CampaignDraft;
  currency: string;
  campaignId?: string;
  version?: number;
  status?: CampaignStatus;
  approvedVersion?: number | null;
  editable?: boolean;
  serverReadiness?: ReadinessIssue[];
  planSource?: string | null;
  planRationale?: string | null;
  translation?: TranslationMeta | null;
}

export default function CampaignBuilder(props: CampaignBuilderProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(props.initial));
  const [saved, setSaved] = useState<FormState>(() => toForm(props.initial));
  const [version, setVersion] = useState(props.version ?? 1);
  const [status, setStatus] = useState<CampaignStatus>(props.status ?? 'draft');
  const [approvedVersion, setApprovedVersion] = useState(props.approvedVersion ?? null);
  const [editable, setEditable] = useState(props.editable ?? true);
  const [translation, setTranslation] = useState<TranslationMeta | null>(props.translation ?? null);
  const [serverIssues, setServerIssues] = useState<ReadinessIssue[]>(props.serverReadiness ?? []);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'success'; text: string; reload?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [preview, setPreview] = useState<PreviewCounts | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(props.mode === 'edit');

  const { draft, errors: localErrors } = useMemo(() => fromForm(form), [form]);
  const errors = { ...localErrors, ...serverErrors };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerErrors((e) => {
      const next = { ...e };
      delete next[keyFor(key)];
      return next;
    });
  };

  // Live segment preview, recomputed by the server with this campaign's frequency limits.
  const cooldown = Number(form.cooldown_days);
  const cap = Number(form.frequency_cap);
  const limitsValid = Number.isInteger(cooldown) && cooldown >= LIMITS.cooldownDaysMin && cooldown <= LIMITS.cooldownDaysMax
    && Number.isInteger(cap) && cap >= LIMITS.frequencyCapMin && cap <= LIMITS.frequencyCapMax;
  useEffect(() => {
    if (!limitsValid) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ cooldown_days: String(cooldown), frequency_cap: String(cap) });
        if (props.campaignId) qs.set('campaign_id', props.campaignId);
        const res = await fetch(`/api/segments/${form.segment_type}/preview?${qs}`, { signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? 'Preview failed.');
        setPreview(json);
        setPreviewError(null);
      } catch (e) {
        if (!controller.signal.aborted) setPreviewError(e instanceof Error ? e.message : 'Preview failed.');
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [form.segment_type, cooldown, cap, limitsValid, props.campaignId]);

  // Editing the translated text by hand counts as reviewing it, so the live checklist treats it
  // like the server will after saving.
  const localizedEdited = form.localized_message !== saved.localized_message;
  const effectiveTranslation: TranslationMeta | null = localizedEdited && draft
    ? {
      source: translation?.source ?? 'manual', model: translation?.model ?? null, language: draft.language,
      source_text: draft.original_message.trim(), edited: true, translated_at: translation?.translated_at ?? '',
      warnings: [], fallback_reason: translation?.fallback_reason ?? null,
    }
    : translation;
  const liveIssues = draft && preview ? checkReadiness({ ...draft, translation: effectiveTranslation }, preview, props.currency) : null;
  const issues = liveIssues ?? serverIssues;
  const costPer = draft && preview ? offerCostPerRedemptionMinor(draft.offer, preview.avg_order_value_minor) : null;
  const messageLimit = CHANNEL_MESSAGE_LIMITS[form.channel];
  const messageLength = form.original_message.trim().length;

  async function save() {
    setShowErrors(true);
    setBanner(null);
    if (!draft) {
      setBanner({ kind: 'error', text: 'Fix the highlighted fields before saving.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(props.mode === 'create' ? '/api/campaigns' : `/api/campaigns/${props.campaignId}`, {
        method: props.mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(props.mode === 'create' ? draft : { ...draft, expected_version: version }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = json.error ?? {};
        setServerErrors(err.details?.fields ?? {});
        setBanner({ kind: 'error', text: err.message ?? 'Save failed.', reload: err.code === 'VERSION_CONFLICT' });
        return;
      }
      if (props.mode === 'create') {
        router.push(`/campaigns/${json.campaign.id}`);
        return;
      }
      const next = toForm({ ...json.campaign, offer: json.campaign.offer });
      setForm(next);
      setSaved(next);
      setVersion(json.campaign.version);
      setStatus(json.campaign.status);
      setApprovedVersion(json.campaign.approved_version);
      setTranslation(json.campaign.translation ?? null);
      setEditable(json.editable);
      setServerIssues(json.readiness);
      setBanner({ kind: 'success', text: `Saved. Version ${json.campaign.version}, ${json.campaign.status === 'ready_for_approval' ? 'ready for approval' : json.campaign.status}.` });
      router.refresh();
    } catch {
      setBanner({ kind: 'error', text: 'Could not reach the server. Your changes are still in the form — try again.' });
    } finally {
      setSaving(false);
    }
  }

  /** Take the server's view of the campaign after it saved a translation. */
  function adoptTranslation(response: TranslateResponse) {
    const next = toForm({ ...response.campaign, offer: response.campaign.offer });
    setForm(next);
    setSaved(next);
    setVersion(response.campaign.version);
    setStatus(response.campaign.status);
    setApprovedVersion(response.campaign.approved_version);
    setEditable(response.editable);
    setServerIssues(response.readiness);
    setTranslation(response.campaign.translation);
    const result = response.translation_result;
    setBanner({
      kind: 'success',
      text: result.cached
        ? 'A current translation already exists, so nothing was changed. Use Re-translate to replace it.'
        : `Translated (${result.source === 'sarvam' ? 'Sarvam' : 'demo fallback'}) and saved as version ${response.campaign.version}. Review the text before approving.`,
    });
    router.refresh();
  }
  const translateBlockedReason = props.mode === 'create' ? null
    : !editable ? 'This campaign can no longer be edited.'
    : dirty ? 'Save your changes first: translation works from the saved English message.'
    : null;

  function applyPlan(plan: CampaignPlanResult, withOffer: boolean) {
    setForm((f) => ({ ...f, original_message: plan.message_draft, ...(withOffer ? offerFields(plan.offer) : {}) }));
    setBanner({ kind: 'success', text: `Applied the ${plan.source === 'gemini' ? 'Gemini' : 'demo'} draft${withOffer ? ' and offer' : ''} to the form. Review it, then save.` });
  }
  const planBlockedReason = props.mode === 'create' ? null
    : !editable ? 'This campaign can no longer be edited.'
    : dirty ? 'Save your changes first: the planner works from the saved campaign.'
    : null;

  async function cancelCampaign() {
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${props.campaignId}/cancel`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Cancel failed.');
      setStatus(json.campaign.status);
      setEditable(json.editable);
      setConfirmCancel(false);
      setBanner({ kind: 'success', text: 'Campaign cancelled. It can no longer be approved or sent.' });
      router.refresh();
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : 'Cancel failed.' });
    } finally {
      setSaving(false);
    }
  }

  const err = (field: keyof FormState) => (showErrors ? errors[keyFor(field)] : undefined);
  const offerPreview = draft ? describeOffer(draft.offer, props.currency) : null;

  return (
    <div>
      {props.mode === 'edit' && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <span className={`badge status-${status}`}>{status.replaceAll('_', ' ')}</span>
          <span className="badge badge-muted">Version {version}</span>
          {approvedVersion !== null && <span className="badge badge-accent">Approved version {approvedVersion}</span>}
          {dirty && <span className="badge badge-warning">Unsaved changes</span>}
        </div>
      )}

      {status === 'approved' && editable && (
        <div className="info-box" style={{ marginBottom: '1rem' }}>
          <span aria-hidden>ℹ️</span>
          <span>Changing the audience, offer, budget, limits, language, channel or message creates a new version and cancels the approval. Name and goal can be changed freely.</span>
        </div>
      )}
      {!editable && (
        <div className="info-box" style={{ marginBottom: '1rem' }}>
          <LockKeyhole size={15} aria-hidden="true" />
          <span>This campaign is {status.replaceAll('_', ' ')} and can no longer be edited.</span>
        </div>
      )}
      {banner && (
        <div className={banner.kind === 'error' ? 'error-box' : 'success-box'} role={banner.kind === 'error' ? 'alert' : 'status'} style={{ marginBottom: '1rem' }}>
          <span>{banner.text}</span>
          {banner.reload && <button className="btn btn-sm btn-secondary" onClick={() => window.location.reload()}>Reload latest</button>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)', gap: '1.5rem', alignItems: 'start' }} className="builder-grid">
        <fieldset disabled={!editable || saving} style={{ border: 'none', display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0 }}>
          <Section title="1. Basics">
            <Field label="Campaign name" error={err('name')}>
              <input className="form-input" value={form.name} maxLength={100} onChange={(e) => set('name', e.target.value)} placeholder="October winback" />
            </Field>
            <Field label="Goal" error={err('goal')}>
              <input className="form-input" value={form.goal} maxLength={500} onChange={(e) => set('goal', e.target.value)} placeholder="Bring lapsed regulars back for a visit" />
            </Field>
          </Section>

          <Section title="2. Audience">
            <div role="radiogroup" aria-label="Segment" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {SEGMENT_TYPES.map((type) => (
                <label key={type} className="card card-sm" style={{ display: 'flex', gap: '0.75rem', cursor: 'pointer', borderColor: form.segment_type === type ? 'var(--accent)' : undefined }}>
                  <input type="radio" name="segment" checked={form.segment_type === type} onChange={() => set('segment_type', type)} />
                  <span>
                    <strong style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>{SEGMENTS[type].label}</strong>
                    <span className="form-help" style={{ display: 'block' }}>{SEGMENTS[type].description}</span>
                  </span>
                </label>
              ))}
            </div>
            {err('segment_type') && <p className="form-error">{err('segment_type')}</p>}
          </Section>

          <Section title="3. Offer">
            <Field label="Offer type" error={err('offer_type')}>
              <select className="form-select" value={form.offer_type} onChange={(e) => set('offer_type', e.target.value as OfferType)}>
                {OFFER_TYPES.map((t) => <option key={t} value={t}>{OFFER_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            {form.offer_type === 'percentage_discount' && (
              <div className="grid-2">
                <Field label={`Discount % (${LIMITS.percentMin}–${LIMITS.percentMax})`} error={err('percent')}>
                  <input className="form-input" inputMode="numeric" value={form.percent} onChange={(e) => set('percent', e.target.value)} />
                </Field>
                <Field label="Maximum discount (₹)" help="Caps the cost of each redemption." error={err('max_discount')}>
                  <input className="form-input" inputMode="decimal" value={form.max_discount} onChange={(e) => set('max_discount', e.target.value)} placeholder="100" />
                </Field>
              </div>
            )}
            {form.offer_type === 'fixed_discount' && (
              <Field label={`Amount off (₹, up to ${LIMITS.perRedemptionMaxMinor / 100})`} error={err('amount')}>
                <input className="form-input" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="50" />
              </Field>
            )}
            {form.offer_type === 'free_item' && (
              <div className="grid-2">
                <Field label="Free item" error={err('item_name')}>
                  <input className="form-input" value={form.item_name} maxLength={60} onChange={(e) => set('item_name', e.target.value)} placeholder="pastry with any coffee" />
                </Field>
                <Field label="Cost to you per item (₹)" error={err('item_cost')}>
                  <input className="form-input" inputMode="decimal" value={form.item_cost} onChange={(e) => set('item_cost', e.target.value)} placeholder="40" />
                </Field>
              </div>
            )}
            {form.offer_type !== 'no_offer' && (
              <div className="grid-2">
                <Field label="Minimum order (₹, optional)" error={err('min_order')}>
                  <input className="form-input" inputMode="decimal" value={form.min_order} onChange={(e) => set('min_order', e.target.value)} />
                </Field>
                <Field label={`Valid for days (optional, up to ${LIMITS.expiryDaysMax})`} help="Leave blank for no expiry. No deadline is shown unless you set one." error={err('expiry_days')}>
                  <input className="form-input" inputMode="numeric" value={form.expiry_days} onChange={(e) => set('expiry_days', e.target.value)} />
                </Field>
              </div>
            )}
            {offerPreview && <p className="form-help">Terms: {offerPreview}</p>}
          </Section>

          <Section title="4. Budget and frequency">
            <div className="grid-3">
              <Field label="Total budget (₹)" error={err('budget')}>
                <input className="form-input" inputMode="decimal" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
              </Field>
              <Field label={`Max messages per customer (${LIMITS.frequencyCapMin}–${LIMITS.frequencyCapMax})`} error={err('frequency_cap')}>
                <input className="form-input" inputMode="numeric" value={form.frequency_cap} onChange={(e) => set('frequency_cap', e.target.value)} />
              </Field>
              <Field label={`Cooldown days (${LIMITS.cooldownDaysMin}–${LIMITS.cooldownDaysMax})`} error={err('cooldown_days')}>
                <input className="form-input" inputMode="numeric" value={form.cooldown_days} onChange={(e) => set('cooldown_days', e.target.value)} />
              </Field>
            </div>
            <p className="form-help">
              Limits apply across all campaigns: anyone messaged in the last {form.cooldown_days || '…'} days is skipped, and nobody gets more than {form.frequency_cap || '…'} message(s) in {frequencyWindowDays(Number(form.cooldown_days) || 0)} days. The budget is never exceeded; it is enforced when sending.
            </p>
          </Section>

          <Section title="5. Message">
            <div className="grid-2">
              <Field label="Customer language" help="The message is translated into this language below." error={err('language')}>
                <select className="form-select" value={form.language} onChange={(e) => set('language', e.target.value)}>
                  {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Channel (simulated)" error={err('channel')}>
                <select className="form-select" value={form.channel} onChange={(e) => set('channel', e.target.value as Channel)}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]} — up to {CHANNEL_MESSAGE_LIMITS[c]} characters</option>)}
                </select>
              </Field>
            </div>
            <PlanPanel
              campaignId={props.campaignId}
              blockedReason={planBlockedReason}
              lastSource={props.planSource ?? null}
              lastRationale={props.planRationale ?? null}
              onApply={applyPlan}
            />
            <Field label="Message (English source)" help="Keep offer terms accurate: the message must match the offer above." error={err('original_message')}>
              <textarea className="form-textarea" value={form.original_message} rows={5} onChange={(e) => set('original_message', e.target.value)}
                placeholder="Write the message customers will receive, or use Draft with AI above." />
            </Field>
            <div className={`char-counter ${messageLength > messageLimit ? 'over' : ''}`} aria-live="polite">
              {messageLength} / {messageLimit} characters for {CHANNEL_LABELS[form.channel]}
            </div>
            <TranslationPanel
              campaignId={props.campaignId}
              language={form.language}
              englishMessage={form.original_message}
              localized={form.localized_message}
              onLocalizedChange={(value) => set('localized_message', value)}
              translation={effectiveTranslation}
              channelLabel={CHANNEL_LABELS[form.channel]}
              channelLimit={messageLimit}
              offerSummary={draft ? describeOffer(draft.offer, props.currency) : null}
              blockedReason={translateBlockedReason}
              onAdopt={adoptTranslation}
            />
          </Section>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving || (props.mode === 'edit' && !dirty)}>
              {saving ? 'Saving…' : props.mode === 'create' ? 'Create draft' : 'Save changes'}
            </button>
            {props.mode === 'edit' && props.campaignId && !dirty && (
              <Link href={`/campaigns/${props.campaignId}/review`} className="btn btn-success">
                {status === 'approved' ? 'View approval' : <>Review and approve <ArrowRight size={15} aria-hidden="true" /></>}
              </Link>
            )}
            <Link href="/campaigns" className="btn btn-secondary">Back to campaigns</Link>
            {props.mode === 'edit' && editable && !confirmCancel && (
              <button className="btn btn-danger" onClick={() => setConfirmCancel(true)}>Cancel campaign…</button>
            )}
            {confirmCancel && (
              <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }} role="group" aria-label="Confirm cancellation">
                <span className="form-help">Cancelling can’t be undone.</span>
                <button className="btn btn-danger btn-sm" onClick={cancelCampaign}>Yes, cancel it</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirmCancel(false)}>Keep it</button>
              </span>
            )}
          </div>
        </fieldset>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'sticky', top: '1rem' }}>
          <section className="card" aria-labelledby="preview-heading" aria-live="polite">
            <h2 id="preview-heading" style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Who will get this</h2>
            {!limitsValid ? (
              <p className="form-help">Enter valid frequency limits to see the audience.</p>
            ) : previewError ? (
              <p className="form-error">{previewError}</p>
            ) : !preview ? (
              <p className="form-help">Calculating…</p>
            ) : (
              <>
                <Stat label="Match the segment" value={preview.matched} />
                <Stat label="Eligible to message" value={preview.eligible} strong />
                <Stat label={`Messaged (treatment)${preview.control_is_estimate ? ' ≈' : ''}`} value={preview.treatment} />
                <Stat label={`Held back (control, ${Math.round(CONTROL_SHARE * 100)}%)${preview.control_is_estimate ? ' ≈' : ''}`} value={preview.control} />
                <p className="form-help" style={{ margin: '0.75rem 0 0.25rem' }}>Excluded</p>
                {(Object.keys(EXCLUSION_LABELS) as (keyof SegmentPreview['excluded'])[]).map((k) => (
                  <Stat key={k} label={EXCLUSION_LABELS[k]} value={preview.excluded[k]} muted />
                ))}
                <p className="form-help" style={{ marginTop: '0.75rem' }}>
                  {preview.control_is_estimate ? 'The exact control split is fixed once the draft is saved. ' : ''}
                  Control customers never receive a message; they are the comparison group. Eligibility is checked again at approval and send time.
                </p>
              </>
            )}
          </section>

          {preview && draft && (
            <section className="card" aria-labelledby="cost-heading">
              <h2 id="cost-heading" style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Cost estimate (simulated)</h2>
              <Stat label="Average order value" value={preview.avg_order_value_minor === null ? 'Unknown' : formatMinor(preview.avg_order_value_minor, props.currency)} />
              <Stat label="Cost per redemption" value={costPer === null ? 'Unknown' : formatMinor(costPer, props.currency)} />
              <Stat label="If every treatment customer redeems" value={costPer === null ? 'Unknown' : formatMinor(costPer * preview.treatment, props.currency)} />
              <Stat label="Budget" value={formatMinor(draft.budget_minor, props.currency)} />
              {costPer !== null && costPer > 0 && (
                <p className="form-help" style={{ marginTop: '0.5rem' }}>
                  Budget covers {Math.floor(draft.budget_minor / costPer)} redemption(s). Sends stop before the budget would be exceeded.
                </p>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="ready-heading">
            <h2 id="ready-heading" style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Ready for approval?</h2>
            {!draft ? (
              <p className="form-help">Complete the form to run the checks.</p>
            ) : issues.length === 0 ? (
              <p style={{ color: 'var(--success)', fontSize: '0.85rem' }}>✓ All checks pass. {props.mode === 'create' ? 'It will be saved as ready for approval.' : ''}</p>
            ) : (
              <ul style={{ paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {issues.map((i) => <li key={i.code} className="form-help" style={{ color: 'var(--warning)' }}>{i.message}</li>)}
              </ul>
            )}
            <p className="form-help" style={{ marginTop: '0.75rem' }}>Drafts can be saved with open issues. Approval and sending come in later steps.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, help, error, children }: { label: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <label className="form-group">
      <span className="form-label">{label}</span>
      {children}
      {error ? <span className="form-error" role="alert">{error}</span> : help ? <span className="form-help">{help}</span> : null}
    </label>
  );
}

function Stat({ label, value, strong, muted }: { label: string; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.25rem 0', fontSize: '0.825rem' }}>
      <span style={{ color: muted ? 'var(--text-muted)' : 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: strong ? 800 : 600 }}>{value}</span>
    </div>
  );
}
