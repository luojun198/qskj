import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import GroupNav from '../GroupNav.vue'
import { buildNavApps } from '@/config/navigation'

const { route, routerPush, confirmMock } = vi.hoisted(() => ({
  route: { params: { groupTitle: '' } as Record<string, string> },
  routerPush: vi.fn(),
  confirmMock: vi.fn(() => Promise.resolve('confirm')),
}))

vi.mock('element-plus', async importOriginal => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessageBox: { ...actual.ElMessageBox, confirm: confirmMock } }
})

vi.mock('vue-router', () => ({
  useRoute: () => route,
  // GlWorkspace 在「模块未启用」链接上要跳账套参数页
  useRouter: () => ({ push: routerPush }),
}))

// GlWorkspace 读系统参数区分「模块未启用」与「无权限」，需要活动的 pinia
beforeEach(() => {
  setActivePinia(createPinia())
  routerPush.mockClear()
  confirmMock.mockClear()
})

function mountGroupNav(groupTitle: string, enableCashFlow = false) {
  route.params.groupTitle = groupTitle
  const navApps = ref(buildNavApps(['*'], enableCashFlow, [], ['gl', 'cashier', 'scm', 'asset', 'production', 'outsource'] as any))
  return mount(GroupNav, {
    global: {
      provide: { layoutNavApps: navApps },
      stubs: {
        'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' },
        'el-icon': { template: '<i><slot /></i>' },
      },
      mocks: { $router: { push: vi.fn() } },
    },
  })
}

function bentoLabels(wrapper: ReturnType<typeof mountGroupNav>) {
  return wrapper.findAll('.module-section .app-tile__label').map(n => n.text())
}

