/**
 * Post-build step for Firefox.
 * vite-plugin-web-extension writes HTML/JS to dist/ and only manifest to dist-firefox/.
 * This script merges them: copies dist/ → dist-firefox/, then restores the Firefox manifest.
 * Also creates dist-firefox.zip for upload to AMO.
 */
import { cpSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const src = resolve(root, 'dist')
const dst = resolve(root, 'dist-firefox')

// Save the Firefox manifest that the plugin wrote to dist-firefox/
const ffManifest = readFileSync(resolve(dst, 'manifest.json'), 'utf8')

// Copy everything from dist/ into dist-firefox/
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })

// Remove Chrome-only files that don't belong in the Firefox build
const EXCLUDE = ['dist.zip', 'offscreen.html', 'offscreen.js']
for (const name of EXCLUDE) {
  const target = resolve(dst, name)
  if (existsSync(target)) rmSync(target)
}

// Restore the Firefox manifest
writeFileSync(resolve(dst, 'manifest.json'), ffManifest, 'utf8')

// Create dist-firefox.zip for AMO upload
const zipPath = resolve(root, 'dist-firefox.zip')
if (existsSync(zipPath)) rmSync(zipPath)
execSync(
  `powershell -Command "Compress-Archive -Path '${dst}\\*' -DestinationPath '${zipPath}' -Force"`,
  { stdio: 'inherit' },
)

console.log('[build-firefox] merged dist/ → dist-firefox/ with Firefox manifest')
console.log(`[build-firefox] created dist-firefox.zip`)
