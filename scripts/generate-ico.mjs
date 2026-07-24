/**
 * Pack multi-size PNGs into a Vista+ ICO (PNG-compressed entries).
 * No external deps — run: node scripts/generate-ico.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resources = join(root, 'resources')

/** Prefer dedicated sizes; fall back to icon.png when a size is missing. */
const candidates = [
  ['icon-64.png', 64],
  ['icon-128.png', 128],
  ['icon-256.png', 256],
  ['icon.png', 512],
]

function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a PNG')
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const images = []
for (const [name] of candidates) {
  const p = join(resources, name)
  if (!existsSync(p)) continue
  const data = readFileSync(p)
  const { w, h } = pngSize(data)
  images.push({ data, w, h })
}

if (images.length === 0) {
  console.error('No PNG sources found under resources/')
  process.exit(1)
}

// De-dupe by max dimension (keep first of each size)
const bySize = new Map()
for (const img of images) {
  const key = Math.max(img.w, img.h)
  if (!bySize.has(key)) bySize.set(key, img)
}
const unique = [...bySize.values()].sort(
  (a, b) => Math.max(a.w, a.h) - Math.max(b.w, b.h),
)

const count = unique.length
const headerSize = 6
const entrySize = 16
let offset = headerSize + entrySize * count

const header = Buffer.alloc(headerSize)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // ICON
header.writeUInt16LE(count, 4)

const entries = []
for (const img of unique) {
  const entry = Buffer.alloc(entrySize)
  const dim = Math.max(img.w, img.h)
  entry.writeUInt8(dim >= 256 ? 0 : dim, 0)
  entry.writeUInt8(dim >= 256 ? 0 : dim, 1)
  entry.writeUInt8(0, 2)
  entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bit count
  entry.writeUInt32LE(img.data.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += img.data.length
  entries.push(entry)
}

const out = Buffer.concat([header, ...entries, ...unique.map((i) => i.data)])
const outPath = join(resources, 'icon.ico')
writeFileSync(outPath, out)
console.log(
  `Wrote ${outPath} (${unique.map((i) => `${i.w}x${i.h}`).join(', ')})`,
)
