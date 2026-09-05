import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import GroupNav from '../GroupNav.vue'
import { buildNavApps } from '@/config/navigation'

const { route } = vi.hoisted(() => ({
  route: { params: { groupTitle: '' } as Record<string, string> },
}))

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

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

  it('财务总账：凭证录入/审核记账只保留在流程里，下方不重复', () => {
    const wrapper = mountGroupNav('财务总账')
    const flowTitles = wrapper.findAll('.flow-node__title').map(n => n.text())
    expect(flowTitles).toEqual(expect.arrayContaining(['凭证录入', '审核记账']))
    expect(bentoLabels(wrapper)).not.toContain('凭证录入')
    expect(bentoLabels(wrapper)).not.toContain('审核记账')
  })

  it('财务总账右上角主入口为新增凭证，并带 action=add', () => {
    const wrapper = mountGroupNav('财务总账')
    const primary = wrapper.find('.module-btn--primary')
    expect(primary.text()).toContain('新增凭证')
    expect(primary.attributes('href')).toBe('/voucher/entry?action=add')
  })

  it('财务总账辅助操作：长标题完整输出，不在文案层截断', () => {
    const wrapper = mountGroupNav('财务总账', true)
    const auxLabels = wrapper.findAll('.flow-aux .app-tile__label').map(n => n.text())
    expect(auxLabels).toEqual(expect.arrayContaining([
      '辅助项目余额表',
      '辅助项目明细账',
      '现金流量试算平衡表',
    ]))
    const flowTitles = wrapper.findAll('.flow-node__title').map(n => n.text())
    expect(flowTitles).toContain('科目与基础资料')
  })

  it('出纳管理：流程未覆盖的银行对账仍出现在其他功能', () => {
    const wrapper = mountGroupNav('出纳管理')
    expect(wrapper.find('.module-sections__heading').text()).toBe('其他功能')
    const labels = bentoLabels(wrapper)
    expect(labels).toContain('银行勾对')
    expect(labels).toContain('出纳初始化')
    expect(labels).not.toContain('出纳录单')
    expect(labels).not.toContain('账户余额表')
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
