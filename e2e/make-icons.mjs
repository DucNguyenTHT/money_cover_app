// Render the app icon (apps/web/public/icon.svg) to the PNG sizes a PWA needs.
// Usage: node make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../apps/web/public/', import.meta.url));
const svg = readFileSync(`${pub}icon.svg`, 'utf8');
// Maskable: Android crops to a circle, so the glyph must sit in the inner 80% on a full-bleed background.
const maskable = svg
  .replace('rx="112"', 'rx="0"')
  .replace('<path', '<g transform="translate(51 51) scale(0.8)"><path')
  .replace('</svg>', '</g></svg>');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, src] of [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['apple-touch-icon.png', 180, maskable],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: `${pub}${name}`, omitBackground: true });
  console.log(name);
}
await browser.close();
