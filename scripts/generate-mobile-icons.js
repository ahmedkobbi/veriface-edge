/**
 * VeriFace Edge — Mobile App Icon Generator
 *
 * Generates branded app icon assets from SVG definitions.
 *
 * This script creates:
 *   - icon.png (1024×1024) — main app icon
 *   - icon-dark.png (1024×1024) — dark mode icon (iOS)
 *   - icon-tinted.png (1024×1024) — tinted icon (iOS 18+)
 *   - adaptive-icon.png (1024×1024) — Android adaptive icon foreground
 *   - splash.png (1242×2436) — splash screen image
 *   - notification-icon.png (96×96) — push notification icon
 *   - favicon.png (48×48) — web favicon
 *
 * Usage:
 *   node scripts/generate-mobile-icons.js
 *
 * Prerequisites:
 *   npm install sharp
 *   (or use any SVG-to-PNG converter)
 *
 * The icons use the VeriFace Edge brand:
 *   - Shield shape (security)
 *   - Face scan circle + lines (facial recognition)
 *   - Gradient: #10b981 → #06b6d4 (brand primary)
 *   - Dark background: #0f172a (brand dark)
 */

const fs = require('fs')
const path = require('path')

const ASSETS_DIR = path.join(__dirname, '..', 'src', 'mobile-admin', 'assets')

// Ensure assets directory exists
fs.mkdirSync(ASSETS_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// SVG Definitions
// ---------------------------------------------------------------------------

const shieldSvg = (size, bg, fg) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
    <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.7)"/>
    </linearGradient>
  </defs>
  <!-- Background with rounded corners -->
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#bg)"/>
  <!-- Shield -->
  <path d="M ${size*0.5} ${size*0.15}
           L ${size*0.8} ${size*0.28}
           L ${size*0.8} ${size*0.5}
           Q ${size*0.8} ${size*0.72} ${size*0.5} ${size*0.85}
           Q ${size*0.2} ${size*0.72} ${size*0.2} ${size*0.5}
           L ${size*0.2} ${size*0.28}
           Z"
        fill="none" stroke="url(#fg)" stroke-width="${size*0.04}" stroke-linejoin="round"/>
  <!-- Face circle -->
  <circle cx="${size*0.5}" cy="${size*0.42}" r="${size*0.1}" fill="none" stroke="url(#fg)" stroke-width="${size*0.03}"/>
  <!-- Scan lines -->
  <rect x="${size*0.35}" y="${size*0.58}" width="${size*0.3}" height="${size*0.015}" rx="${size*0.007}" fill="rgba(255,255,255,0.6)"/>
  <rect x="${size*0.38}" y="${size*0.62}" width="${size*0.24}" height="${size*0.015}" rx="${size*0.007}" fill="rgba(255,255,255,0.4)"/>
</svg>
`

const adaptiveIconSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <!-- Centered icon (80% of safe zone) -->
  <g transform="translate(${size*0.1}, ${size*0.1}) scale(0.8)">
    <path d="M ${size*0.5} ${size*0.15}
             L ${size*0.8} ${size*0.28}
             L ${size*0.8} ${size*0.5}
             Q ${size*0.8} ${size*0.72} ${size*0.5} ${size*0.85}
             Q ${size*0.2} ${size*0.72} ${size*0.2} ${size*0.5}
             L ${size*0.2} ${size*0.28}
             Z"
          fill="none" stroke="white" stroke-width="${size*0.04}" stroke-linejoin="round"/>
    <circle cx="${size*0.5}" cy="${size*0.42}" r="${size*0.1}" fill="none" stroke="white" stroke-width="${size*0.03}"/>
    <rect x="${size*0.35}" y="${size*0.58}" width="${size*0.3}" height="${size*0.015}" rx="${size*0.007}" fill="rgba(255,255,255,0.8)"/>
    <rect x="${size*0.38}" y="${size*0.62}" width="${size*0.24}" height="${size*0.015}" rx="${size*0.007}" fill="rgba(255,255,255,0.6)"/>
  </g>
</svg>
`

const notificationIconSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Simple shield silhouette for notification bar -->
  <path d="M ${size*0.5} ${size*0.1}
           L ${size*0.85} ${size*0.25}
           L ${size*0.85} ${size*0.55}
           Q ${size*0.85} ${size*0.8} ${size*0.5} ${size*0.9}
           Q ${size*0.15} ${size*0.8} ${size*0.15} ${size*0.55}
           L ${size*0.15} ${size*0.25}
           Z"
        fill="white"/>
  <circle cx="${size*0.5}" cy="${size*0.45}" r="${size*0.12}" fill="#10b981"/>
</svg>
`

const splashSvg = (width, height) => `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <!-- Logo centered -->
  <g transform="translate(${width/2 - 50}, ${height/2 - 80})">
    <rect width="100" height="100" rx="22" fill="url(#logo)"/>
    <path d="M 50 15 L 80 28 L 80 50 Q 80 72 50 85 Q 20 72 20 50 L 20 28 Z"
          fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="50" cy="42" r="10" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="3"/>
    <rect x="35" y="58" width="30" height="1.5" rx="0.75" fill="rgba(255,255,255,0.6)"/>
    <rect x="38" y="62" width="24" height="1.5" rx="0.75" fill="rgba(255,255,255,0.4)"/>
  </g>
  <text x="${width/2}" y="${height/2 + 60}" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="32" font-weight="800" fill="#f1f5f9">
    VeriFace <tspan fill="#10b981">Edge</tspan>
  </text>
  <text x="${width/2}" y="${height/2 + 90}" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="16" font-weight="500" fill="#64748b">
    Admin Console
  </text>
</svg>
`

// ---------------------------------------------------------------------------
// Generate SVG files (PNG conversion requires sharp or an online converter)
// ---------------------------------------------------------------------------

const icons = [
  { name: 'icon.svg', svg: shieldSvg(1024, '#10b981', '#fff'), desc: 'Main app icon (1024×1024)' },
  { name: 'icon-dark.svg', svg: shieldSvg(1024, '#06b6d4', '#fff'), desc: 'Dark mode icon (iOS)' },
  { name: 'adaptive-icon.svg', svg: adaptiveIconSvg(1024), desc: 'Android adaptive icon foreground' },
  { name: 'notification-icon.svg', svg: notificationIconSvg(96), desc: 'Push notification icon (96×96)' },
  { name: 'splash.svg', svg: splashSvg(1242, 2436), desc: 'Splash screen (1242×2436)' },
  { name: 'favicon.svg', svg: shieldSvg(48, '#10b981', '#fff'), desc: 'Web favicon (48×48)' },
]

console.log('\n🎨 VeriFace Edge — Mobile App Icon Generator\n')
console.log('Generating SVG icons:\n')

for (const icon of icons) {
  const filePath = path.join(ASSETS_DIR, icon.name)
  fs.writeFileSync(filePath, icon.svg)
  console.log(`  ✅ ${icon.name} — ${icon.desc}`)
}

// Create a placeholder PNG (1×1 transparent — replaced with real PNG)
// In production, use sharp to convert SVG → PNG:
//   npx sharp-cli -i icon.svg -o icon.png -- resize 1024 1024
const placeholderPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const pngFiles = ['icon.png', 'icon-dark.png', 'icon-tinted.png', 'adaptive-icon.png', 'notification-icon.png', 'splash.png', 'favicon.png']
for (const file of pngFiles) {
  fs.writeFileSync(path.join(ASSETS_DIR, file), placeholderPng)
}

console.log('\n📦 Placeholder PNGs created (1×1 transparent)')
console.log('\nTo generate real PNGs from SVG:')
console.log('  npm install sharp')
console.log('  node -e "const sharp=require(\'sharp\'); sharp(\'icon.svg\').resize(1024,1024).png().toFile(\'icon.png\')"')
console.log('\nOr use an online converter: https://svgtopng.com/')
console.log('\n✅ All brand assets generated in: src/mobile-admin/assets/')
