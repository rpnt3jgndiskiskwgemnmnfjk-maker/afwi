// CPU（評価関数型）。自軍から見える情報（探知済みの地点と公開情報）だけで計画を立てる。
// 易：判断に揺らぎを入れ、防空制圧・給油・分散を使わない。標準：下の優先順で兵站の許す限り任務を積む。

import { CARDS } from '../data/cards';
import { UNIT_TYPES } from '../data/units';
import { band, isHub, LOC, LOCATIONS } from './geo';
import {
  cardPlayable, cardTargets, missionsFor, planCost, REPAIR_COST, reach, validatePlan, validTargets,
} from './orders';
import { nextU32, seedRng } from './rng';
import { resolveTurn } from './resolve';
import { aliveUnits, emptyPlan, ownerOf, unitsAt } from './state';
import type { CardId, GameState, Mission, Order, Plan, Side, Unit } from './types';
import { enemyOf } from './types';

export type CpuLevel = 'easy' | 'normal';

/** 標準 CPU の動きの切り替え（バランス調整と検証用） */
export const AI_OPTIONS = { lookahead: true, reserve: true, hubCap: true, disperse: true, strikes: true, cards: true, moves: true };

const CANDIDATES = 6;
const SIMULATIONS = 3;

/**
 * CPU の計画。易は手作業のルールだけで決める。
 * 標準は候補の計画を何通りか作り、相手の出方（標準のルールによる計画）を想定して数回ずつ試しに解決し、
 * 評価関数で最も良いものを選ぶ（1 手先読み）。試しの解決は真の状態を使う（P4 で戦場の霧を考えた推定に置き換える）。
 */
export function planForCpu(st: GameState, side: Side, level: CpuLevel): Plan {
  if (level === 'easy') return heuristicPlan(st, side, true, false, 0);
  if (!AI_OPTIONS.lookahead) return heuristicPlan(st, side, false, false, 0);
  const enemy = enemyOf(side);
  const enemyPlan = heuristicPlan(st, enemy, false, false, 0);
  let best: { plan: Plan; score: number } | null = null;
  for (let c = 0; c < CANDIDATES; c++) {
    // 0：標準のルール、1：易のルール（温存寄り）、2 以降：標準に揺らぎを入れたもの
    const plan = c === 1 ? heuristicPlan(st, side, true, false, 0) : heuristicPlan(st, side, false, c > 1, c);
    let total = 0;
    for (let k = 0; k < SIMULATIONS; k++) {
      const sim = structuredClone(st);
      sim.history = [];
      sim.rng = seedRng((st.seed ^ Math.imul(st.turn * 97 + k, 0x85ebca6b)) >>> 0);
      const plans = side === 'blue' ? { blue: plan, red: enemyPlan } : { blue: enemyPlan, red: plan };
      total += evaluate(resolveTurn(sim, plans).state, side, st);
    }
    if (!best || total > best.score) best = { plan, score: total };
  }
  return best!.plan;
}

/** 1 日の解決後の局面の評価（自軍から見て大きいほど良い） */
function evaluate(after: GameState, side: Side, before: GameState): number {
  const enemy = enemyOf(side);
  const s = after.sides[side];
  const e = after.sides[enemy];
  if (after.outcome?.kind === 'catastrophe') return -100;
  if (after.outcome?.kind === 'victory') return after.outcome.winner === side ? 100 : -100;
  const runway = (who: Side) => Object.entries(after.bases).filter(([id]) => after.owners[id] === who).reduce((n, [, b]) => n + b.runway, 0);
  const steps = (who: Side) => aliveUnits(after, who).reduce((n, u) => n + u.steps, 0);
  return (s.vp - e.vp) * 3
    + (steps(side) - steps(enemy)) * 1.5
    + (s.will - e.will) * 2
    + (runway(side) - runway(enemy)) * 0.5
    + s.logistics * 0.15
    - (after.escalation - before.escalation) * (after.escalation >= 4 ? 3 : 1);
}

