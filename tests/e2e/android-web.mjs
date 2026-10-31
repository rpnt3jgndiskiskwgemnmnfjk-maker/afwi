// Android 版に入れる画面一式（dist-android）の確認。エミュレータを使わずに Chromium で開き、
// 外部への通信が発生しないこと、保存と再開、戻る操作を確かめる。
// 使い方: npx vite build --mode android && node tests/e2e/android-web.mjs
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('../../dist-android/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const server = createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  const file = path.startsWith(root) && existsSync(path) && statSync(path).isFile() ? path : join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
const external = [];
const errors = [];
await page.route('**/*', (route) => {
  if (route.request().url().startsWith(base)) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(base);
await page.getByRole('button', { name: 'この設定で始める' }).click();
await page.getByRole('button', { name: '計画を確定する' }).click();
await page.getByRole('button', { name: /作戦日 2 へ進む/ }).click();

// 戻る操作：タイトルへ戻り、「続きから」が出る
await page.evaluate(() => window.dispatchEvent(new Event('aac-back', { cancelable: true })));
await page.getByRole('button', { name: /続きから/ }).waitFor();

// 再読み込みしても保存が残る（Android 版では Capacitor Preferences の Web 実装＝localStorage）
await page.reload();
const resume = page.getByRole('button', { name: /続きから.*作戦日 2/ });
await resume.waitFor();
await resume.click();
await page.getByRole('button', { name: '計画を確定する' }).waitFor();
const font = await page.evaluate(() => document.fonts.check('600 12px "IBM Plex Mono"'));

await browser.close();
server.close();
console.log('外部への通信:', external.length ? external : 'なし');
console.log('同梱フォント（IBM Plex Mono）:', font ? '読み込み済み' : '未読み込み');
if (external.length || errors.length || !font) {
  console.error('エラー:', errors);
  process.exit(1);
}
console.log('Android 版の画面一式 OK');
