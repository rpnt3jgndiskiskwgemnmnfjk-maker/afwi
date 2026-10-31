import type { UnitCode, UnitType } from '../engine/types';

// 能力値は暫定（docs/02-game-design.md 5.1）
export const UNIT_TYPES: Record<UnitCode, UnitType> = {
  FTR: { code: 'FTR', name: '制空戦闘機', aaDice: 3, agDice: 1, target: 3, steps: 2, radius: 2 },
  MRF: { code: 'MRF', name: '多用途戦闘機', aaDice: 2, agDice: 2, target: 3, steps: 2, radius: 2 },
  STL: { code: 'STL', name: 'ステルス戦闘機', aaDice: 3, agDice: 2, target: 2, steps: 2, radius: 2 },
  BMR: { code: 'BMR', name: '爆撃機', aaDice: 0, agDice: 4, target: 3, steps: 2, radius: 6 },
  TKR: { code: 'TKR', name: '空中給油機', aaDice: 0, agDice: 0, target: 3, steps: 1, radius: 4 },
  AEW: { code: 'AEW', name: '早期警戒管制機', aaDice: 0, agDice: 0, target: 3, steps: 1, radius: 2 },
  ISR: { code: 'ISR', name: '偵察・無人機', aaDice: 0, agDice: 0, target: 3, steps: 1, radius: 4 },
  ALT: { code: 'ALT', name: '輸送機', aaDice: 0, agDice: 0, target: 3, steps: 1, radius: 4 },
  SAM: { code: 'SAM', name: '地上配備防空', aaDice: 2, agDice: 0, target: 3, steps: 2, radius: 0 },
  LRM: { code: 'LRM', name: '長射程ミサイル', aaDice: 0, agDice: 3, target: 3, steps: 1, radius: 4 },
};
