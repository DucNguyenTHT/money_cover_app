import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const API = 'http://localhost:4000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app for the tills / kitchen tablets. Only the app shell is cached; data always comes live from
    // the server in the shop (no offline selling — see plan "ngoài phạm vi").
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Quán ăn — Bán hàng',
        short_name: 'Bán hàng',
        description: 'Bán hàng, bếp và kế toán nội bộ của quán',
        lang: 'vi',
        start_url: '/pos',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f5f7fa',
        theme_color: '#eaf2fd',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Bán hàng', url: '/pos' },
          { name: 'Màn hình bếp', url: '/kitchen' },
          { name: 'Quản trị', url: '/admin' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely: separate chunks stay cached on the tablets across app updates.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'react';
          if (/[\\/](zod|@ts-rest)[\\/]/.test(id)) return 'api';
          if (/[\\/](socket\.io-client|engine\.io-client|socket\.io-parser|@socket\.io)[\\/]/.test(id))
            return 'socket';
          if (/[\\/]@tanstack[\\/]/.test(id)) return 'query';
          if (/[\\/]lucide-react[\\/]/.test(id)) return 'icons';
          if (/[\\/](decimal\.js)[\\/]/.test(id)) return 'decimal';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
