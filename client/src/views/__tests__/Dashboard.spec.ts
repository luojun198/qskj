import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import Dashboard from '../Dashboard.vue'
import { buildNavApps } from '@/config/navigation'
import { useUserStore } from '@/stores/user'
import { useLicenseStore } from '@/stores/license'

const { push, requestGet } = vi.hoisted(() => ({
  push: vi.fn(),
  requestGet: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/api/request', () => ({
  default: { get: requestGet },
}))

const overview = {
  data: {
    stats: { currentYear: 2026, currentPeriod: 9, voucherCount: 12, unpostedVoucherCount: 3, cashBalance: 1000 },
    recentVouchers: [{ id: 'v1', voucherDate: '2026-09-01', voucherNo: '记-001', abstract: '测试', status: 'draft', totalAmount: 100 }],
    trend: [],
    insights: { riskItems: [], cashStructure: [], activityTop: [] },
  },
}
const todos = {
  data: {
    currentYear: 2026,
    currentPeriod: 9,
    todos: [
      { key: 'draft', title: '待审核凭证', count: 3, level: 'warning', actionPath: '/voucher/audit', module: 'gl' },
      { key: 'stock', title: '库存低于安全库存', count: 0, level: 'danger', actionPath: '/scm/report/stock-alert', module: 'scm' },
    ],
    cashier: { accountCount: 2, totalBalance: 500, unreconciledCount: 1 },
    asset: null,
    scm: null,
  },
}

class ObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
}

/** happy-dom 下 localStorage/sessionStorage 在部分 Node 版本里不可用，按其它 store 测试的做法打桩 */
function stubStorage(name: 'localStorage' | 'sessionStorage') {
  const store: Record<string, string> = {}
  vi.stubGlobal(name, {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
  })
}

describe('工作台（星辰风）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubStorage('localStorage')
    stubStorage('sessionStorage')
    setActivePinia(createPinia())
    vi.stubGlobal('IntersectionObserver', ObserverStub)
    requestGet.mockImplementation((url: string) => Promise.resolve(url === '/dashboard/todos' ? todos : overview))

    const userStore = useUserStore()
    userStore.token = 'token'
    // 页面在 keep-alive 的 onActivated 或账套切换时拉数据；测试里靠挂载后切换账套触发
    userStore.accountSetId = ''
    userStore.accountSetName = '测试账套'
    userStore.permissions = ['*']
    userStore.userInfo = { username: 'admin', nickname: '管理员' } as any
    useLicenseStore().apply({
      activated: true,
      expired: false,
      expiresAt: null,
      daysRemaining: 365,
      machineId: 'm',
      machineMismatch: false,
      modules: ['gl', 'cashier', 'scm'],
      maxConcurrent: 0,
      onlineCount: 0,
    })
  })

  async function mountDashboard() {
    const navApps = ref(buildNavApps(['*'], false, [], ['gl', 'cashier', 'scm'] as any))
    const wrapper = mount(Dashboard, {
      global: {
        provide: { layoutNavApps: navApps },
        stubs: {
          'router-link': { template: '<a><slot /></a>' },
          'el-icon': { template: '<i><slot /></i>' },
          'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
          'el-checkbox-group': { template: '<div><slot /></div>' },
          'el-checkbox': { template: '<label><slot /></label>' },
          'el-button': { template: '<button><slot /></button>' },
          'el-radio-group': { template: '<div><slot /></div>' },
          'el-radio-button': { template: '<button><slot /></button>' },
        },
      },
    })
    useUserStore().accountSetId = 'as-1'
    await flushPromises()
    return wrapper
  }

  it('渲染问候条、常用功能宫格、待办列表与经营数据页签', async () => {
    const wrapper = await mountDashboard()

    expect(wrapper.find('.wb-greet__title').text()).toContain('管理员')
    expect(wrapper.find('.wb-chip__value').text()).toBe('测试账套')

    const quick = wrapper.findAll('.app-tile')
    expect(quick.length).toBeGreaterThan(4)
    // 主操作排在最前，且与收藏去重
    expect(quick[0].text()).toBe('新增凭证')
    const paths = quick.map(q => q.attributes('title'))
    expect(new Set(paths).size).toBe(paths.length)

    const rows = wrapper.findAll('.todo-row')
    expect(rows.length).toBe(2)
    expect(rows[0].classes()).toContain('is-warning')
    expect(rows[1].classes()).toContain('is-empty')
    expect(wrapper.find('.wb-count-badge').text()).toBe('1')

    const tabs = wrapper.findAll('.wb-tab').map(t => t.text())
    expect(tabs).toEqual(['财务', '资金'])
    expect(wrapper.findAll('.kpi-card').length).toBeGreaterThan(0)

    // 旧 Hero 不再出现在工作台
    expect(wrapper.find('.hero-section').exists()).toBe(false)
    expect(wrapper.find('.wb-widgets').exists()).toBe(true)
  })

  it('切换到资金页签后指标卡换成出纳数据', async () => {
    const wrapper = await mountDashboard()

    await wrapper.findAll('.wb-tab')[1].trigger('click')
    const labels = wrapper.findAll('.kpi-card__label').map(l => l.text())
    expect(labels).toContain('资金余额合计')
  })
})
