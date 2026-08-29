import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    // 覆盖率只统计纯逻辑层（lib/），组件测试另行补充
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      exclude: ['src/lib/__tests__/**', 'src/lib/types.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        // 阈值 = 当前覆盖水平的锁底线（防回退）；api.ts 端点包装层与
        // download.ts 浏览器流程暂未覆盖，后续补测试后逐步上调
        lines: 25,
        functions: 19,
      },
    },
  },
});
