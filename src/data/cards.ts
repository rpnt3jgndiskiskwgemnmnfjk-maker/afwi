import type { CardDomain, CardId, SituationId } from '../engine/types';

export type CardTarget = 'none' | 'ownLocation' | 'enemyHub';

export interface CardDef {
  id: CardId;
  name: string;
  domain: CardDomain;
  target: CardTarget;
  text: string;
}

// 国力カード（docs/02-game-design.md 10 章）。効果は実行フェイズの最初に解決する
export const CARDS: Record<CardId, CardDef> = {
  ACCESS: { id: 'ACCESS', name: '基地使用の合意', domain: '外交', target: 'none', text: '中立のルソン北部のスポーク基地を、自軍が使えるようになる' },
  MEDIATION: { id: 'MEDIATION', name: '停戦の仲介', domain: '外交', target: 'none', text: 'エスカレーション −1（段階 1 未満にはならない）' },
  MESSAGE: { id: 'MESSAGE', name: '戦略的発信', domain: '情報', target: 'none', text: '敵の国民の意志 −1' },
  DECEPTION: { id: 'DECEPTION', name: '欺瞞', domain: '情報', target: 'ownLocation', text: '選んだ自軍の地点は、次の情報フェイズで探知されない' },
  SEALIFT: { id: 'SEALIFT', name: '海上輸送の優先', domain: '経済', target: 'none', text: 'この日の回復フェイズに兵站 +2' },
  SANCTIONS: { id: 'SANCTIONS', name: '経済制裁', domain: '経済', target: 'none', text: '敵の兵站の生成 −1（2 日間）' },
  SATELLITE: { id: 'SATELLITE', name: '衛星偵察', domain: '宇宙', target: 'none', text: '次の情報フェイズで、すべての探知判定の基準 −2' },
  CYBER: { id: 'CYBER', name: '基地システム妨害', domain: 'サイバー', target: 'enemyHub', text: '選んだ敵ハブ基地のこの日の出撃上限 −1。上限を超えた出撃は取り消される' },
};

/** 各陣営の山札の構成（12 枚） */
export const DECK: CardId[] = [
  'ACCESS', 'MEDIATION', 'MEDIATION', 'MESSAGE', 'MESSAGE', 'DECEPTION', 'DECEPTION',
  'SEALIFT', 'SEALIFT', 'SANCTIONS', 'SATELLITE', 'CYBER',
];

export const SITUATIONS: Record<SituationId, { name: string; text: string }> = {
  CALM: { name: '平穏', text: '特別な出来事はありません。' },
  WEATHER: { name: '悪天候', text: '選ばれた争奪エリアでは、この日の航空戦の命中基準 +1。' },
  ALLY_SUPPORT: { name: '同盟国の支援', text: '選ばれた陣営の兵站 +2。' },
  RALLY: { name: '国内の結束', text: '選ばれた陣営の国民の意志 +1。' },
  PARTS: { name: '部品不足', text: '選ばれた陣営の兵站 −2。' },
  TALKS: { name: '停戦交渉の打診', text: '段階 4 以上ならエスカレーション −1。' },
};

/** 情勢の山札（シナリオ開始時に混ぜる） */
export const SITUATION_DECK: SituationId[] = ['CALM', 'CALM', 'CALM', 'WEATHER', 'WEATHER', 'ALLY_SUPPORT', 'ALLY_SUPPORT', 'RALLY', 'RALLY', 'PARTS', 'PARTS', 'TALKS'];
