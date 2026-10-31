import { useEffect, useMemo, useState } from 'preact/hooks';
import { SCENARIOS, S0 } from '../data/scenarios';
import { UNIT_TYPES } from '../data/units';
import {
  createGame, emptyPlan, LOC, missionsFor, resolveTurn, sideJa, validTargets,
  type GameState, type Mission, type Plan, type Side, type StrikeAim, type TurnReport,
} from '../engine';
import { MapView, type MapLine } from './MapView';
import { PlanPanel } from './PlanPanel';
import { ResultPanel, Summary } from './ResultPanel';
import { clearSession, loadSession, saveSession } from './storage';

export type Mode = 'secret' | 'open';

export type Screen =
  | { kind: 'title' }
  | { kind: 'handover'; side: Side }
  | { kind: 'plan'; side: Side }
  | { kind: 'result' }
  | { kind: 'end' };

export interface Session {
  version: 1;
  mode: Mode;
  game: GameState;
  plans: Record<Side, Plan>;
  screen: Screen;
  lastReport: TurnReport | null;
}

let current: Session | null = null;
/** 表示中のアーティファクトが更新されたときに状態を引き継ぐための参照 */
export const currentSession = () => current;

const newSeed = () => {
  try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Date.now() >>> 0; }
};

export function App({ initial }: { initial: Session | null }) {
  const [session, setSession] = useState<Session | null>(initial);
  const [saved, setSaved] = useState<Session | null>(() => (initial ? null : loadSession()));
  const [selLoc, setSelLoc] = useState<string | null>('OKI');
  const [selUnit, setSelUnit] = useState<string | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [aim, setAim] = useState<StrikeAim>('runway');
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    current = session;
    if (session) saveSession(session);
  }, [session]);

  const resetSelection = (side?: Side) => {
    setSelLoc(side === 'red' ? 'ECC' : 'OKI');
    setSelUnit(null);
    setMission(null);
    setAim('runway');
  };

  const start = (mode: Mode) => {
    const game = createGame(S0, newSeed());
    resetSelection('blue');
    setSession({ version: 1, mode, game, plans: { blue: emptyPlan(), red: emptyPlan() }, screen: mode === 'secret' ? { kind: 'handover', side: 'blue' } : { kind: 'plan', side: 'blue' }, lastReport: null });
  };

  if (!session || session.screen.kind === 'title') {
    return <Title saved={saved} onStart={start} onContinue={() => { setSession(saved); setSaved(null); }} />;
  }

  const { game, screen } = session;
  const update = (patch: Partial<Session>) => setSession({ ...session, ...patch });

  if (screen.kind === 'handover') {
    return (
      <>
        <StatusBar game={game} who={screen.side} label="交代" />
        <div class="screen gutter">
          <div class="sheet handover">
            <span class="label">作戦日 {game.turn} · ホットシート</span>
            <p class={`big ${screen.side}`}>{sideJa(screen.side)}軍の計画です</p>
            <p class="lede">端末を{sideJa(screen.side)}軍のプレイヤーに渡してください。相手の計画は表示されません。</p>
            <button class="btn primary" onClick={() => { resetSelection(screen.side); update({ screen: { kind: 'plan', side: screen.side } }); }}>{sideJa(screen.side)}軍の計画を始める</button>
          </div>
        </div>
      </>
    );
  }

  if (screen.kind === 'end') {
    return <End session={session} onAgain={() => { clearSession(); start(session.mode); }} onTitle={() => { clearSession(); setSession(null); setSaved(null); }} />;
  }

  if (screen.kind === 'result' && session.lastReport) {
    const lines: MapLine[] = (['blue', 'red'] as Side[]).flatMap((s) =>
      session.lastReport!.plans[s].orders.map((o) => ({ from: prevLoc(session, o.unitId), to: o.target, side: s, mission: o.mission })),
    );
    const next = () => {
      if (game.outcome) return update({ screen: { kind: 'end' } });
      resetSelection('blue');
      update({ plans: { blue: emptyPlan(), red: emptyPlan() }, screen: session.mode === 'secret' ? { kind: 'handover', side: 'blue' } : { kind: 'plan', side: 'blue' } });
    };
    return (
      <>
        <StatusBar game={game} label="解決" />
        <div class="board">
          <div class="mapwrap"><MapView game={game} selected={null} ring={null} targets={[]} lines={lines} onPick={() => {}} /></div>
          <div class="panel gutter"><ResultPanel game={game} report={session.lastReport} onNext={next} /></div>
        </div>
      </>
    );
  }

  // 計画フェイズ
  const side = (screen as { side: Side }).side;
  const plan = session.plans[side];
  const setPlan = (p: Plan) => update({ plans: { ...session.plans, [side]: p } });
  const unit = selUnit ? game.units[selUnit] : null;
  const planWithout = unit ? { ...plan, orders: plan.orders.filter((o) => o.unitId !== unit.id) } : plan;
  const targets = unit && mission ? validTargets(game, planWithout, unit, mission) : [];
  const ringCenter = unit ? unit.location : selLoc;
  const ringRadius = unit ? UNIT_TYPES[unit.type].radius : 2;
  const showRing = ringCenter && (unit ? UNIT_TYPES[unit.type].radius > 0 : LOC[ringCenter].kind !== 'contested');

  const assign = (target: string) => {
    if (!unit || !mission) return;
    const order = { unitId: unit.id, mission, target, ...(mission === 'STRIKE' || mission === 'STANDOFF' ? { aim } : {}) };
    setPlan({ ...plan, orders: [...planWithout.orders, order] });
    setMission(null);
  };
  const pick = (id: string) => {
    if (unit && mission && targets.includes(id)) return assign(id);
    setSelLoc(id);
    if (unit && unit.location !== id) { setSelUnit(null); setMission(null); }
  };
  const selectUnit = (id: string | null) => {
    setSelUnit(id);
    setMission(null);
    if (id) {
      setSelLoc(game.units[id].location);
      const ms = missionsFor(game, game.units[id]);
      if (ms.length === 1) setMission(ms[0]);
    }
  };
  const confirm = () => {
    if (side === 'blue') {
      resetSelection('red');
      update({ screen: session.mode === 'secret' ? { kind: 'handover', side: 'red' } : { kind: 'plan', side: 'red' } });
    } else {
      const { state, report } = resolveTurn(game, session.plans);
      update({ game: state, lastReport: report, screen: { kind: 'result' } });
    }
  };
  const lines: MapLine[] = plan.orders.map((o) => ({ from: game.units[o.unitId].location, to: o.target, side, mission: o.mission }));
  const scenario = SCENARIOS[game.scenarioId];

  return (
    <>
      <StatusBar game={game} who={side} label="計画" />
      <div class="board">
        <div class="mapwrap">
          <button class="btn small zoom" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? '全域を表示' : '拡大'}</button>
          <MapView game={game} selected={selLoc} ring={showRing ? { center: ringCenter!, radius: ringRadius } : null} targets={targets} lines={lines} zoom={zoom} onPick={pick} />
        </div>
        <div class="panel gutter">
          <PlanPanel
            game={game} side={side} plan={plan} setPlan={setPlan}
            selLoc={selLoc} selUnit={selUnit} mission={mission} aim={aim}
            hint={side === 'blue' || session.mode === 'open' ? scenario?.hints[game.turn - 1] : undefined}
            onSelectUnit={selectUnit} onMission={setMission} onAim={setAim} onAssign={assign} onConfirm={confirm}
          />
        </div>
      </div>
    </>
  );
}

