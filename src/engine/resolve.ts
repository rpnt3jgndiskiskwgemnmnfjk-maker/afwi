// 1 ターンの同時解決。前の状態は変更せず、新しい状態と経過（イベント列）を返す。
// 解決順：準備 → スタンドオフ打撃 → 航空優勢の争奪 → 地上配備防空 → 打撃 → 回復

import { UNIT_TYPES } from '../data/units';
import { rollPool, type Mod } from './combat';
import { controllerOf, isHub, LOC, LOCATIONS } from './geo';
import { planCost, reach, standoffCount } from './orders';
import { aliveUnits, isDamaged, unitsAt } from './state';
import type { DieRoll, FinalScore, GameEvent, GameState, Order, Plan, Side, StrikeAim, TurnReport, Unit } from './types';
import { enemyOf, SIDES } from './types';

export const sideJa = (s: Side) => (s === 'blue' ? '青' : '赤');
export const unitLabel = (u: Unit) => `${sideJa(u.side)} ${u.id.slice(2)}`;

const AIR_MISSIONS = new Set(['CAP', 'STRIKE', 'AEW', 'TANKER']);
const GROUP_ORDER: Record<string, number> = { CAP: 0, STRIKE: 1, AEW: 2, TANKER: 2 };
const SAM_ORDER: Record<string, number> = { STRIKE: 0, CAP: 1, AEW: 2, TANKER: 2 };

