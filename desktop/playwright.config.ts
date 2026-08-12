import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration.
 *
 * The app is served in "browser test" mode by the existing `vite.test.config.ts`,
 * which serves `test/index.html` (the page injects `test/mock-api.js` so the
 * renderer can run without Electron). E2E tests therefore exercise the real
 * React UI against the mock backend.
 *
 * First-time setup: install the Chromium browser binary with
 *   npm run test:e2e:install
 * (this downloads a browser binary, not an npm package).
 */
const PORT = 5174
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { outputFolder: 'playwright-report' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        },
      },
    },
  ],
  webServer: {
    // `npx vite` resolves to the locally-installed vite (no download).
    command: `npx vite --config vite.test.config.ts --port ${PORT} --strictPort`,
    // /test/ serves test/index.html (see vite.test.config.ts root + input).
    url: `${baseURL}/test/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
