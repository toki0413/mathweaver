import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname),
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'test/index.html') },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [react()],
})
