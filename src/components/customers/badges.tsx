import type { CustomerProfile } from '@/lib/customers/service';
import type { RiskStatus } from '@/types';

const RISK: Record<RiskStatus, { label: string; className: string }> = {
  at_risk: { label: 'At risk', className: 'badge-danger' },
  healthy: { label: 'Healthy', className: 'badge-success' },
  insufficient_history: { label: 'Not enough history', className: 'badge-muted' },
};

export function RiskBadge({ status }: { status: RiskStatus }) {
  const { label, className } = RISK[status];
  return <span className={`badge ${className}`}>{label}</span>;
}

/** Short label for whether a customer may be messaged, matching backend reason codes. */
export function contactLabel(profile: Pick<CustomerProfile, 'contact' | 'consent_status' | 'opted_out_at'>): { label: string; className: string } {
  const { contact } = profile;
  if (contact.eligible) return { label: 'Can contact', className: 'badge-success' };
  switch (contact.reason) {
    case 'CONSENT_UNKNOWN': return { label: 'No consent', className: 'badge-warning' };
    case 'OPTED_OUT':
      return profile.consent_status === 'revoked' && !profile.opted_out_at
        ? { label: 'Consent revoked', className: 'badge-danger' }
        : { label: 'Opted out', className: 'badge-danger' };
    case 'FREQUENCY_CAP': return { label: 'Recently messaged', className: 'badge-warning' };
    default: return { label: contact.reason ?? 'Not contactable', className: 'badge-muted' };
  }
}

export function ContactBadge({ profile }: { profile: Pick<CustomerProfile, 'contact' | 'consent_status' | 'opted_out_at'> }) {
  const { label, className } = contactLabel(profile);
  return <span className={`badge ${className}`} title={profile.contact.reason ?? undefined}>{label}</span>;
}
