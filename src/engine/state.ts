import { DECK, SITUATION_DECK } from '../data/cards';
import { SCENARIOS, type Scenario, type ScenarioUnit } from '../data/scenarios';
import { UNIT_TYPES } from '../data/units';
import { finalTarget, type Mod } from './combat';
import { band, LOC, LOCATIONS } from './geo';
import { nextU32, rollD4, seedRng, type RngState } from './rng';
import type { GameState, Plan, Side, Situation, Unit } from './types';
import { enemyOf, SIDES } from './types';

export const HAND_LIMIT = 3;
export const DETECT_TARGET = 3;

export function createGame(sc: Scenario, seed: number): GameState {
  const bases: GameState['bases'] = {};
  const owners: GameState['owners'] = {};
  for (const l of LOCATIONS) {
    if (l.kind !== 'base') continue;
    bases[l.id] = { runway: 3 };
    owners[l.id] = l.owner ?? 'neutral';
  }
  const rng = seedRng(seed);
  const side = (s: Side) => ({
    ...sc.sides[s], vp: 0, stepsKilled: 0, hand: [], deck: shuffle(rng, DECK), sanctions: 0, deception: null, satellite: false,
  });
  const st: GameState = {
    schemaVersion: 2,
    scenarioId: sc.id,
    seed,
    rng,
    turn: 1,
    maxTurns: sc.maxTurns,
    escalation: sc.escalation,
    keyAreas: [...sc.keyAreas],
    sides: { blue: side('blue'), red: side('red') },
    bases,
    owners,
    units: {},
    superiority: {},
    supStreak: {},
    detected: { blue: [], red: [] },
    situation: null,
    situationDeck: shuffle(rng, SITUATION_DECK),
    history: [],
    outcome: null,
    score: null,
  };
  for (const u of sc.units) addUnits(st, u);
  for (const s of SIDES) drawCards(st, s, HAND_LIMIT - 1);
  startTurn(st, null);
  return st;
}

export function addUnits(st: GameState, u: ScenarioUnit): string[] {
  const ids: string[] = [];
  for (let i = 0; i < (u.count ?? 1); i++) {
    const prefix = `${u.side === 'blue' ? 'B' : 'R'}-${u.type}-`;
    const n = Object.keys(st.units).filter((id) => id.startsWith(prefix)).length + 1;
    const id = `${prefix}${n}`;
    st.units[id] = { id, side: u.side, type: u.type, steps: UNIT_TYPES[u.type].steps, location: u.location, posture: u.posture ?? 'parked' };
    ids.push(id);
  }
  return ids;
}

