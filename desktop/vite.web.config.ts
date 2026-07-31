/**
 * Standalone Web build configuration.
 *
 * This config produces a pure-browser version of MathWeaver that does not
 * require Electron. It bundles only the renderer code and injects a mock
 * API shim so the app works offline in any modern browser.
 *
 * Usage:
 *   npm run build:web
 *
 * Output: dist-web/
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    // Tell the renderer it's running in web mode (no Electron)
    'import.meta.env.VITE_IS_WEB': JSON.stringify('true'),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
      },
    },
  },
})