function heuristicPlan(st: GameState, side: Side, easy: boolean, jitter: boolean, salt: number): Plan {
  const rng = seedRng((st.seed ^ Math.imul(st.turn, 0x9e3779b1) ^ (side === 'blue' ? 0x1234 : 0x5678) ^ Math.imul(salt, 0x27d4eb2d)) >>> 0);
  const rand = () => nextU32(rng) / 2 ** 32;
  const p = emptyPlan();
  const enemy = enemyOf(side);
  const used = new Set<string>();
  const own = aliveUnits(st, side);
  const free = () => own.filter((u) => !used.has(u.id));

  // 標準は翌日のために兵站を少し残す（最終日は使い切る）
  const reserve = easy || !AI_OPTIONS.reserve || st.turn >= st.maxTurns ? 0 : 2;
  const tryAdd = (o: Order): boolean => {
    if (used.has(o.unitId)) return false;
    p.orders.push(o);
    if (validatePlan(st, side, p).length || planCost(st, p) > st.sides[side].logistics - reserve) { p.orders.pop(); return false; }
    used.add(o.unitId);
    return true;
  };
  const can = (u: Unit, m: Mission, target: string) => missionsFor(st, u).includes(m) && validTargets(st, p, u, m).includes(target);

  // 修復は先に予算を確保する（ハブを優先）
  const damaged = LOCATIONS.filter((l) => l.kind === 'base' && ownerOf(st, l.id) === side && st.bases[l.id].runway < 3)
    .sort((a, b) => Number(isHub(b.id)) - Number(isHub(a.id)) || st.bases[a.id].runway - st.bases[b.id].runway);
  for (const b of damaged.slice(0, easy ? 1 : 2)) {
    if (st.sides[side].logistics >= REPAIR_COST + 3) {
      p.repairs.push(b.id);
      if (validatePlan(st, side, p).length) p.repairs.pop();
    }
  }
  for (const b of p.repairs) {
    const alt = free().find((u) => u.type === 'ALT' && can(u, 'AIRLIFT', b));
    if (alt) tryAdd({ unitId: alt.id, mission: 'AIRLIFT', target: b });
  }

  // 1. 要域の制空（給油機と AEW の支援つき）
  // 標準：敵が出せそうな機数を見積もり、上回れる要域に集中する。易：均等に配り、ところどころ抜ける
  const fighters = () => free()
    .filter((u) => missionsFor(st, u).includes('CAP') && u.type !== 'BMR')
    .sort((a, b) => fighterRank(a) - fighterRank(b));
  const reachable = (k: string) => fighters().filter((u) => can(u, 'CAP', k)).length;
  const keys = easy || jitter
    ? [...st.keyAreas].sort(() => rand() - 0.5)
    : [...st.keyAreas].sort((a, b) => (reachable(b) - enemyCommit(st, side, b)) - (reachable(a) - enemyCommit(st, side, a)));
  const assignCap = (k: string, want: number) => {
    let n = 0;
    // 行動半径に余裕のある機体（命中基準が不利にならない）を先に使う
    const cands = fighters().sort((a, b) => Number(reach(p, a, k).atLimit) - Number(reach(p, b, k).atLimit));
    for (const u of cands) {
      if (n >= want) break;
      if ((easy && rand() < 0.3) || (jitter && rand() < 0.15)) continue;
      if (can(u, 'CAP', k)) { if (tryAdd({ unitId: u.id, mission: 'CAP', target: k })) n++; continue; }
      // 給油機を付ければ届くなら付ける
      if (!easy && reach(p, u, k).band === UNIT_TYPES[u.type].radius + 1) {
        const tkr = free().find((t) => t.type === 'TKR' && can(t, 'TANKER', k));
        if (tkr && tryAdd({ unitId: tkr.id, mission: 'TANKER', target: k }) && can(u, 'CAP', k) && tryAdd({ unitId: u.id, mission: 'CAP', target: k })) n++;
      }
    }
    if (n >= 2 || (easy && n >= 1)) {
      const aew = free().find((u) => u.type === 'AEW' && can(u, 'AEW', k));
      if (aew) tryAdd({ unitId: aew.id, mission: 'AEW', target: k });
    }
    return n;
  };
  if (easy) {
    const per = Math.max(1, Math.ceil(fighters().length / (keys.length + 1)));
    for (const k of keys) assignCap(k, Math.min(3, per));
  } else {
    // 敵が出せそうな機数を上回れる要域にまとめて出す。上回れない要域には出さず、損耗を避けて温存する
    const per = Math.max(2, Math.ceil(fighters().length / (keys.length + 1)));
    for (const k of keys) {
      const need = Math.max(2, Math.min(4, enemyCommit(st, side, k) + 1));
      if (reachable(k) >= need) assignCap(k, Math.max(need, Math.min(3, per)));
      else if (enemyCommit(st, side, k) === 0 && reachable(k) > 0) assignCap(k, 1);
    }
  }

  // 2. 前方の基地を守る制空（標準のみ）
  if (!easy && AI_OPTIONS.hubCap && st.escalation >= 2) {
    const hub = mostValuableBase(st, side);
    const g = hub && fighters().find((u) => can(u, 'CAP', hub));
    if (hub && g) tryAdd({ unitId: g.id, mission: 'CAP', target: hub });
  }

  // 3. スタンドオフ打撃と打撃
  const allowHub = st.escalation <= (jitter && rand() < 0.5 ? 2 : 3);  // 段階 5 に近づけない
  const targets = LOCATIONS.filter((l) => l.kind === 'base' && ownerOf(st, l.id) === enemy && (allowHub || !isHub(l.id)))
    .map((l) => ({ id: l.id, value: targetValue(st, side, l.id) }))
    .sort((a, b) => b.value - a.value || (easy ? rand() - 0.5 : 0));
  if ((easy || AI_OPTIONS.strikes) && st.escalation >= 2 && (st.escalation >= 3 || st.turn >= 2 || easy)) {
    const salvoBudget = Math.min(st.sides[side].salvos, easy ? 1 : 2);
    let fired = 0;
    for (const u of free().filter((x) => missionsFor(st, x).includes('STANDOFF'))) {
      if (fired >= salvoBudget) break;
      const t = targets.find((x) => can(u, 'STANDOFF', x.id));
      if (t && tryAdd({ unitId: u.id, mission: 'STANDOFF', target: t.id, aim: aimFor(st, side, t.id) })) fired++;
    }
    const t = targets.find((x) => free().some((u) => u.type !== 'FTR' && can(u, 'STRIKE', x.id)));
    if (t) {
      const sam = (st.detected[side].includes(t.id) ? unitsAt(st, t.id, enemy) : []).some((u) => u.type === 'SAM');
      if (sam && !easy) {
        const sead = free().find((u) => can(u, 'SEAD', t.id));
        if (sead) tryAdd({ unitId: sead.id, mission: 'SEAD', target: t.id });
      }
      for (const u of free().filter((x) => (x.type === 'MRF' || x.type === 'BMR') && can(x, 'STRIKE', t.id)).slice(0, easy ? 1 : 3)) {
        tryAdd({ unitId: u.id, mission: 'STRIKE', target: t.id, aim: aimFor(st, side, t.id) });
      }
    }
  }

  // 4. 偵察
  for (const u of free().filter((x) => x.type === 'ISR')) {
    const t = targets.map((x) => x.id).find((id) => !st.detected[side].includes(id) && can(u, 'RECON', id));
    if (t) tryAdd({ unitId: u.id, mission: 'RECON', target: t });
  }

  // 5. 後方の戦闘機を前方へ転地（標準は滑走路に空きのある基地へ散らす）
  const crowd = (loc: string) => aliveUnits(st, side).filter((u) => u.location === loc && UNIT_TYPES[u.type].radius > 0).length
    + p.orders.filter((o) => o.mission === 'MOVE' && o.target === loc).length;
  for (const u of free().filter((x) => LOC[x.location].kind === 'box' && LOC[x.location].role === 'rear' && x.type !== 'ALT')) {
    if (st.keyAreas.some((k) => band(u.location, k) <= UNIT_TYPES[u.type].radius)) continue;
    const dests = LOCATIONS.filter((l) => l.kind === 'base' && ownerOf(st, l.id) === side && st.bases[l.id].runway > 0 && can(u, 'MOVE', l.id));
    const dest = easy
      ? dests.filter((l) => l.base === 'hub').sort((a, b) => keyDistance(st, a.id) - keyDistance(st, b.id))[0]
      : dests.sort((a, b) => (crowd(a.id) - st.bases[a.id].runway) - (crowd(b.id) - st.bases[b.id].runway) || keyDistance(st, a.id) - keyDistance(st, b.id))[0];
    if (dest && (easy ? rand() < 0.5 : AI_OPTIONS.moves && crowd(dest.id) < st.bases[dest.id].runway + 1)) tryAdd({ unitId: u.id, mission: 'MOVE', target: dest.id });
  }

  // 6. 分散（標準のみ）：敵の打撃が届く基地で、任務のない支援機と予備機を分散させる
  if (!easy && AI_OPTIONS.disperse && st.escalation >= 2) {
    for (const u of free()) {
      if (LOC[u.location].kind !== 'base' || u.type === 'SAM' || u.posture === 'dispersed') continue;
      if (!threatened(st, side, u.location)) continue;
      if (['AEW', 'TKR', 'ALT', 'ISR', 'BMR'].includes(u.type)) p.postures[u.id] = 'dispersed';
    }
  }

  // 7. 国力カード
  const card = easy || AI_OPTIONS.cards ? chooseCard(st, side, easy, rand) : null;
  if (card) {
    const ts = cardTargets(st, side, card);
    const target = CARDS[card].target === 'none' ? undefined
      : CARDS[card].target === 'enemyHub' ? ts.sort((a, b) => targetValue(st, side, b) - targetValue(st, side, a))[0]
        : ts.sort((a, b) => unitsAt(st, b, side).length - unitsAt(st, a, side).length)[0];
    if (CARDS[card].target === 'none' || target) {
      p.card = { card, target };
      if (validatePlan(st, side, p).length) delete p.card;
    }
  }
  return p;
}

