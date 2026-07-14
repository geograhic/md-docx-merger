// Render favicon/PWA/OG assets from the source SVGs using sharp.
// Run: NODE_PATH=<workspace>/node_modules node scripts/render-icons.mjs
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dirname, '..', 'public');

const svg = await readFile(join(PUB, 'favicon.svg'));
const svgMask = await readFile(join(PUB, 'favicon-maskable.svg'));
const svgOg = await readFile(join(PUB, 'og.svg'));

async function png(src, size, out) {
  await sharp(src, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(PUB, out));
  console.log('  wrote', out, size + 'x' + size);
}

// Standard rounded-tile icons
await png(svg, 512, 'icon-512.png');
await png(svg, 192, 'icon-192.png');
await png(svg, 180, 'apple-touch-icon.png');
await png(svg, 48, 'favicon-48.png');
await png(svg, 32, 'favicon-32.png');
await png(svg, 16, 'favicon-16.png');

// Maskable (full-bleed) icons for Android adaptive
await png(svgMask, 512, 'icon-512-maskable.png');
await png(svgMask, 192, 'icon-192-maskable.png');

// OG social card 1200x630 (exact, no transparent padding)
await sharp(svgOg, { density: 192 })
  .resize(1200, 630, { fit: 'cover' })
  .png()
  .toFile(join(PUB, 'og-image.png'));
console.log('  wrote og-image.png 1200x630');

// Multi-resolution favicon.ico (16/32/48)
const icoBufs = await Promise.all(
  [16, 32, 48].map((s) =>
    sharp(svg, { density: 384 })
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  )
);
const ico = await pngToIco(icoBufs);
await writeFile(join(PUB, 'favicon.ico'), ico);
console.log('  wrote favicon.ico (16/32/48)');

console.log('DONE');
