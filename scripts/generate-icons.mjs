import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const srcLogo = 'C:\\Users\\dgapc\\Downloads\\atenna-logo.webp';

const sizes = [16, 32, 48, 128];
mkdirSync(resolve(projectRoot, 'public/icons'), { recursive: true });

for (const size of sizes) {
  await sharp(srcLogo)
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(resolve(projectRoot, `public/icons/icon${size}.png`));
  console.log(`Generated icon${size}.png`);
}

// Store promo 1280x800 — logo centered on white
await sharp(srcLogo)
  .resize(400, 400, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .extend({
    top: 200,
    bottom: 200,
    left: 440,
    right: 440,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  })
  .png()
  .toFile(resolve(projectRoot, 'public/store-promo-1280x800.png'));
console.log('Generated store-promo-1280x800.png');
