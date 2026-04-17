const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const iconsDir = path.join(__dirname, 'public', 'icons');
const lemonPng = path.join(iconsDir, 'lemon-logo.png');
/** Letterbox nos ícones PWA: transparente — mantém o PNG como vem */
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="100" fill="#0c2834"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%" stop-color="#b6c33f"/>
      <stop offset="100%" stop-color="#41710b"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(182,195,63,0.2)"/>
      <stop offset="100%" stop-color="rgba(182,195,63,0)"/>
    </radialGradient>
  </defs>
  <circle cx="256" cy="256" r="220" fill="url(#glow)"/>
  <ellipse cx="256" cy="290" rx="130" ry="165" fill="url(#g)" transform="rotate(-15 256 290)"/>
  <ellipse cx="310" cy="195" rx="36" ry="22" fill="#d4e07a" transform="rotate(-25 310 195)"/>
  <line x1="256" y1="130" x2="270" y2="75" stroke="#41710b" stroke-width="14" stroke-linecap="round"/>
  <ellipse cx="295" cy="68" rx="28" ry="12" fill="#2d5a08" transform="rotate(-40 295 68)"/>
</svg>`);

async function main() {
  if (fs.existsSync(lemonPng)) {
    await Promise.all([
      sharp(lemonPng)
        .resize(192, 192, { fit: 'contain', background: TRANSPARENT })
        .png()
        .toFile(path.join(iconsDir, 'icon-192.png')),
      sharp(lemonPng)
        .resize(512, 512, { fit: 'contain', background: TRANSPARENT })
        .png()
        .toFile(path.join(iconsDir, 'icon-512.png')),
    ]);
    console.log('Ícones PWA gerados a partir de public/icons/lemon-logo.png');
    return;
  }
  await Promise.all([
    sharp(svg).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png')),
    sharp(svg).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png')),
  ]);
  console.log('Ícones PWA gerados a partir do SVG interno (coloque lemon-logo.png em public/icons para usar a marca).');
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
