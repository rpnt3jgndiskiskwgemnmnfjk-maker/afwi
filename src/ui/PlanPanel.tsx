import { UNIT_TYPES } from '../data/units';
import {
  band, controllerOf, describeMods, finalTarget, hitProb, isHub, LOC, MISSION_LABEL, missionsFor, orderOf, planCost,
  postureOf, reach, REPAIR_COST, sortieCost, sortieLimit, sortiesFrom, unitLabel, unitsAt, validatePlan, validTargets,
  isDamaged, type GameState, type Mission, type Mod, type Plan, type Side, type StrikeAim, type Unit,
} from '../engine';
import { targetText } from './Dice';

interface Props {
  game: GameState;
  side: Side;
  plan: Plan;
  setPlan: (p: Plan) => void;
  selLoc: string | null;
  selUnit: string | null;
  mission: Mission | null;
  aim: StrikeAim;
  hint?: string;
  onSelectUnit: (id: string | null) => void;
  onMission: (m: Mission | null) => void;
  onAim: (a: StrikeAim) => void;
  onAssign: (target: string) => void;
  onConfirm: () => void;
}

const sideName = (s: Side) => (s === 'blue' ? '青軍' : '赤軍');

export function Pips({ n, max }: { n: number; max: number }) {
  return <span class="pips">{Array.from({ length: max }, (_, i) => <i class={i < n ? '' : 'x'} />)}</span>;
}

/** 計画時点で分かる修正（敵の出方で決まる数的劣勢・航空優勢は含めない） */
export function knownMods(game: GameState, plan: Plan, u: Unit, mission: Mission, target: string): Mod[] {
  const mods: Mod[] = [];
  if (mission === 'CAP' && plan.orders.some((o) => o.mission === 'AEW' && o.target === target)) mods.push({ label: 'AEW 支援', delta: -1 });
  if ((mission === 'CAP' || mission === 'STRIKE') && reach(plan, u, target).atLimit) mods.push({ label: '行動半径ちょうど', delta: 1 });
  if (mission === 'STRIKE' && unitsAt(game, target).some((x) => x.type === 'SAM' && x.side !== u.side)) mods.push({ label: '防空が健在', delta: 1 });
  return mods;
}

export function PlanPanel(p: Props) {
  const { game, side, plan } = p;
  const errs = validatePlan(game, side, plan);
  const cost = planCost(game, plan);
  const s = game.sides[side];
  const unit = p.selUnit ? game.units[p.selUnit] : null;
  const loc = p.selLoc ? LOC[p.selLoc] : null;

  const removeOrder = (unitId: string) => p.setPlan({ ...plan, orders: plan.orders.filter((o) => o.unitId !== unitId) });
  const toggleRepair = (b: string) =>
    p.setPlan({ ...plan, repairs: plan.repairs.includes(b) ? plan.repairs.filter((x) => x !== b) : [...plan.repairs, b] });
  const togglePosture = (u: Unit) => {
    const next = postureOf(u, plan) === 'parked' ? 'dispersed' : 'parked';
    const postures = { ...plan.postures };
    if (next === u.posture) delete postures[u.id];
    else postures[u.id] = next;
    p.setPlan({ ...plan, postures });
  };

  return (
    <>
      <div class="card">
        <div class="between">
          <h3 class={side}>{sideName(side)}の計画</h3>
          <span class="mono muted">作戦日 {game.turn}/{game.maxTurns}</span>
        </div>
        <div class="row">
          <span>兵站 <b class="mono">{s.logistics}</b> → 計画後 <b class={`mono${s.logistics - cost < 0 ? ' red' : ''}`}>{s.logistics - cost}</b></span>
          <span class="muted">スタンドオフ弾 {s.salvos}</span>
        </div>
        {errs.map((e) => <p class="err">{e}</p>)}
      </div>

      {p.hint && <div class="card hint"><span class="label">手引き</span><p>{p.hint}</p></div>}

      {loc ? (
        <div class="card">
          <div class="between">
            <h3>{loc.name}</h3>
            <span class="mono muted">{loc.id}</span>
          </div>
          <p class="muted">{locKind(loc.id)}</p>
          {game.bases[loc.id] && (
            <div class="row">
              <span>滑走路 <Pips n={game.bases[loc.id].runway} max={3} /> <span class="mono">{game.bases[loc.id].runway}/3</span></span>
              {controllerOf(loc.id) === side && <span class="muted">出撃 {sortiesFrom(game, plan, loc.id)}/{sortieLimit(game, loc.id)}</span>}
              {controllerOf(loc.id) === side && game.bases[loc.id].runway < 3 && (
                <button class="btn small" aria-pressed={plan.repairs.includes(loc.id)} onClick={() => toggleRepair(loc.id)}>
                  {plan.repairs.includes(loc.id) ? '修復を取り消す' : `修復する（兵站 ${REPAIR_COST}）`}
                </button>
              )}
            </div>
          )}
          <UnitList game={game} plan={plan} side={side} loc={loc.id} selUnit={p.selUnit} onSelect={p.onSelectUnit} onPosture={togglePosture} />
        </div>
      ) : (
        <div class="card"><p class="muted">地図の基地かマップ外ボックスをタップして、部隊を選んでください。</p></div>
      )}

      {unit && unit.side === side && (
        <UnitCard {...p} unit={unit} onRemove={() => removeOrder(unit.id)} />
      )}

      <div class="card">
        <div class="between"><h3>任務一覧</h3><span class="mono muted">費用 {cost}</span></div>
        {plan.orders.length === 0 && plan.repairs.length === 0 && <p class="muted">まだ任務がありません。何もしない日にしても構いません。</p>}
        {plan.orders.map((o) => {
          const u = game.units[o.unitId];
          return (
            <div class="orderline">
              <button class="btn ghost small" style="text-align:left;border:0;padding:0" onClick={() => p.onSelectUnit(u.id)}>
                <b>{unitLabel(u)}</b> {LOC[u.location].name} → {LOC[o.target].name}・{MISSION_LABEL[o.mission]}
                {o.aim === 'parked' && '（駐機機狙い）'} <span class="muted mono">兵站 {sortieCost(u, plan)}</span>
              </button>
              <button class="btn small" onClick={() => removeOrder(u.id)} aria-label={`${unitLabel(u)} の任務を取り消す`}>取消</button>
            </div>
          );
        })}
        {plan.repairs.map((b) => (
          <div class="orderline"><span>{LOC[b].name} の滑走路を修復 <span class="muted mono">兵站 {REPAIR_COST}</span></span><button class="btn small" onClick={() => toggleRepair(b)}>取消</button></div>
        ))}
        <button class="btn primary" disabled={errs.length > 0} onClick={p.onConfirm}>計画を確定する</button>
      </div>
    </>
  );
}

