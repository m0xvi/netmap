import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths in index.html so `file://` works inside Electron
  base: './',
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'reactflow':    ['@xyflow/react'],
          'dagre':        ['dagre'],
          // v0.40: xterm.js + fit-addon are only used in SSH terminal dialog,
          // so split them out — saves 200 KB from the main bundle if the
          // user never opens SSH terminal (still eagerly loaded, but the
          // browser can cache the chunk separately).
          'xterm':        ['xterm', 'xterm-addon-fit'],
          // qrcode is ~50 KB, only used in QR share dialog.
          'qrcode':       ['qrcode'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true
  }
});
