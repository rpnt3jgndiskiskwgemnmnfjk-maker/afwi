/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Android 版はオフラインで動かすため、Google Fonts の読み込みを外す（等幅フォントは同梱、和文は端末の標準フォント） */
const offlineFonts = (): Plugin => ({
  name: 'aac-offline-fonts',
  transformIndexHtml: (html) => html.replace(/\s*<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, ''),
});

// 既定：単一 HTML に固めてアーティファクトで確認する。--mode android：Capacitor に渡す dist-android を作る
export default defineConfig(({ mode }) => {
  const android = mode === 'android';
  return {
    plugins: android ? [preact(), offlineFonts()] : [preact(), viteSingleFile()],
    base: android ? './' : '/',
    build: { target: 'es2022', outDir: android ? 'dist-android' : 'dist' },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
