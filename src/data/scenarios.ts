import type { Side, UnitCode } from '../engine/types';

export interface ScenarioUnit {
  side: Side;
  type: UnitCode;
  location: string;
  count?: number;
  posture?: 'parked' | 'dispersed';
}

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  maxTurns: number;
  escalation: number;
  keyAreas: string[];
  sides: Record<Side, { will: number; logistics: number; salvos: number }>;
  units: ScenarioUnit[];
  hints: string[];   // チュートリアルの手引き（ターン順）
}

export const S0: Scenario = {
  id: 'S0',
  name: '南西防空',
  summary:
    '3 作戦日の短いシナリオです。要域は東シナ海と台湾東方海域。制空で航空優勢を取り、敵の基地を叩き、自軍の基地を守ってください。開始時点でエスカレーション段階 3（本格的航空戦）です。',
  maxTurns: 3,
  escalation: 3,
  keyAreas: ['ECS', 'TWE'],
  sides: {
    blue: { will: 8, logistics: 8, salvos: 3 },
    red: { will: 8, logistics: 8, salvos: 4 },
  },
  units: [
    { side: 'blue', type: 'FTR', location: 'OKI', count: 2 },
    { side: 'blue', type: 'MRF', location: 'OKI' },
    { side: 'blue', type: 'AEW', location: 'OKI' },
    { side: 'blue', type: 'SAM', location: 'OKI' },
    { side: 'blue', type: 'FTR', location: 'SAK' },
    { side: 'blue', type: 'FTR', location: 'KYU' },
    { side: 'blue', type: 'MRF', location: 'KYU' },
    { side: 'blue', type: 'TKR', location: 'KYU' },
    { side: 'blue', type: 'BMR', location: 'B-STO' },
    { side: 'blue', type: 'FTR', location: 'B-REAR' },

    { side: 'red', type: 'FTR', location: 'ECC', count: 2 },
    { side: 'red', type: 'MRF', location: 'ECC', count: 2 },
    { side: 'red', type: 'AEW', location: 'ECC' },
    { side: 'red', type: 'SAM', location: 'ECC' },
    { side: 'red', type: 'FTR', location: 'SCC' },
    { side: 'red', type: 'MRF', location: 'SCC' },
    { side: 'red', type: 'SAM', location: 'SCC' },
    { side: 'red', type: 'LRM', location: 'R-STO', count: 2 },
    { side: 'red', type: 'FTR', location: 'R-REAR' },
  ],
  hints: [
    '作戦日 1：まず沖縄を選び、制空戦闘機を「制空」で東シナ海へ出してみましょう。AEW を同じエリアに出すと命中基準が 1 下がります。赤の長射程ミサイルは沖縄に届くので、残る部隊は「分散」にすると壊されにくくなります。',
    '作戦日 2：射程リングで届く範囲を確かめましょう。九州の戦闘機は台湾東方海域まで 3 帯です。給油機を同じエリアに出すと行動半径が 1 伸びます。グアムの戦闘機は「転地」で前方の基地へ移せます。',
    '作戦日 3：最終日です。相手のハブ基地を打撃するとエスカレーションが 1 上がり、段階 5 で双方が敗北します。勝利点と意志の差を見て判断しましょう。',
  ],
};

export const SCENARIOS: Record<string, Scenario> = { S0 };
