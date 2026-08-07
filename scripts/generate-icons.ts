/**
 * Generate PNG icons from SVG logo.
 * Creates: favicon 16x16, 32x32, 180x180 (apple), 192x192, 512x512 (PWA)
 */

import sharp from 'sharp'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BRAND_DIR = join(process.cwd(), 'public', 'brand')
const SVG_PATH = join(BRAND_DIR, 'logo.svg')

async function generatePngs() {
  const svgBuffer = readFileSync(SVG_PATH)

  const sizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'icon-192x192.png', size: 192 },
    { name: 'icon-512x512.png', size: 512 },
  ]

  for (const { name, size } of sizes) {
    const outPath = join(BRAND_DIR, name)
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath)
    console.log(`Generated: ${outPath} (${size}x${size})`)
  }

  // Generate ICO favicon (just copy 32x32 PNG — browsers accept PNG as favicon)
  writeFileSync(join(BRAND_DIR, 'favicon.ico'), readFileSync(join(BRAND_DIR, 'favicon-32x32.png')))
  console.log('Generated: favicon.ico')
}

generatePngs().catch(console.error)
