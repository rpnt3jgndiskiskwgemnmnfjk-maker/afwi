// CPU 同士の自動対戦によるバランスと強さの計測（時間がかかるので普段のテストでは動かさない）。
// 使い方: npm run balance          （AAC_GAMES で局数、AAC_ONLY で計測の種類を指定できる）
import { describe, it } from 'vitest';
import { SCENARIOS } from '../src/data/scenarios';
import { createGame, planForCpu, resolveTurn, type CpuLevel, type Side } from '../src/engine';

// Node.js の型定義を入れずに環境変数を読む
declare const process: { env: Record<string, string | undefined> };

const GAMES = Number(process.env.AAC_GAMES ?? 100);
const ONLY = process.env.AAC_ONLY ?? 'all';
const IDS = (process.env.AAC_SCENARIOS ?? Object.keys(SCENARIOS).join(',')).split(',');

function play(scenarioId: string, blue: CpuLevel, red: CpuLevel, seed: number) {
  let g = createGame(SCENARIOS[scenarioId], seed);
  while (!g.outcome) g = resolveTurn(g, { blue: planForCpu(g, 'blue', blue), red: planForCpu(g, 'red', red) }).state;
  return g.outcome;
}

function tally(scenarioId: string, blue: CpuLevel, red: CpuLevel, n: number) {
  const r = { blue: 0, red: 0, draw: 0, catastrophe: 0 };
  for (let i = 1; i <= n; i++) {
    const o = play(scenarioId, blue, red, i * 7919);
    if (o.kind === 'victory') r[o.winner]++;
    else r[o.kind]++;
  }
  return r;
}

const pct = (x: number, n: number) => `${Math.round((x / n) * 100)}%`;

describe.skipIf(!process.env.AAC_BALANCE)('バランス計測', () => {
  it('シナリオごとの陣営別勝率（標準同士）', () => {
    if (ONLY !== 'all' && ONLY !== 'scenario') return;
    for (const id of IDS) {
      const r = tally(id, 'normal', 'normal', GAMES);
      console.log(`${id} 標準同士 ${GAMES} 局：青 ${r.blue}（${pct(r.blue, GAMES)}）赤 ${r.red}（${pct(r.red, GAMES)}）引分 ${r.draw} 破局 ${r.catastrophe}`);
    }
  }, 3_600_000);
  it('強さの比較（席を入れ替えて同数）', () => {
    if (ONLY !== 'all' && ONLY !== 'level') return;
    const pairs: [CpuLevel, CpuLevel][] = [['normal', 'easy'], ['hard', 'normal']];
    for (const id of IDS) {
      for (const [a, b] of pairs) {
        let wa = 0, wb = 0;
        const half = Math.ceil(GAMES / 2);
        for (const [blue, red, aSide] of [[a, b, 'blue'], [b, a, 'red']] as [CpuLevel, CpuLevel, Side][]) {
          for (let i = 1; i <= half; i++) {
            const o = play(id, blue, red, i * 104729);
            if (o.kind === 'victory') o.winner === aSide ? wa++ : wb++;
          }
        }
        console.log(`${id} ${a} 対 ${b}（各 ${half} 局×2）：${a} ${wa} 勝、${b} ${wb} 勝`);
      }
    }
  }, 3_600_000);
});
