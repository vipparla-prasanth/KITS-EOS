import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createVersionManifestPlugin } from '../../scripts/versionPlugin.mts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    createVersionManifestPlugin(),
  ],
  server: {
    port: 5175,
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
})