/** 敵がその要域に出せそうな制空機の数（探知済みの地点は実数、未探知の基地は見積もり） */
function enemyCommit(st: GameState, side: Side, area: string): number {
  const enemy = enemyOf(side);
  let potential = 0;
  for (const l of LOCATIONS) {
    if (ownerOf(st, l.id) !== enemy) continue;
    const near = band(l.id, area) <= 2;
    if (!near) continue;
    if (st.detected[side].includes(l.id)) {
      potential += unitsAt(st, l.id, enemy).filter((u) => UNIT_TYPES[u.type].aaDice > 0 && u.type !== 'SAM').length;
    } else if (l.kind === 'base') {
      potential += l.base === 'hub' ? 3 : 1;
    }
  }
  const spread = Math.max(1, st.keyAreas.filter((k) => LOCATIONS.some((l) => ownerOf(st, l.id) === enemy && band(l.id, k) <= 2)).length);
  return Math.ceil(potential / spread);
}

const fighterRank = (u: Unit) => ({ STL: 0, FTR: 1, MRF: 2 } as Record<string, number>)[u.type] ?? 3;

/** 要域までの距離の合計（小さいほど前方） */
function keyDistance(st: GameState, loc: string) {
  return st.keyAreas.reduce((s, k) => s + band(loc, k), 0);
}

