import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve('dist')
const oldName = '_commonjsHelpers.js'
const newName = 'commonjs-helpers.js'
const oldPath = path.join(distDir, oldName)
const newPath = path.join(distDir, newName)

if (!fs.existsSync(oldPath)) {
  process.exit(0)
}

fs.renameSync(oldPath, newPath)

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }
    if (!/\.(js|html|map)$/i.test(entry.name)) continue
    const raw = fs.readFileSync(fullPath, 'utf8')
    if (!raw.includes(oldName)) continue
    fs.writeFileSync(fullPath, raw.replaceAll(oldName, newName), 'utf8')
  }
}

walk(distDir)

