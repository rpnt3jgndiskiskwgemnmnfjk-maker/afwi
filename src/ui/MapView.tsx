import { useRef, useState } from 'preact/hooks';
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
  /** 解決結果で光らせる地点（交戦や攻撃のあった場所） */
  flashes?: string[];
  /** 拡大・移動の操作（ピンチ、ドラッグ、ホイール、ボタン）を有効にする */
  zoomable?: boolean;
  /** 誰の目で見るか。'all' は霧なし（1 人で両軍）、'public' は双方に見えてよいものだけ（2 人対戦の結果画面） */
  viewer: Side | 'all' | 'public';
  onPick: (id: string) => void;
}

interface Box { x: number; y: number; w: number; h: number }
const FULL: Box = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
const MIN_W = 260;

/** 表示範囲を地図の内側に収める（縦横比は保つ） */
function clampBox(b: Box): Box {
  const w = Math.max(MIN_W, Math.min(VIEW_W, b.w));
  const h = (w * VIEW_H) / VIEW_W;
  return { w, h, x: Math.max(0, Math.min(VIEW_W - w, b.x)), y: Math.max(0, Math.min(VIEW_H - h, b.y)) };
}

/** 中心 (cx, cy) を固定して倍率 k で拡大・縮小する */
const zoomAt = (b: Box, k: number, cx: number, cy: number): Box =>
  clampBox({ x: cx - (cx - b.x) / k, y: cy - (cy - b.y) / k, w: b.w / k, h: b.h / k });

const sideColor = (s: Side | 'neutral' | null | undefined) =>
  s === 'blue' ? 'var(--blue)' : s === 'red' ? 'var(--red)' : s === 'neutral' ? 'var(--neutral)' : 'var(--muted)';

/** 線の端点。ボックスは枠の中心から出す */
function anchor(id: string): [number, number] {
  const f = BOX_FRAMES[id];
  return f ? [f.x + BOX_W / 2, f.y + BOX_H / 2] : posOf(id);
}

export function MapView({ game, selected, ring, targets, lines, flashes = [], zoomable, viewer, onPick }: Props) {
  const [box, setBox] = useState<Box>(FULL);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; dist?: number }>({ moved: false });

  /** 画面上の座標を地図の座標に直す */
  const toMap = (clientX: number, clientY: number): [number, number] => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return [clientX, clientY];
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!zoomable) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    if (pointers.current.size === 1) {
      // 1 本指：6px を超えて動いたらドラッグとして地図を動かす（タップとは区別する）
      if (!gesture.current.moved && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 6) return;
      gesture.current.moved = true;
      const [ax, ay] = toMap(prev.x, prev.y);
      const [bx, by] = toMap(e.clientX, e.clientY);
      setBox((b) => clampBox({ ...b, x: b.x - (bx - ax), y: b.y - (by - ay) }));
    } else if (pointers.current.size === 2) {
      // 2 本指：指の間隔の比で拡大・縮小する
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) {
        const [cx, cy] = toMap((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
        setBox((b) => zoomAt(b, after / before, cx, cy));
      }
      gesture.current.moved = true;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: PointerEvent) => { pointers.current.delete(e.pointerId); };
  const onWheel = (e: WheelEvent) => {
    if (!zoomable) return;
    e.preventDefault();
    const [cx, cy] = toMap(e.clientX, e.clientY);
    setBox((b) => zoomAt(b, e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy));
  };
  /** ドラッグやピンチの直後のクリックは地点の選択にしない */
  const onClickCapture = (e: MouseEvent) => {
    if (gesture.current.moved) { e.stopPropagation(); e.preventDefault(); gesture.current.moved = false; }
  };
  const zoomButton = (k: number) => {
    const [cx, cy] = selected ? anchor(selected) : [box.x + box.w / 2, box.y + box.h / 2];
    setBox((b) => {
      const z = zoomAt(b, k, b.x + b.w / 2, b.y + b.h / 2);
      return k > 1 ? clampBox({ ...z, x: cx - z.w / 2, y: cy - z.h / 2 }) : z;
    });
  };

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
    <>
    {zoomable && (
      <div class="zoom row" role="group" aria-label="地図の拡大">
        <button class="btn small" onClick={() => zoomButton(1.5)} aria-label="拡大">＋</button>
        <button class="btn small" onClick={() => zoomButton(1 / 1.5)} aria-label="縮小">−</button>
        <button class="btn small" onClick={() => setBox(FULL)} disabled={box.w >= VIEW_W}>全域</button>
      </div>
    )}
    <svg
      ref={svgRef}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label="射程地図（2 本指で拡大、ドラッグで移動）"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      onClickCapture={onClickCapture}
    >
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

      {flashes.map((id, i) => {
        const [x, y] = anchor(id);
        return <circle class="flash" cx={x} cy={y} r={22} style={`--i:${i}`} />;
      })}

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
    </>
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
