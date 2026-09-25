import { describe, expect, it } from 'vitest'
import { fetchAllPages, FetchAllPagesAborted } from '../ledgerFetchAll'

/** FIX-158：全量分页拉取 */
describe('fetchAllPages', () => {
  const make = (totalRows: number, reportTotal: boolean) => (page: number, pageSize: number) => {
    const start = (page - 1) * pageSize
    const data = Array.from({ length: Math.max(0, Math.min(pageSize, totalRows - start)) }, (_, i) => start + i)
    return Promise.resolve({ data, total: reportTotal ? totalRows : undefined, initBalance: 99 })
  }

  it('按页拉完全部行，首页响应保留期初等元数据', async () => {
    const r = await fetchAllPages<number, any>(make(25, true), { pageSize: 10 })
    expect(r.rows).toHaveLength(25)
    expect(r.total).toBe(25)
    expect(r.first.initBalance).toBe(99)
  })

  it('服务端不返回 total 时按「本页不足一页」判尾，不会只导第一页', async () => {
    const r = await fetchAllPages<number, any>(make(25, false), { pageSize: 10 })
    expect(r.rows).toHaveLength(25)
    expect(r.total).toBe(25)
  })

  it('刚好整页时多拉一页空页后结束', async () => {
    let calls = 0
    const r = await fetchAllPages<number, any>((p, s) => { calls++; return make(20, false)(p, s) }, { pageSize: 10 })
    expect(r.rows).toHaveLength(20)
    expect(calls).toBe(3)
  })
  // FIX-251：十万级保护
  it('total 超过 largeTotal.threshold 时先确认，拒绝则抛 FetchAllPagesAborted 且不再翻页', async () => {
    let calls = 0
    const asked: number[] = []
    await expect(
      fetchAllPages<number, any>((p, s) => { calls++; return make(50, true)(p, s) }, {
        pageSize: 10,
        largeTotal: { threshold: 30, confirm: async t => { asked.push(t); return false } },
      })
    ).rejects.toBeInstanceOf(FetchAllPagesAborted)
    expect(asked).toEqual([50])
    expect(calls).toBe(1)
  })

  it('确认继续时正常拉完；未超阈值不询问', async () => {
    let asked = 0
    const r = await fetchAllPages<number, any>(make(50, true), {
      pageSize: 10,
      largeTotal: { threshold: 30, confirm: async () => { asked++; return true } },
    })
    expect(r.rows).toHaveLength(50)
    expect(asked).toBe(1)
    await fetchAllPages<number, any>(make(20, true), {
      pageSize: 10,
      largeTotal: { threshold: 30, confirm: async () => { asked++; return true } },
    })
    expect(asked).toBe(1)
  })

  it('超过 maxRows 硬上限直接报错（有 total 时首页即拦截，无 total 时累计拦截）', async () => {
    await expect(fetchAllPages<number, any>(make(50, true), { pageSize: 10, maxRows: 40 })).rejects.toThrow('超过上限')
    await expect(fetchAllPages<number, any>(make(50, false), { pageSize: 10, maxRows: 40 })).rejects.toThrow('超过上限')
  })
})
