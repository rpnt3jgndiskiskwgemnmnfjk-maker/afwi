// シード付き乱数（xoshiro128**）。状態は GameState に保存し、同じシードと計画なら同じ結果になる。

export type RngState = [number, number, number, number];

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** splitmix32 で 32bit シードから内部状態を作る */
export function seedRng(seed: number): RngState {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    out.push((z ^ (z >>> 16)) >>> 0);
  }
  if (!out.some((v) => v !== 0)) out[0] = 1;
  return out as RngState;
}

/** 状態を進めて 32bit の符号なし整数を返す（st を書き換える） */
export function nextU32(st: RngState): number {
  const result = Math.imul(rotl(Math.imul(st[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (st[1] << 9) >>> 0;
  st[2] = (st[2] ^ st[0]) >>> 0;
  st[3] = (st[3] ^ st[1]) >>> 0;
  st[1] = (st[1] ^ st[2]) >>> 0;
  st[0] = (st[0] ^ st[3]) >>> 0;
  st[2] = (st[2] ^ t) >>> 0;
  st[3] = rotl(st[3], 11);
  return result;
}

/** 1〜4 の出目。4 は 2^32 を割り切るので上位 2 ビットを使えば偏りがない */
export function rollD4(st: RngState): number {
  return (nextU32(st) >>> 30) + 1;
}
