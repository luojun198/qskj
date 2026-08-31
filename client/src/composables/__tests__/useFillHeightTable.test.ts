import { describe, expect, it } from 'vitest'
import {
  measureTableFillHeight,
  measureTableBodyHeight,
  measureAfterSiblingReserve,
  WIDE_TABLE_H_SCROLLBAR_RESERVE,
} from '@/composables/useFillHeightTable'

describe('measureTableFillHeight', () => {
  it('应基于视口与兄弟节点计算可用高度', () => {
    const page = document.createElement('div')
    page.className = 'page'
    page.getBoundingClientRect = () =>
      ({ top: 60, bottom: 960, height: 900, width: 1000, left: 0, right: 1000, x: 0, y: 60, toJSON: () => ({}) }) as DOMRect
    const header = document.createElement('div')
    header.className = 'page-header'
    Object.defineProperty(header, 'offsetHeight', { value: 80, configurable: true })
    header.getBoundingClientRect = () =>
      ({ top: 100, bottom: 180, height: 80, width: 800, left: 0, right: 800, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect

    const container = document.createElement('div')
    container.className = 'table-summary-scroll'
    container.getBoundingClientRect = () =>
      ({ top: 200, bottom: 200, height: 0, width: 800, left: 0, right: 800, x: 0, y: 200, toJSON: () => ({}) }) as DOMRect

    const footer = document.createElement('div')
    footer.className = 'pagination-bar'
    footer.getBoundingClientRect = () =>
      ({ top: 900, bottom: 940, height: 40, width: 800, left: 0, right: 800, x: 0, y: 900, toJSON: () => ({}) }) as DOMRect
    Object.defineProperty(footer, 'offsetHeight', { value: 40, configurable: true })

    const main = document.createElement('main')
    main.className = 'main'
    main.getBoundingClientRect = () =>
      ({ top: 60, bottom: 960, height: 900, width: 1000, left: 0, right: 1000, x: 0, y: 60, toJSON: () => ({}) }) as DOMRect

    page.append(header, container, footer)
    main.append(page)
    document.body.append(main)

    const style = document.createElement('style')
    style.textContent = `
      .pagination-bar { display: block; margin: 0; }
      .page-header { display: block; margin: 0; }
    `
    document.head.append(style)

    const h = measureTableFillHeight(container)
    // page bottom(960) - padding(0) - 200(container top) - 40(footer) - 8(reserve) = 712
    expect(h).toBe(712)

    document.body.innerHTML = ''
    style.remove()
  })

  it('宽表应为横向滚动条预留高度', () => {
    const container = document.createElement('div')
    container.className = 'table-summary-scroll table-summary-scroll--wide'
    container.getBoundingClientRect = () =>
      ({ top: 200, bottom: 912, height: 712, width: 800, left: 0, right: 800, x: 0, y: 200, toJSON: () => ({}) }) as DOMRect

    const page = document.createElement('div')
    page.className = 'page page-ledger'
    page.getBoundingClientRect = () =>
      ({ top: 60, bottom: 960, height: 900, width: 1000, left: 0, right: 1000, x: 0, y: 60, toJSON: () => ({}) }) as DOMRect
    Object.defineProperty(page, 'clientWidth', { value: 1000, configurable: true })

    const table = document.createElement('div')
    table.className = 'el-table'
    Object.defineProperty(table, 'offsetWidth', { value: 2000, configurable: true })
    container.append(table)
    page.append(container)
    document.body.append(page)

    const style = document.createElement('style')
    style.textContent = `.page { padding-bottom: 0; }`
    document.head.append(style)

    const bodyH = measureTableBodyHeight(container)
    expect(bodyH).toBe(measureTableFillHeight(container) - WIDE_TABLE_H_SCROLLBAR_RESERVE)

    document.body.innerHTML = ''
    style.remove()
  })

  it('table-wrap 内 footer/pagination 应计入高度预留', () => {
    const page = document.createElement('div')
    page.className = 'page'
    page.getBoundingClientRect = () =>
      ({ top: 60, bottom: 960, height: 900, width: 1000, left: 0, right: 1000, x: 0, y: 60, toJSON: () => ({}) }) as DOMRect

    const tableWrap = document.createElement('div')
    tableWrap.className = 'table-wrap'
    tableWrap.getBoundingClientRect = () =>
      ({ top: 120, bottom: 900, height: 780, width: 960, left: 0, right: 960, x: 0, y: 120, toJSON: () => ({}) }) as DOMRect

    const container = document.createElement('div')
    container.className = 'table-summary-scroll'
    container.getBoundingClientRect = () =>
      ({ top: 160, bottom: 160, height: 0, width: 960, left: 0, right: 960, x: 0, y: 160, toJSON: () => ({}) }) as DOMRect

    const footer = document.createElement('div')
    footer.className = 'footer-bar'
    footer.getBoundingClientRect = () =>
      ({ top: 820, bottom: 852, height: 32, width: 960, left: 0, right: 960, x: 0, y: 820, toJSON: () => ({}) }) as DOMRect

    const pagination = document.createElement('div')
    pagination.className = 'pagination-bar'
    pagination.getBoundingClientRect = () =>
      ({ top: 852, bottom: 892, height: 40, width: 960, left: 0, right: 960, x: 0, y: 852, toJSON: () => ({}) }) as DOMRect

    tableWrap.append(container, footer, pagination)
    page.append(tableWrap)
    document.body.append(page)

    const style = document.createElement('style')
    style.textContent = `
      .footer-bar, .pagination-bar { display: block; margin: 0; }
      .page { padding-bottom: 0; }
    `
    document.head.append(style)

    const h = measureTableFillHeight(container)
    // wrap bottom(900) - container top(160) - footer(32) - pagination(40) - 8 = 660
    expect(h).toBe(660)
    expect(measureAfterSiblingReserve(container, tableWrap)).toBe(72)

    document.body.innerHTML = ''
    style.remove()
  })
})
