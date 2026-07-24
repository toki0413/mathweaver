import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname, 'src'),
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [react()],
  define: {
    'process.env.IS_ELECTRON': JSON.stringify(false),
  },
})
