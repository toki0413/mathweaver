import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') },
        output: {
          manualChunks: {
            // Split heavy 3D library into its own cacheable chunk
            three: ['three'],
            // Split React runtime into vendor chunk for better caching
            'react-vendor': ['react', 'react-dom', 'zustand'],
          },
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
  },
})
