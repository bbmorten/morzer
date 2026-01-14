import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Packaged Electron loads via file://, so assets must be referenced relatively.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'renderer-dist',
    emptyOutDir: true
  }
})
