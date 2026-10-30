# Archipelago Air Command（仮称）

西太平洋を舞台にした、航空作戦がテーマのオリジナル作戦級ウォーゲーム。Android アプリ（APK）として配布する予定です。

> 本作は Air Force Wargame: Indo-Pacific（米空軍 AFWI）を参考にしたジャンル作品ですが、ルール・地図・名称・図版はすべて独自に設計しており、原作を再現・複製するものではありません。

## 設計書

| 文書 | 内容 |
|---|---|
| [docs/01-requirements.md](docs/01-requirements.md) | 要件定義（目的、スコープ、機能・非機能要件、未決事項） |
| [docs/02-game-design.md](docs/02-game-design.md) | ゲームデザイン仕様（地図、部隊、ACE、ターン手順、戦闘判定、勝利条件） |
| [docs/03-architecture.md](docs/03-architecture.md) | 技術設計（実装方式、構成、データ型、ビルド、テスト、開発計画、リスク） |
| [docs/data/map.json](docs/data/map.json) | 作戦地図の定義（18エリアと接続） |

## 進め方

1. P0 設計（現在）: 設計書をアーティファクトで確認し、未決事項を決める
2. P1 試作: ブラウザで遊べる試作をアーティファクトで確認
3. P2 ルール完成と CPU
4. P3 Capacitor で Android 化し、CI で APK を生成
5. P4 バランス調整 → P5 v1.0
