// ルールエンジンの型定義。UI に依存しない。

export type Side = 'blue' | 'red';
export const SIDES: Side[] = ['blue', 'red'];
export const enemyOf = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');

export type UnitCode = 'FTR' | 'MRF' | 'STL' | 'BMR' | 'TKR' | 'AEW' | 'ISR' | 'ALT' | 'SAM' | 'LRM';

export interface UnitType {
  code: UnitCode;
  name: string;
  aaDice: number;     // 対空ダイス数（d4）
  agDice: number;     // 対地ダイス数（d4）
  target: 2 | 3 | 4;  // 命中基準
  steps: 1 | 2;
  radius: number;     // 行動半径（射程帯）
}

export type LocationKind = 'base' | 'contested' | 'box';

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  lon: number;
  lat: number;
  owner?: Side | 'neutral';      // 基地の初期の支配陣営
  base?: 'hub' | 'spoke';
  side?: Side;                   // マップ外ボックスの陣営
  role?: 'rear' | 'standoff';    // マップ外ボックスの種類
}

export type Mission = 'CAP' | 'STRIKE' | 'SEAD' | 'STANDOFF' | 'AEW' | 'RECON' | 'TANKER' | 'AIRLIFT' | 'MOVE';
export type StrikeAim = 'runway' | 'parked';
export type Posture = 'parked' | 'dispersed';

export interface Unit {
  id: string;
  side: Side;
  type: UnitCode;
  steps: number;        // 残りステップ。0 で撃破
  location: string;
  posture: Posture;
}

export interface Order {
  unitId: string;
  mission: Mission;
  target: string;
  aim?: StrikeAim;      // STRIKE / STANDOFF のみ
}

export type CardId = 'ACCESS' | 'MEDIATION' | 'MESSAGE' | 'DECEPTION' | 'SEALIFT' | 'SANCTIONS' | 'SATELLITE' | 'CYBER';
export type CardDomain = '外交' | '情報' | '経済' | '宇宙' | 'サイバー';

export interface CardPlay {
  card: CardId;
  target?: string;
}

export interface Plan {
  orders: Order[];
  postures: Record<string, Posture>;  // 駐機／分散の変更（回復フェイズに切り替わる）
  repairs: string[];                  // 修復する自軍基地
  card?: CardPlay;                    // 使う国力カード（1 日 1 枚）
}

export interface BaseState {
  runway: number;       // 0〜3
}

export interface SideState {
  will: number;         // 国民の意志 0〜10
  logistics: number;    // 兵站点
  vp: number;           // 要域の航空優勢で得た勝利点
  salvos: number;       // スタンドオフ打撃の残り弾数
  stepsKilled: number;  // 撃破した敵ステップの累計
  hand: CardId[];       // 国力カードの手札（最大 3 枚）
  deck: CardId[];       // 山札（上から引く）
  sanctions: number;    // 経済制裁の残りターン（兵站の生成 −1）
  deception: string | null;  // 次の情報フェイズで探知されない自軍の地点
  satellite: boolean;        // 次の情報フェイズで衛星偵察を使う
}

export interface DieRoll {
  unitId: string;
  dice: number[];
  target: number;
  mods: string[];       // 命中基準の修正の内訳
  hits: number;
}

export type GameEvent =
  | { kind: 'card'; side: Side; card: CardId; target?: string; effects: string[] }
  | { kind: 'cancelled'; side: Side; unitId: string; reason: string }
  | { kind: 'standoff'; side: Side; unitId: string; target: string; launched: number; intercept: DieRoll[]; intercepted: number; roll: DieRoll | null; effects: string[] }
  | { kind: 'air'; area: string; rolls: Record<Side, DieRoll[]>; effects: string[]; superiority: Side | null }
  | { kind: 'sead'; side: Side; target: string; rolls: DieRoll[]; effects: string[] }
  | { kind: 'sam'; area: string; side: Side; rolls: DieRoll[]; effects: string[] }
  | { kind: 'strike'; side: Side; target: string; rolls: DieRoll[]; effects: string[] }
  | { kind: 'move'; side: Side; unitId: string; from: string; to: string }
  | { kind: 'posture'; side: Side; unitId: string; posture: Posture }
  | { kind: 'repair'; side: Side; base: string; runway: number }
  | { kind: 'escalation'; from: number; to: number; reason: string }
  | { kind: 'will'; side: Side; delta: number; reason: string }
  | { kind: 'logistics'; side: Side; delta: number; reason: string }
  | { kind: 'vp'; side: Side; delta: number; reason: string };

export interface TurnReport {
  turn: number;
  plans: Record<Side, Plan>;
  events: GameEvent[];
}

export type SituationId = 'CALM' | 'WEATHER' | 'ALLY_SUPPORT' | 'RALLY' | 'PARTS' | 'TALKS';

/** 情勢フェイズに引いたイベント（双方に公開） */
export interface Situation {
  id: SituationId;
  area?: string;        // 悪天候のエリア
  side?: Side;          // 対象の陣営
  effects: string[];
}

export type Outcome =
  | { kind: 'victory'; winner: Side; reason: string }
  | { kind: 'draw'; reason: string }
  | { kind: 'catastrophe'; reason: string };

export interface FinalScore {
  areaVp: number;
  killVp: number;
  willVp: number;
  total: number;
}

export interface GameState {
  schemaVersion: 2;
  scenarioId: string;
  seed: number;
  rng: [number, number, number, number];
  turn: number;
  maxTurns: number;
  escalation: number;           // 0〜5
  keyAreas: string[];
  sides: Record<Side, SideState>;
  bases: Record<string, BaseState>;
  owners: Record<string, Side | 'neutral'>;  // 地図上の基地の支配陣営（外交カードで変わる）
  units: Record<string, Unit>;
  superiority: Record<string, Side | null>;  // 直前のターンの航空優勢
  supStreak: Record<string, { side: Side; turns: number }>;  // 要域の航空優勢の連続日数
  detected: Record<Side, string[]>;           // その陣営が敵部隊を探知している地点
  situation: Situation | null;                // 今日の情勢
  situationDeck: SituationId[];
  history: TurnReport[];
  outcome: Outcome | null;
  score: Record<Side, FinalScore> | null;
}
