import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import zlib from 'zlib'
import iconv from 'iconv-lite'
import { join } from 'path'

const acdPath = process.argv[2]
const outDir = process.argv[3] || 'scratch/acd-dump'
mkdirSync(outDir, { recursive: true })
const buffer = readFileSync(acdPath)
const texts = new Map()
let pos = 0
while (pos < buffer.length) {
  let i = pos
  const nameBytes = []
  while (i < pos + 32 && i < buffer.length && buffer[i] !== 0) nameBytes.push(buffer[i++])
  if (nameBytes.length < 3 || i >= buffer.length) break
  const fileName = iconv.decode(Buffer.from(nameBytes), 'gbk').trim()
  const nullPos = buffer.indexOf(0, pos)
  let fieldEnd = nullPos + 1
  while (fieldEnd < buffer.length && buffer[fieldEnd] === 0x20) fieldEnd++
  if (fieldEnd + 12 > buffer.length) break
  const uncompressedSize = buffer.readUInt32LE(fieldEnd + 4)
  const compressedSize = buffer.readUInt32LE(fieldEnd + 8)
  const zlibStart = fieldEnd + 12
  if (compressedSize === 0 || uncompressedSize === 0) {
    texts.set(fileName, '')
    pos = zlibStart + compressedSize
    continue
  }
  try {
    const dec = zlib.inflateSync(buffer.subarray(zlibStart, zlibStart + compressedSize))
    texts.set(fileName, /\.vts$/i.test(fileName) ? `<binary ${dec.length}>` : iconv.decode(dec, 'gbk'))
  } catch (e) {
    texts.set(fileName, `<ERR ${e.message}>`)
  }
  pos = zlibStart + compressedSize
}
const summary = []
for (const [name, content] of texts) {
  const lines = content ? content.split(/\r?\n/).filter(Boolean).length : 0
  summary.push(`${name}\t${content.length}\t${lines}`)
  const safe = name.replace(/[^\w.\u4e00-\u9fa5-]/g, '_')
  writeFileSync(join(outDir, safe + '.dump.txt'), content, 'utf8')
}
writeFileSync(join(outDir, '_summary.txt'), summary.join('\n'), 'utf8')
console.log(summary.join('\n'))
