import { render } from 'preact';
import { App, currentSession, type Session } from './ui/App';
import { loadSession } from './ui/storage';
import './ui/styles.css';

// アーティファクトの表示中に新しい版が届いたとき、対局の状態を引き継ぐ（ビューアの外では hot は存在しない）
interface Hot {
  data?: { session?: Session | null };
  ready?: (start: (data: Hot['data']) => void) => void;
  snapshot?: (fn: () => Hot['data']) => void;
}
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

async function start(data: Hot['data']) {
  const initial = data?.session ?? null;
  const saved = initial ? null : await loadSession();
  render(<App initial={initial} saved={saved} />, document.getElementById('app')!);
}

if (import.meta.env.MODE === 'android') {
  // 同梱の等幅フォント。和文は端末の標準フォント（Noto Sans CJK）を使う
  import('@fontsource/ibm-plex-mono/400.css');
  import('@fontsource/ibm-plex-mono/600.css');
  // 戻るボタン：画面が処理しなければアプリを閉じる
  import('@capacitor/app').then(({ App: CapApp }) => {
    CapApp.addListener('backButton', () => {
      const ev = new Event('aac-back', { cancelable: true });
      window.dispatchEvent(ev);
      if (!ev.defaultPrevented) CapApp.exitApp();
    });
  });
}

hot?.snapshot?.(() => ({ session: currentSession() }));
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
