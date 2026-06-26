import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // build 時のみ相対パスにする（GitHub Pages の /<repo>/ サブパス配信対策）。
  // dev サーバ（serve）では '/' でないとモジュール変換・解決が壊れるため分岐する。
  base: command === 'build' ? './' : '/',
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 移行中のデバッグ用に sourcemap を有効化（後で off にしてよい）
    sourcemap: true,
  },
}));
