/**
 * Lighthouse CI 配置：跑在 `vite preview`（需先 build）上，对关键页面做性能预算断言。
 * 断言失败即 CI 步骤失败（= 告警）；报告写入 .lighthouseci/ 供 artifact 留档。
 * 阈值可按基线实测调整，宁松勿抖（CI 共享 runner 有噪声）。
 */
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3, // 多次取中位数，降低单次抖动
      startServerCommand: 'pnpm exec vite preview --port 4173 --strictPort',
      url: [
        'http://localhost:4173/', // 首页（Hero + 搜索）
        'http://localhost:4173/lyrics-search', // 平台搜索页
        'http://localhost:4173/ranking', // 排行榜页
      ],
    },
    assert: {
      assertions: {
        // 硬门槛：性能总分回退直接红
        'categories:performance': ['error', { minScore: 0.75 }],
        // 硬门槛：布局稳定性
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        // 软告警：仅在 PR 上提示，不阻塞
        'categories:accessibility': ['warn', { minScore: 0.85 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 4000 }],
        'interactive': ['warn', { maxNumericValue: 4000 }],
        'total-byte-weight': ['warn', { maxNumericValue: 3000000 }], // 3MB
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
      reportFilenamePattern: 'report-%%DATETIME%%-%%PATHNAME%%.%%EXTENSION%%',
    },
  },
};