function locKind(id: string): string {
  const l = LOC[id];
  if (l.kind === 'box') return `マップ外ボックス（${l.side === 'blue' ? '青' : '赤'}・${l.role === 'rear' ? '後方：敵機は攻撃できない' : 'スタンドオフ打撃'}）`;
  if (l.kind === 'contested') return '争奪エリア';
  const owner = l.owner === 'blue' ? '青' : l.owner === 'red' ? '赤' : '中立';
  return `${l.base === 'hub' ? 'ハブ基地（兵站 +2/日）' : 'スポーク基地（収容 2）'}・${owner}`;
}

function UnitList({ game, plan, side, loc, selUnit, onSelect, onPosture }: {
  game: GameState; plan: Plan; side: Side; loc: string; selUnit: string | null;
  onSelect: (id: string | null) => void; onPosture: (u: Unit) => void;
}) {
  const own = unitsAt(game, loc, side);
  const enemy = unitsAt(game, loc).filter((u) => u.side !== side);
  const onMapBase = LOC[loc].kind === 'base';
  return (
    <div class="units">
      {own.map((u) => {
        const t = UNIT_TYPES[u.type];
        const o = orderOf(plan, u.id);
        const canPosture = onMapBase && u.type !== 'SAM';
        return (
          <div class={`unit${selUnit === u.id ? ' sel' : ''}`}>
            <span class={`badge ${u.side}`}>{u.type}</span>
            <button class="btn ghost small" style="text-align:left;border:0;padding:0;min-height:0" onClick={() => onSelect(u.id)}>
              <div>{unitLabel(u)} <span class="muted">{t.name}</span> <span class={u.side}><Pips n={u.steps} max={t.steps} /></span></div>
              <div class="meta">{o ? `${MISSION_LABEL[o.mission]} → ${LOC[o.target].name}` : missionsFor(game, u).length ? '待機' : '任務なし（防空として迎撃）'}</div>
            </button>
            {canPosture
              ? <button class="btn small" aria-pressed={postureOf(u, plan) === 'dispersed'} onClick={() => onPosture(u)} title="分散すると打撃で破壊されないが出撃費用 +1">{postureOf(u, plan) === 'dispersed' ? '分散' : '駐機'}</button>
              : <span />}
          </div>
        );
      })}
      {own.length === 0 && <p class="muted">自軍の部隊はいません。</p>}
      {enemy.length > 0 && (
        <p class="muted">敵：{Object.entries(groupBy(enemy)).map(([k, n]) => `${k}×${n}`).join('、')}</p>
      )}
    </div>
  );
}

const groupBy = (us: Unit[]) => us.reduce<Record<string, number>>((m, u) => ((m[u.type] = (m[u.type] ?? 0) + 1), m), {});

