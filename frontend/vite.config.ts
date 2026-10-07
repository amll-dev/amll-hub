import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import path from 'node:path';
export type CoepMode = 'credentialless' | 'require-corp' | 'off';

function packageNameOf(id: string): string | null {
  const marker = 'node_modules/';
  const i = id.lastIndexOf(marker);
  if (i < 0) return null;
  const rest = id.slice(i + marker.length);
  const parts = rest.split('/');
  return rest.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

const REACT_PKGS = new Set([
  'react',
  'react-dom',
  'react-is',
  'scheduler',
  'sonner',
  'aria-hidden',
  'react-remove-scroll',
  'react-remove-scroll-bar',
  'react-style-singleton',
  'use-callback-ref',
  'use-sidecar',
  'use-sync-external-store',
]);

const REACT_SCOPES = ['@radix-ui/', '@griffel/', '@floating-ui/', '@fluentui/', '@tanstack/'];

function resolveCoepMode(raw) {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'none' || v === 'false' || v === '0') return 'off';
  if (v === 'require-corp' || v === 'requirecorp') return 'require-corp';
  return 'credentialless';
}

function coepHeaders(mode) {
  if (mode === 'off') return {};
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': mode,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const coepMode = resolveCoepMode(env.COEP_MODE);

  return {
    publicDir: 'public',
    plugins: [react(), tailwindcss(), wasm()],
    worker: {
      format: 'es',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        $: path.resolve(__dirname, './src/editor'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          // 主应用入口
          main: path.resolve(__dirname, 'index.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('vite/preload-helper')) return 'vendor-react';
            if (!id.includes('node_modules')) return undefined;
            const pkg = packageNameOf(id);
            if (!pkg) return 'vendor-react';

            if (
              pkg.startsWith('@applemusic-like-lyrics/') ||
              pkg === 'gl-matrix' ||
              pkg === 'pixi.js' ||
              pkg.startsWith('@pixi/') ||
              pkg === 'earcut' ||
              pkg === 'figma-squircle' ||
              pkg === 'corner-smoothing'
            )
              return 'vendor-amll';
            if (pkg === 'lucide-react') return 'vendor-icons';
            // 媒体/文件处理：jszip(+pako 压缩)、music-metadata(+file-type)、截图、ID3 写入
            if (
              pkg === 'music-metadata' ||
              pkg === 'jszip' ||
              pkg === 'pako' ||
              pkg === 'file-type' ||
              pkg === 'modern-screenshot' ||
              pkg === 'browser-id3-writer'
            )
              return 'vendor-media';
            if (pkg === 'framer-motion' || pkg === 'motion-dom' || pkg === 'motion-utils')
              return 'vendor-motion';
            // react 本体 + 整个 react 生态（radix/griffel/tanstack/fluentui…）
            if (
              REACT_PKGS.has(pkg) ||
              pkg === 'react-hook-form' ||
              pkg === 'react-i18next' ||
              pkg === 'react-router' ||
              pkg === 'react-router-dom' ||
              pkg === '@hookform/resolvers' ||
              pkg === 'jotai' ||
              pkg.startsWith('jotai-') ||
              pkg.startsWith('react-') ||
              REACT_SCOPES.some((s) => pkg.startsWith(s))
            )
              return 'vendor-react';
            // markdown 渲染 + 二维码：marked、qrcode 及其依赖（pngjs/url 等）
            if (
              pkg === 'marked' ||
              pkg === 'qrcode' ||
              pkg === 'pngjs' ||
              pkg === 'dijkstrajs' ||
              pkg === 'yargs' ||
              pkg === 'url'
            )
              return 'vendor-markdown';
            return 'vendor-react';
          },
        },
      },
    },
    server: {
      headers: coepHeaders(coepMode),
      proxy: {
        '/api': { target: 'http://localhost:8080', changeOrigin: true },
        '/ws': { target: 'http://localhost:8080', ws: true },
      },
    },
    preview: {
      headers: coepHeaders(coepMode),
    },
  };
});