export function shuffle<T>(rng: RngState, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((nextU32(rng) / 2 ** 32) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T>(rng: RngState, xs: readonly T[]): T => xs[Math.floor((nextU32(rng) / 2 ** 32) * xs.length)];

function drawCards(st: GameState, side: Side, n: number) {
  const s = st.sides[side];
  for (let i = 0; i < n && s.hand.length < HAND_LIMIT && s.deck.length; i++) s.hand.push(s.deck.shift()!);
}

/**
 * 新しい作戦日の準備：情勢（2 日目以降）、増援、国力カードを引く、情報フェイズ（探知）。
 * prevPlans は直前の日の計画（偵察・AEW の任務を探知に使う）。
 */
export function startTurn(st: GameState, prevPlans: Record<Side, Plan> | null) {
  st.situation = st.turn >= 2 ? drawSituation(st) : null;
  const sc = SCENARIOS[st.scenarioId];
  for (const r of sc?.reinforcements ?? []) if (r.turn === st.turn) addUnits(st, r);
  for (const s of SIDES) drawCards(st, s, 1);
  intel(st, prevPlans);
}

function drawSituation(st: GameState): Situation {
  if (!st.situationDeck.length) st.situationDeck = shuffle(st.rng, SITUATION_DECK);
  const id = st.situationDeck.shift()!;
  const side = pick(st.rng, SIDES);
  const ja = side === 'blue' ? '青' : '赤';
  switch (id) {
    case 'WEATHER': {
      const area = pick(st.rng, LOCATIONS.filter((l) => l.kind === 'contested').map((l) => l.id));
      return { id, area, effects: [`${LOC[area].name} で悪天候。航空戦の命中基準 +1`] };
    }
    case 'ALLY_SUPPORT':
      st.sides[side].logistics += 2;
      return { id, side, effects: [`${ja}の兵站 +2`] };
    case 'RALLY': {
      const s = st.sides[side];
      s.will = Math.min(10, s.will + 1);
      return { id, side, effects: [`${ja}の国民の意志 +1`] };
    }
    case 'PARTS': {
      const s = st.sides[side];
      s.logistics = Math.max(0, s.logistics - 2);
      return { id, side, effects: [`${ja}の兵站 −2`] };
    }
    case 'TALKS':
      if (st.escalation >= 4) {
        st.escalation -= 1;
        return { id, effects: [`エスカレーション ${st.escalation + 1}→${st.escalation}`] };
      }
      return { id, effects: ['段階 4 未満のため効果なし'] };
    default:
      return { id: 'CALM', effects: [] };
  }
}

/** 探知判定で使う修正（UI の説明にも使う） */
export function detectMods(st: GameState, side: Side, loc: string, prevPlans: Record<Side, Plan> | null): Mod[] {
  const mods: Mod[] = [];
  const own = aliveUnits(st, side);
  const aewNear = (prevPlans?.[side].orders ?? []).some(
    (o) => o.mission === 'AEW' && st.units[o.unitId]?.steps > 0 && band(o.target, loc) <= 1,
  );
  if (aewNear) mods.push({ label: 'AEW', delta: -1 });
  if (own.some((u) => u.type === 'ISR' && band(u.location, loc) <= UNIT_TYPES.ISR.radius)) mods.push({ label: '偵察機の射程内', delta: -1 });
  if (st.sides[side].satellite) mods.push({ label: '衛星偵察', delta: -2 });
  const enemies = unitsAt(st, loc, enemyOf(side));
  if (enemies.length && enemies.every((u) => u.type === 'STL')) mods.push({ label: 'ステルス', delta: 1 });
  return mods;
}

/** 情報フェイズ：敵部隊のいる地点ごとに d4 を振り、3+ で探知 */
export function intel(st: GameState, prevPlans: Record<Side, Plan> | null) {
  for (const side of SIDES) {
    const enemy = enemyOf(side);
    const found: string[] = [];
    const locs = [...new Set(aliveUnits(st, enemy).map((u) => u.location))];
    for (const loc of LOCATIONS.map((l) => l.id).filter((id) => locs.includes(id))) {
      if (unitsAt(st, loc, side).length) { found.push(loc); continue; }
      if (st.sides[enemy].deception === loc) continue;
      const recon = (prevPlans?.[side].orders ?? []).some((o) => o.mission === 'RECON' && o.target === loc && st.units[o.unitId]?.steps > 0);
      if (recon) { found.push(loc); continue; }
      if (rollD4(st.rng) >= finalTarget(DETECT_TARGET, detectMods(st, side, loc, prevPlans))) found.push(loc);
    }
    st.detected[side] = found;
  }
  for (const side of SIDES) {
    st.sides[side].deception = null;
    st.sides[side].satellite = false;
  }
}

export const emptyPlan = (): Plan => ({ orders: [], postures: {}, repairs: [] });

export const aliveUnits = (st: GameState, side?: Side) =>
  Object.values(st.units).filter((u) => u.steps > 0 && (!side || u.side === side));

export const unitsAt = (st: GameState, loc: string, side?: Side) =>
  aliveUnits(st, side).filter((u) => u.location === loc);

export const isDamaged = (u: Unit) => u.steps < UNIT_TYPES[u.type].steps;

/** 地点の支配陣営（基地は現在の支配者、ボックスはその陣営、争奪エリアは null） */
export function ownerOf(st: GameState, id: string): Side | 'neutral' | null {
  const l = LOC[id];
  if (!l) return null;
  if (l.kind === 'box') return l.side ?? null;
  if (l.kind === 'base') return st.owners[id] ?? null;
  return null;
}

/** その陣営から見た敵部隊。探知していない地点は null（数の目安だけ分かる） */
export function visibleEnemies(st: GameState, viewer: Side, loc: string): Unit[] | null {
  const enemies = unitsAt(st, loc, enemyOf(viewer));
  return st.detected[viewer].includes(loc) ? enemies : null;
}

/** 未探知の地点で分かる数の目安 */
export const sizeHint = (n: number) => (n === 0 ? 'なし' : n <= 2 ? '少数' : '多数');
