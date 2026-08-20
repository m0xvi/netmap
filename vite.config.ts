import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' assert { type: 'json' };

// v0.44.3 — expose package.json version to the app so the "About" tab and
// the header badge always match the built .exe. Previously the version was
// hard-coded in SettingsDialog.tsx and drifted on every release.
export default defineConfig({
  plugins: [react()],
  // Relative paths in index.html so `file://` works inside Electron
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
