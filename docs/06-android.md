# Android 版（P3）

| 項目 | 内容 |
|---|---|
| 文書番号 | AAC-AND-001 |
| 更新日 | 2026-10-31 |
| 対象 | Capacitor による APK の作成・署名・配布 |

## 1. 構成

| 項目 | 値 |
|---|---|
| アプリ ID | `app.archipelago.aircommand`（一度配布したら変更しない。変えると別アプリ扱いになり、更新できない） |
| 表示名 | 列島航空作戦 |
| バージョン | 0.4.0（versionCode 4）。P3 の初版は 0.3.0 |
| 対応 OS | Android 7.0（API 24）以上。対象 API 36。Capacitor 8.5.3 のテンプレートの値 |
| 権限 | なし（INTERNET も要求しない。要件 NFR-03） |
| 保存 | Capacitor Preferences（端末の SharedPreferences）。アプリを閉じても対局を再開できる |
| フォント | 等幅の IBM Plex Mono を同梱。和文は端末の標準フォント（Noto Sans CJK）を使う。APK を小さく保つため |
| 戻るボタン | 選択を外す → タイトルへ戻る（対局は保存済み）→ タイトルではアプリを閉じる |
| 画面の向き | 固定しない（横持ちが主、縦持ちでも表示が崩れない） |
| APK の大きさ | 約 4.5MB（要件 NFR-05 の 20MB 以下） |

Web 版（アーティファクト）と Android 版は同じソースから作ります。違いは `vite build --mode android` のときだけ有効になる部分（フォントの同梱、保存先、戻るボタン）です。

## 2. ビルドの手順（手元）

必要なもの：Node.js 22、JDK 21、Android SDK（platforms;android-36、build-tools;36.0.0）

```
npm ci
npm run apk:debug      # デバッグ版：android/app/build/outputs/apk/debug/app-debug.apk
```

`android/local.properties` に `sdk.dir=<Android SDK の場所>` を書くか、環境変数 `ANDROID_HOME` を設定してください。

アイコンとスプラッシュ画面を作り直すときは `node tools/icons.mjs`（Playwright が必要）。

## 3. 署名鍵（リリース版）

デバッグ版は、ビルドした環境ごとに違う鍵で署名されます。そのため、別の環境で作った APK を上書きインストールできません（いったんアンインストールが必要になり、保存した対局も消えます）。知人に配るなら、同じ鍵で署名したリリース版を使ってください。

### 3.1 鍵を作る（一度だけ）

```
keytool -genkeypair -v -keystore aac-release.jks -alias aac -keyalg RSA -keysize 4096 -validity 10000
```

- 鍵ファイルとパスワードは**リポジトリに入れない**でください（`.gitignore` で `*.jks` を除外しています）。
- 鍵を失うと、同じアプリとして更新版を配れなくなります。2 か所以上に保管してください。

### 3.2 GitHub に登録する

リポジトリの Settings → Secrets and variables → Actions に、次の 4 つを登録します。

| 名前 | 内容 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 aac-release.jks` の出力 |
| `AAC_KEYSTORE_PASSWORD` | 鍵ストアのパスワード |
| `AAC_KEY_ALIAS` | `aac`（3.1 で指定した別名） |
| `AAC_KEY_PASSWORD` | 鍵のパスワード |

登録すると、CI がリリース版 APK を作るようになります。登録がなければデバッグ版を作ります。

### 3.3 手元でリリース版を作る

```
AAC_KEYSTORE_PATH=/path/to/aac-release.jks AAC_KEYSTORE_PASSWORD=... AAC_KEY_ALIAS=aac AAC_KEY_PASSWORD=... npm run apk:release
```

## 4. CI（GitHub Actions）

`.github/workflows/ci.yml`：プルリクエストと main への push で動きます。

1. 型チェック、単体テスト、Web 版のビルド
2. Android 版のビルドと APK の作成。APK は実行結果の Artifacts「archipelago-air-command-apk」からダウンロードできます

## 5. 端末へのインストール

1. APK を端末に送る（USB、Google ドライブ、メールの添付など）
2. 端末でファイルを開く。「提供元不明のアプリ」の許可を求められたら、そのアプリ（ファイルマネージャーなど）に許可する
3. インストール後、ホーム画面の「列島航空作戦」から起動する

## 6. 確認結果（2026-10-31）

| 確認 | 結果 |
|---|---|
| APK の内容（aapt2） | アプリ ID・表示名・API 24〜36・権限なしを確認 |
| 署名（apksigner） | デバッグ鍵で署名済み |
| Android 版の画面一式（Chromium） | 外部への通信 0 件、同梱フォントの読み込み、保存と再開、戻る操作を確認（`tests/e2e/android-web.mjs`） |
| 実機・エミュレータ | **未確認**。開発環境に KVM がなくエミュレータを動かせないため、実機での確認が必要 |

### 実機で確かめてほしいこと

- 起動、スプラッシュ画面、アイコンの見た目
- タップの反応、地図の拡大、パネルのスクロール
- アプリを閉じて開き直したときに「続きから」が出るか
- 戻るボタンの動き
- 起動にかかる時間（要件：3 秒以内）と CPU の思考時間

## 7. 既知の注意点

- 開発時だけ使う Capacitor CLI の依存（glob、minimatch、uuid）に中程度の脆弱性が報告されています。修正には CLI を 4 系に戻す必要があり、APK には含まれないため、現状のままとします。
- npm 10.9 の依存解決の不具合を避けるため、`.npmrc` で `legacy-peer-deps=true` にしています。
- （P4 で対応済み）地図は 2 本指のピンチで拡大・縮小、1 本指のドラッグで移動できます。
