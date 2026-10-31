// Android のアイコンとスプラッシュ画面を、ゲーム内の射程リングを図案にした SVG から作る。
// 既存の PNG と同じ寸法で上書きするので、`npx cap add android` の直後に一度実行すればよい。
// 使い方: node tools/icons.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const RES = new URL('../android/app/src/main/res/', import.meta.url).pathname;
const NAVY = '#15212e';
const AMBER = '#e0a33a';
const BLUE = '#3b7be0';

/** 射程リングと基地の印。size は描画領域、scale は前景の縮小率（アダプティブアイコンの安全領域用） */
function emblem(size, scale = 1, bg = NAVY) {
  const c = size / 2;
  const r = (size / 2) * 0.78 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}
  <g fill="none" stroke="${AMBER}" stroke-linecap="round">
    <ellipse cx="${c}" cy="${c}" rx="${r}" ry="${r * 0.92}" stroke-width="${size * 0.045 * scale}"/>
    <ellipse cx="${c}" cy="${c}" rx="${r * 0.55}" ry="${r * 0.5}" stroke-width="${size * 0.03 * scale}" opacity="0.8"/>
  </g>
  <rect x="${c - r * 0.2}" y="${c - r * 0.2}" width="${r * 0.4}" height="${r * 0.4}" fill="${BLUE}" stroke="#ffffff" stroke-width="${size * 0.012 * scale}"/>
  <path d="M${c + r * 0.62} ${c - r * 0.62} l${r * 0.16} ${-r * 0.16}" stroke="${AMBER}" stroke-width="${size * 0.04 * scale}" stroke-linecap="round"/>
</svg>`;
}

/** スプラッシュ：中央に図案、背景は濃紺 */
function splash(w, h) {
  const s = Math.min(w, h) * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="${NAVY}"/>
  <g transform="translate(${(w - s) / 2} ${(h - s) / 2})">${emblem(s, 1, null).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>
</svg>`;
}

const pngSize = (file) => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, w, h, file, round = false) {
  await page.setViewportSize({ width: w, height: h });
  const clip = round ? 'border-radius:50%;overflow:hidden;' : '';
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${w}px;height:${h}px;${clip}">${svg}</div></body></html>`);
  writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }));
}

let n = 0;
for (const dir of readdirSync(RES)) {
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png', 'splash.png']) {
    const file = join(RES, dir, name);
    let size;
    try { size = pngSize(file); } catch { continue; }
    const [w, h] = size;
    if (name === 'splash.png') await render(splash(w, h), w, h, file);
    else if (name === 'ic_launcher_foreground.png') await render(emblem(w, 0.62, null), w, h, file);
    else await render(emblem(w), w, h, file, name === 'ic_launcher_round.png');
    n++;
  }
}
await browser.close();

writeFileSync(join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${NAVY.toUpperCase()}</color>\n</resources>\n`);
console.log(`${n} 枚の画像を作り直しました`);