/** 敵の長射程ミサイルか打撃機が届く基地か */
function threatened(st: GameState, side: Side, loc: string): boolean {
  const enemy = enemyOf(side);
  return aliveUnits(st, enemy).some((u) => (u.type === 'LRM' || u.type === 'MRF' || u.type === 'BMR') && band(u.location, loc) <= UNIT_TYPES[u.type].radius);
}

/** 打撃目標の価値。探知済みなら駐機中の部隊数、未探知なら控えめに見積もる */
function targetValue(st: GameState, side: Side, loc: string): number {
  const seen = st.detected[side].includes(loc);
  const units = seen ? unitsAt(st, loc, enemyOf(side)).filter((u) => u.type !== 'SAM') : [];
  const parked = units.filter((u) => u.posture === 'parked').length;
  const runway = st.bases[loc]?.runway ?? 0;
  return (seen ? parked * 2 + units.length : 1) + (runway > 0 ? 1 : -2) + (isHub(loc) ? 1 : 0) - keyDistance(st, loc) * 0.2;
}

function aimFor(st: GameState, side: Side, loc: string): 'runway' | 'parked' {
  const seen = st.detected[side].includes(loc);
  const parked = seen ? unitsAt(st, loc, enemyOf(side)).filter((u) => u.type !== 'SAM' && u.posture === 'parked').length : 0;
  return parked >= 2 ? 'parked' : 'runway';
}

function mostValuableBase(st: GameState, side: Side): string | null {
  const bases = LOCATIONS.filter((l) => l.kind === 'base' && ownerOf(st, l.id) === side && threatened(st, side, l.id));
  bases.sort((a, b) => unitsAt(st, b.id, side).length - unitsAt(st, a.id, side).length);
  return bases[0]?.id ?? null;
}

function chooseCard(st: GameState, side: Side, easy: boolean, rand: () => number): CardId | null {
  const hand = st.sides[side].hand.filter((c) => !cardPlayable(st, side, c));
  if (!hand.length) return null;
  if (easy) return rand() < 0.5 ? hand[Math.floor(rand() * hand.length)] : null;
  const s = st.sides[side];
  const e = st.sides[enemyOf(side)];
  const prefs: [CardId, boolean][] = [
    ['MEDIATION', st.escalation >= 4],
    ['MESSAGE', e.will <= 3],
    ['ACCESS', side === 'blue' || st.keyAreas.includes('BAS') || st.keyAreas.includes('SCN')],
    ['SEALIFT', s.logistics <= 6],
    ['SATELLITE', st.detected[side].length < 3],
    ['CYBER', st.escalation >= 2],
    ['SANCTIONS', true],
    ['DECEPTION', st.escalation >= 3],
    ['MESSAGE', true],
    ['SEALIFT', true],
  ];
  for (const [c, ok] of prefs) if (ok && hand.includes(c)) return c;
  return null;
}

