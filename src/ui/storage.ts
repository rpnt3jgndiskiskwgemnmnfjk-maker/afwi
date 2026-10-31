// 自動保存。ブラウザ（アーティファクト）では localStorage、Android 版では Capacitor Preferences
// （端末の SharedPreferences）に保存する。保存できない環境でもゲームは続けられるよう、失敗は無視する。

import type { Session } from './App';

const KEY = 'aac.session.v2';
const native = import.meta.env.MODE === 'android';

// プラグインは Promise の戻り値にしない（then の有無を調べられた時点で例外になる）。モジュールごと受け取る
const prefsModule = () => import('@capacitor/preferences');

function parse(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    return s?.version === 2 && s.game?.schemaVersion === 2 ? s : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session) {
  const value = JSON.stringify(s);
  try {
    if (native) await (await prefsModule()).Preferences.set({ key: KEY, value });
    else localStorage.setItem(KEY, value);
  } catch { /* 保存できなくても続行 */ }
}

export async function loadSession(): Promise<Session | null> {
  try {
    if (native) return parse((await (await prefsModule()).Preferences.get({ key: KEY })).value);
    return parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function clearSession() {
  try {
    if (native) await (await prefsModule()).Preferences.remove({ key: KEY });
    else localStorage.removeItem(KEY);
  } catch { /* 無視 */ }
}
