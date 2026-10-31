import { BAND_KM, LOC } from '../engine';

export const VIEW_W = 860;
export const VIEW_H = 560;
const PX_PER_DEG = 20;

/** 経緯度を画面座標に簡易投影する */
export const px = (lon: number, lat: number): [number, number] => [(lon - 105) * PX_PER_DEG + 20, (35 - lat) * PX_PER_DEG + 20];

export const posOf = (id: string): [number, number] => {
  const l = LOC[id];
  return px(l.lon, l.lat);
};

/** 射程リング 1 帯ぶんの半径（緯度で横方向を補正） */
export function ringRadius(lat: number): { rx: number; ry: number } {
  const ry = (BAND_KM / 111.2) * PX_PER_DEG;
  return { rx: ry / Math.cos((lat * Math.PI) / 180), ry };
}

/** マップ外ボックスを地図の端に置く枠 */
export const BOX_W = 190;
export const BOX_H = 42;
export const BOX_FRAMES: Record<string, { x: number; y: number }> = {
  'R-REAR': { x: 14, y: 14 },
  'R-STO': { x: 14, y: 66 },
  'B-HOME': { x: 656, y: 14 },
  'B-STO': { x: 430, y: 504 },
  'B-REAR': { x: 646, y: 504 },
};