/** 解決前の位置（転地した部隊は移動前の地点から線を引く） */
function prevLoc(session: Session, unitId: string): string {
  const ev = session.lastReport?.events.find((e) => e.kind === 'move' && e.unitId === unitId);
  return ev && ev.kind === 'move' ? ev.from : session.game.units[unitId].location;
}

function StatusBar({ game, who, label }: { game: GameState; who?: Side; label: string }) {
  return (
    <header class="statusbar gutter">
      <span class="title">AAC</span>
      <span>作戦日 <b>{game.turn}/{game.maxTurns}</b></span>
      <span>{label}</span>
      {who && <span class={`who ${who}`}>{sideJa(who)}軍</span>}
      <span>
        段階 <b>{game.escalation}</b>{' '}
        <span class="esc" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <i class={`${i <= game.escalation ? 'on' : ''}${i === 5 ? ' r5' : ''}`} />)}</span>
      </span>
      <span>意志 青 <b>{game.sides.blue.will}</b> 赤 <b>{game.sides.red.will}</b></span>
      <span>勝利点 青 <b>{game.sides.blue.vp}</b> 赤 <b>{game.sides.red.vp}</b></span>
    </header>
  );
}

function Title({ saved, onStart, onContinue }: { saved: Session | null; onStart: (m: Mode) => void; onContinue: () => void }) {
  return (
    <div class="screen gutter">
      <div class="sheet">
        <span class="label">試作 P1 · シナリオ S0</span>
        <h1>Archipelago Air Command</h1>
        <p class="lede">列島航空作戦。<b>{S0.name}</b>：{S0.summary}</p>
        <div class="choice">
          {saved && saved.screen.kind !== 'end' && (
            <button class="btn primary" onClick={onContinue}>
              続きから（作戦日 {saved.game.turn}）
              <small>前回の対局を再開します</small>
            </button>
          )}
          <button class="btn" onClick={() => onStart('secret')}>
            2 人で対戦する
            <small>1 台の端末を交代で使います。交代のたびに目隠し画面を出します</small>
          </button>
          <button class="btn" onClick={() => onStart('open')}>
            1 人で両軍を操作する
            <small>ルールの確認用。目隠し画面を出さず、赤軍の計画にも手引きを出します</small>
          </button>
        </div>
        <QuickRules />
      </div>
    </div>
  );
}

