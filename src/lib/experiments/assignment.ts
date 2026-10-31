/**
 * Winback AI — Experiment Assignment
 * Stable treatment/control group assignment using deterministic hash.
 */

import { createHash } from 'crypto';
import { GroupAssignment } from '@/types';

export const EXPERIMENT_SALT = 'winback-exp-v1';
export const CONTROL_RATIO = 0.2; // 20% control group

/**
 * Assign a customer to treatment or control group.
 * Assignment is deterministic and stable for a given campaign/customer/salt combo.
 */
export function assignGroup(
  campaignId: string,
  customerId: string,
  salt: string = EXPERIMENT_SALT,
  controlRatio: number = CONTROL_RATIO,
): GroupAssignment {
  const hash = createHash('sha256')
    .update(`${campaignId}:${customerId}:${salt}`)
    .digest('hex');

  // Use first 8 hex chars as a 32-bit number
  const num = parseInt(hash.slice(0, 8), 16);
  const normalized = num / 0xffffffff;

  return normalized < controlRatio ? 'control' : 'treatment';
}

/**
 * Batch assignment for a list of customer IDs.
 */
export function batchAssignGroups(
  campaignId: string,
  customerIds: string[],
  salt?: string,
  controlRatio?: number,
): Map<string, GroupAssignment> {
  const assignments = new Map<string, GroupAssignment>();
  for (const id of customerIds) {
    assignments.set(id, assignGroup(campaignId, id, salt, controlRatio));
  }
  return assignments;
}
