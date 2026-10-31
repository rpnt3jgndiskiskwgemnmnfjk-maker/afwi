import { render } from 'preact';
import { App, currentSession, type Session } from './ui/App';
import './ui/styles.css';

// アーティファクトの表示中に新しい版が届いたとき、対局の状態を引き継ぐ（ビューアの外では hot は存在しない）
interface Hot {
  data?: { session?: Session | null };
  ready?: (start: (data: Hot['data']) => void) => void;
  snapshot?: (fn: () => Hot['data']) => void;
}
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

function start(data: Hot['data']) {
  render(<App initial={data?.session ?? null} />, document.getElementById('app')!);
}

hot?.snapshot?.(() => ({ session: currentSession() }));
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