function QuickRules() {
  return (
    <div class="card">
      <h3>早見表</h3>
      <ul style="margin:0;padding-left:1.2em;display:grid;gap:4px">
        <li><b>d4 判定</b>：出目が命中基準以上で 1 命中。2+ は 75%、3+ は 50%、4 は 25%。</li>
        <li><b>射程</b>：1 帯 = 500km。部隊は行動半径の帯数まで任務を出せる。ちょうどの距離で戦うと基準 +1。</li>
        <li><b>兵站</b>：出撃 1 回につき 1（分散中は 2）。ハブ基地が毎日 +2、後方ボックスが +1。</li>
        <li><b>基地</b>：滑走路の数までしか出撃できない。分散した部隊は打撃で壊れない。</li>
        <li><b>エスカレーション</b>：相手のハブ基地を打撃すると +1。段階 5 で双方の戦略的敗北。</li>
        <li><b>勝利点</b>：要域の航空優勢 1 点/日、敵 2 ステップ撃破で 1 点、最後の意志の差 1 点ごと。</li>
      </ul>
    </div>
  );
}

function End({ session, onAgain, onTitle }: { session: Session; onAgain: () => void; onTitle: () => void }) {
  const { game } = session;
  const o = game.outcome!;
  const sc = game.score!;
  const title = o.kind === 'victory' ? `${sideJa(o.winner)}軍の勝利` : o.kind === 'draw' ? '引き分け' : '双方の戦略的敗北';
  const cls = o.kind === 'victory' ? o.winner : 'red';
  const turns = useMemo(() => game.history.length, [game]);
  return (
    <>
      <StatusBar game={game} label="終了" />
      <div class="screen gutter">
        <div class="sheet">
          <span class="label">戦後評価 · {turns} 作戦日</span>
          <h1 class={cls}>{title}</h1>
          <p class="lede">{o.reason}</p>
          <table class="score">
            <thead><tr><th>勝利点</th><th class="blue">青</th><th class="red">赤</th></tr></thead>
            <tbody>
              <tr><td>要域の航空優勢</td><td>{sc.blue.areaVp}</td><td>{sc.red.areaVp}</td></tr>
              <tr><td>撃破（2 ステップごと）</td><td>{sc.blue.killVp}</td><td>{sc.red.killVp}</td></tr>
              <tr><td>国民の意志の差</td><td>{sc.blue.willVp}</td><td>{sc.red.willVp}</td></tr>
              <tr><th>合計</th><th>{sc.blue.total}</th><th>{sc.red.total}</th></tr>
            </tbody>
          </table>
          <div class="card"><Summary game={game} /><p class="muted mono" style="font-size:12px">エスカレーション最終段階 {game.escalation} · 乱数シード {game.seed}</p></div>
          <div class="row">
            <button class="btn primary" onClick={onAgain}>もう一度遊ぶ</button>
            <button class="btn" onClick={onTitle}>タイトルへ</button>
          </div>
        </div>
      </div>
    </>
  );
}
