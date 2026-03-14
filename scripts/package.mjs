import { existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { execFileSync } from 'child_process'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const releaseDir = resolve(root, 'release')
const output = resolve(releaseDir, 'petclaw-webstore.zip')

if (!existsSync(dist)) {
  throw new Error('Missing dist/ directory. Run npm run build first.')
}

if (!existsSync(resolve(dist, 'manifest.json'))) {
  throw new Error('Missing dist/manifest.json. Run npm run build first.')
}

mkdirSync(releaseDir, { recursive: true })
rmSync(output, { force: true })

// Package the contents of dist/ at the ZIP root for Chrome Web Store upload.
execFileSync('zip', ['-qr', output, '.'], { cwd: dist, stdio: 'inherit' })

console.log(`Created ${output}`)
