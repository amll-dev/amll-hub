import { defineConfig } from '@playwright/test';

/**
 * E2E 冒烟测试：跑在 `vite preview`（需先 build）上，后端 API 全部用 page.route mock，
 * 无真实后端依赖、无网络抖动，断言页面壳与关键交互。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
