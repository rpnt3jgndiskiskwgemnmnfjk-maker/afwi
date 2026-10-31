/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 単一 HTML に固めて、アーティファクトとしてそのまま確認できるようにする（P3 で Capacitor にも同じ成果物を使う）
export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
