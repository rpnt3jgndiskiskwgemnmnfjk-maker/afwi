// 1 ターンの同時解決。前の状態は変更せず、新しい状態と経過（イベント列）を返す。
// 解決順：国力カード → スタンドオフ打撃 → 航空優勢の争奪 → 防空制圧と地上配備防空 → 打撃 → 回復 → 次の日の準備

import { UNIT_TYPES } from '../data/units';
import { rollPool, type Mod } from './combat';
import { isHub, LOC, LOCATIONS } from './geo';
import { planCost, reach, sortieLimit, standoffCount } from './orders';
import { isDamaged, ownerOf, startTurn, unitsAt } from './state';
import type { DieRoll, FinalScore, GameEvent, GameState, Order, Plan, Side, StrikeAim, TurnReport, Unit } from './types';
import { enemyOf, SIDES } from './types';

export const sideJa = (s: Side) => (s === 'blue' ? '青' : '赤');
export const unitLabel = (u: Unit) => `${sideJa(u.side)} ${u.id.slice(2)}`;

const AIR_MISSIONS = new Set(['CAP', 'STRIKE', 'SEAD', 'AEW', 'RECON', 'TANKER', 'AIRLIFT']);
/** 航空戦で命中を割り振る順（護衛 → 打撃機 → 支援機） */
const GROUP_ORDER: Record<string, number> = { CAP: 0, STRIKE: 1, SEAD: 1, AEW: 2, RECON: 2, TANKER: 2, AIRLIFT: 2 };
/** 地上配備防空が狙う順（打撃機 → 護衛 → 支援機） */
const SAM_ORDER: Record<string, number> = { STRIKE: 0, SEAD: 0, CAP: 1, AEW: 2, RECON: 2, TANKER: 2, AIRLIFT: 2 };
const STREAK_FOR_WILL = 3;

type Sortie = { side: Side; order: Order; unit: Unit };

