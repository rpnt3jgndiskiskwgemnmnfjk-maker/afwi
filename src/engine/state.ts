import { UNIT_TYPES } from '../data/units';
import type { Scenario } from '../data/scenarios';
import { LOCATIONS } from './geo';
import { seedRng } from './rng';
import type { GameState, Plan, Side, Unit } from './types';

export function createGame(sc: Scenario, seed: number): GameState {
  const units: Record<string, Unit> = {};
  const serial: Record<string, number> = {};
  for (const u of sc.units) {
    for (let i = 0; i < (u.count ?? 1); i++) {
      const key = `${u.side}-${u.type}`;
      serial[key] = (serial[key] ?? 0) + 1;
      const id = `${u.side === 'blue' ? 'B' : 'R'}-${u.type}-${serial[key]}`;
      units[id] = { id, side: u.side, type: u.type, steps: UNIT_TYPES[u.type].steps, location: u.location, posture: u.posture ?? 'parked' };
    }
  }
  const bases: GameState['bases'] = {};
  for (const l of LOCATIONS) if (l.kind === 'base') bases[l.id] = { runway: 3 };
  const side = (s: Side) => ({ ...sc.sides[s], vp: 0, stepsKilled: 0 });
  return {
    schemaVersion: 1,
    scenarioId: sc.id,
    seed,
    rng: seedRng(seed),
    turn: 1,
    maxTurns: sc.maxTurns,
    escalation: sc.escalation,
    keyAreas: [...sc.keyAreas],
    sides: { blue: side('blue'), red: side('red') },
    bases,
    units,
    superiority: {},
    history: [],
    outcome: null,
    score: null,
  };
}

export const emptyPlan = (): Plan => ({ orders: [], postures: {}, repairs: [] });

export const aliveUnits = (st: GameState, side?: Side) =>
  Object.values(st.units).filter((u) => u.steps > 0 && (!side || u.side === side));

export const unitsAt = (st: GameState, loc: string, side?: Side) =>
  aliveUnits(st, side).filter((u) => u.location === loc);

export const isDamaged = (u: Unit) => u.steps < UNIT_TYPES[u.type].steps;
