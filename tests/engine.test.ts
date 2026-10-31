import { describe, expect, it } from 'vitest';
import { S0, S1, S2 } from '../src/data/scenarios';
import { UNIT_TYPES } from '../src/data/units';
import {
  band, createGame, emptyPlan, hitDistribution, missionsFor, planCost, planForCpu, resolveTurn, validatePlan, validTargets,
  type GameState, type Plan, type Side,
} from '../src/engine';
import { rollD4, seedRng } from '../src/engine/rng';

const plan = (orders: Plan['orders'] = [], extra: Partial<Plan> = {}): Plan => ({ ...emptyPlan(), orders, ...extra });

describe('乱数と d4', () => {
  it('同じシードなら同じ出目列になる', () => {
    const a = seedRng(42), b = seedRng(42);
    const xs = Array.from({ length: 50 }, () => rollD4(a));
    const ys = Array.from({ length: 50 }, () => rollD4(b));
    expect(xs).toEqual(ys);
  });
  it('出目は 1〜4 に偏りなく分布する', () => {
    const r = seedRng(7);
    const n = 40000;
    const count = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) count[rollD4(r) - 1]++;
    for (const c of count) expect(Math.abs(c / n - 0.25)).toBeLessThan(0.01);
  });
  it('命中数の分布は合計 1、3+ の 1 個は 50%', () => {
    const d = hitDistribution(3, 3);
    expect(d.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    expect(hitDistribution(1, 3)[1]).toBeCloseTo(0.5);
    expect(hitDistribution(1, 1)[1]).toBeCloseTo(0.75); // 2+ に収める
    expect(hitDistribution(1, 9)[1]).toBeCloseTo(0.25); // 4 に収める
  });
});

describe('射程帯', () => {
  it('設計書の表と一致する', () => {
    expect(band('OKI', 'ECS')).toBe(2);
    expect(band('SAK', 'TWS')).toBe(1);
    expect(band('KYU', 'TWE')).toBe(3);
    expect(band('B-REAR', 'PHS')).toBe(4);
    expect(band('OKI', 'OKI')).toBe(0);
  });
  it('沖縄の戦闘機は 5 つの争奪エリアに制空を出せる', () => {
    const g = createGame(S0, 1);
    const ftr = g.units['B-FTR-1'];
    const t = validTargets(g, emptyPlan(), ftr, 'CAP').filter((id) => ['ECS', 'TWS', 'TWE', 'BAS', 'PHS', 'SCN', 'SCS'].includes(id));
    expect(t.sort()).toEqual(['BAS', 'ECS', 'PHS', 'TWE', 'TWS']);
  });
  it('給油機を同じエリアに出すと行動半径が 1 伸びる', () => {
    const g = createGame(S0, 1);
    const kyuFtr = Object.values(g.units).find((u) => u.location === 'KYU' && u.type === 'FTR')!;
    expect(validTargets(g, emptyPlan(), kyuFtr, 'CAP')).not.toContain('TWE');
    const tkr = Object.values(g.units).find((u) => u.type === 'TKR')!;
    const p = plan([{ unitId: tkr.id, mission: 'TANKER', target: 'TWE' }]);
    expect(validTargets(g, p, kyuFtr, 'CAP')).toContain('TWE');
  });
  it('グアムの戦闘機はどこにも届かないが転地はできる', () => {
    const g = createGame(S0, 1);
    const guam = Object.values(g.units).find((u) => u.location === 'B-REAR')!;
    expect(validTargets(g, emptyPlan(), guam, 'CAP')).toEqual([]);
    expect(validTargets(g, emptyPlan(), guam, 'MOVE')).toContain('OKI');
  });
});

describe('計画の検証', () => {
  it('分散中の部隊は出撃費用が 2', () => {
    const g = createGame(S0, 1);
    g.units['B-FTR-1'].posture = 'dispersed';
    const p = plan([{ unitId: 'B-FTR-1', mission: 'CAP', target: 'ECS' }]);
    expect(planCost(g, p)).toBe(2);
  });
  it('駐機／分散の切り替えは回復フェイズに有効になる', () => {
    const g = createGame(S0, 1);
    const r = resolveTurn(g, { blue: plan([], { postures: { 'B-FTR-2': 'dispersed' } }), red: plan() });
    expect(g.units['B-FTR-2'].posture).toBe('parked');
    expect(r.state.units['B-FTR-2'].posture).toBe('dispersed');
  });
  it('滑走路の数を超えて出撃できない', () => {
    const g = createGame(S0, 1);
    g.bases.OKI.runway = 1;
    const p = plan([
      { unitId: 'B-FTR-1', mission: 'CAP', target: 'ECS' },
      { unitId: 'B-FTR-2', mission: 'CAP', target: 'ECS' },
    ]);
    expect(validatePlan(g, 'blue', p).join()).toContain('滑走路');
  });
  it('長射程ミサイルはスタンドオフ打撃だけを選べ、グアムには届かない', () => {
    const g = createGame(S0, 1);
    const lrm = g.units['R-LRM-1'];
    expect(missionsFor(g, lrm)).toEqual(['STANDOFF']);
    const t = validTargets(g, emptyPlan(), lrm, 'STANDOFF');
    expect(t).toContain('OKI');
    expect(t).not.toContain('B-REAR');
  });
});

