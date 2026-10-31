// dist/index.html（単一ファイル）からアーティファクト用の HTML 断片 dist/artifact.html を作る。
// アーティファクトは公開時に doctype・html・head・body と charset・viewport の meta を自動で補うため、それらを外す。
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const out = src
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta charset="UTF-8"\s*\/?>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .trim();
if (!/^<title>/.test(out)) throw new Error('先頭が <title> になっていません');
writeFileSync(new URL('../dist/artifact.html', import.meta.url), out + '\n');
console.log(`dist/artifact.html ${(out.length / 1024).toFixed(1)} KiB`);
