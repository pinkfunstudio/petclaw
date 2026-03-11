import * as esbuild from 'esbuild'
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { deflateSync } from 'zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, 'src')
const dist = resolve(root, 'dist')

const isWatch = process.argv.includes('--watch')

if (!existsSync(dist)) mkdirSync(dist, { recursive: true })

// Copy static files
copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'))
copyFileSync(resolve(src, 'popup/popup.html'), resolve(dist, 'popup.html'))

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'chrome120',
  logLevel: 'info',
}

const configs = [
  {
    ...shared,
    entryPoints: [resolve(src, 'content/index.ts')],
    outfile: resolve(dist, 'content.js'),
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: [resolve(src, 'content/style.css')],
    outfile: resolve(dist, 'content.css'),
  },
  {
    ...shared,
    entryPoints: [resolve(src, 'background/index.ts')],
    outfile: resolve(dist, 'background.js'),
    format: 'esm',
  },
  {
    ...shared,
    entryPoints: [resolve(src, 'popup/index.ts')],
    outfile: resolve(dist, 'popup.js'),
    format: 'iife',
  },
  {
    ...shared,
    entryPoints: [resolve(src, 'popup/style.css')],
    outfile: resolve(dist, 'popup.css'),
  },
]

// ── Generate icons ──────────────────────────────────────
generateIcons()

if (isWatch) {
  const contexts = await Promise.all(configs.map(c => esbuild.context(c)))
  await Promise.all(contexts.map(c => c.watch()))
  console.log('Watching for changes...')
} else {
  await Promise.all(configs.map(c => esbuild.build(c)))
  console.log('Build complete.')
}

// ── Icon generator ──────────────────────────────────────

function generateIcons() {
  const R = [220,60,60,255], D = [160,30,30,255], W = [255,255,255,255]
  const B = [0,0,0,255], O = [255,120,60,255], _ = [0,0,0,0]
  const px = [
    [_,_,_,D,_,_,_,_,_,_,_,_,D,_,_,_],
    [_,_,D,_,_,_,_,_,_,_,_,_,_,D,_,_],
    [_,_,_,_,_,_,D,D,D,D,_,_,_,_,_,_],
    [_,_,_,_,_,D,R,R,R,R,D,_,_,_,_,_],
    [_,_,D,D,D,R,R,R,R,R,R,D,D,D,_,_],
    [_,D,R,R,D,R,W,B,R,W,B,D,R,R,D,_],
    [_,D,R,D,_,R,R,R,R,R,R,_,D,R,D,_],
    [_,_,D,_,_,D,R,R,R,R,D,_,_,D,_,_],
    [_,_,_,_,_,_,R,O,O,R,_,_,_,_,_,_],
    [_,_,_,_,_,D,R,R,R,R,D,_,_,_,_,_],
    [_,_,_,_,D,_,R,R,R,R,_,D,_,_,_,_],
    [_,_,_,_,_,D,R,R,R,R,D,_,_,_,_,_],
    [_,_,_,_,_,_,D,R,R,D,_,_,_,_,_,_],
    [_,_,_,_,_,_,D,R,R,D,_,_,_,_,_,_],
    [_,_,_,_,_,D,D,_,_,D,D,_,_,_,_,_],
    [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  ]
  for (const size of [48, 128]) {
    const scale = size / 16
    const raw = Buffer.alloc((size * 4 + 1) * size)
    for (let y = 0; y < size; y++) {
      raw[y * (size * 4 + 1)] = 0
      for (let x = 0; x < size; x++) {
        const c = px[Math.floor(y / scale)]?.[Math.floor(x / scale)] || _
        const i = y * (size * 4 + 1) + 1 + x * 4
        raw[i] = c[0]; raw[i+1] = c[1]; raw[i+2] = c[2]; raw[i+3] = c[3]
      }
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
    const sig = Buffer.from([137,80,78,71,13,10,26,10])
    const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
    writeFileSync(resolve(dist, `icon${size}.png`), png)
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type), d = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(d))
  return Buffer.concat([len, t, data, crc])
}

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0) }
  return (c ^ 0xFFFFFFFF) >>> 0
}
