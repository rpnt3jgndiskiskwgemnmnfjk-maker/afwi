# Archipelago Air Command（列島航空作戦）

西太平洋を舞台にした、航空作戦がテーマのオリジナル作戦級ウォーゲーム。Android アプリ（APK）として配布する予定です。d4 ダイス、射程を示す地図、マップ外ボックスを使います。

> 本作は Air Force Wargame: Indo-Pacific（米空軍 AFWI）と同じジャンルの作品ですが、ルール・地図・名称・図版・数値はすべて独自に設計しており、原作を再現・複製するものではありません。

## 設計書

| 文書 | 内容 |
|---|---|
| [docs/01-requirements.md](docs/01-requirements.md) | 要件定義（目的、スコープ、機能・非機能要件、未決事項） |
| [docs/02-game-design.md](docs/02-game-design.md) | ゲームデザイン仕様（地図、部隊、ACE、ターン手順、戦闘判定、勝利条件） |
| [docs/03-architecture.md](docs/03-architecture.md) | 技術設計（実装方式、構成、データ型、ビルド、テスト、開発計画、リスク） |
| [src/data/map.json](src/data/map.json) | 作戦地図の定義（17エリア、マップ外ボックス5つ、射程帯の表）。`npm run mapgen` で生成 |
| [docs/04-prototype-p1.md](docs/04-prototype-p1.md) | P1 試作の実装範囲、簡略化した点、開発の手順 |
| [docs/05-prototype-p2.md](docs/05-prototype-p2.md) | P2（全ルール、S1・S2、CPU）の実装範囲と、CPU 同士の対戦による確認結果 |
| [docs/06-android.md](docs/06-android.md) | Android 版（P3）：APK のビルド、署名鍵、CI、インストール、確認結果 |
| [docs/07-p4.md](docs/07-p4.md) | P4：霧を考慮した CPU、難しい CPU、1,000 局の自動対戦によるバランス確認、ピンチ操作、演出 |

## 開発

```
npm install
npm run dev              # 開発サーバー
npm test                 # ルールエンジンの単体テスト
npm run build:artifact   # 単一 HTML（dist/index.html）とアーティファクト用 HTML（dist/artifact.html）
npm run apk:debug        # Android のデバッグ版 APK（Android SDK が必要。docs/06-android.md）
npm run balance          # CPU 同士の自動対戦（AAC_GAMES=局数、AAC_ONLY=scenario|level）
```

## 進め方

1. P0 設計（完了）: 設計書をアーティファクトで確認し、未決事項を決定
2. P1 試作（完了）: ブラウザで遊べる試作をアーティファクトで確認
3. P2 ルール完成と CPU（完了）
4. P3 Capacitor で Android 化し、CI で APK を生成（完了・実機確認待ち）
5. P4 バランス調整、難しい CPU、演出（実装済み・確認中）
6. P5 v1.0
