import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Logo fonte versionado no repo. Override opcional via ATENNA_LOGO_SRC.
const srcLogo = process.env.ATENNA_LOGO_SRC
  ? resolve(process.env.ATENNA_LOGO_SRC)
  : resolve(projectRoot, 'assets/brand/atenna-logo.webp');

const sizes = [16, 32, 48, 128];
const iconsDir = resolve(projectRoot, 'public/icons');
mkdirSync(iconsDir, { recursive: true });

// Se o logo fonte não existe mas os ícones já estão versionados, o build segue.
if (!existsSync(srcLogo)) {
  const haveAllIcons = sizes.every((s) => existsSync(resolve(iconsDir, `icon${s}.png`)));
  if (haveAllIcons) {
    console.warn(
      `[generate-icons] logo fonte não encontrado (${srcLogo}); usando ícones já versionados em public/icons/.`,
    );
    process.exit(0);
  }
  console.error(
    `[generate-icons] ERRO: logo fonte ausente (${srcLogo}) e ícones não versionados. ` +
      `Coloque o .webp em assets/brand/ ou defina ATENNA_LOGO_SRC.`,
  );
  process.exit(1);
}

for (const size of sizes) {
  // Use 85% of the canvas so the owl has a small margin
  const logoSize = Math.round(size * 0.85);
  const offset = Math.round((size - logoSize) / 2);

  // Trim transparent border and resize
  const logoBuffer = await sharp(srcLogo)
    .trim({ threshold: 10 })
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Green owl on transparent background (#22c55e)
  const greenLogo = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: await sharp({
        create: { width: logoSize, height: logoSize, channels: 4, background: { r: 34, g: 197, b: 94, alpha: 1 } },
      })
        .composite([{ input: logoBuffer, blend: 'dest-in' }])
        .png()
        .toBuffer(),
      top: offset,
      left: offset,
    }])
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

const greenPromoLogo = await sharp({
  create: { width: promoLogoSize, height: promoLogoSize, channels: 4, background: { r: 34, g: 197, b: 94, alpha: 1 } },
})
  .composite([{ input: promoLogoBuffer, blend: 'dest-in' }])
  .png()
  .toBuffer();

await sharp({
  create: { width: 1280, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
})
  .composite([{ input: greenPromoLogo, top: 200, left: 440 }])
  .png()
  .toFile(resolve(projectRoot, 'public/store-promo-1280x800.png'));

console.log('Generated store-promo-1280x800.png');
