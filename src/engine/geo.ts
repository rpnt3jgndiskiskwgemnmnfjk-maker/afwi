import MAP from '../data/map.json';
import type { Location, Side } from './types';

interface MapFile {
  bandKm: number;
  areas: { id: string; name: string; kind: 'base' | 'contested'; owner?: Side | 'neutral'; base?: 'hub' | 'spoke'; lon: number; lat: number }[];
  offMapBoxes: { id: string; name: string; side: Side; role: 'rear' | 'standoff'; lon: number; lat: number }[];
  bands: Record<string, Record<string, number>>;
}

const map = MAP as MapFile;

export const BAND_KM = map.bandKm;

export const LOCATIONS: Location[] = [
  ...map.areas.map((a) => ({ ...a })),
  ...map.offMapBoxes.map((b) => ({ ...b, kind: 'box' as const })),
];

export const LOC: Record<string, Location> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));

/** 2 地点間の射程帯。表にない組み合わせは届かないものとして扱う */
export function band(from: string, to: string): number {
  return map.bands[from]?.[to] ?? Infinity;
}

/** 地点の支配陣営（基地はその支配者、ボックスはその陣営、争奪エリアは null） */
export function controllerOf(id: string): Side | 'neutral' | null {
  const l = LOC[id];
  if (!l) return null;
  if (l.kind === 'box') return l.side ?? null;
  if (l.kind === 'base') return l.owner ?? null;
  return null;
}

export const isOnMapBase = (id: string) => LOC[id]?.kind === 'base';
export const isBox = (id: string) => LOC[id]?.kind === 'box';
export const isHub = (id: string) => LOC[id]?.base === 'hub';
