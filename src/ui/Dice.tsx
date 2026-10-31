import type { DieRoll, Side } from '../engine';

export function D4({ value, hit, side }: { value: number; hit: boolean; side: Side }) {
  return (
    <svg viewBox="0 0 22 20" class={`d4${hit ? ' on' : ''}${side === 'red' ? ' r' : ''}`} role="img" aria-label={`${value}${hit ? ' 命中' : ''}`}>
      <polygon points="11,1.5 20.5,18.5 1.5,18.5" />
      <text x="11" y="16" text-anchor="middle">{value}</text>
    </svg>
  );
}

export const targetText = (t: number) => (t >= 4 ? '4' : `${t}+`);

export function RollLine({ roll, side, label }: { roll: DieRoll; side: Side; label: string }) {
  return (
    <div class="roll">
      <span>{label}</span>
      <span class="dice">{roll.dice.map((d) => <D4 value={d} hit={d >= roll.target} side={side} />)}</span>
      <span class="mono">基準 {targetText(roll.target)}</span>
      {roll.mods.length > 0 && <span class="muted">（{roll.mods.join('、')}）</span>}
      <b>{roll.hits} 命中</b>
    </div>
  );
}
