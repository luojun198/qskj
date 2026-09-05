import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../workbench.css'),
  'utf8',
)

function cssBlock(startMarker: string, endMarker: string) {
  const start = css.indexOf(startMarker)
  const end = css.indexOf(endMarker, start + startMarker.length)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end)
}

describe('工作台磁贴标题排版', () => {
  it('app-tile 标题与副标：换行居中，不再单行省略', () => {
    const label = cssBlock('.app-tile__label {', '.app-tile__sub {')
    expect(label).toMatch(/text-align:\s*center/)
    expect(label).toMatch(/white-space:\s*normal/)
    expect(label).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(label).not.toMatch(/white-space:\s*nowrap/)

    const sub = cssBlock('.app-tile__sub {', '.app-grid--roomy {')
    expect(sub).toMatch(/text-align:\s*center/)
    expect(sub).toMatch(/white-space:\s*normal/)
    expect(sub).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(sub).not.toMatch(/white-space:\s*nowrap/)
  })
})
