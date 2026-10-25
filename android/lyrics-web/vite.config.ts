import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * 构建产物直接落到 Android assets，APK 内离线可用。
 * base: './' 让 file:///android_asset/lyrics/index.html 能正确找到相对资源。
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../app/src/main/assets/lyrics', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
  },
});
