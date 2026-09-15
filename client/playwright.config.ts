import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,
  reporter: 'html',
  use: {
    // cw0523 分支独立端口
    baseURL: 'http://127.0.0.1:5275',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5275',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      // 后端（fixtures 通过 /api/auth/account-sets 真实登录，必须先起 3105）
      command: 'npm run dev:server',
      cwd: '..',
      url: 'http://127.0.0.1:3105/api/auth/account-sets',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
})
