import { defineConfig, devices } from '@playwright/test'

/**
 * Real-backend Playwright configuration.
 *
 * Boots BOTH the real FastAPI backend (uvicorn + mock LLM) and the frontend
 * (vite serving test/real-index.html, which injects test/real-api.js). E2E
 * tests therefore exercise the genuine frontend -> HTTP -> FastAPI ->
 * Orchestrator chain instead of the deterministic mock.
 *
 * Run with:  npm run test:e2e:real
 * First-time setup requires the Chromium browser binary:
 *   npm run test:e2e:install
 */
const FRONTEND_PORT = 5176
const BACKEND_PORT = 8010
const backendURL = `http://127.0.0.1:${BACKEND_PORT}`
const baseURL = `http://localhost:${FRONTEND_PORT}`

export default defineConfig({
  testDir: './tests/e2e-real',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { outputFolder: 'playwright-report-real' }], ['list']] : 'list',
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
  webServer: [
    {
      // Real FastAPI backend with the deterministic mock LLM and a scratch DB.
      command:
        'cd ../backend && rm -f /tmp/mathweaver_e2e.db && ' +
        `MATHWEAVER_LLM_PROVIDER=mock MATHWEAVER_LLM_API_KEY= ` +
        `MATHWEAVER_DB_PATH=/tmp/mathweaver_e2e.db MATHWEAVER_PORT=${BACKEND_PORT} ` +
        'python -m uvicorn mathweaver.api.app:app --host 127.0.0.1 ' +
        `--port ${BACKEND_PORT} --log-level warning`,
      url: `${backendURL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
    {
              // Frontend served with the real-backend bridge injected.
              command: `npx vite --config vite.real.config.ts --port ${FRONTEND_PORT} --strictPort`,
              url: `${baseURL}/test/real-index.html`,
              reuseExistingServer: !process.env.CI,
              timeout: 60_000,
            },
  ],
})