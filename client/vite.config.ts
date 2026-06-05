import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    // The initial globe view intentionally ships a cached Three/globe vendor chunk.
    chunkSizeWarningLimit: 1900,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;

          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react-vendor';
          }

          if (id.includes('/node_modules/three/')) {
            return 'three-vendor';
          }

          if (
            id.includes('/node_modules/react-globe.gl/') ||
            id.includes('/node_modules/globe.gl/') ||
            id.includes('/node_modules/three-globe/') ||
            id.includes('/node_modules/three-conic-polygon-geometry/') ||
            id.includes('/node_modules/three-geojson-geometry/') ||
            id.includes('/node_modules/three-slippy-map-globe/') ||
            id.includes('/node_modules/three-render-objects/')
          ) {
            return 'globe-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
