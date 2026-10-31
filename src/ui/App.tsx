import { useEffect, useState } from 'preact/hooks';
import { SCENARIOS } from '../data/scenarios';
import { UNIT_TYPES } from '../data/units';
import {
  createGame, emptyPlan, enemyOf, LOC, missionsFor, planForCpu, resolveTurn, sideJa, validTargets,
  type CpuLevel, type GameState, type Mission, type Plan, type Side, type StrikeAim, type TurnReport,
} from '../engine';
import { MapView, type MapLine } from './MapView';
import { PlanPanel } from './PlanPanel';
import { ResultPanel, Summary } from './ResultPanel';
import { clearSession, loadSession, saveSession } from './storage';

/** cpu：CPU と対戦、secret：2 人で交代（目隠しあり）、open：1 人で両軍（霧なし） */
export type Mode = 'cpu' | 'secret' | 'open';

export type Screen =
  | { kind: 'title' }
  | { kind: 'handover'; side: Side }
  | { kind: 'plan'; side: Side }
  | { kind: 'result' }
  | { kind: 'end' };

export interface Session {
  version: 2;
  mode: Mode;
  human: Side;          // CPU 対戦で人が持つ陣営
  cpuLevel: CpuLevel;
  game: GameState;
  plans: Record<Side, Plan>;
  screen: Screen;
  lastReport: TurnReport | null;
}

export interface Setup {
  scenarioId: string;
  mode: Mode;
  human: Side;
  cpuLevel: CpuLevel;
}

let current: Session | null = null;
/** 表示中のアーティファクトが更新されたときに状態を引き継ぐための参照 */
export const currentSession = () => current;

const newSeed = () => {
  try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Date.now() >>> 0; }
};

