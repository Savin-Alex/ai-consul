import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    // Copy AudioWorklet processor to public directory so Vite can serve it
    {
      name: 'copy-audioworklet',
      buildStart() {
        const source = path.resolve(__dirname, 'src/core/audio/audio-worklet-processor.js');
        const destDir = path.resolve(__dirname, 'src/renderer/public/core/audio');
        const dest = path.join(destDir, 'audio-worklet-processor.js');
        try {
          if (!existsSync(destDir)) {
            mkdirSync(destDir, { recursive: true });
          }
          copyFileSync(source, dest);
          console.log('[vite] Copied AudioWorklet processor to public directory');
        } catch (error) {
          console.warn('[vite] Failed to copy AudioWorklet processor:', error);
        }
      },
    },
  ],
  root: './src/renderer',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@core': path.resolve(__dirname, './src/core'),
      '@utils': path.resolve(__dirname, './src/utils'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

