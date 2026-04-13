/**
 * Generates TabLab Chrome Store icons from SVG using sharp.
 * Outputs: 16, 32, 48, 128 px (manifest) + 512 px (store listing source).
 * Source: public/icons/icon.svg
 */

import sharp from 'sharp'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/icons')
const SVG_PATH = resolve(OUT, 'icon.svg')

const buf = readFileSync(SVG_PATH)

// ── Generate sizes ───────────────────────────────────────────────────────────

const SIZES = [16, 32, 48, 128, 512]

for (const size of SIZES) {
  const out = `${OUT}/icon-${size}.png`
  await sharp(buf)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`✓ ${out}`)
}

console.log('\nDone. Update manifest.json icon paths to icon-{16,32,48,128}.png')
