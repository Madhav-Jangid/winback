import { DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { getServerEnv } from '@/lib/env';

/**
 * The "current time" used for business rules such as risk detection.
 * In demo mode this is the fixed demo reference date; otherwise it is the real clock.
 * Tests should pass an explicit date to domain functions instead of calling this.
 */
export function getAppNow(demoMode: boolean = getServerEnv().DEMO_MODE === 'true'): Date {
  return demoMode ? new Date(DEMO_REFERENCE_DATE) : new Date();
}
