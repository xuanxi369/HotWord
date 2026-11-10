import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  // Local parsing and UI checks do not need to contact a billed AI service.
  plugins: [react(), cloudflare({ remoteBindings: process.env.CF_AI_REMOTE === '1' })],
  worker: { format: 'es' },
  optimizeDeps: { include: ['fflate', 'fast-xml-parser', 'papaparse', 'pdfjs-dist', 'read-excel-file/web-worker'] },
  build: { chunkSizeWarningLimit: 1600 },
});
