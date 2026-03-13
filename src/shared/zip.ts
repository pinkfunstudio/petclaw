/**
 * Minimal ZIP file creator — no dependencies.
 * Supports uncompressed (STORE) files only, which is fine for small text files.
 */

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
}

function writeU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
  buf[offset + 2] = (value >>> 16) & 0xff
  buf[offset + 3] = (value >>> 24) & 0xff
}

interface ZipEntry {
  name: string
  data: Uint8Array
}

export function createZip(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = files.map(f => ({
    name: f.name,
    data: encoder.encode(f.content),
  }))

  const parts: Uint8Array[] = []
  const centralHeaders: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)

    // Local file header (30 + name length)
    const local = new Uint8Array(30 + nameBytes.length)
    writeU32(local, 0, 0x04034b50)    // signature
    writeU16(local, 4, 20)             // version needed
    writeU16(local, 6, 0)              // flags
    writeU16(local, 8, 0)              // compression: STORE
    writeU16(local, 10, 0)             // mod time
    writeU16(local, 12, 0)             // mod date
    writeU32(local, 14, crc)           // crc32
    writeU32(local, 18, entry.data.length) // compressed size
    writeU32(local, 22, entry.data.length) // uncompressed size
    writeU16(local, 26, nameBytes.length)  // name length
    writeU16(local, 28, 0)             // extra length
    local.set(nameBytes, 30)

    // Central directory header (46 + name length)
    const central = new Uint8Array(46 + nameBytes.length)
    writeU32(central, 0, 0x02014b50)   // signature
    writeU16(central, 4, 20)            // version made by
    writeU16(central, 6, 20)            // version needed
    writeU16(central, 8, 0)             // flags
    writeU16(central, 10, 0)            // compression: STORE
    writeU16(central, 12, 0)            // mod time
    writeU16(central, 14, 0)            // mod date
    writeU32(central, 16, crc)          // crc32
    writeU32(central, 20, entry.data.length) // compressed size
    writeU32(central, 24, entry.data.length) // uncompressed size
    writeU16(central, 28, nameBytes.length)  // name length
    writeU16(central, 30, 0)            // extra length
    writeU16(central, 32, 0)            // comment length
    writeU16(central, 34, 0)            // disk start
    writeU16(central, 36, 0)            // internal attributes
    writeU32(central, 38, 0)            // external attributes
    writeU32(central, 42, offset)       // local header offset
    central.set(nameBytes, 46)

    parts.push(local)
    parts.push(entry.data)
    centralHeaders.push(central)
    offset += local.length + entry.data.length
  }

  const centralDirOffset = offset
  let centralDirSize = 0
  for (const ch of centralHeaders) {
    parts.push(ch)
    centralDirSize += ch.length
  }

  // End of central directory (22 bytes)
  const eocd = new Uint8Array(22)
  writeU32(eocd, 0, 0x06054b50)       // signature
  writeU16(eocd, 4, 0)                 // disk number
  writeU16(eocd, 6, 0)                 // central dir disk
  writeU16(eocd, 8, entries.length)    // entries on this disk
  writeU16(eocd, 10, entries.length)   // total entries
  writeU32(eocd, 12, centralDirSize)   // central dir size
  writeU32(eocd, 16, centralDirOffset) // central dir offset
  writeU16(eocd, 20, 0)                // comment length
  parts.push(eocd)

  return new Blob(parts as unknown as BlobPart[], { type: 'application/zip' })
}
