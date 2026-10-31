import type { CapacitorConfig } from '@capacitor/cli';

// アプリ ID は一度配布すると変えられない（変えると別アプリ扱いになり、更新できない）
const config: CapacitorConfig = {
  appId: 'app.archipelago.aircommand',
  appName: '列島航空作戦',
  webDir: 'dist-android',
  android: {
    // 画面は端末の中で完結させる（外部への通信をしない）
    allowMixedContent: false,
  },
};

export default config;