export function resolveTurn(prev: GameState, plans: Record<Side, Plan>): { state: GameState; report: TurnReport } {
  if (prev.outcome) throw new Error('ゲームは終了しています');
  const st: GameState = structuredClone(prev);
  const rng = st.rng;
  const events: GameEvent[] = [];
  const lost: Record<Side, number> = { blue: 0, red: 0 };
  const hubsZeroed: Record<Side, Set<string>> = { blue: new Set(), red: new Set() };
  let hubStruck = false;
  let rearStruck = false;

  const unitOrders: { side: Side; order: Order; unit: Unit }[] = [];
  for (const side of SIDES) {
    const plan = plans[side];
    for (const u of aliveUnits(st, side)) {
      const p = plan.postures[u.id];
      if (p) u.posture = p;
    }
    // 費用は計画時点の状態で計算する
    const cost = planCost(prev, plan);
    st.sides[side].logistics -= cost;
    st.sides[side].salvos -= standoffCount(plan);
    if (cost) events.push({ kind: 'logistics', side, delta: -cost, reason: '出撃と修復' });
    for (const o of plan.orders) {
      const u = st.units[o.unitId];
      if (u && u.steps > 0) unitOrders.push({ side, order: o, unit: u });
    }
  }
  const airborne = new Set(unitOrders.map((x) => x.unit.id));

  function damage(u: Unit, by: Side): string {
    if (u.steps <= 0) return '';
    u.steps -= 1;
    lost[u.side] += 1;
    st.sides[by].stepsKilled += 1;
    return `${unitLabel(u)} ${u.steps === 0 ? '撃破' : '損耗'}`;
  }

  function hitBest(cands: Unit[], by: Side): string | null {
    const alive = cands.filter((u) => u.steps > 0).sort((a, b) => b.steps - a.steps || a.id.localeCompare(b.id));
    return alive.length ? damage(alive[0], by) : null;
  }

  /** 基地（またはマップ外ボックス）への命中を、狙いに従って滑走路か駐機中の部隊に割り振る */
  function baseDamage(by: Side, target: string, hits: number, aim: StrikeAim): string[] {
    const out: string[] = [];
    const defender = controllerOf(target) as Side;
    const loc = LOC[target];
    const parked = unitsAt(st, target, defender).filter(
      (u) => !airborne.has(u.id) && u.type !== 'SAM' && (loc.kind === 'box' || u.posture === 'parked'),
    );
    for (let i = 0; i < hits; i++) {
      const base = st.bases[target];
      const parkedAlive = parked.some((u) => u.steps > 0);
      if (base && (aim === 'runway' || !parkedAlive) && base.runway > 0) {
        base.runway -= 1;
        out.push(`${loc.name} 滑走路 ${base.runway + 1}→${base.runway}`);
        if (base.runway === 0 && isHub(target)) hubsZeroed[defender].add(target);
      } else if (parkedAlive) {
        out.push(hitBest(parked, by)!);
      } else {
        out.push('効果なし');
      }
    }
    return out;
  }

  const dmgDice = (u: Unit, n: number) => Math.max(0, n - (isDamaged(u) ? 1 : 0));

  // 1. スタンドオフ打撃
  for (const { side, order, unit } of unitOrders.filter((x) => x.order.mission === 'STANDOFF')) {
    const defender = enemyOf(side);
    const launched = dmgDice(unit, UNIT_TYPES[unit.type].agDice);
    const intercept: DieRoll[] = unitsAt(st, order.target, defender)
      .filter((u) => u.type === 'SAM')
      .map((sam) => rollPool(rng, sam.id, dmgDice(sam, UNIT_TYPES.SAM.aaDice), 4, []));
    const intercepted = Math.min(launched, intercept.reduce((s, r) => s + r.hits, 0));
    const remaining = launched - intercepted;
    const roll = remaining > 0 ? rollPool(rng, unit.id, remaining, UNIT_TYPES[unit.type].target, []) : null;
    const effects = roll ? baseDamage(side, order.target, roll.hits, order.aim ?? 'runway') : [];
    if (isHub(order.target)) hubStruck = true;
    if (LOC[order.target].kind === 'box') rearStruck = true;
    events.push({ kind: 'standoff', side, unitId: unit.id, target: order.target, launched, intercept, intercepted, roll, effects });
  }

  // 2. 航空優勢の争奪
  st.superiority = {};
  const localSup: Record<string, Side | null> = {};
  const airAreas = LOCATIONS.map((l) => l.id).filter((id) =>
    unitOrders.some((x) => x.order.target === id && AIR_MISSIONS.has(x.order.mission)),
  );
  const partsAt = (area: string) => {
    const p = { blue: [] as { unit: Unit; order: Order }[], red: [] as { unit: Unit; order: Order }[] };
    for (const x of unitOrders) if (x.order.target === area && AIR_MISSIONS.has(x.order.mission)) p[x.side].push(x);
    return p;
  };
  const capAlive = (list: { unit: Unit; order: Order }[]) => list.filter((x) => x.order.mission === 'CAP' && x.unit.steps > 0);

  for (const area of airAreas) {
    const parts = partsAt(area);
    const cap = { blue: capAlive(parts.blue), red: capAlive(parts.red) };
    const fight = parts.blue.length > 0 && parts.red.length > 0 && cap.blue.length + cap.red.length > 0;
    let airEvent: Extract<GameEvent, { kind: 'air' }> | null = null;
    if (fight) {
      const rolls: Record<Side, DieRoll[]> = { blue: [], red: [] };
      for (const side of SIDES) {
        const enemy = enemyOf(side);
        const aew = parts[side].some((x) => x.order.mission === 'AEW');
        for (const { unit } of cap[side]) {
          const mods: Mod[] = [];
          if (aew) mods.push({ label: 'AEW 支援', delta: -1 });
          if (cap[side].length < cap[enemy].length) mods.push({ label: '数的劣勢', delta: 1 });
          if (reach(plans[side], prev.units[unit.id], area).atLimit) mods.push({ label: '行動半径ちょうど', delta: 1 });
          rolls[side].push(rollPool(rng, unit.id, dmgDice(unit, UNIT_TYPES[unit.type].aaDice), UNIT_TYPES[unit.type].target, mods));
        }
      }
      const effects: string[] = [];
      for (const side of SIDES) {
        const hits = rolls[side].reduce((s, r) => s + r.hits, 0);
        const targets = parts[enemyOf(side)];
        for (let i = 0; i < hits; i++) {
          const g = [0, 1, 2].find((n) => targets.some((x) => GROUP_ORDER[x.order.mission] === n && x.unit.steps > 0));
          if (g === undefined) break;
          effects.push(hitBest(targets.filter((x) => GROUP_ORDER[x.order.mission] === g).map((x) => x.unit), side)!);
        }
      }
      airEvent = { kind: 'air', area, rolls, effects, superiority: null };
    }
    const sup = superiorityOf(capAlive(parts.blue).length, capAlive(parts.red).length);
    if (airEvent) {
      airEvent.superiority = sup;
      events.push(airEvent);
    }
    if (LOC[area].kind === 'contested') st.superiority[area] = sup;
    else localSup[area] = sup;
  }

  // 3. 地上配備防空
  for (const area of airAreas.filter((a) => LOC[a].kind === 'base')) {
    const defender = controllerOf(area);
    if (defender !== 'blue' && defender !== 'red') continue;
    const intruders = partsAt(area)[enemyOf(defender)].filter((x) => x.unit.steps > 0);
    const sams = unitsAt(st, area, defender).filter((u) => u.type === 'SAM');
    if (!intruders.length || !sams.length) continue;
    const rolls = sams.map((sam) => rollPool(rng, sam.id, dmgDice(sam, UNIT_TYPES.SAM.aaDice), UNIT_TYPES.SAM.target, []));
    const effects: string[] = [];
    const hits = rolls.reduce((s, r) => s + r.hits, 0);
    for (let i = 0; i < hits; i++) {
      const g = [0, 1, 2].find((n) => intruders.some((x) => SAM_ORDER[x.order.mission] === n && x.unit.steps > 0));
      if (g === undefined) break;
      effects.push(hitBest(intruders.filter((x) => SAM_ORDER[x.order.mission] === g).map((x) => x.unit), defender)!);
    }
    events.push({ kind: 'sam', area, side: defender, rolls, effects });
  }

  // 4. 打撃
  for (const area of airAreas.filter((a) => LOC[a].kind === 'base')) {
    for (const side of SIDES) {
      const strikers = partsAt(area)[side].filter((x) => x.order.mission === 'STRIKE' && x.unit.steps > 0);
      if (!strikers.length) continue;
      const defender = enemyOf(side);
      const samUp = unitsAt(st, area, defender).some((u) => u.type === 'SAM');
      const rolls: DieRoll[] = [];
      const effects: string[] = [];
      for (const { unit, order } of strikers) {
        const mods: Mod[] = [];
        if (localSup[area] === side) mods.push({ label: '航空優勢', delta: -1 });
        if (samUp) mods.push({ label: '防空が健在', delta: 1 });
        if (reach(plans[side], prev.units[unit.id], area).atLimit) mods.push({ label: '行動半径ちょうど', delta: 1 });
        const r = rollPool(rng, unit.id, dmgDice(unit, UNIT_TYPES[unit.type].agDice), UNIT_TYPES[unit.type].target, mods);
        rolls.push(r);
        effects.push(...baseDamage(side, area, r.hits, order.aim ?? 'runway'));
      }
      if (isHub(area)) hubStruck = true;
      events.push({ kind: 'strike', side, target: area, rolls, effects });
    }
  }

  // 5. 回復
  for (const { side, order, unit } of unitOrders.filter((x) => x.order.mission === 'MOVE')) {
    if (unit.steps <= 0) continue;
    events.push({ kind: 'move', side, unitId: unit.id, from: unit.location, to: order.target });
    unit.location = order.target;
  }
  for (const side of SIDES) {
    for (const b of plans[side].repairs) {
      const base = st.bases[b];
      base.runway = Math.min(3, base.runway + 1);
      events.push({ kind: 'repair', side, base: b, runway: base.runway });
    }
  }
  for (const side of SIDES) {
    let gain = 0;
    for (const l of LOCATIONS) {
      if (controllerOf(l.id) !== side) continue;
      if (l.kind === 'base' && l.base === 'hub' && st.bases[l.id].runway > 0) gain += 2;
      if (l.kind === 'box' && l.role === 'rear') gain += 1;
    }
    st.sides[side].logistics += gain;
    events.push({ kind: 'logistics', side, delta: gain, reason: 'ハブ基地と後方ボックスの兵站' });
  }
  const changeWill = (side: Side, delta: number, reason: string) => {
    const s = st.sides[side];
    const next = Math.max(0, Math.min(10, s.will + delta));
    if (next !== s.will) events.push({ kind: 'will', side, delta: next - s.will, reason });
    s.will = next;
  };
  for (const side of SIDES) {
    for (const h of hubsZeroed[side]) changeWill(side, -1, `${LOC[h].name} の滑走路が使えなくなった`);
    if (lost[side] >= 3) changeWill(side, -1, `1 日で ${lost[side]} ステップを失った`);
  }
  const escalate = (reason: string) => {
    if (st.escalation >= 5) return;
    events.push({ kind: 'escalation', from: st.escalation, to: st.escalation + 1, reason });
    st.escalation += 1;
  };
  if (hubStruck) escalate('相手のハブ基地への打撃');
  if (rearStruck) escalate('後方ボックスへの攻撃');
  for (const area of st.keyAreas) {
    const s = st.superiority[area];
    if (s) {
      st.sides[s].vp += 1;
      events.push({ kind: 'vp', side: s, delta: 1, reason: `${LOC[area].name} の航空優勢` });
    }
  }

  const report: TurnReport = { turn: st.turn, plans: structuredClone(plans), events };
  st.history.push(report);
  decideOutcome(st);
  if (!st.outcome) st.turn += 1;
  return { state: st, report };
}

