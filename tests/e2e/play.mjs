// 試作版の通しプレイ確認。ビルド済みの dist/index.html を開き、「1 人で両軍」で 3 作戦日を最後まで進める。
// 使い方: npm run build && node tests/e2e/play.mjs   （画面写真は dist/screens/ に保存）
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright はこの環境に事前インストール済みのものを使う
const { chromium } = createRequire(import.meta.url)('playwright');

const url = new URL('../../dist/index.html', import.meta.url).href;
const outDir = new URL('../../dist/screens/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const shot = (page, name) => page.screenshot({ path: new URL(`${name}.png`, outDir).pathname });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && errors.push(m.text()));

await page.goto(url);
await shot(page, '0-title');
await page.getByRole('button', { name: /1 人で両軍を操作する/ }).click();

/** 地点 → 部隊 → 任務 → 目標の順に選ぶ */
async function order(loc, unitLabel, mission, target) {
  await page.getByRole('button', { name: loc, exact: true }).first().click();
  const u = page.getByRole('button', { name: new RegExp(`^${unitLabel} `) }).first();
  if (!(await u.count())) return console.log(`  ${unitLabel} は撃破済みのため省略`);
  await u.click();
  const m = page.getByRole('group', { name: '任務' }).getByRole('button', { name: mission, exact: true });
  if (await m.getAttribute('aria-pressed') !== 'true') await m.click();
  await page.locator('.panel button.unit', { hasText: target }).first().click();
}

for (let turn = 1; turn <= 3; turn++) {
  // 青
  await order('沖縄', '青 FTR-1', '制空', '東シナ海');
  await order('沖縄', '青 AEW-1', '早期警戒', '東シナ海');
  await order('先島', '青 FTR-3', '制空', '台湾東方海域');
  if (turn === 1) {
    await order('マップ外ボックス 後方航空基地（グアム・第二列島線）', '青 FTR-5', '転地', '沖縄');
    await shot(page, '1-blue-plan');
  }
  await page.getByRole('button', { name: '計画を確定する' }).click();
  // 赤
  await order('華東沿岸', '赤 FTR-1', '制空', '東シナ海');
  await order('華東沿岸', '赤 FTR-2', '制空', '東シナ海');
  if (turn === 1) {
    await order('マップ外ボックス スタンドオフ打撃（赤）', '赤 LRM-1', 'スタンドオフ打撃', '先島');
    await order('華東沿岸', '赤 MRF-1', '打撃', '先島');
  }
  await page.getByRole('button', { name: '計画を確定する' }).click();
  await shot(page, `2-result-${turn}`);
  await page.getByRole('button', { name: turn < 3 ? /へ進む/ : /最終結果/ }).click();
}
await shot(page, '3-end');
const endText = await page.locator('h1').first().innerText();
console.log('最終画面:', endText);

// スマホ横持ち
const phone = await browser.newPage({ viewport: { width: 844, height: 390 } });
await phone.goto(url);
await phone.getByRole('button', { name: /1 人で両軍を操作する/ }).click();
await phone.screenshot({ path: new URL('4-phone.png', outDir).pathname });
await phone.getByRole('button', { name: '拡大' }).click();
await phone.screenshot({ path: new URL('5-phone-zoom.png', outDir).pathname });

await browser.close();
if (errors.length) {
  console.error('ページのエラー:', errors);
  process.exit(1);
}
console.log('通しプレイ OK');