export function resolveTurn(prev: GameState, plans: Record<Side, Plan>): { state: GameState; report: TurnReport } {
  if (prev.outcome) throw new Error('ゲームは終了しています');
  const st: GameState = structuredClone(prev);
  const rng = st.rng;
  const events: GameEvent[] = [];
  const lost: Record<Side, number> = { blue: 0, red: 0 };
  const hubsZeroed: Record<Side, Set<string>> = { blue: new Set(), red: new Set() };
  const rearHit: Record<Side, boolean> = { blue: false, red: false };
  const extraLogistics: Record<Side, number> = { blue: 0, red: 0 };
  let baseStruck = false;
  let hubStruck = false;
  let rearStruck = false;

  // 準備：費用の支払い（計画時点の状態で計算する）
  for (const side of SIDES) {
    const cost = planCost(prev, plans[side]);
    st.sides[side].logistics -= cost;
    st.sides[side].salvos -= standoffCount(plans[side]);
    if (cost) events.push({ kind: 'logistics', side, delta: -cost, reason: '出撃と修復' });
  }

  // 1. 国力カード
  const cyber: Record<string, number> = {};
  for (const side of SIDES) {
    const play = plans[side].card;
    if (!play) continue;
    const s = st.sides[side];
    s.hand.splice(s.hand.indexOf(play.card), 1);
    const enemy = enemyOf(side);
    const effects: string[] = [];
    switch (play.card) {
      case 'ACCESS':
        if (st.owners.LUZ === 'neutral') { st.owners.LUZ = side; effects.push(`ルソン北部を${sideJa(side)}が使えるようになった`); }
        else effects.push('すでに中立ではなかったため効果なし');
        break;
      case 'MEDIATION':
        if (st.escalation > 1) {
          events.push({ kind: 'escalation', from: st.escalation, to: st.escalation - 1, reason: '停戦の仲介' });
          st.escalation -= 1;
        } else effects.push('効果なし');
        break;
      case 'MESSAGE': {
        const e = st.sides[enemy];
        const before = e.will;
        e.will = Math.max(0, e.will - 1);
        effects.push(`${sideJa(enemy)}の国民の意志 ${before}→${e.will}`);
        break;
      }
      case 'DECEPTION':
        s.deception = play.target ?? null;
        effects.push('次の情報フェイズで 1 地点を隠す');
        break;
      case 'SEALIFT':
        extraLogistics[side] += 2;
        effects.push('回復フェイズに兵站 +2');
        break;
      case 'SANCTIONS':
        st.sides[enemy].sanctions = 2;
        effects.push(`${sideJa(enemy)}の兵站の生成 −1（2 日間）`);
        break;
      case 'SATELLITE':
        s.satellite = true;
        effects.push('次の情報フェイズで探知の基準 −2');
        break;
      case 'CYBER':
        if (play.target) { cyber[play.target] = (cyber[play.target] ?? 0) + 1; effects.push(`${LOC[play.target].name} の出撃上限 −1`); }
        break;
    }
    events.push({ kind: 'card', side, card: play.card, target: play.target, effects });
  }

  // 基地システム妨害で上限を超えた出撃を取り消す（計画の後ろから）
  const sorties: Sortie[] = [];
  for (const side of SIDES) {
    const used: Record<string, number> = {};
    for (const o of plans[side].orders) {
      const u = st.units[o.unitId];
      if (!u || u.steps <= 0) continue;
      const from = u.location;
      const lim = sortieLimit(prev, from) - (cyber[from] ?? 0);
      used[from] = (used[from] ?? 0) + 1;
      if (used[from] > lim) {
        events.push({ kind: 'cancelled', side, unitId: u.id, reason: `${LOC[from].name} の基地システムが妨害された` });
        continue;
      }
      sorties.push({ side, order: o, unit: u });
    }
  }
  const airborne = new Set(sorties.map((x) => x.unit.id));
  const dmgDice = (u: Unit, n: number) => Math.max(0, n - (isDamaged(u) ? 1 : 0));
  const notDetected = (side: Side, loc: string) => !prev.detected[side].includes(loc);

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

  /** 命中を優先順の組ごとに、残りステップの多い部隊から割り振る */
  function allocate(hits: number, targets: { unit: Unit; order: Order }[], order: Record<string, number>, by: Side): string[] {
    const out: string[] = [];
    for (let i = 0; i < hits; i++) {
      const g = [0, 1, 2].find((n) => targets.some((x) => order[x.order.mission] === n && x.unit.steps > 0));
      if (g === undefined) break;
      out.push(hitBest(targets.filter((x) => order[x.order.mission] === g).map((x) => x.unit), by)!);
    }
    return out;
  }

  /** 基地（またはマップ外ボックス）への命中を、狙いに従って滑走路か駐機中の部隊に割り振る */
  function baseDamage(by: Side, target: string, hits: number, aim: StrikeAim): string[] {
    const out: string[] = [];
    const defender = ownerOf(st, target) as Side;
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

  const markAttack = (target: string) => {
    if (LOC[target].kind === 'box') { rearStruck = true; rearHit[ownerOf(st, target) as Side] = true; return; }
    baseStruck = true;
    if (isHub(target)) hubStruck = true;
  };

  // 2. スタンドオフ打撃
  for (const { side, order, unit } of sorties.filter((x) => x.order.mission === 'STANDOFF')) {
    const defender = enemyOf(side);
    const launched = dmgDice(unit, UNIT_TYPES[unit.type].agDice);
    const intercept: DieRoll[] = unitsAt(st, order.target, defender)
      .filter((u) => u.type === 'SAM')
      .map((sam) => rollPool(rng, sam.id, dmgDice(sam, UNIT_TYPES.SAM.aaDice), 4, []));
    const intercepted = Math.min(launched, intercept.reduce((s, r) => s + r.hits, 0));
    const remaining = launched - intercepted;
    const mods: Mod[] = notDetected(side, order.target) ? [{ label: '目標未探知', delta: 1 }] : [];
    const roll = remaining > 0 ? rollPool(rng, unit.id, remaining, UNIT_TYPES[unit.type].target, mods) : null;
    const effects = roll ? baseDamage(side, order.target, roll.hits, order.aim ?? 'runway') : [];
    markAttack(order.target);
    events.push({ kind: 'standoff', side, unitId: unit.id, target: order.target, launched, intercept, intercepted, roll, effects });
  }

  // 3. 航空優勢の争奪
  st.superiority = {};
  const localSup: Record<string, Side | null> = {};
  const airAreas = LOCATIONS.map((l) => l.id).filter((id) => sorties.some((x) => x.order.target === id && AIR_MISSIONS.has(x.order.mission)));
  const partsAt = (area: string) => {
    const p = { blue: [] as { unit: Unit; order: Order }[], red: [] as { unit: Unit; order: Order }[] };
    for (const x of sorties) if (x.order.target === area && AIR_MISSIONS.has(x.order.mission)) p[x.side].push(x);
    return p;
  };
  const capAlive = (list: { unit: Unit; order: Order }[]) => list.filter((x) => x.order.mission === 'CAP' && x.unit.steps > 0);
  const weatherArea = st.situation?.id === 'WEATHER' ? st.situation.area : undefined;

  for (const area of airAreas) {
    const parts = partsAt(area);
    const cap = { blue: capAlive(parts.blue), red: capAlive(parts.red) };
    if (parts.blue.length > 0 && parts.red.length > 0 && cap.blue.length + cap.red.length > 0) {
      const rolls: Record<Side, DieRoll[]> = { blue: [], red: [] };
      for (const side of SIDES) {
        const enemy = enemyOf(side);
        const aew = parts[side].some((x) => x.order.mission === 'AEW');
        const stealthy = cap[enemy].length > 0 && cap[enemy].every((x) => x.unit.type === 'STL');
        for (const { unit } of cap[side]) {
          const mods: Mod[] = [];
          if (aew) mods.push({ label: 'AEW 支援', delta: -1 });
          if (stealthy && !aew) mods.push({ label: 'ステルス目標', delta: 1 });
          if (cap[side].length < cap[enemy].length) mods.push({ label: '数的劣勢', delta: 1 });
          if (reach(plans[side], prev.units[unit.id], area).atLimit) mods.push({ label: '行動半径ちょうど', delta: 1 });
          if (weatherArea === area) mods.push({ label: '悪天候', delta: 1 });
          rolls[side].push(rollPool(rng, unit.id, dmgDice(unit, UNIT_TYPES[unit.type].aaDice), UNIT_TYPES[unit.type].target, mods));
        }
      }
      const effects: string[] = [];
      for (const side of SIDES) {
        effects.push(...allocate(rolls[side].reduce((s, r) => s + r.hits, 0), parts[enemyOf(side)], GROUP_ORDER, side));
      }
      events.push({ kind: 'air', area, rolls, effects, superiority: superiorityOf(capAlive(parts.blue).length, capAlive(parts.red).length) });
    }
    const sup = superiorityOf(capAlive(parts.blue).length, capAlive(parts.red).length);
    if (LOC[area].kind === 'contested') st.superiority[area] = sup;
    else localSup[area] = sup;
  }

  // 4. 防空制圧（SEAD）と地上配備防空
  const suppressed = new Set<string>();
  for (const area of airAreas.filter((a) => LOC[a].kind === 'base')) {
    const defender = ownerOf(st, area);
    if (defender !== 'blue' && defender !== 'red') continue;
    const attacker = enemyOf(defender);
    const seads = partsAt(area)[attacker].filter((x) => x.order.mission === 'SEAD' && x.unit.steps > 0);
    const samsBefore = unitsAt(st, area, defender).filter((u) => u.type === 'SAM');
    if (seads.length) {
      const rolls = seads.map(({ unit }) => {
        const mods: Mod[] = [];
        if (localSup[area] === attacker) mods.push({ label: '航空優勢', delta: -1 });
        if (reach(plans[attacker], prev.units[unit.id], area).atLimit) mods.push({ label: '行動半径ちょうど', delta: 1 });
        if (notDetected(attacker, area)) mods.push({ label: '目標未探知', delta: 1 });
        return rollPool(rng, unit.id, dmgDice(unit, UNIT_TYPES[unit.type].agDice), UNIT_TYPES[unit.type].target, mods);
      });
      const hits = rolls.reduce((s, r) => s + r.hits, 0);
      const effects: string[] = [];
      for (let i = 0; i < hits; i++) {
        const target = samsBefore.filter((u) => u.steps > 0).sort((a, b) => b.steps - a.steps || a.id.localeCompare(b.id))[0];
        if (!target) break;
        suppressed.add(target.id);
        effects.push(damage(target, attacker));
      }
      if (!samsBefore.length) effects.push('防空部隊はいなかった');
      markAttack(area);
      events.push({ kind: 'sead', side: attacker, target: area, rolls, effects });
    }
    const intruders = partsAt(area)[attacker].filter((x) => x.unit.steps > 0);
    const sams = unitsAt(st, area, defender).filter((u) => u.type === 'SAM' && !suppressed.has(u.id));
    if (!intruders.length || !sams.length) continue;
    const rolls = sams.map((sam) => rollPool(rng, sam.id, dmgDice(sam, UNIT_TYPES.SAM.aaDice), UNIT_TYPES.SAM.target, []));
    const effects = allocate(rolls.reduce((s, r) => s + r.hits, 0), intruders, SAM_ORDER, defender);
    events.push({ kind: 'sam', area, side: defender, rolls, effects });
  }

  // 5. 打撃
  for (const area of airAreas.filter((a) => LOC[a].kind === 'base')) {
    for (const side of SIDES) {
      const strikers = partsAt(area)[side].filter((x) => x.order.mission === 'STRIKE' && x.unit.steps > 0);
      if (!strikers.length) continue;
      const defender = enemyOf(side);
      const samUp = unitsAt(st, area, defender).some((u) => u.type === 'SAM' && !suppressed.has(u.id));
      const rolls: DieRoll[] = [];
      const effects: string[] = [];
      for (const { unit, order } of strikers) {
        const mods: Mod[] = [];
        if (localSup[area] === side) mods.push({ label: '航空優勢', delta: -1 });
        if (samUp) mods.push({ label: '防空が健在', delta: 1 });
        if (notDetected(side, area)) mods.push({ label: '目標未探知', delta: 1 });
        if (reach(plans[side], prev.units[unit.id], area).atLimit) mods.push({ label: '行動半径ちょうど', delta: 1 });
        const r = rollPool(rng, unit.id, dmgDice(unit, UNIT_TYPES[unit.type].agDice), UNIT_TYPES[unit.type].target, mods);
        rolls.push(r);
        effects.push(...baseDamage(side, area, r.hits, order.aim ?? 'runway'));
      }
      markAttack(area);
      events.push({ kind: 'strike', side, target: area, rolls, effects });
    }
  }
  // 6. 回復
  const moved = new Set<string>();
  for (const { side, order, unit } of sorties.filter((x) => x.order.mission === 'MOVE')) {
    if (unit.steps <= 0) continue;
    moved.add(unit.id);
    events.push({ kind: 'move', side, unitId: unit.id, from: unit.location, to: order.target });
    unit.location = order.target;
    unit.posture = 'parked';
  }
  for (const side of SIDES) {
    for (const [id, posture] of Object.entries(plans[side].postures)) {
      const u = st.units[id];
      if (!u || u.steps <= 0 || u.side !== side || u.posture === posture || moved.has(id)) continue;
      u.posture = posture;
      events.push({ kind: 'posture', side, unitId: id, posture });
    }
    for (const b of plans[side].repairs) {
      const base = st.bases[b];
      base.runway = Math.min(3, base.runway + 1);
      events.push({ kind: 'repair', side, base: b, runway: base.runway });
    }
  }
  for (const side of SIDES) {
    const s = st.sides[side];
    let gain = 0;
    for (const l of LOCATIONS) {
      if (ownerOf(st, l.id) !== side) continue;
      if (l.kind === 'base' && l.base === 'hub' && st.bases[l.id].runway > 0) gain += 2;
      if (l.kind === 'box' && l.role === 'rear') gain += 1;
    }
    events.push({ kind: 'logistics', side, delta: gain, reason: 'ハブ基地と後方ボックスの兵站' });
    if (s.sanctions > 0) {
      gain -= 1;
      s.sanctions -= 1;
      events.push({ kind: 'logistics', side, delta: -1, reason: '経済制裁' });
    }
    const airlift = sorties.filter((x) => x.side === side && x.order.mission === 'AIRLIFT' && x.unit.steps > 0).length;
    if (airlift) events.push({ kind: 'logistics', side, delta: airlift, reason: '輸送機による補給' });
    if (extraLogistics[side]) events.push({ kind: 'logistics', side, delta: extraLogistics[side], reason: '海上輸送の優先' });
    s.logistics = Math.max(0, s.logistics + gain + airlift + extraLogistics[side]);
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
    if (rearHit[side]) changeWill(side, -1, '後方が攻撃を受けた');
  }
  for (const area of st.keyAreas) {
    const s = st.superiority[area];
    const prevStreak = st.supStreak[area];
    if (!s) { delete st.supStreak[area]; continue; }
    const turns = prevStreak?.side === s ? prevStreak.turns + 1 : 1;
    st.supStreak[area] = { side: s, turns };
    if (turns === STREAK_FOR_WILL) changeWill(s, 1, `${LOC[area].name} の航空優勢を ${turns} 日続けた`);
  }

  const escalate = (to: number, reason: string) => {
    const next = Math.min(5, to);
    if (next <= st.escalation) return;
    events.push({ kind: 'escalation', from: st.escalation, to: next, reason });
    st.escalation = next;
  };
  if (baseStruck && st.escalation < 3) escalate(3, '基地への攻撃で本格的航空戦に入った');
  if (hubStruck) escalate(st.escalation + 1, '相手のハブ基地への攻撃');
  if (rearStruck) escalate(st.escalation + 1, '後方ボックスへの攻撃');

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
  if (!st.outcome) {
    st.turn += 1;
    startTurn(st, plans);
  }
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

