import type { Quality } from '../core/logic';

export type Tier = 'high' | 'low';

export interface TierSettings {
  pixelRatio: number;
  shadows: boolean;
  shadowMap: number;
  motes: boolean;
  antialias: boolean;
}

/** Pure so it can be tested: pick a tier from the setting and a few device facts. */
export function pickTier(setting: Quality, device: { coarsePointer: boolean; cores: number; memoryGb?: number }): Tier {
  if (setting !== 'auto') return setting;
  if (device.coarsePointer) return 'low';
  if (device.cores <= 4) return 'low';
  if (device.memoryGb !== undefined && device.memoryGb <= 4) return 'low';
  return 'high';
}

export function tierSettings(tier: Tier, dpr: number): TierSettings {
  return tier === 'high'
    ? { pixelRatio: Math.min(dpr, 2), shadows: true, shadowMap: 2048, motes: true, antialias: true }
    : { pixelRatio: Math.min(dpr, 1.25), shadows: false, shadowMap: 0, motes: false, antialias: false };
}

export function detectDevice() {
  return {
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    cores: navigator.hardwareConcurrency ?? 4,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  };
}
