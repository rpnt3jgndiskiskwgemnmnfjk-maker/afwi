// 計画フェイズの任務割当：選べる任務、届く目標、兵站の費用、計画の検証。

import { CARDS } from '../data/cards';
import { UNIT_TYPES } from '../data/units';
import { band, isOnMapBase, LOC, LOCATIONS } from './geo';
import { aliveUnits, ownerOf } from './state';
import type { CardPlay, GameState, Mission, Order, Plan, Posture, Side, Unit } from './types';
import { enemyOf } from './types';

export const MISSION_LABEL: Record<Mission, string> = {
  CAP: '制空',
  STRIKE: '打撃',
  SEAD: '防空制圧',
  STANDOFF: 'スタンドオフ打撃',
  AEW: '早期警戒',
  RECON: '偵察',
  TANKER: '給油',
  AIRLIFT: '輸送',
  MOVE: '転地',
};

/** エスカレーション段階ごとの解禁条件 */
export const ESCALATION_REQ: Partial<Record<Mission, number>> = { CAP: 1, STRIKE: 2, SEAD: 2, STANDOFF: 2 };
export const REAR_BOX_STRIKE_LEVEL = 4;
export const REPAIR_COST = 2;
export const SPOKE_CAPACITY = 2;
/** 基地を攻撃する任務（エスカレーションの対象） */
export const BASE_ATTACKS = new Set<Mission>(['STRIKE', 'SEAD', 'STANDOFF']);

const flies = (u: Unit) => u.type !== 'SAM' && u.type !== 'LRM';

export function postureOf(u: Unit, plan: Plan): Posture {
  return plan.postures[u.id] ?? u.posture;
}

export function orderOf(plan: Plan, unitId: string): Order | undefined {
  return plan.orders.find((o) => o.unitId === unitId);
}

/** その部隊が選べる任務 */
export function missionsFor(st: GameState, u: Unit): Mission[] {
  const t = UNIT_TYPES[u.type];
  const loc = LOC[u.location];
  const out: Mission[] = [];
  if (u.type === 'LRM') {
    if (loc.role === 'standoff') out.push('STANDOFF');
  } else if (flies(u)) {
    if (t.aaDice > 0) out.push('CAP');
    if (t.agDice > 0) out.push('STRIKE');
    if (t.aaDice > 0 && t.agDice > 1) out.push('SEAD');
    if (u.type === 'BMR' && loc.role === 'standoff') out.push('STANDOFF');
    if (u.type === 'AEW') out.push('AEW');
    if (u.type === 'ISR') out.push('RECON');
    if (u.type === 'TKR') out.push('TANKER');
    if (u.type === 'ALT') out.push('AIRLIFT');
    out.push('MOVE');
  }
  return out.filter((m) => st.escalation >= (ESCALATION_REQ[m] ?? 0));
}

/** 給油機の支援を含めた行動半径 */
export function effectiveRadius(plan: Plan, u: Unit, target: string): number {
  const base = UNIT_TYPES[u.type].radius;
  const tanker = u.type !== 'TKR' && plan.orders.some((o) => o.mission === 'TANKER' && o.target === target);
  return base + (tanker ? 1 : 0);
}

/** 届くかどうかと、行動半径ちょうど（交戦で不利）かどうか */
export function reach(plan: Plan, u: Unit, target: string): { ok: boolean; atLimit: boolean; band: number; radius: number } {
  const b = band(u.location, target);
  const r = effectiveRadius(plan, u, target);
  return { ok: b <= r, atLimit: b === r, band: b, radius: r };
}

function incomingTo(st: GameState, plan: Plan, loc: string, exceptUnit?: string): number {
  const present = aliveUnits(st).filter((x) => x.location === loc && !(orderOf(plan, x.id)?.mission === 'MOVE'));
  const incoming = plan.orders.filter((o) => o.mission === 'MOVE' && o.target === loc && o.unitId !== exceptUnit);
  return present.length + incoming.length;
}

/** 任務ごとの目標候補（射程・陣営・段階を満たすもの） */
export function validTargets(st: GameState, plan: Plan, u: Unit, mission: Mission): string[] {
  const side = u.side;
  const enemy = enemyOf(side);
  const own = (id: string) => ownerOf(st, id) === side;
  const inRange = (id: string) => reach(plan, u, id).ok;
  const enemyBase = (id: string) => LOC[id].kind === 'base' && ownerOf(st, id) === enemy;
  switch (mission) {
    case 'CAP':
    case 'AEW':
    case 'TANKER':
      return LOCATIONS.filter((l) => (l.kind === 'contested' || (l.kind === 'base' && own(l.id))) && inRange(l.id)).map((l) => l.id);
    case 'STRIKE':
    case 'SEAD':
      return LOCATIONS.filter((l) => enemyBase(l.id) && inRange(l.id)).map((l) => l.id);
    case 'RECON':
      return LOCATIONS.filter((l) => !own(l.id) && inRange(l.id)).map((l) => l.id);
    case 'AIRLIFT':
      return LOCATIONS.filter((l) => l.kind === 'base' && own(l.id) && inRange(l.id)).map((l) => l.id);
    case 'STANDOFF':
      return LOCATIONS.filter((l) => {
        if (!inRange(l.id) || ownerOf(st, l.id) !== enemy) return false;
        if (l.kind === 'base') return true;
        return l.kind === 'box' && l.role === 'rear' && u.type === 'LRM' && st.escalation >= REAR_BOX_STRIKE_LEVEL;
      }).map((l) => l.id);
    case 'MOVE':
      return LOCATIONS.filter((l) => {
        if (l.id === u.location || !own(l.id)) return false;
        if (l.kind === 'box') return l.role === 'rear' || (l.role === 'standoff' && u.type === 'BMR');
        if (l.kind !== 'base') return false;
        if (l.base === 'spoke') return incomingTo(st, plan, l.id, u.id) < SPOKE_CAPACITY;
        return true;
      }).map((l) => l.id);
  }
}

