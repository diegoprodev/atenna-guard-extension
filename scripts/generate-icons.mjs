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
  const logoSize = Math.round(size * 0.68);
  const offset = Math.round((size - logoSize) / 2);

  // Black circle background
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="black"/>
    </svg>`
  );

  // Trim transparent border first so the logo fills the available space
  const logoBuffer = await sharp(srcLogo)
    .trim({ threshold: 10 })
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Make logo white: create white canvas masked by logo's alpha (dest-in)
  const whiteLogo = await sharp({
    create: { width: logoSize, height: logoSize, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: logoBuffer, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Composite white logo centered on black circle
  await sharp(circle)
    .composite([{ input: whiteLogo, top: offset, left: offset }])
    .png()
    .toFile(resolve(projectRoot, `public/icons/icon${size}.png`));

  console.log(`Generated icon${size}.png (${size}x${size})`);
}

// Store promo 1280x800 — logo centered on black
const promoLogoSize = 400;
const promoLogoBuffer = await sharp(srcLogo)
  .trim({ threshold: 10 })
  .resize(promoLogoSize, promoLogoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

const whitePromoLogo = await sharp({
  create: { width: promoLogoSize, height: promoLogoSize, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
})
  .composite([{ input: promoLogoBuffer, blend: 'dest-in' }])
  .png()
  .toBuffer();

await sharp({
  create: { width: 1280, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
})
  .composite([{ input: whitePromoLogo, top: 200, left: 440 }])
  .png()
  .toFile(resolve(projectRoot, 'public/store-promo-1280x800.png'));

console.log('Generated store-promo-1280x800.png');
