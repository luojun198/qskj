import { describe, it, expect, vi } from 'vitest'

vi.mock('vue-plugin-hiprint/dist/print-lock.css?url', () => ({ default: '' }))
vi.mock('vue-plugin-hiprint/dist/print-lock.css?raw', () => ({ default: '' }))

import { canMergeA4, groupPapersIntoA4Sheets, panelHeightMm } from '../printTemplateHiprint'

function containerWith(n: number) {
  const box = document.createElement('div')
  const tpl = document.createElement('div')
  tpl.className = 'hiprint-printTemplate'
  for (let i = 0; i < n; i++) {
    const paper = document.createElement('div')
    paper.className = 'hiprint-printPaper'
    paper.dataset.no = String(i + 1)
    tpl.appendChild(paper)
  }
  box.appendChild(tpl)
  return box
}

describe('凭证合打拼版', () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
  ])('%i 个纸面拼成 %i 张 A4', (papers, sheets) => {
    const box = containerWith(papers)
    expect(groupPapersIntoA4Sheets(box)).toBe(sheets)
    expect(box.querySelectorAll('.cw-merge-sheet')).toHaveLength(sheets)
    const order = Array.from(box.querySelectorAll<HTMLElement>('.cw-merge-sheet .hiprint-printPaper')).map(
      p => p.dataset.no
    )
    expect(order).toEqual(Array.from({ length: papers }, (_, i) => String(i + 1)))
  })

  it('奇数张时最后一张 A4 只有上半页', () => {
    const box = containerWith(3)
    groupPapersIntoA4Sheets(box)
    const last = box.querySelectorAll('.cw-merge-sheet')[1]
    expect(last.querySelectorAll('.cw-merge-half')).toHaveLength(1)
  })

  it('无纸面时不改动容器', () => {
    const box = document.createElement('div')
    box.innerHTML = '<p>x</p>'
    expect(groupPapersIntoA4Sheets(box)).toBe(0)
    expect(box.innerHTML).toBe('<p>x</p>')
  })

  it('模板纸高不超过半张 A4 才能合打', () => {
    expect(panelHeightMm({ panels: [{ height: 148 }] })).toBe(148)
    expect(canMergeA4({ panels: [{ height: 148 }] })).toBe(true)
    expect(canMergeA4({ panels: [{ height: 297 }] })).toBe(false)
    expect(canMergeA4({ panels: [] })).toBe(true)
  })
})