describe('模块首页（星辰风）', () => {
  it('分组布局：头部卡 + 每个分组一张白卡的图标宫格，不再有 Hero', () => {
    const wrapper = mountGroupNav('库存管理')

    expect(wrapper.find('.hero-section').exists()).toBe(false)
    expect(wrapper.find('.module-head__title').text()).toBe('库存管理')
    expect(wrapper.find('.module-btn--primary').exists()).toBe(true)
    expect(wrapper.find('.flow-card').exists()).toBe(false)

    const sections = wrapper.findAll('.module-section')
    expect(sections.length).toBeGreaterThan(1)
    expect(sections[0].find('.wb-card__title').text()).toBeTruthy()
    expect(sections[0].findAll('.app-tile').length).toBeGreaterThan(0)
  })

  it('流程布局：核心业务流程卡；流程已覆盖的入口不再出现在下方宫格', () => {
    const wrapper = mountGroupNav('销售管理')

    expect(wrapper.find('.flow-card').exists()).toBe(true)
    expect(wrapper.findAll('.flow-node').length).toBeGreaterThan(2)
    expect(wrapper.findAll('.flow-aux .app-tile').length).toBeGreaterThan(0)
    expect(wrapper.find('.flow-aux .app-tile .el-icon').exists()).toBe(false)
    expect(wrapper.find('.flow-aux .app-tile__icon').exists()).toBe(true)
    // 销售菜单全部已在流程/辅助中，不再渲染「其他功能」
    expect(wrapper.find('.module-sections__heading').exists()).toBe(false)
    expect(bentoLabels(wrapper)).not.toContain('销售报价')
    expect(bentoLabels(wrapper)).not.toContain('销售汇总表')
  })

  it('财务总账：专用工作页面，流程图主干为 录入→审核→过账→结转→报表，不渲染通用流程卡/宫格', () => {
    const wrapper = mountGroupNav('财务总账')
    expect(wrapper.find('.gl-workspace').exists()).toBe(true)
    expect(wrapper.find('.flow-card').exists()).toBe(false)
    expect(wrapper.find('.module-section').exists()).toBe(false)

    const mainTitles = wrapper.findAll('.gl-cell--main .gl-tile__title').map(n => n.text())
    expect(mainTitles).toEqual(['凭证录入', '凭证审核', '凭证过账', '月度结转', '报表'])
    // 主干之间 4 个横向箭头
    expect(wrapper.findAll('.gl-arrow--right').length).toBe(4)
  })

  it('财务总账：审核/过账进入同一页面但带不同状态预设', () => {
    const wrapper = mountGroupNav('财务总账')
    const hrefs = wrapper.findAll('.gl-cell--main .gl-tile').map(n => n.attributes('href'))
    expect(hrefs).toEqual([
      '/voucher/entry',
      '/voucher/audit?status=draft',
      '/voucher/audit?status=audited',
      '/voucher/auto-transfer',
      '/ledger/standard-report',
    ])
  })

  it('财务总账：下挂节点为凭证查询/结账/数据备份（跨应用引用系统管理），无 Layout 注入时切换用户不显示', () => {
    const wrapper = mountGroupNav('财务总账')
    const below = wrapper.findAll('.gl-cell--below .gl-tile__title').map(n => n.text())
    expect(below).toEqual(['凭证查询', '结账', '数据备份'])
    expect(wrapper.find('.gl-cell--above').exists()).toBe(false)
  })

  it('财务总账：切换用户节点调用 Layout 注入的弹窗', async () => {
    route.params.groupTitle = '财务总账'
    const open = vi.fn()
    const navApps = ref(buildNavApps(['*'], false, [], ['gl'] as any))
    const wrapper = mount(GroupNav, {
      global: {
        provide: { layoutNavApps: navApps, layoutOpenSwitchOperator: open },
        stubs: {
          'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' },
          'el-icon': { template: '<i><slot /></i>' },
        },
        mocks: { $router: { push: vi.fn() } },
      },
    })
    const above = wrapper.find('.gl-cell--above button.gl-tile')
    expect(above.text()).toContain('切换用户')
    await above.trigger('click')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('财务总账：底部链接列严格按参考图排列与命名，链接列已全部可点', () => {
    const wrapper = mountGroupNav('财务总账', true)
    const columns = wrapper.findAll('.gl-links__col')
    expect(columns.length).toBe(4)
    const colTexts = columns.map(c => c.findAll('.gl-link').map(n => n.text()))
    expect(colTexts).toEqual([
      ['总分类账', '银行日记账', '现金日记账'],
      ['汇总余额表', '外币余额表', '辅助项目余额表', '辅助项目外币余额表', '凭证汇总表'],
      ['明细账', '外币明细账', '增值税明细账', '多栏账', '辅助项目明细账', '辅助项目多栏明细账'],
      ['库存数量金额表', '辅助项目库存数量金额表', '现金流量试算平衡表'],
    ])
    // 未实现的功能占位：不是可点链接
    const placeholders = wrapper.findAll('.gl-link--placeholder').map(n => n.text())
    expect(placeholders).not.toContain('合同账款查询')
    expect(placeholders).not.toContain('库存数量金额表')
    const qtyLink = wrapper.findAll('a.gl-link').find(n => n.text() === '库存数量金额表')
    expect(qtyLink?.attributes('href')).toBe('/ledger/quantity-balance')
    const vatLink = wrapper.findAll('a.gl-link').find(n => n.text() === '增值税明细账')
    expect(vatLink?.attributes('href')).toBe('/ledger/vat-detail')
    const multiColumnLink = wrapper.findAll('a.gl-link').find(n => n.text() === '多栏账')
    expect(multiColumnLink?.attributes('href')).toBe('/ledger/multi-column')
    expect(placeholders).not.toContain('辅助项目多栏明细账')
    const auxMultiColumnLink = wrapper.findAll('a.gl-link').find(n => n.text() === '辅助项目多栏明细账')
    expect(auxMultiColumnLink?.attributes('href')).toBe('/ledger/aux-multi-column')
    const bank = wrapper.findAll('a.gl-link').find(n => n.text() === '银行日记账')
    expect(bank?.attributes('href')).toBe('/ledger/cash-journal?scope=bank')
    // 流程图里已有的凭证入口不在链接列重复
    expect(colTexts.flat()).not.toContain('凭证录入')
  })

  it('财务总账：未启用外币核算的入口显示为「模块未启用」，点击引导去账套参数而非提示功能没做', async () => {
    const wrapper = mountGroupNav('财务总账', true)

    const moduleOff = wrapper.findAll('.gl-link--module-off').map(n => n.text())
    expect(moduleOff).toContain('外币余额表')
    expect(moduleOff).toContain('辅助项目外币余额表')
    // 关键：不再落到「功能规划中」那条占位分支
    const placeholders = wrapper.findAll('.gl-link--placeholder').map(n => n.text())
    expect(placeholders).not.toContain('外币余额表')

    const link = wrapper.findAll('.gl-link--module-off').find(n => n.text() === '外币余额表')!
    expect(link.attributes('title')).toBe('账套未启用外币核算')
    await link.trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith('/system/param')
  })

  it('财务总账：左侧面板的「期末调汇」「外币类型」同样是「模块未启用」而非「功能规划中」', async () => {
    const wrapper = mountGroupNav('财务总账', true)

    const moduleOff = wrapper.findAll('.gl-sidebar-btn--module-off').map(n => n.text())
    expect(moduleOff).toEqual(expect.arrayContaining(['期末调汇', '外币类型']))
    const placeholders = wrapper.findAll('.gl-sidebar-btn--placeholder').map(n => n.text())
    expect(placeholders).not.toContain('期末调汇')
    expect(placeholders).not.toContain('外币类型')

    // action 项（无路由）仍要渲染成按钮，不能被 status 判定吞掉
    const buttons = wrapper.findAll('button.gl-sidebar-btn').map(n => n.text())
    expect(buttons).toContain('修改密码')

    const btn = wrapper.findAll('.gl-sidebar-btn--module-off').find(n => n.text() === '期末调汇')!
    expect(btn.attributes('title')).toBe('账套未启用外币核算')
    await btn.trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalled()
    expect(routerPush).toHaveBeenCalledWith('/system/param')
  })


  it('模块头部压缩为单行紧凑模式，右上角无重复冗余按钮', () => {
    const wrapper = mountGroupNav('财务总账')
    expect(wrapper.find('.module-head').exists()).toBe(true)
    expect(wrapper.find('.module-head__actions').exists()).toBe(false)
  })


  it('出纳管理：专用工作页面，主干为 单据录入→凭证生成→对账→结账，结账上方挂反结账并指向出纳结账页', () => {
    const wrapper = mountGroupNav('出纳管理')
    expect(wrapper.find('.cashier-workspace').exists()).toBe(true)
    expect(wrapper.find('.module-section').exists()).toBe(false)
    const mainTitles = wrapper.findAll('.cashier-cell--main .gl-tile__title').map(n => n.text())
    expect(mainTitles).toEqual(['单据录入', '凭证生成', '对账', '结账'])
    const above = wrapper.find('.cashier-cell--above a')
    expect(above.exists()).toBe(true)
    expect(above.text()).toContain('反结账')
    expect(above.attributes('href')).toBe('/cashier/period-close')
  })

  it('旧模块名地址仍能打开对应首页', () => {
    const wrapper = mountGroupNav('财务会计')
    expect(wrapper.find('.module-head__title').text()).toBe('财务总账')
  })

  it('未知模块显示空状态', () => {
    const wrapper = mountGroupNav('不存在的模块')
    expect(wrapper.find('.empty-state-card').exists()).toBe(true)
  })
})
