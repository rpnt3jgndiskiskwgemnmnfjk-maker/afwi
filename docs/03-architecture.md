# 技術設計書 — Archipelago Air Command（仮称）

| 項目 | 内容 |
|---|---|
| 文書番号 | AAC-ARC-001 |
| 版 | 第0.2版 |
| 更新日 | 2026-10-30 |
| 変更点 | 射程帯・マップ外ボックス・d4 判定に合わせてデータ型と描画方式を更新 |

---

## 1. 実装方式の比較

| 案 | 構成 | 長所 | 短所 |
|---|---|---|---|
| A（推奨） | TypeScript + Vite + Preact、Capacitor で APK 化 | アーティファクト試作のコードをそのまま APK に使える。Web で素早く確認できる | WebView のため、ネイティブより描画性能がやや劣る |
| B | Kotlin + Jetpack Compose | ネイティブの性能と操作感 | アーティファクト試作と二重開発になる |
| C | Godot 4（GDScript） | ゲーム向けの描画とアニメ | アーティファクト（HTML）で確認できない。Web 書き出しは容量が大きい |
| D | PWA を TWA で包む | 構成が最も簡単 | 公開 URL のホスティングが要る。完全オフラインに制約 |

**判定: 案A。** 「アーティファクトで確認してから APK にする」という進め方に合い、ルールエンジンを1本で保守できる。

## 2. 全体構成

```
┌──────────────────────────────────────────┐
│ UI 層（Preact + SVG 地図 + CSS）          │  画面・入力・アニメ
├──────────────────────────────────────────┤
│ アプリ層（store / 画面遷移 / i18n）       │  状態の購読、セーブ
├───────────────┬──────────────────────────┤
│ AI（CPU）      │ ルールエンジン（純 TS）   │  決定的・副作用なし
├───────────────┴──────────────────────────┤
│ データ（シナリオ・部隊・地図 JSON）       │
├──────────────────────────────────────────┤
│ プラットフォーム層                         │  Web: localStorage
│                                          │  Android: Capacitor Preferences
└──────────────────────────────────────────┘
```

## 3. ルールエンジン

- 状態は1つのオブジェクト `GameState`。変更は `applyAction(state, action)` で新しい状態を返す。
- ターンの解決は `resolveTurn(state, blueOrders, redOrders)` が担い、`{ state, events }` を返す。`events` は UI のアニメとログに使う。
- 乱数は xoshiro128** などのシード付き生成器。状態に乱数の内部値を持たせ、セーブ／ロード後も同じ結果を再現する。d4 は `1 + (next() % 4)` ではなく偏りのない方法（棄却法）で引く。
- 射程帯は `map.json` の `bands` 表を引く。表は経緯度から大圏距離を計算して生成する（生成スクリプトを `tools/` に置く）。地図上のエリアとマップ外ボックスを同じ ID 体系で扱うため、射程計算は 1 つの関数で済む。
- d4 の命中数の分布は二項分布で正確に求まる。UI の確率表示と CPU の期待値計算は同じ関数 `hitDistribution(dice, target)` を使う。
- UI と AI は同じエンジン関数を呼ぶ。AI は状態をコピーして試行（先読み）する。

### 3.1 主なデータ型（TypeScript）

```ts
type Side = 'blue' | 'red';
type Phase = 'situation' | 'intel' | 'planning' | 'execution' | 'recovery';

interface GameState {
  schemaVersion: number;
  scenarioId: string;
  turn: number;
  phase: Phase;
  rng: { seed: number; s: [number, number, number, number] };
  escalation: 0 | 1 | 2 | 3 | 4 | 5;
  sides: Record<Side, SideState>;
  areas: Record<AreaId, AreaState>;
  boxes: Record<BoxId, OffMapBox>;
  units: Record<UnitId, Unit>;
  log: GameEvent[];
}

interface SideState {
  will: number;          // 0〜10
  logistics: number;     // 兵站点
  hand: CardId[];        // 国力カード
  vp: number;
  lrmSalvos: number;     // 長射程ミサイルの残り斉射数
}

type LocationId = AreaId | BoxId;   // 地図上のエリアとマップ外ボックスを同じ扱いにする

interface AreaState {
  id: AreaId;
  owner: Side | 'neutral' | null;
  base?: { type: 'hub' | 'spoke'; runway: 0 | 1 | 2 | 3; capacity: number };
  detectedBy: Side[];
  airSuperiority: Side | null;
}

interface OffMapBox {
  id: BoxId;                // 'B-REAR' | 'B-HOME' | 'B-STO' | 'R-REAR' | 'R-STO'
  side: Side;
  role: 'rear' | 'standoff';
  salvosLeft?: number;      // スタンドオフ・ボックスの残り弾数
}

interface UnitType {
  code: 'FTR' | 'MRF' | 'STL' | 'BMR' | 'TKR' | 'AEW' | 'ISR' | 'ALT' | 'SAM' | 'LRM';
  aaDice: number;           // 対空ダイス数（d4）
  agDice: number;           // 対地ダイス数（d4）
  target: 2 | 3 | 4;        // 命中基準（出目がこれ以上で命中）
  steps: 1 | 2;
  radius: number;           // 行動半径（射程帯）
}

interface Unit {
  id: UnitId;
  side: Side;
  type: UnitType['code'];
  steps: number;            // 残りステップ
  location: LocationId;
  posture: 'parked' | 'dispersed';
  transit?: LocationId;     // 転地中なら行き先（1 ターン後に到着）
}

interface Order {           // 計画フェイズの任務割当
  unitIds: UnitId[];        // パッケージ
  mission: 'CAP' | 'STRIKE' | 'SEAD' | 'RECON' | 'TANKER' | 'AIRLIFT';
  target: LocationId;
}
```

