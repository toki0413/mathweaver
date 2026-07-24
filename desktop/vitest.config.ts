import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // NOTE on environment:
    // The task spec requested `environment: 'jsdom'`, but `jsdom` (and
    // `happy-dom`) are NOT installed in this project, and the task constraints
    // forbid installing new npm packages. Vitest fails hard when the jsdom
    // environment cannot be resolved, so we use `'node'` instead.
    //
    // Component tests render via `react-dom/server`'s `renderToString`, which
    // produces an HTML string with no DOM dependency — this covers every
    // assertion required by the task (text/math rendering, Cayley-table
    // closure/associativity badges, aria-label presence, XSS escaping).
    //
    // To switch back to the spec's intent later, install the DOM toolchain
    // (`npm i -D jsdom @testing-library/react @testing-library/jest-dom`) and
    // change this value to `'jsdom'`; the guarded setup file below will then
    // pick up @testing-library/jest-dom automatically.
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Only run unit tests through vitest; E2E specs live under tests/e2e and
    // are executed by Playwright (`npm run test:e2e`).
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/', 'dist/', 'out/', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'out/'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