/** 1 部隊の出撃費用（分散中は +1） */
export function sortieCost(u: Unit, _plan?: Plan): number {
  return 1 + (u.posture === 'dispersed' ? 1 : 0);
}

/** 修復の費用（輸送機を同じ基地に出していれば 1） */
export function repairCost(plan: Plan, base: string): number {
  return plan.orders.some((o) => o.mission === 'AIRLIFT' && o.target === base) ? REPAIR_COST - 1 : REPAIR_COST;
}

export function planCost(st: GameState, plan: Plan): number {
  let c = plan.repairs.reduce((s, b) => s + repairCost(plan, b), 0);
  for (const o of plan.orders) {
    const u = st.units[o.unitId];
    if (u) c += sortieCost(u, plan);
  }
  return c;
}

/** 基地から出撃する部隊数（滑走路の数まで） */
export function sortiesFrom(st: GameState, plan: Plan, loc: string): number {
  return plan.orders.filter((o) => st.units[o.unitId]?.location === loc).length;
}

export function sortieLimit(st: GameState, loc: string): number {
  return isOnMapBase(loc) ? st.bases[loc].runway : Infinity;
}

export function standoffCount(plan: Plan): number {
  return plan.orders.filter((o) => o.mission === 'STANDOFF').length;
}

/** 国力カードの目標候補 */
export function cardTargets(st: GameState, side: Side, play: CardPlay['card']): string[] {
  const def = CARDS[play];
  if (def.target === 'ownLocation') {
    return LOCATIONS.filter((l) => ownerOf(st, l.id) === side && aliveUnits(st, side).some((u) => u.location === l.id)).map((l) => l.id);
  }
  if (def.target === 'enemyHub') {
    return LOCATIONS.filter((l) => l.kind === 'base' && l.base === 'hub' && ownerOf(st, l.id) === enemyOf(side)).map((l) => l.id);
  }
  return [];
}

export function cardPlayable(st: GameState, side: Side, card: CardPlay['card']): string | null {
  if (!st.sides[side].hand.includes(card)) return '手札にありません';
  if (card === 'ACCESS' && st.owners.LUZ !== 'neutral') return 'ルソン北部はすでに中立ではありません';
  if (card === 'MEDIATION' && st.escalation <= 1) return '段階 1 以下では使えません';
  return null;
}

/** 計画の誤りを列挙する。空なら確定できる */
export function validatePlan(st: GameState, side: Side, plan: Plan): string[] {
  const errs: string[] = [];
  const s = st.sides[side];
  const cost = planCost(st, plan);
  if (cost > s.logistics) errs.push(`兵站点が足りません（必要 ${cost}、保有 ${s.logistics}）`);
  if (standoffCount(plan) > s.salvos) errs.push(`スタンドオフ打撃の弾数が足りません（残り ${s.salvos}）`);
  const seen = new Set<string>();
  for (const o of plan.orders) {
    const u = st.units[o.unitId];
    if (!u || u.side !== side || u.steps <= 0) { errs.push(`部隊 ${o.unitId} は使えません`); continue; }
    if (seen.has(u.id)) errs.push(`${u.id} に任務が 2 つあります`);
    seen.add(u.id);
    if (!missionsFor(st, u).includes(o.mission)) errs.push(`${u.id} は${MISSION_LABEL[o.mission]}に使えません`);
    else if (!validTargets(st, plan, u, o.mission).includes(o.target)) errs.push(`${u.id} の目標 ${LOC[o.target]?.name ?? o.target} は選べません`);
  }
  const fromLocs = new Set(plan.orders.map((o) => st.units[o.unitId]?.location).filter(Boolean) as string[]);
  for (const loc of fromLocs) {
    const n = sortiesFrom(st, plan, loc);
    const lim = sortieLimit(st, loc);
    if (n > lim) errs.push(`${LOC[loc].name} の滑走路は ${lim} 機分です（出撃 ${n}）`);
  }
  for (const r of plan.repairs) {
    if (!isOnMapBase(r) || ownerOf(st, r) !== side) errs.push(`${LOC[r]?.name ?? r} は修復できません`);
    else if (st.bases[r].runway >= 3) errs.push(`${LOC[r].name} の滑走路は損傷していません`);
  }
  if (new Set(plan.repairs).size !== plan.repairs.length) errs.push('同じ基地を 2 回修復しようとしています');
  if (plan.card) {
    const why = cardPlayable(st, side, plan.card.card);
    if (why) errs.push(`${CARDS[plan.card.card].name}：${why}`);
    const ts = cardTargets(st, side, plan.card.card);
    if (CARDS[plan.card.card].target !== 'none' && !ts.includes(plan.card.target ?? '')) errs.push(`${CARDS[plan.card.card].name} の目標を選んでください`);
  }
  for (const id of Object.keys(plan.postures)) {
    const u = st.units[id];
    if (!u || u.side !== side || !isOnMapBase(u.location)) errs.push(`${id} の駐機／分散は変えられません`);
  }
  return errs;
}
