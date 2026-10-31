import { createHash } from 'node:crypto';

/**
 * Deterministic pseudo-random number in [0, 1) from a seed string. The simulations use it instead
 * of Math.random so every result can be reproduced from the demo seed (ME-08).
 */
export function uniform(seed: string): number {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 8);
  return parseInt(hex, 16) / 0x1_0000_0000;
}
