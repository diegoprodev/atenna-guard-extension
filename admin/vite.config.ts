import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/nexussafe/',
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    proxy: {
      '/admin': 'https://atennaplugin.maestro-n8n.site',
    },
  },
});