function UnitCard(p: Props & { unit: Unit; onRemove: () => void }) {
  const { game, plan, unit, mission } = p;
  const t = UNIT_TYPES[unit.type];
  const o = orderOf(plan, unit.id);
  const ms = missionsFor(game, unit);
  // 自分の任務を外した計画で目標候補を出す（任務の付け替えのため）
  const planWithout = { ...plan, orders: plan.orders.filter((x) => x.unitId !== unit.id) };
  const targets = mission ? validTargets(game, planWithout, unit, mission) : [];
  const dmg = isDamaged(unit) ? 1 : 0;
  return (
    <div class="card">
      <div class="between">
        <h3>{unitLabel(unit)} <span class="muted" style="font-size:13px">{t.name}</span></h3>
        <span class={unit.side}><Pips n={unit.steps} max={t.steps} /></span>
      </div>
      <p class="mono muted" style="font-size:12px">
        対空 {Math.max(0, t.aaDice - dmg)}d4・対地 {Math.max(0, t.agDice - dmg)}d4・基準 {targetText(t.target)}・行動半径 {t.radius} 帯{dmg ? '・損耗' : ''}
      </p>
      {o && (
        <div class="row">
          <span>現在の任務：<b>{MISSION_LABEL[o.mission]}</b> → {LOC[o.target].name}</span>
          <button class="btn small" onClick={p.onRemove}>取消</button>
        </div>
      )}
      {ms.length === 0 && <p class="muted">この部隊に出せる任務はありません。{unit.type === 'SAM' ? '基地に入った敵機を自動で迎撃します。' : ''}</p>}
      {ms.length > 0 && (
        <div class="row" role="group" aria-label="任務">
          {ms.map((m) => <button class="btn small" aria-pressed={mission === m} onClick={() => p.onMission(mission === m ? null : m)}>{MISSION_LABEL[m]}</button>)}
        </div>
      )}
      {mission && (mission === 'STRIKE' || mission === 'STANDOFF') && (
        <div class="row" role="group" aria-label="狙い">
          <span class="muted">狙い</span>
          <button class="btn small" aria-pressed={p.aim === 'runway'} onClick={() => p.onAim('runway')}>滑走路</button>
          <button class="btn small" aria-pressed={p.aim === 'parked'} onClick={() => p.onAim('parked')}>駐機中の部隊</button>
        </div>
      )}
      {mission && (
        <div class="units">
          {targets.length === 0 && <p class="warn">届く目標がありません。{LOC[unit.location].role === 'rear' ? '「転地」で前方の基地に移しましょう。' : ''}</p>}
          {targets.length > 0 && <p class="muted" style="font-size:12.5px">目標を選んでください（地図の光っている地点をタップしても選べます）。</p>}
          {targets.map((id) => <TargetRow {...p} unit={unit} mission={mission} target={id} plan={planWithout} />)}
        </div>
      )}
    </div>
  );
}

function TargetRow(p: Props & { unit: Unit; mission: Mission; target: string }) {
  const { game, plan, unit, mission, target } = p;
  const t = UNIT_TYPES[unit.type];
  const r = reach(plan, unit, target);
  const showOdds = mission === 'CAP' || mission === 'STRIKE' || mission === 'STANDOFF';
  const mods = knownMods(game, plan, unit, mission, target);
  const ft = finalTarget(t.target, mods);
  const dice = Math.max(0, (mission === 'CAP' ? t.aaDice : t.agDice) - (isDamaged(unit) ? 1 : 0));
  const escal = (mission === 'STRIKE' || mission === 'STANDOFF') && (isHub(target) || LOC[target].kind === 'box');
  return (
    <button class="unit" onClick={() => p.onAssign(target)}>
      <span class="mono" style="min-width:38px">{Number.isFinite(band(unit.location, target)) ? `${r.band}帯` : '—'}</span>
      <span>
        <div><b>{LOC[target].name}</b> {r.atLimit && mission !== 'MOVE' && mission !== 'STANDOFF' && <span class="warn">行動半径ちょうど</span>}</div>
        {showOdds && (
          <div class="meta">
            {dice}d4・基準 {targetText(ft)}（1 個 {Math.round(hitProb(ft) * 100)}%・期待 {(dice * hitProb(ft)).toFixed(1)} 命中）
            {mods.length > 0 && ` ${describeMods(mods).join('、')}`}
            {mission === 'STANDOFF' && '・防空の迎撃は基準 4'}
          </div>
        )}
        {escal && <div class="warn">実行するとエスカレーション +1（{game.escalation}→{game.escalation + 1}）{game.escalation >= 4 ? '。段階 5 で双方が敗北します' : ''}</div>}
      </span>
      <span class="mono muted">兵站 {sortieCost(unit, plan)}</span>
    </button>
  );
}