describe('ターン解決', () => {
  it('同じシード・同じ計画なら同じ結果、元の状態は変わらない', () => {
    const g = createGame(S0, 99);
    const before = JSON.stringify(g);
    const plans = {
      blue: plan([{ unitId: 'B-FTR-1', mission: 'CAP', target: 'ECS' }, { unitId: 'B-AEW-1', mission: 'AEW', target: 'ECS' }]),
      red: plan([{ unitId: 'R-FTR-1', mission: 'CAP', target: 'ECS' }, { unitId: 'R-LRM-1', mission: 'STANDOFF', target: 'OKI' }]),
    };
    const a = resolveTurn(g, plans);
    const b = resolveTurn(g, plans);
    expect(JSON.stringify(g)).toBe(before);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.report.events.some((e) => e.kind === 'air')).toBe(true);
    expect(a.report.events.some((e) => e.kind === 'standoff')).toBe(true);
  });
  it('一方だけが制空を出したエリアはその陣営の航空優勢になり、要域なら 1VP', () => {
    const g = createGame(S0, 3);
    const r = resolveTurn(g, { blue: plan([{ unitId: 'B-FTR-1', mission: 'CAP', target: 'ECS' }]), red: plan() });
    expect(r.state.superiority.ECS).toBe('blue');
    expect(r.state.sides.blue.vp).toBe(1);
  });
  it('ハブ基地を打撃するとエスカレーションが 1 上がる', () => {
    const g = createGame(S0, 5);
    const r = resolveTurn(g, { blue: plan(), red: plan([{ unitId: 'R-LRM-1', mission: 'STANDOFF', target: 'OKI' }]) });
    // 翌日の情勢（停戦交渉の打診）で下がることがあるので、この日の上昇をイベントで確かめる
    expect(r.report.events).toContainEqual(expect.objectContaining({ kind: 'escalation', from: 3, to: 4 }));
  });
  it('分散中の部隊は基地への打撃で破壊されない', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = createGame(S0, seed);
      g.bases.OKI.runway = 0; // 命中はすべて駐機中の部隊に向かう
      for (const u of Object.values(g.units)) if (u.location === 'OKI') u.posture = 'dispersed';
      const r = resolveTurn(g, {
        blue: plan(),
        red: plan([{ unitId: 'R-LRM-1', mission: 'STANDOFF', target: 'OKI', aim: 'parked' }]),
      });
      for (const u of Object.values(r.state.units)) if (u.location === 'OKI' && u.type !== 'SAM') expect(u.steps).toBe(UNIT_TYPES[u.type].steps);
    }
  });
  it('段階 5 に達すると双方の敗北で終わる', () => {
    const g = createGame(S0, 8);
    g.escalation = 4;
    const r = resolveTurn(g, { blue: plan(), red: plan([{ unitId: 'R-LRM-1', mission: 'STANDOFF', target: 'OKI' }]) });
    expect(r.state.outcome?.kind).toBe('catastrophe');
  });
  it('ランダムな計画で 300 局を最後まで進めても壊れない', () => {
    for (let seed = 1; seed <= 300; seed++) {
      let g: GameState = createGame(S0, seed);
      const pick = seedRng(seed * 7919);
      while (!g.outcome) {
        const plans = { blue: randomPlan(g, 'blue', pick), red: randomPlan(g, 'red', pick) };
        g = resolveTurn(g, plans).state;
        for (const s of ['blue', 'red'] as Side[]) {
          expect(g.sides[s].logistics).toBeGreaterThanOrEqual(0);
          expect(g.sides[s].will).toBeGreaterThanOrEqual(0);
        }
      }
      expect(g.score).not.toBeNull();
      expect(g.history.length).toBeLessThanOrEqual(S0.maxTurns);
    }
  });
});

function randomPlan(g: GameState, side: Side, r: ReturnType<typeof seedRng>): Plan {
  const p = emptyPlan();
  for (const u of Object.values(g.units).filter((x) => x.side === side && x.steps > 0)) {
    const ms = missionsFor(g, u);
    if (!ms.length || rollD4(r) <= 2) continue;
    const m = ms[(rollD4(r) - 1) % ms.length];
    const ts = validTargets(g, p, u, m);
    if (!ts.length) continue;
    p.orders.push({ unitId: u.id, mission: m, target: ts[(rollD4(r) - 1) % ts.length], aim: rollD4(r) > 2 ? 'parked' : 'runway' });
    if (validatePlan(g, side, p).length) p.orders.pop();
  }
  return p;
}