### 3.2 射程地図の描画

- 地図は SVG。エリアは経緯度を簡易投影した座標に置く（`x = (経度 − 105) × 20 + 20`、`y = (35 − 緯度) × 20 + 20`）。
- 射程リングは楕円で描く。縦半径は 1 帯あたり約 90、横半径はその地点の緯度の余弦で割って補正する。
- マップ外ボックスは地図の端に固定表示し、選んだときだけ基準点に印を出してリングを描く。

## 4. ディレクトリ構成（案）

```
afwi/
├─ docs/                  設計書
├─ src/
│  ├─ engine/             ルールエンジン（UI に依存しない）
│  │  ├─ state.ts  rules/  combat.ts  rng.ts
│  ├─ ai/                 CPU
│  ├─ data/               scenarios/ units.json map.json cards.json
│  ├─ ui/                 screens/ components/ map/
│  ├─ platform/           storage.ts（Web と Capacitor の切替）
│  └─ i18n/               ja.json（en.json は将来）
├─ tests/                 Vitest（エンジン）、Playwright（E2E）
├─ android/               Capacitor が生成
└─ .github/workflows/     CI（テスト、試作 HTML、APK）
```

## 5. ビルドと配布

| 成果物 | 手順 |
|---|---|
| アーティファクト用試作 | `vite build` を単一 HTML に固める（vite-plugin-singlefile）。外部通信なし、保存は localStorage（try/catch で保護） |
| APK（デバッグ） | `vite build` → `npx cap sync android` → `./gradlew assembleDebug` |
| APK（リリース） | GitHub Actions で `assembleRelease`。署名鍵は GitHub Secrets に置き、成果物として APK をダウンロード |

- Capacitor は v8（2025-12-08 リリース、Active）を採用予定。v7 は 2026-06-08 に保守終了、2026-12-08 にサポート終了（出典: Capacitor Support Policy、一次情報）。
- v8 の Android 最低要件は**未確認**。着手時に公式ドキュメントで確認して `minSdkVersion` を確定する。

## 6. テスト方針

| 種類 | 対象 | 基準 |
|---|---|---|
| 単体テスト（Vitest） | エンジンの各ルール、戦闘判定、勝利判定 | カバレッジ 80% 以上 |
| 決定性テスト | 同じシード・同じ計画で同じ結果 | 全シナリオで一致 |
| 自動対戦 | CPU 同士で 1,000 局 | クラッシュ 0、陣営別勝率 40〜60% |
| E2E（Playwright） | Web ビルドで新規開始 → 1ターン完了 → セーブ → ロード | 主要導線が通る |
| 実機 | Android 実機 2 台以上（中級機、タブレット） | NFR-04 の性能基準 |

## 7. 開発計画

| 段階 | 内容 | 完了の基準 | 確認方法 |
|---|---|---|---|
| P0 設計 | 要件定義、ゲーム仕様、技術設計（本書） | 未決事項 D-01〜D-08 の決定 | アーティファクト（設計書） |
| P1 試作 | 地図、S0 チュートリアル、ホットシート、制空と打撃の判定 | ブラウザで3ターン遊べる | アーティファクト（遊べる試作） |
| P2 ルール完成 | 全ルール、S1・S2、CPU（易・中） | CPU と最後まで対戦できる | アーティファクト |
| P3 Android 化 | Capacitor 導入、保存のネイティブ化、CI で APK 生成 | 実機で起動しセーブ／ロードできる | APK |
| P4 調整 | 自動対戦によるバランス調整、CPU（難）、演出 | NFR を満たす | APK（ベータ） |
| P5 v1.0 | 不具合修正、ルールブック整備 | 受入れ確認 | APK（正式版） |

## 8. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| 原作との類似による権利問題 | 配布停止 | オリジナル設計を徹底し、名称・ルール・図版を独自にする。設計判断を本書に記録 |
| 実在国家を扱うことの政治的な受け止め | 配布先での反発 | 陣営は青／赤表記。架空化オプションを検討（D-01） |
| バランス崩れ | 片方が必勝 | CPU 同士の自動対戦で勝率を計測して調整 |
| CPU が弱い・遅い | 面白さの低下 | 評価関数を段階的に改良し、思考時間に上限を設ける |
| APK 署名鍵の紛失 | 更新版を入れられない | 鍵を2か所に保管。手順を README に記載 |
| 性能値の正確性 | 誤った理解 | 抽象化した値だけを使い、実在の性能を示すものではないと明記 |
