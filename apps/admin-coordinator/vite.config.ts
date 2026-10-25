import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createVersionManifestPlugin } from '../../scripts/versionPlugin.mts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    createVersionManifestPlugin({
      swCachePrefix: 'kits-eos-admin',
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@supabase/')) {
            return 'vendor-supabase';
          }
        },
      },
    },
  },
})
