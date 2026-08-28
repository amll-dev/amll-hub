import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 独立于 vite.config.ts：单测不需要 react/tailwind 插件，只保留路径别名
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
