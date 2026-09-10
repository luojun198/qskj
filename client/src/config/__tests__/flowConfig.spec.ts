import { describe, expect, it } from 'vitest'
import { collectFlowCoveredPaths, groupFlowMap, normalizeNavPath } from '@/config/flowConfig'
import { GL_FLOW_NODES, GL_LINK_COLUMNS, collectGlCoveredPaths } from '@/config/glWorkspace'
import { buildNavApps } from '@/config/navigation'

describe('flowConfig 路径去重', () => {
  it('normalizeNavPath 忽略查询参数顺序与尾斜杠', () => {
    expect(normalizeNavPath('/scm/docs?doc_type=RCV&payment_mode=advance'))
      .toBe(normalizeNavPath('/scm/docs/?payment_mode=advance&doc_type=RCV'))
    expect(normalizeNavPath('/voucher/entry/')).toBe('/voucher/entry')
  })

  it('财务总账使用专用工作页面布局，流程图按 录入→审核→过账→结转→报表 排列', () => {
    expect(groupFlowMap['财务总账'].layout).toBe('gl-workspace')
    expect(GL_FLOW_NODES.map(n => n.title)).toEqual(['凭证录入', '凭证审核', '凭证过账', '月度结转', '报表'])
    expect(GL_FLOW_NODES[1].above?.action).toBe('switch-user')
    expect(GL_FLOW_NODES[0].below?.path).toBe('/voucher/query')


    const covered = collectGlCoveredPaths()
    expect(covered.has('/voucher/entry')).toBe(true)
    expect(covered.has('/voucher/audit')).toBe(true)
    expect(covered.has('/ledger/detail')).toBe(true)
    expect(covered.has('/ledger/vat-detail')).toBe(true)
    expect(covered.has('/ledger/multi-column')).toBe(true)
    expect(covered.has('/security/backup')).toBe(true)
  })

  it('财务总账链接列严格按参考图排列与命名，已无未实现的占位项', () => {
    const names = GL_LINK_COLUMNS.map(c => c.items.map(i => i.title))
    expect(names).toEqual([
      ['总分类账', '银行日记账', '现金日记账'],
      ['汇总余额表', '外币余额表', '辅助项目余额表', '辅助项目外币余额表', '凭证汇总表'],
      ['明细账', '增值税明细账', '多栏账', '辅助项目明细账', '辅助项目多栏明细账'],
      ['库存数量金额表', '辅助项目库存数量金额表', '现金流量试算平衡表'],
    ])
    const placeholders = GL_LINK_COLUMNS.flatMap(c => c.items).filter(i => !i.path).map(i => i.title)
    expect(placeholders).toEqual([])
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
      if (config.layout !== 'flow') continue
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
