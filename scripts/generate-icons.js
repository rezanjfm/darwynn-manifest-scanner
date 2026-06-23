// Generates all required PWA icon PNGs from an SVG source.
// Run: node scripts/generate-icons.js

const sharp = require("sharp");
const path  = require("path");
const fs    = require("fs");

const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

// Brand blue background + bold white "D"
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#00B2D8"/>
  <path d="M104 72 L228 72 C420 72 420 440 228 440 L104 440 Z
           M176 144 L228 144 C348 144 348 368 228 368 L176 368 Z"
        fill="white" fill-rule="evenodd"/>
</svg>`;

// Maskable icon: identical design but with extra padding so the D sits
// within the 80% "safe zone" that adaptive icons crop to.
const maskableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#00B2D8"/>
  <path d="M134 102 L228 102 C390 102 390 410 228 410 L134 410 Z
           M194 162 L228 162 C330 162 330 350 228 350 L194 350 Z"
        fill="white" fill-rule="evenodd"/>
</svg>`;

const sizes = [
  { name: "icon-72.png",          size: 72,  svg: iconSvg },
  { name: "icon-96.png",          size: 96,  svg: iconSvg },
  { name: "icon-128.png",         size: 128, svg: iconSvg },
  { name: "icon-144.png",         size: 144, svg: iconSvg },
  { name: "icon-152.png",         size: 152, svg: iconSvg },
  { name: "icon-192.png",         size: 192, svg: iconSvg },
  { name: "icon-384.png",         size: 384, svg: iconSvg },
  { name: "icon-512.png",         size: 512, svg: iconSvg },
  { name: "icon-512-maskable.png",size: 512, svg: maskableSvg },
  { name: "apple-touch-icon.png", size: 180, svg: maskableSvg },
];

(async () => {
  for (const { name, size, svg } of sizes) {
    const dest = path.join(outDir, name);
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(dest);
    console.log(`✓ ${name} (${size}×${size})`);
  }
  console.log("\nAll icons generated.");
})();
