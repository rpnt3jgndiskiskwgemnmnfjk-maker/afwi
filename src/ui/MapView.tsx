import { aliveUnits, LOC, LOCATIONS, type GameState, type Mission, type Side } from '../engine';
import { BOX_FRAMES, BOX_H, BOX_W, posOf, ringRadius, VIEW_H, VIEW_W } from './mapgeo';

export interface MapLine {
  from: string;
  to: string;
  side: Side;
  mission: Mission;
}

interface Props {
  game: GameState;
  selected: string | null;
  ring: { center: string; radius: number } | null;
  targets: string[];
  lines: MapLine[];
  zoom?: boolean;
  /** 誰の目で見るか。'all' は霧なし（1 人で両軍）、'public' は双方に見えてよいものだけ（2 人対戦の結果画面） */
  viewer: Side | 'all' | 'public';
  onPick: (id: string) => void;
}

/** 拡大表示の範囲（選択中の地点を中心に、地図の内側に収める） */
function zoomBox(center: string | null): string {
  const w = 430, h = 280;
  const [cx, cy] = center ? anchor(center) : [430, 240];
  const x = Math.max(0, Math.min(VIEW_W - w, cx - w / 2));
  const y = Math.max(0, Math.min(VIEW_H - h, cy - h / 2));
  return `${x} ${y} ${w} ${h}`;
}

const sideColor = (s: Side | 'neutral' | null | undefined) =>
  s === 'blue' ? 'var(--blue)' : s === 'red' ? 'var(--red)' : s === 'neutral' ? 'var(--neutral)' : 'var(--muted)';

/** 線の端点。ボックスは枠の中心から出す */
function anchor(id: string): [number, number] {
  const f = BOX_FRAMES[id];
  return f ? [f.x + BOX_W / 2, f.y + BOX_H / 2] : posOf(id);
}

