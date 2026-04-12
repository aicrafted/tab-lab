/**
 * Generates TabLab Chrome Store icons from SVG using sharp.
 * Outputs: 16, 32, 48, 128 px (manifest) + 512 px (store listing source).
 */

import sharp from 'sharp'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/icons')

// ── SVG icon design ─────────────────────────────────────────────────────────
// Concept: stacked browser tabs on indigo/violet gradient — clean, scalable.
// Works at 16 px (reads as coloured square with white accent) and 512 px.

const SVG = /* xml */ `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#4338CA"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="shine" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- ── Background ── -->
  <rect width="512" height="512" rx="108" fill="url(#bg)"/>
  <!-- subtle top-shine -->
  <rect width="512" height="256" rx="108" fill="url(#shine)"/>

  <!-- ── Stacked tab cards (back → front) ── -->

  <!-- Card 3 — back, top-right -->
  <rect x="196" y="108" width="228" height="168" rx="28"
        fill="#FFFFFF" fill-opacity="0.20"/>

  <!-- Card 2 — middle -->
  <rect x="148" y="156" width="228" height="168" rx="28"
        fill="#FFFFFF" fill-opacity="0.38"/>

  <!-- Card 1 — front, bottom-left -->
  <rect x="88"  y="204" width="228" height="168" rx="28"
        fill="#FFFFFF"/>

  <!-- Content lines on the front card -->
  <rect x="120" y="244" width="108" height="14" rx="7"  fill="#6D28D9"/>
  <rect x="120" y="272" width="80"  height="10" rx="5"  fill="#7C3AED" fill-opacity="0.40"/>
  <rect x="120" y="294" width="96"  height="10" rx="5"  fill="#7C3AED" fill-opacity="0.40"/>
  <rect x="120" y="316" width="68"  height="10" rx="5"  fill="#7C3AED" fill-opacity="0.40"/>

  <!-- AI accent dot — top-right corner -->
  <circle cx="366" cy="148" r="46" fill="#F59E0B"/>
  <!-- sparkle cross inside dot -->
  <line x1="366" y1="126" x2="366" y2="170" stroke="#FFFBEB" stroke-width="10" stroke-linecap="round"/>
  <line x1="344" y1="148" x2="388" y2="148" stroke="#FFFBEB" stroke-width="10" stroke-linecap="round"/>
  <line x1="350" y1="132" x2="382" y2="164" stroke="#FFFBEB" stroke-width="6"  stroke-linecap="round" stroke-opacity="0.6"/>
  <line x1="382" y1="132" x2="350" y2="164" stroke="#FFFBEB" stroke-width="6"  stroke-linecap="round" stroke-opacity="0.6"/>
</svg>
`

// ── Generate sizes ───────────────────────────────────────────────────────────

const SIZES = [16, 32, 48, 128, 512]

const buf = Buffer.from(SVG)

for (const size of SIZES) {
  const out = `${OUT}/icon-${size}.png`
  await sharp(buf)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`✓ ${out}`)
}

// Also write the raw SVG for reference / future editing
writeFileSync(`${OUT}/icon.svg`, SVG.trim())
console.log(`✓ ${OUT}/icon.svg`)

console.log('\nDone. Update manifest.json icon paths to icon-{16,32,48,128}.png')
