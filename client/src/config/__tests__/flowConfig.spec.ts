import { describe, expect, it } from 'vitest'
import { collectFlowCoveredPaths, groupFlowMap, normalizeNavPath } from '@/config/flowConfig'
import { buildNavApps } from '@/config/navigation'

describe('flowConfig 路径去重', () => {
  it('normalizeNavPath 忽略查询参数顺序与尾斜杠', () => {
    expect(normalizeNavPath('/scm/docs?doc_type=RCV&payment_mode=advance'))
      .toBe(normalizeNavPath('/scm/docs/?payment_mode=advance&doc_type=RCV'))
    expect(normalizeNavPath('/voucher/entry/')).toBe('/voucher/entry')
  })

  it('财务会计流程覆盖凭证录入/审核记账及其分支', () => {
    const covered = collectFlowCoveredPaths(groupFlowMap['财务总账'])
    expect(covered.has('/voucher/entry')).toBe(true)
    expect(covered.has('/voucher/audit')).toBe(true)
    expect(covered.has('/ledger/detail')).toBe(true)
    expect(covered.has('/base/voucher-type')).toBe(true)
  })

  it('预收款与普通收款路径不相等，不会误伤', () => {
    const covered = collectFlowCoveredPaths(groupFlowMap['应收应付'])
    expect(covered.has('/scm/docs?doc_type=RCV')).toBe(true)
    expect(covered.has('/scm/docs?doc_type=RCV&payment_mode=advance')).toBe(true)
    expect(covered.has(normalizeNavPath('/scm/docs?payment_mode=advance&doc_type=RCV'))).toBe(true)
  })

  it('每个流程模块：菜单项若已在流程中出现，应能被 collect 命中', () => {
    const apps = buildNavApps(['*'], false, [], ['gl', 'cashier', 'scm', 'asset', 'production', 'outsource'] as any)
    for (const [title, config] of Object.entries(groupFlowMap)) {
      const app = apps.find(a => a.title === title)
      if (!app) continue
      const covered = collectFlowCoveredPaths(config)
      const leftovers = app.sections.flatMap(s => s.items).filter(i => !covered.has(normalizeNavPath(i.path)))
      // 出纳管理故意留下银行对账/出纳初始化；其余流程模块菜单应被流程覆盖
      if (title === '出纳管理') {
        expect(leftovers.map(i => i.title)).toEqual(expect.arrayContaining(['银行勾对', '出纳初始化']))
        expect(leftovers.map(i => i.title)).not.toContain('出纳录单')
      } else {
        expect(leftovers, `${title} 仍有未覆盖项：${leftovers.map(i => i.title).join('、')}`).toEqual([])
      }
    }
  })
})
