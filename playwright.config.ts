import { defineConfig } from '@playwright/test'

/**
 * Playwright E2E 配置
 *
 * 测试策略：
 * - 通过 app-launcher.js 启动真实 Electron 进程（CDP 远程调试）
 * - 每个测试 suite 独立实例 + 独立 userData 目录，实例间完全隔离
 * - Web UI API server 运行于随机端口，由 app-launcher 管理
 * - serial 模式避免同一 suite 内的状态竞争
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,       // 单个 test 最长 60s（含 AI 响应等待）
  globalTimeout: 300_000, // 整套测试最长 5 分钟
  retries: 0,             // CI 中失败不重试，保持日志清晰
  workers: 1,             // E2E 必须串行，避免 Electron 实例冲突

  use: {
    // 截图：仅在失败时保留
    screenshot: 'only-on-failure',
    // 视频：仅在重试时录制（retries=0 时实际不录）
    video: 'on-first-retry',
    // 追踪：仅在失败时收集
    trace: 'on-first-retry',
    // headless 模式（CI 友好）；本地调试可设 PWHEADLESS=false
    headless: process.env.PWHEADLESS !== 'false',
  },

  // 测试结果输出
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
})