function superiorityOf(blue: number, red: number): Side | null {
  if (blue > 0 && red === 0) return 'blue';
  if (red > 0 && blue === 0) return 'red';
  return null;
}

export function scoreOf(st: GameState, side: Side): FinalScore {
  const s = st.sides[side];
  const e = st.sides[enemyOf(side)];
  const areaVp = s.vp;
  const killVp = Math.floor(s.stepsKilled / 2);
  const willVp = Math.max(0, s.will - e.will);
  return { areaVp, killVp, willVp, total: areaVp + killVp + willVp };
}

function decideOutcome(st: GameState) {
  const score = { blue: scoreOf(st, 'blue'), red: scoreOf(st, 'red') };
  if (st.escalation >= 5) {
    st.outcome = { kind: 'catastrophe', reason: 'エスカレーションが段階 5 に達し、双方が戦略的に敗北しました' };
  } else if (st.sides.blue.will <= 0 || st.sides.red.will <= 0) {
    if (st.sides.blue.will <= 0 && st.sides.red.will <= 0) st.outcome = { kind: 'draw', reason: '双方の国民の意志が 0 になりました' };
    else {
      const winner: Side = st.sides.blue.will <= 0 ? 'red' : 'blue';
      st.outcome = { kind: 'victory', winner, reason: `${sideJa(enemyOf(winner))}の国民の意志が 0 になりました` };
    }
  } else if (st.turn >= st.maxTurns) {
    const d = score.blue.total - score.red.total;
    st.outcome = d === 0
      ? { kind: 'draw', reason: `勝利点が同じです（${score.blue.total} 対 ${score.red.total}）` }
      : { kind: 'victory', winner: d > 0 ? 'blue' : 'red', reason: `勝利点 ${score.blue.total} 対 ${score.red.total}` };
  }
  if (st.outcome) st.score = score;
}
