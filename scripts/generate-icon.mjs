// Génère build/icon.png (1024×1024) : hexagone blanc sur carré arrondi en dégradé.
// Sans dépendance : rastérisation maison + encodeur PNG (zlib natif).
// electron-builder en dérive automatiquement les .ico / .icns.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZE = 1024
const SS = 4 // sur-échantillonnage pour l'anticrénelage

const C1 = [165, 151, 255] // violet clair (haut-gauche)
const C2 = [91, 140, 255] // bleu (bas-droite)

const margin = SIZE * 0.06
const radius = SIZE * 0.22
const inRoundedSquare = (x, y) => {
  const min = margin
  const max = SIZE - margin
  if (x < min || x > max || y < min || y > max) return false
  const cx = Math.min(Math.max(x, min + radius), max - radius)
  const cy = Math.min(Math.max(y, min + radius), max - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

// Hexagone (pointe en haut) : distance au contour pour tracer un trait épais
const R = SIZE * 0.27
const STROKE = SIZE * 0.065
const verts = Array.from({ length: 6 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 3
  return [SIZE / 2 + R * Math.cos(a), SIZE / 2 + R * Math.sin(a)]
})
const distSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
const onHexStroke = (x, y) => {
  let d = Infinity
  for (let i = 0; i < 6; i++) d = Math.min(d, distSeg(x, y, verts[i], verts[(i + 1) % 6]))
  return d <= STROKE / 2
}
// Point central (cœur de la « forge »)
const onDot = (x, y) => Math.hypot(x - SIZE / 2, y - SIZE / 2) <= SIZE * 0.06

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filtre PNG : aucun
  for (let x = 0; x < SIZE; x++) {
    let bg = 0
    let fg = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS
        const py = y + (sy + 0.5) / SS
        if (!inRoundedSquare(px, py)) continue
        bg++
        if (onHexStroke(px, py) || onDot(px, py)) fg++
      }
    }
    const n = SS * SS
    const alpha = bg / n
    const white = bg ? fg / bg : 0
    const t = (x + y) / (2 * SIZE)
    const grad = C1.map((c, i) => c + (C2[i] - c) * t)
    const rgb = grad.map((c) => Math.round(c + (255 - c) * white))
    const o = y * (SIZE * 4 + 1) + 1 + x * 4
    raw[o] = rgb[0]
    raw[o + 1] = rgb[1]
    raw[o + 2] = rgb[2]
    raw[o + 3] = Math.round(alpha * 255)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // profondeur
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.resolve('build/icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log(`Icône générée : ${out} (${(png.length / 1024).toFixed(0)} Ko)`)
