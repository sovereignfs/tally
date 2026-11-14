// Renders the PWA's PNG icons from public/icons/icon.svg (DESIGN.md §15.11), with the Chromium that Playwright already installs, so that
// no image tool is needed. Run once when the icon changes; the PNGs are committed.
//
//   node scripts/generate-icons.mjs
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
// The glyph alone, for a maskable icon and the iPhone's, which the platform cuts to its own shape: a full-bleed square, the strokes inside the
// central safe zone (80% for maskable).
const glyph = svg
  .replace(/<rect[^>]*\/>/, '<rect width="512" height="512" fill="#18181b"/>')
  .replace(/<g /, '<g transform="translate(51.2 51.2) scale(0.8)"><g ')
  .replace('</g></svg>', '</g></g></svg>');

const icons = [
  { file: 'icon-192.png', size: 192, source: svg },
  { file: 'icon-512.png', size: 512, source: svg },
  { file: 'maskable-512.png', size: 512, source: glyph },
  { file: 'apple-touch-icon.png', size: 180, source: glyph },
];

const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${icon.source.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `)}</body></html>`,
    );
    await page.screenshot({
      path: `public/icons/${icon.file}`,
      omitBackground: true,
      clip: { x: 0, y: 0, width: icon.size, height: icon.size },
    });
    await page.close();
    console.log(`public/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}
