import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/** API behind the dev proxy; the e2e stack points it at its own API (e2e/playwright.config.ts). */
const API = process.env.API_URL ?? 'http://localhost:4000';

/** Dev server: /t/<code> (table QR) opens the guest page, like Caddy does in production. */
const guestPage = (): Plugin => ({
  name: 'guest-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/t/')) req.url = '/guest.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [
    guestPage(),
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
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/, /^\/t\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      // Two pages: the app (staff) and the light page guests open from the table QR.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        guest: fileURLToPath(new URL('./guest.html', import.meta.url)),
      },
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
