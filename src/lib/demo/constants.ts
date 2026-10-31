/** The single demo merchant used by the local, non-production workspace. */
export const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Fixed "today" for demo mode. Seed purchase dates are relative to this date, and risk is
 * calculated against it, so the demo never decays as real time passes (PRD E-29).
 */
export const DEMO_REFERENCE_DATE = new Date('2026-10-01T00:00:00Z');

export const DEMO_ACTOR_ID = 'demo-merchant';
