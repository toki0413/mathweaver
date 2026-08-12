import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Vite config for the real-backend E2E harness.
 *
 * Serves test/real-index.html on a dedicated port (5176) so it never clashes
 * with the mock-based test server (5174). real-index.html injects
 * test/real-api.js, which talks to the real FastAPI backend over HTTP.
 */
export default defineConfig({
  root: resolve(__dirname),
  server: {
    port: 5176,
    host: '0.0.0.0',
  },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'test/real-index.html') },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [react()],
})