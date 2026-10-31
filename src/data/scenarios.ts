import type { Side, UnitCode } from '../engine/types';

export interface ScenarioUnit {
  side: Side;
  type: UnitCode;
  location: string;
  count?: number;
  posture?: 'parked' | 'dispersed';
}

export interface Reinforcement extends ScenarioUnit {
  turn: number;
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
  reinforcements: Reinforcement[];
  hints: string[];   // チュートリアルの手引き（ターン順）
}

export const S0: Scenario = {
  id: 'S0',
  name: '南西防空',
  summary:
    '3 作戦日のチュートリアルです。要域は東シナ海と台湾東方海域。制空で航空優勢を取り、敵の基地を叩き、自軍の基地を守ってください。開始時点でエスカレーション段階 3（本格的航空戦）です。',
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
  reinforcements: [],
  hints: [
    '作戦日 1：まず沖縄を選び、制空戦闘機を「制空」で東シナ海へ出してみましょう。AEW を同じエリアに出すと命中基準が 1 下がります。赤の長射程ミサイルは沖縄に届きます。待機させる部隊は「分散」にしておくと、翌日から打撃で壊されにくくなります（切り替えは 1 日かかります）。',
    '作戦日 2：射程リングで届く範囲を確かめましょう。九州の戦闘機は台湾東方海域まで 3 帯です。給油機を同じエリアに出すと行動半径が 1 伸びます。グアムの戦闘機は「転地」で前方の基地へ移せます。国力カードも 1 枚使えます。',
    '作戦日 3：最終日です。相手のハブ基地を打撃するとエスカレーションが 1 上がり、段階 5 で双方が敗北します。勝利点と意志の差を見て判断しましょう。',
  ],
};

export const S1: Scenario = {
  id: 'S1',
  name: '第一列島線',
  summary:
    '8 作戦日。要域は東シナ海、台湾東方海域、バシー海峡。開始時点の段階は 2（限定的航空戦）で、基地を打撃すると段階 3 に上がります。前方の基地に出すか、後方に下げて守るか。兵站と分散運用の駆け引きが中心です。',
  maxTurns: 8,
  escalation: 2,
  keyAreas: ['ECS', 'TWE', 'BAS'],
  sides: {
    blue: { will: 9, logistics: 12, salvos: 5 },
    red: { will: 8, logistics: 10, salvos: 4 },
  },
  units: [
    { side: 'blue', type: 'FTR', location: 'KYU', count: 2 },
    { side: 'blue', type: 'MRF', location: 'KYU' },
    { side: 'blue', type: 'TKR', location: 'KYU' },
    { side: 'blue', type: 'AEW', location: 'KYU' },
    { side: 'blue', type: 'FTR', location: 'OKI', count: 2 },
    { side: 'blue', type: 'STL', location: 'OKI' },
    { side: 'blue', type: 'MRF', location: 'OKI' },
    { side: 'blue', type: 'AEW', location: 'OKI' },
    { side: 'blue', type: 'SAM', location: 'OKI' },
    { side: 'blue', type: 'MRF', location: 'SAK' },
    { side: 'blue', type: 'SAM', location: 'SAK' },
    { side: 'blue', type: 'FTR', location: 'AMA' },
    { side: 'blue', type: 'FTR', location: 'B-REAR', count: 2 },
    { side: 'blue', type: 'TKR', location: 'B-REAR' },
    { side: 'blue', type: 'ALT', location: 'B-REAR' },
    { side: 'blue', type: 'ISR', location: 'B-HOME' },
    { side: 'blue', type: 'FTR', location: 'B-HOME' },
    { side: 'blue', type: 'BMR', location: 'B-STO' },

    { side: 'red', type: 'FTR', location: 'ECC', count: 3 },
    { side: 'red', type: 'MRF', location: 'ECC', count: 2 },
    { side: 'red', type: 'AEW', location: 'ECC' },
    { side: 'red', type: 'ISR', location: 'ECC' },
    { side: 'red', type: 'SAM', location: 'ECC' },
    { side: 'red', type: 'FTR', location: 'SCC', count: 2 },
    { side: 'red', type: 'MRF', location: 'SCC', count: 2 },
    { side: 'red', type: 'STL', location: 'SCC' },
    { side: 'red', type: 'SAM', location: 'SCC' },
    { side: 'red', type: 'FTR', location: 'HAI' },
    { side: 'red', type: 'MRF', location: 'HAI' },
    { side: 'red', type: 'AEW', location: 'HAI' },
    { side: 'red', type: 'FTR', location: 'SPR' },
    { side: 'red', type: 'LRM', location: 'R-STO', count: 3 },
    { side: 'red', type: 'FTR', location: 'R-REAR', count: 2 },
    { side: 'red', type: 'ALT', location: 'R-REAR' },
  ],
  reinforcements: [
    { turn: 3, side: 'blue', type: 'STL', location: 'B-REAR' },
    { turn: 4, side: 'red', type: 'FTR', location: 'R-REAR', count: 2 },
    { turn: 5, side: 'blue', type: 'FTR', location: 'B-HOME', count: 2 },
    { turn: 6, side: 'red', type: 'MRF', location: 'R-REAR' },
  ],
  hints: [],
};

export const S2: Scenario = {
  id: 'S2',
  name: '海峡危機',
  summary:
    '12 作戦日。要域は東シナ海、台湾海峡、台湾東方海域、バシー海峡。中立のルソン北部を外交でどちらが使うかも鍵になります。スタンドオフ打撃とエスカレーション管理を含む全ルールで戦います。',
  maxTurns: 12,
  escalation: 2,
  keyAreas: ['ECS', 'TWS', 'TWE', 'BAS'],
  sides: {
    blue: { will: 10, logistics: 16, salvos: 6 },
    red: { will: 8, logistics: 10, salvos: 4 },
  },
  units: [
    ...S1.units,
    { side: 'blue', type: 'BMR', location: 'B-REAR' },
    { side: 'blue', type: 'ISR', location: 'B-REAR' },
    { side: 'blue', type: 'MRF', location: 'B-HOME' },
    { side: 'blue', type: 'FTR', location: 'SAK' },
    { side: 'red', type: 'BMR', location: 'R-REAR' },
    { side: 'red', type: 'MRF', location: 'SPR' },
    { side: 'red', type: 'SAM', location: 'HAI' },
  ],
  reinforcements: [
    { turn: 3, side: 'blue', type: 'STL', location: 'B-REAR' },
    { turn: 3, side: 'red', type: 'STL', location: 'R-REAR' },
    { turn: 4, side: 'blue', type: 'FTR', location: 'B-REAR', count: 2 },
    { turn: 5, side: 'blue', type: 'FTR', location: 'B-HOME', count: 2 },
    { turn: 5, side: 'red', type: 'FTR', location: 'R-REAR', count: 2 },
    { turn: 8, side: 'blue', type: 'MRF', location: 'B-REAR', count: 2 },
    { turn: 8, side: 'red', type: 'MRF', location: 'R-REAR', count: 2 },
  ],
  hints: [],
};

export const SCENARIOS: Record<string, Scenario> = { S0, S1, S2 };