/** 新しい作戦日の最初の画面 */
function firstScreen(mode: Mode, human: Side): Screen {
  if (mode === 'cpu') return { kind: 'plan', side: human };
  return mode === 'secret' ? { kind: 'handover', side: 'blue' } : { kind: 'plan', side: 'blue' };
}

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

  const start = (s: Setup) => {
    const game = createGame(SCENARIOS[s.scenarioId], newSeed());
    const screen = firstScreen(s.mode, s.human);
    resetSelection(screen.kind === 'plan' || screen.kind === 'handover' ? screen.side : 'blue');
    setSession({ version: 2, mode: s.mode, human: s.human, cpuLevel: s.cpuLevel, game, plans: { blue: emptyPlan(), red: emptyPlan() }, screen, lastReport: null });
  };

  if (!session || session.screen.kind === 'title') {
    return <Title saved={saved} onStart={start} onContinue={() => { setSession(saved); setSaved(null); }} />;
  }

  const { game, screen, mode } = session;
  const update = (patch: Partial<Session>) => setSession({ ...session, ...patch });

  if (screen.kind === 'handover') {
    return (
      <>
        <StatusBar game={game} who={screen.side} label="交代" />
        <div class="screen gutter">
          <div class="sheet handover">
            <span class="label">作戦日 {game.turn} · 2 人で対戦</span>
            <p class={`big ${screen.side}`}>{sideJa(screen.side)}軍の計画です</p>
            <p class="lede">端末を{sideJa(screen.side)}軍のプレイヤーに渡してください。相手の計画と、相手だけが探知した情報は表示されません。</p>
            <button class="btn primary" onClick={() => { resetSelection(screen.side); update({ screen: { kind: 'plan', side: screen.side } }); }}>{sideJa(screen.side)}軍の計画を始める</button>
          </div>
        </div>
      </>
    );
  }

  if (screen.kind === 'end') {
    return <End session={session} onAgain={() => { clearSession(); start({ scenarioId: game.scenarioId, mode, human: session.human, cpuLevel: session.cpuLevel }); }} onTitle={() => { clearSession(); setSession(null); setSaved(null); }} />;
  }

  if (screen.kind === 'result' && session.lastReport) {
    const report = session.lastReport;
    const lines: MapLine[] = (['blue', 'red'] as Side[]).flatMap((s) =>
      report.plans[s].orders.map((o) => ({ from: prevLoc(session, o.unitId), to: o.target, side: s, mission: o.mission })),
    );
    const next = () => {
      if (game.outcome) return update({ screen: { kind: 'end' } });
      const sc = firstScreen(mode, session.human);
      resetSelection(sc.kind === 'plan' ? sc.side : 'blue');
      update({ plans: { blue: emptyPlan(), red: emptyPlan() }, screen: sc });
    };
    const viewer = mode === 'cpu' ? session.human : mode === 'open' ? 'all' : 'public';
    return (
      <>
        <StatusBar game={game} label="解決" />
        <div class="board">
          <div class="mapwrap"><MapView game={game} selected={null} ring={null} targets={[]} lines={lines} viewer={viewer} onPick={() => {}} /></div>
          <div class="panel gutter"><ResultPanel game={game} report={report} onNext={next} /></div>
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
  const resolveWith = (plans: Record<Side, Plan>) => {
    const { state, report } = resolveTurn(game, plans);
    update({ game: state, plans, lastReport: report, screen: { kind: 'result' } });
  };
  const confirm = () => {
    if (mode === 'cpu') {
      const cpu = enemyOf(side);
      return resolveWith({ ...session.plans, [cpu]: planForCpu(game, cpu, session.cpuLevel) } as Record<Side, Plan>);
    }
    if (side === 'blue') {
      resetSelection('red');
      update({ screen: mode === 'secret' ? { kind: 'handover', side: 'red' } : { kind: 'plan', side: 'red' } });
    } else {
      resolveWith(session.plans);
    }
  };
  const lines: MapLine[] = plan.orders.map((o) => ({ from: game.units[o.unitId].location, to: o.target, side, mission: o.mission }));
  const scenario = SCENARIOS[game.scenarioId];
  const showHint = mode === 'open' || mode === 'cpu' || side === 'blue';

  return (
    <>
      <StatusBar game={game} who={side} label={mode === 'cpu' ? `計画（CPU：${session.cpuLevel === 'easy' ? '易しい' : '標準'}）` : '計画'} />
      <div class="board">
        <div class="mapwrap">
          <button class="btn small zoom" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? '全域を表示' : '拡大'}</button>
          <MapView game={game} selected={selLoc} ring={showRing ? { center: ringCenter!, radius: ringRadius } : null} targets={targets} lines={lines} zoom={zoom} viewer={mode === 'open' ? 'all' : side} onPick={pick} />
        </div>
        <div class="panel gutter">
          <PlanPanel
            game={game} side={side} plan={plan} setPlan={setPlan}
            selLoc={selLoc} selUnit={selUnit} mission={mission} aim={aim}
            hint={showHint ? scenario?.hints[game.turn - 1] : undefined}
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
      <span class="title">AAC {game.scenarioId}</span>
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

function Title({ saved, onStart, onContinue }: { saved: Session | null; onStart: (s: Setup) => void; onContinue: () => void }) {
  const [setup, setSetup] = useState<Setup>({ scenarioId: 'S0', mode: 'cpu', human: 'blue', cpuLevel: 'normal' });
  const set = (patch: Partial<Setup>) => setSetup({ ...setup, ...patch });
  return (
    <div class="screen gutter">
      <div class="sheet">
        <span class="label">試作 P2</span>
        <h1>Archipelago Air Command</h1>
        <p class="lede">列島航空作戦。西太平洋の航空作戦を、d4 ダイスと射程を示す地図で戦うオリジナルの作戦級ウォーゲームです。</p>
        {saved && saved.screen.kind !== 'end' && (
          <button class="btn primary" onClick={onContinue}>
            続きから（{SCENARIOS[saved.game.scenarioId]?.name}・作戦日 {saved.game.turn}）
          </button>
        )}
        <div class="card">
          <h3>シナリオ</h3>
          <div class="choice" role="group" aria-label="シナリオ">
            {Object.values(SCENARIOS).map((sc) => (
              <button class="btn" aria-pressed={setup.scenarioId === sc.id} onClick={() => set({ scenarioId: sc.id })}>
                {sc.id}「{sc.name}」・{sc.maxTurns} 作戦日
                <small>{sc.summary}</small>
              </button>
            ))}
          </div>
        </div>
        <div class="card">
          <h3>遊び方</h3>
          <div class="row" role="group" aria-label="遊び方">
            <button class="btn small" aria-pressed={setup.mode === 'cpu'} onClick={() => set({ mode: 'cpu' })}>CPU と対戦</button>
            <button class="btn small" aria-pressed={setup.mode === 'secret'} onClick={() => set({ mode: 'secret' })}>2 人で対戦</button>
            <button class="btn small" aria-pressed={setup.mode === 'open'} onClick={() => set({ mode: 'open' })}>1 人で両軍を操作</button>
          </div>
          <p class="muted" style="font-size:12.5px">
            {setup.mode === 'cpu' && '相手の計画は CPU が立てます。戦場の霧があり、探知していない敵部隊は「?」で表示されます。'}
            {setup.mode === 'secret' && '1 台の端末を交代で使います。交代のたびに目隠し画面を出し、それぞれ自分が探知した情報だけを表示します。'}
            {setup.mode === 'open' && 'ルールの確認用です。戦場の霧を外し、両軍の部隊をすべて表示します。'}
          </p>
          {setup.mode === 'cpu' && (
            <>
              <div class="row" role="group" aria-label="あなたの陣営">
                <span class="muted">あなたの陣営</span>
                <button class="btn small" aria-pressed={setup.human === 'blue'} onClick={() => set({ human: 'blue' })}>青軍</button>
                <button class="btn small" aria-pressed={setup.human === 'red'} onClick={() => set({ human: 'red' })}>赤軍</button>
              </div>
              <div class="row" role="group" aria-label="CPU の強さ">
                <span class="muted">CPU の強さ</span>
                <button class="btn small" aria-pressed={setup.cpuLevel === 'easy'} onClick={() => set({ cpuLevel: 'easy' })}>易しい</button>
                <button class="btn small" aria-pressed={setup.cpuLevel === 'normal'} onClick={() => set({ cpuLevel: 'normal' })}>標準</button>
              </div>
            </>
          )}
        </div>
        <button class="btn primary" onClick={() => onStart(setup)}>この設定で始める</button>
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
        <li><b>基地</b>：滑走路の数までしか出撃できない。分散した部隊は打撃で壊れない（切り替えは翌日から）。</li>
        <li><b>戦場の霧</b>：毎朝 d4 で探知（3+）。偵察機・AEW・衛星で探知しやすくなる。未探知の基地への攻撃は基準 +1。</li>
        <li><b>国力カード</b>：外交・情報・経済・宇宙・サイバーのカードを 1 日 1 枚。</li>
        <li><b>エスカレーション</b>：基地を攻撃すると段階 3 へ。相手のハブ基地や後方を攻撃すると +1。段階 5 で双方の敗北。</li>
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
  return (
    <>
      <StatusBar game={game} label="終了" />
      <div class="screen gutter">
        <div class="sheet">
          <span class="label">戦後評価 · {SCENARIOS[game.scenarioId]?.name} · {game.history.length} 作戦日{session.mode === 'cpu' ? ` · あなたは${sideJa(session.human)}軍` : ''}</span>
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
            <button class="btn primary" onClick={onAgain}>同じ設定でもう一度</button>
            <button class="btn" onClick={onTitle}>タイトルへ</button>
          </div>
        </div>
      </div>
    </>
  );
}
