import { CARDS } from '../data/cards';
import { LOC, sideJa, unitLabel, type GameEvent, type GameState, type Side, type TurnReport } from '../engine';
import { RollLine } from './Dice';

const nameOf = (game: GameState, id: string) => (game.units[id] ? unitLabel(game.units[id]) : id);

export function ResultPanel({ game, report, onNext }: { game: GameState; report: TurnReport; onNext: () => void }) {
  const ev = report.events;
  const pick = <K extends GameEvent['kind']>(k: K) => ev.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === k);
  const cards = pick('card');
  const cancelled = pick('cancelled');
  const sead = pick('sead');
  const standoff = pick('standoff');
  const air = pick('air');
  const sam = pick('sam');
  const strike = pick('strike');
  const tally = ev.filter((e) => ['move', 'posture', 'repair', 'logistics', 'will', 'escalation', 'vp'].includes(e.kind));
  const nothing = !standoff.length && !air.length && !sam.length && !strike.length && !sead.length;

  return (
    <>
      <div class="card">
        <div class="between"><h3>作戦日 {report.turn} の結果</h3><span class="muted">地図に双方の任務を表示中</span></div>
        {nothing && <p class="muted">交戦はありませんでした。</p>}
      </div>
      <div class="events">
        {cards.map((e) => (
          <div class={`ev ${e.side}`}>
            <h4>国力カード：{sideJa(e.side)}「{CARDS[e.card].name}」{e.target ? `（${LOC[e.target].name}）` : ''}</h4>
            <p class="effects">{CARDS[e.card].domain}・{e.effects.length ? e.effects.join('、') : CARDS[e.card].text}</p>
          </div>
        ))}
        {cancelled.length > 0 && (
          <div class="ev both">
            <h4>出撃の取り消し</h4>
            {cancelled.map((e) => <p class="effects">{nameOf(game, e.unitId)}：{e.reason}</p>)}
          </div>
        )}
        {standoff.map((e) => (
          <div class={`ev ${e.side}`}>
            <h4>スタンドオフ打撃：{sideJa(e.side)} → {LOC[e.target].name}</h4>
            <p class="effects">{nameOf(game, e.unitId)} が {e.launched} 発を発射</p>
            {e.intercept.map((r) => <RollLine roll={r} side={e.side === 'blue' ? 'red' : 'blue'} label={`迎撃 ${nameOf(game, r.unitId)}`} />)}
            {e.intercept.length > 0 && <p class="effects">迎撃 {e.intercepted} 発</p>}
            {e.roll ? <RollLine roll={e.roll} side={e.side} label="着弾" /> : <p class="effects">すべて迎撃されました</p>}
            <Effects list={e.effects} />
          </div>
        ))}
        {air.map((e) => (
          <div class="ev both">
            <h4>航空戦：{LOC[e.area].name}</h4>
            {(['blue', 'red'] as Side[]).map((s) => e.rolls[s].map((r) => <RollLine roll={r} side={s} label={nameOf(game, r.unitId)} />))}
            <Effects list={e.effects} />
            <p class="effects">航空優勢：<b class={e.superiority ?? ''}>{e.superiority ? sideJa(e.superiority) : 'なし（争奪中）'}</b></p>
          </div>
        ))}
        {sead.map((e) => (
          <div class={`ev ${e.side}`}>
            <h4>防空制圧：{sideJa(e.side)} → {LOC[e.target].name}</h4>
            {e.rolls.map((r) => <RollLine roll={r} side={e.side} label={nameOf(game, r.unitId)} />)}
            <Effects list={e.effects} />
          </div>
        ))}
        {sam.map((e) => (
          <div class={`ev ${e.side}`}>
            <h4>地上配備防空：{LOC[e.area].name}（{sideJa(e.side)}）</h4>
            {e.rolls.map((r) => <RollLine roll={r} side={e.side} label={nameOf(game, r.unitId)} />)}
            <Effects list={e.effects} />
          </div>
        ))}
        {strike.map((e) => (
          <div class={`ev ${e.side}`}>
            <h4>打撃：{sideJa(e.side)} → {LOC[e.target].name}</h4>
            {e.rolls.map((r) => <RollLine roll={r} side={e.side} label={nameOf(game, r.unitId)} />)}
            <Effects list={e.effects} />
          </div>
        ))}
        <div class="ev">
          <h4>回復と集計</h4>
          {tally.map((e) => <p class="effects">{tallyText(game, e)}</p>)}
        </div>
      </div>
      <div class="card">
        <Summary game={game} />
        <button class="btn primary" onClick={onNext}>{game.outcome ? '最終結果を見る' : `作戦日 ${game.turn} へ進む`}</button>
      </div>
    </>
  );
}

function Effects({ list }: { list: string[] }) {
  if (!list.length) return <p class="effects">損害なし</p>;
  return <p class="effects">結果：<b>{list.join('、')}</b></p>;
}

function tallyText(game: GameState, e: GameEvent): string {
  switch (e.kind) {
    case 'move': return `${nameOf(game, e.unitId)} が ${LOC[e.from].name} から ${LOC[e.to].name} へ転地`;
    case 'posture': return `${nameOf(game, e.unitId)} を${e.posture === 'dispersed' ? '分散' : '駐機'}に切り替え`;
    case 'repair': return `${sideJa(e.side)}：${LOC[e.base].name} の滑走路を修復（${e.runway}/3）`;
    case 'logistics': return `${sideJa(e.side)}：兵站 ${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)}（${e.reason}）`;
    case 'will': return `${sideJa(e.side)}：国民の意志 ${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)}（${e.reason}）`;
    case 'escalation': return `エスカレーション ${e.from}→${e.to}（${e.reason}）`;
    case 'vp': return `${sideJa(e.side)}：勝利点 +${e.delta}（${e.reason}）`;
    default: return '';
  }
}

export function Summary({ game }: { game: GameState }) {
  const b = game.sides.blue, r = game.sides.red;
  return (
    <div class="sumgrid">
      <span /><span class="mono blue">青</span><span class="mono red">赤</span>
      <span>国民の意志</span><span class="mono">{b.will}</span><span class="mono">{r.will}</span>
      <span>兵站</span><span class="mono">{b.logistics}</span><span class="mono">{r.logistics}</span>
      <span>要域の勝利点</span><span class="mono">{b.vp}</span><span class="mono">{r.vp}</span>
      <span>撃破ステップ</span><span class="mono">{b.stepsKilled}</span><span class="mono">{r.stepsKilled}</span>
    </div>
  );
}

