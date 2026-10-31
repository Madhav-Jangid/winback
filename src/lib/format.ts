/** Display helpers. Timestamps are stored in UTC and shown in the merchant's time zone (E-21). */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function formatDate(iso: string | null, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));
}

export function formatMoney(minor: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
}

export function formatDays(days: number | null): string {
  if (days === null) return '—';
  const rounded = Math.round(days);
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam',
  mr: 'Marathi', od: 'Odia', pa: 'Punjabi', ta: 'Tamil', te: 'Telugu',
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}
