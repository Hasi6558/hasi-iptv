import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import pkg from './package.json' with { type: 'json' };

// The VIDAA browser version is unknown until Phase 1 is tested on the TV.
// Modern browsers get ES module chunks; older engines without module support get
// a transpiled nomodule bundle. Transpilation cannot add missing media APIs.
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 49', 'safari >= 10', 'firefox >= 52'],
      modernPolyfills: false,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: { format: 'iife' },
  build: {
    sourcemap: false,
    reportCompressedSize: true,
    // hls.js (~180 KB gzip) is loaded on demand when the first HLS stream starts.
    chunkSizeWarningLimit: 700,
  },
});