describe('P2 のルール', () => {
  it('段階 2 で基地を攻撃すると段階 3 に上がる（スポークなら +1 はない）', () => {
    const g = createGame(S1, 4);
    expect(g.escalation).toBe(2);
    const r = resolveTurn(g, { blue: plan(), red: plan([{ unitId: 'R-LRM-1', mission: 'STANDOFF', target: 'SAK' }]) });
    expect(r.state.escalation).toBe(3);
  });
  it('国力カード：戦略的発信で敵の意志 −1、カードは手札から消える', () => {
    const g = createGame(S1, 4);
    g.sides.blue.hand = ['MESSAGE'];
    const r = resolveTurn(g, { blue: plan([], { card: { card: 'MESSAGE' } }), red: plan() });
    expect(r.state.sides.red.will).toBe(g.sides.red.will - 1);
    expect(r.state.sides.blue.hand).not.toContain('MESSAGE');
  });
  it('国力カード：基地使用の合意でルソン北部が使えるようになる', () => {
    const g = createGame(S2, 4);
    g.sides.red.hand = ['ACCESS'];
    const r = resolveTurn(g, { blue: plan(), red: plan([], { card: { card: 'ACCESS' } }) });
    expect(r.state.owners.LUZ).toBe('red');
  });
  it('国力カード：基地システム妨害で上限を超えた出撃が取り消される', () => {
    const g = createGame(S0, 4);
    g.sides.red.hand = ['CYBER'];
    g.bases.OKI.runway = 2;
    const r = resolveTurn(g, {
      blue: plan([{ unitId: 'B-FTR-1', mission: 'CAP', target: 'ECS' }, { unitId: 'B-FTR-2', mission: 'CAP', target: 'ECS' }]),
      red: plan([], { card: { card: 'CYBER', target: 'OKI' } }),
    });
    expect(r.report.events.filter((e) => e.kind === 'cancelled')).toHaveLength(1);
  });
  it('情報フェイズ：偵察機を出した地点は翌日に探知される', () => {
    const g = createGame(S1, 11);
    const isr = Object.values(g.units).find((u) => u.side === 'red' && u.type === 'ISR')!;
    const r = resolveTurn(g, { blue: plan(), red: plan([{ unitId: isr.id, mission: 'RECON', target: 'OKI' }]) });
    expect(r.state.detected.red).toContain('OKI');
  });
  it('防空制圧で命中した地上配備防空はその日は迎撃しない', () => {
    let sawSead = false;
    for (let seed = 1; seed <= 20; seed++) {
      const g = createGame(S0, seed);
      const r = resolveTurn(g, { blue: plan([{ unitId: 'B-MRF-1', mission: 'SEAD', target: 'ECC' }]), red: plan() });
      const sead = r.report.events.find((e) => e.kind === 'sead');
      expect(sead).toBeTruthy();
      if (sead && sead.kind === 'sead' && sead.rolls[0].hits > 0) {
        sawSead = true;
        expect(r.report.events.some((e) => e.kind === 'sam' && e.area === 'ECC')).toBe(false);
      }
    }
    expect(sawSead).toBe(true);
  });
  it('CPU の計画は常に検証を通る', () => {
    for (const sc of [S0, S1, S2]) {
      for (let seed = 1; seed <= 10; seed++) {
        let g = createGame(sc, seed);
        while (!g.outcome) {
          const plans = { blue: planForCpu(g, 'blue', 'normal'), red: planForCpu(g, 'red', seed % 2 ? 'easy' : 'normal') };
          expect(validatePlan(g, 'blue', plans.blue)).toEqual([]);
          expect(validatePlan(g, 'red', plans.red)).toEqual([]);
          g = resolveTurn(g, plans).state;
        }
      }
    }
  }, 60_000);
  it('標準の CPU は席を入れ替えても易しい CPU に勝ち越す（S0、各 30 局）', () => {
    let normalWins = 0, easyWins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const normal: Side = seed % 2 ? 'blue' : 'red';
      let g = createGame(S0, seed * 31);
      while (!g.outcome) {
        g = resolveTurn(g, {
          blue: planForCpu(g, 'blue', normal === 'blue' ? 'normal' : 'easy'),
          red: planForCpu(g, 'red', normal === 'red' ? 'normal' : 'easy'),
        }).state;
      }
      if (g.outcome.kind === 'victory') g.outcome.winner === normal ? normalWins++ : easyWins++;
    }
    expect(normalWins).toBeGreaterThan(easyWins);
  }, 60_000);
});
