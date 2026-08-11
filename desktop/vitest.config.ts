import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom enables real DOM APIs (document, window, etc.) so React Testing
    // Library can render components into an actual DOM tree and simulate
    // user interactions (click, type, hover, …). This is the industry-standard
    // environment for component-level testing.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Only run unit tests through vitest; E2E specs live under tests/e2e and
    // are executed by Playwright (`npm run test:e2e`).
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/', 'dist/', 'out/', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'out/',
        'tests/**',
        'test/**',
        '**/*.config.{ts,js}',
        'src/main/index.ts',     // Electron main process entry
        'src/preload/**',        // Electron preload bridge
        'electron/main/**',      // Electron main process (requires app context)
        'electron/preload/**',   // Electron preload bridge
        'electron/backend/agents/**',  // LLM-dependent agents (require network)
        'electron/backend/rag/**',      // RAG retriever (requires data files)
        'electron/backend/persistence/**', // SQLite store (requires native module)
      ],
      // Industry-standard coverage thresholds (production-grade).
      // Two-tier approach: src/ (frontend) has higher thresholds, while
      // electron/backend is measured but with lower thresholds since most
      // backend modules require LLM/network/SQLite runtime to test.
      // See: https://frontendchecklist.io/rules/testing/test-coverage
      thresholds: {
        global: {
          statements: 40,
          branches: 38,
          functions: 42,
          lines: 40,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
