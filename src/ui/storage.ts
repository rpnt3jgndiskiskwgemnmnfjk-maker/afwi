// 自動保存。ブラウザ（アーティファクト）では localStorage、P3 で Capacitor Preferences に差し替える。
// 保存できない環境（プライベートウィンドウなど）でもゲームは続けられるよう、失敗は無視する。

import type { Session } from './App';

const KEY = 'aac.session.v2';

export function saveSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存できなくても続行 */ }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s?.version === 2 && s.game?.schemaVersion === 2 ? s : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* 無視 */ }
}
