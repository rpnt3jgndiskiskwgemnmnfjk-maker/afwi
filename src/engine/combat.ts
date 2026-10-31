// d4 判定。出目が命中基準以上の 1 個につき 1 命中。基準は修正後 2+〜4 に収める。

import { rollD4, type RngState } from './rng';
import type { DieRoll } from './types';

export interface Mod {
  label: string;
  delta: number;   // −1 は有利、+1 は不利
}

export const clampTarget = (t: number) => Math.max(2, Math.min(4, t));

/** 1 個あたりの命中率 */
export const hitProb = (target: number) => (5 - clampTarget(target)) / 4;

/** n 個振ったときの命中数 0..n の確率 */
export function hitDistribution(n: number, target: number): number[] {
  const p = hitProb(target);
  const out: number[] = [];
  let c = 1;
  for (let k = 0; k <= n; k++) {
    out.push(c * p ** k * (1 - p) ** (n - k));
    c = (c * (n - k)) / (k + 1);
  }
  return out;
}

export function finalTarget(base: number, mods: Mod[]): number {
  return clampTarget(base + mods.reduce((s, m) => s + m.delta, 0));
}

export function describeMods(mods: Mod[]): string[] {
  return mods.map((m) => `${m.label} ${m.delta > 0 ? '+' : '−'}${Math.abs(m.delta)}`);
}

export function rollPool(rng: RngState, unitId: string, n: number, base: number, mods: Mod[]): DieRoll {
  const target = finalTarget(base, mods);
  const dice: number[] = [];
  for (let i = 0; i < Math.max(0, n); i++) dice.push(rollD4(rng));
  return { unitId, dice, target, mods: describeMods(mods), hits: dice.filter((d) => d >= target).length };
}