export function MapView({ game, selected, ring, targets, lines, zoom, viewer, onPick }: Props) {
  const counts: Record<string, Record<Side, number>> = {};
  for (const u of aliveUnits(game)) {
    counts[u.location] ??= { blue: 0, red: 0 };
    counts[u.location][u.side] += 1;
  }
  const targetSet = new Set(targets);
  /** その地点のその陣営の部隊数が見えるか（自軍、霧なし、探知済み） */
  const visible = (s: Side, loc: string) => {
    if (viewer === 'all') return true;
    if (viewer === 'public') return game.detected[s === 'blue' ? 'red' : 'blue'].includes(loc);
    return s === viewer || game.detected[viewer].includes(loc);
  };
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(id); }
  };

  return (
    <svg viewBox={zoom ? zoomBox(selected) : `0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" role="application" aria-label="射程地図">
      <g class="grid">
        {[110, 115, 120, 125, 130, 135, 140, 145].map((lon) => {
          const x = (lon - 105) * 20 + 20;
          return <g><line x1={x} y1={0} x2={x} y2={VIEW_H} /><text x={x + 3} y={496}>{lon}°E</text></g>;
        })}
        {[10, 15, 20, 25, 30].map((lat) => {
          const y = (35 - lat) * 20 + 20;
          return <g><line x1={0} y1={y} x2={VIEW_W} y2={y} /><text x={214} y={y - 3}>{lat}°N</text></g>;
        })}
      </g>

      {ring && <Rings center={ring.center} radius={ring.radius} />}

      {lines.map((l) => {
        const [x1, y1] = anchor(l.from);
        const [x2, y2] = anchor(l.to);
        return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={sideColor(l.side)} stroke-width={l.mission === 'STANDOFF' ? 2.5 : 2} stroke-dasharray={l.mission === 'MOVE' ? '2 4' : l.mission === 'STANDOFF' ? '10 4' : '6 4'} opacity={0.85} />;
      })}

      {LOCATIONS.filter((l) => l.kind !== 'box').map((l) => {
        const [x, y] = posOf(l.id);
        const sel = selected === l.id;
        const sup = game.superiority[l.id];
        const c = counts[l.id];
        const isKey = game.keyAreas.includes(l.id);
        const base = game.bases[l.id];
        return (
          <g class="node">
            {sup && <circle cx={x} cy={y} r={15} fill="none" stroke={sideColor(sup)} stroke-width={3} opacity={0.6} />}
            {l.kind === 'contested'
              ? <circle cx={x} cy={y} r={9} fill="var(--surface)" stroke={sel ? 'var(--amber)' : 'var(--muted)'} stroke-width={sel ? 4 : 2} />
              : (() => {
                  const r = l.base === 'hub' ? 11 : 7;
                  return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={l.base === 'hub' ? sideColor(game.owners[l.id] ?? l.owner) : 'var(--surface)'} stroke={sel ? 'var(--amber)' : sideColor(game.owners[l.id] ?? l.owner)} stroke-width={sel ? 4 : 2.5} />;
                })()}
            {targetSet.has(l.id) && <circle class="target-halo" cx={x} cy={y} r={19} />}
            <text x={x + 15} y={y + 4}>{l.name}</text>
            <text class="code" x={x + 15} y={y + 15}>{l.id}</text>
            {isKey && <text class="keylbl" x={x - 14} y={y + 4} text-anchor="end">要域</text>}
            {base && (
              <g>
                {[0, 1, 2].map((i) => <rect x={x - 11 + i * 8} y={y + 15} width={6} height={4} fill={i < base.runway ? 'var(--ink)' : 'none'} stroke="var(--ink)" stroke-width={0.8} />)}
              </g>
            )}
            {c && (['blue', 'red'] as Side[]).filter((s) => c[s] > 0).map((s, i) => (
              <g>
                {visible(s, l.id)
                  ? <rect x={x + 42 + i * 22} y={y + 6} width={20} height={13} fill={sideColor(s)} />
                  : <rect x={x + 42 + i * 22} y={y + 6} width={20} height={13} fill="var(--surface)" stroke={sideColor(s)} stroke-dasharray="3 2" />}
                <text class="chipt" x={x + 52 + i * 22} y={y + 16} text-anchor="middle" style={visible(s, l.id) ? undefined : { fill: sideColor(s) }}>{visible(s, l.id) ? c[s] : '?'}</text>
              </g>
            ))}
            <circle class="hit" cx={x} cy={y} r={22} fill="transparent" tabIndex={0} role="button" aria-label={l.name} onClick={() => onPick(l.id)} onKeyDown={(e) => key(e as KeyboardEvent, l.id)} />
          </g>
        );
      })}

      {LOCATIONS.filter((l) => l.kind === 'box').map((l) => {
        const f = BOX_FRAMES[l.id];
        const sel = selected === l.id;
        const c = counts[l.id]?.[l.side!] ?? 0;
        const shown = visible(l.side!, l.id);
        return (
          <g>
            <rect x={f.x} y={f.y} width={BOX_W} height={BOX_H} fill="var(--surface)" stroke={sel ? 'var(--amber)' : sideColor(l.side)} stroke-width={sel ? 3 : 1.6} stroke-dasharray="5 4" />
            {targetSet.has(l.id) && <rect class="target-halo" x={f.x - 4} y={f.y - 4} width={BOX_W + 8} height={BOX_H + 8} />}
            <text class="boxlbl" x={f.x + 8} y={f.y + 14}>マップ外 · {l.side === 'blue' ? '青' : '赤'} · {l.role === 'rear' ? '後方' : 'スタンドオフ'}</text>
            <text class="boxname" x={f.x + 8} y={f.y + 32}>{l.name.replace('（グアム・第二列島線）', '（グアム）')}</text>
            {c > 0 && <g><rect x={f.x + BOX_W - 28} y={f.y + 6} width={20} height={13} fill={sideColor(l.side)} /><text class="chipt" x={f.x + BOX_W - 18} y={f.y + 16} text-anchor="middle">{shown ? c : '?'}</text></g>}
            {l.role === 'standoff' && <text class="boxlbl" x={f.x + BOX_W - 8} y={f.y + 34} text-anchor="end">弾 {game.sides[l.side!].salvos}</text>}
            <rect class="hit" x={f.x} y={f.y} width={BOX_W} height={BOX_H} fill="transparent" tabIndex={0} role="button" aria-label={`マップ外ボックス ${l.name}`} onClick={() => onPick(l.id)} onKeyDown={(e) => key(e as KeyboardEvent, l.id)} />
          </g>
        );
      })}
    </svg>
  );
}

function Rings({ center, radius }: { center: string; radius: number }) {
  const l = LOC[center];
  const [cx, cy] = posOf(center);
  const { rx, ry } = ringRadius(l.lat);
  const n = Math.min(radius, 8);
  return (
    <g>
      {Array.from({ length: n }, (_, i) => i + 1).map((i) => (
        <g>
          <ellipse class={`ring${i === n ? ' lim' : ''}`} cx={cx} cy={cy} rx={rx * i} ry={ry * i} />
          <text class="ringlbl" x={cx + 4} y={cy - ry * i - 4}>{i}帯 {i * 500}km</text>
        </g>
      ))}
      <path d={`M${cx - 7} ${cy}h14M${cx} ${cy - 7}v14`} stroke="var(--amber)" stroke-width={2} />
    </g>
  );
}
