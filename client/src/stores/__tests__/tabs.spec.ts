import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getVisibleTabKeys, MAX_TABS, useTabsStore, type TabItem } from '@/stores/tabs'

function tab(key: string, lastActiveAt: number, pinned = false): TabItem {
  return {
    key, identity: key, fullPath: `/${key}`, title: key, pinned, lastActiveAt,
    kind: pinned ? 'fixed' : 'normal', evictable: !pinned,
  }
}

describe('tabs store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('可见标签始终包含工作台和当前页，并用最近访问页补足', () => {
    const tabs = [tab('home', 0, true), tab('a', 10), tab('b', 30), tab('c', 20), tab('active', 5)]
    const keys = getVisibleTabKeys(tabs, 'active', 4)
    expect([...keys]).toEqual(['home', 'active', 'b', 'c'])
  })

  it('同一只读功能切换记录时复用标签并更换缓存键', () => {
    const store = useTabsStore()
    const first = store.openOrActivate({
      identity: 'acct:route:ScmDocView', fullPath: '/scm/docs/1', title: '查看单据1',
      kind: 'transient', evictable: true,
    })
    const firstKey = first.key
    const second = store.openOrActivate({
      identity: 'acct:route:ScmDocView', fullPath: '/scm/docs/2', title: '查看单据2',
      kind: 'transient', evictable: true,
    })
    expect(store.tabs).toHaveLength(1)
    expect(second.fullPath).toBe('/scm/docs/2')
    expect(second.title).toBe('查看单据2')
    expect(second.key).not.toBe(firstKey)
    expect(store.activeKey).toBe(second.key)
  })

  it('快捷切换编辑单据后移除来源标签并聚焦目标标签', () => {
    const store = useTabsStore()
    const source = store.openOrActivate({
      identity: 'acct:/scm/docs/1/edit', fullPath: '/scm/docs/1/edit', title: '编辑1',
      kind: 'editor', evictable: false,
    })
    const target = store.openOrActivate({
      identity: 'acct:/scm/docs/2/edit', fullPath: '/scm/docs/2/edit', title: '编辑2',
      kind: 'editor', evictable: false,
    })
    expect(store.finishTabReplacement(source.key, target.identity)?.key).toBe(target.key)
    expect(store.tabs.map(t => t.identity)).toEqual([target.identity])
    expect(store.activeKey).toBe(target.key)
  })

  it('达到上限时优先回收只读动态页，编辑页保持独立', () => {
    const store = useTabsStore()
    store.ensureHome({ identity: 'home', fullPath: '/dashboard', title: '工作台' })
    store.openOrActivate({ identity: 'edit-1', fullPath: '/edit/1', title: '编辑1', kind: 'editor', evictable: false })
    store.openOrActivate({ identity: 'readonly', fullPath: '/view/1', title: '查看1', kind: 'transient', evictable: true })
    store.openOrActivate({ identity: 'edit-2', fullPath: '/edit/2', title: '编辑2', kind: 'editor', evictable: false })
    for (let i = 0; i < MAX_TABS - 3; i += 1) {
      store.openOrActivate({ identity: `normal-${i}`, fullPath: `/normal/${i}`, title: `普通${i}`, kind: 'normal', evictable: true })
    }
    store.openOrActivate({ identity: 'overflow', fullPath: '/overflow', title: '新增普通页', kind: 'normal', evictable: true })

    expect(store.tabs.some(t => t.identity === 'readonly')).toBe(false)
    expect(store.tabs.some(t => t.identity === 'edit-1')).toBe(true)
    expect(store.tabs.some(t => t.identity === 'edit-2')).toBe(true)
    expect(store.tabs.filter(t => !t.pinned)).toHaveLength(MAX_TABS)
  })

  it('旧版采购报表标签首次切换时直接复用', () => {
    const store = useTabsStore()
    const legacy = store.openOrActivate({
      identity: 'acct:/scm/report/purchase/detail',
      fullPath: '/scm/report/purchase/detail',
      title: '采购明细表',
    })
    const switched = store.openOrActivate({
      identity: 'acct:scm-report:purchase',
      fullPath: '/scm/report/purchase/summary',
      title: '采购汇总表',
    })
    expect(switched.key).toBe(legacy.key)
    expect(store.tabs).toHaveLength(1)
    expect(switched.fullPath).toBe('/scm/report/purchase/summary')
  })

  it('同类型单据切换时复用当前标签并清理旧重复标签', () => {
    const store = useTabsStore()
    const list = store.openOrActivate({
      identity: 'legacy-list', fullPath: '/scm/docs?doc_type=PI', title: '采购入库',
    })
    store.tabs.push({
      key: 'legacy-duplicate', identity: 'legacy-source-new',
      fullPath: '/scm/docs/new?doc_type=PI&source_doc_id=PO1', title: '新增采购入库',
      pinned: false, lastActiveAt: Date.now(), kind: 'editor', evictable: false,
    })
    store.activeKey = 'legacy-duplicate'
    const switched = store.openOrActivate({
      identity: 'acct:scm-doc:PI:normal', fullPath: '/scm/docs/PI1?nav_list_doc_type=PI', title: '采购入库 PI1',
      kind: 'transient', evictable: true,
    })

    expect(switched.key).not.toBe(list.key)
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].fullPath).toBe('/scm/docs/PI1?nav_list_doc_type=PI')
  })

  it('同类型单据在一个标签内换页时刷新 KeepAlive 缓存键', () => {
    const store = useTabsStore()
    const list = store.openOrActivate({
      identity: 'acct:scm-doc:SOa:normal', fullPath: '/scm/docs?doc_type=SOa', title: '销售订单',
    })
    const listKey = list.key
    const form = store.openOrActivate({
      identity: 'acct:scm-doc:SOa:normal', fullPath: '/scm/docs/new?doc_type=SOa', title: '新增销售订单',
      kind: 'editor', evictable: false,
    })

    expect(store.tabs).toHaveLength(1)
    expect(form.key).not.toBe(listKey)
    expect(store.activeKey).toBe(form.key)
  })

  it('已审核单据从错误编辑路由纠偏到查看路由时不残留可反复激活的编辑标签', () => {
    const store = useTabsStore()
    store.ensureHome({ identity: 'home', fullPath: '/dashboard', title: '工作台' })
    const edit = store.openOrActivate({
      identity: 'acct:/scm/docs/SO1/edit', fullPath: '/scm/docs/SO1/edit', title: '编辑销售订单',
      kind: 'editor', evictable: false,
    })
    const editKey = edit.key
    const view = store.openOrActivate({
      identity: 'acct:route:ScmDocView', fullPath: '/scm/docs/SO1', title: '销售订单 SO1',
      kind: 'transient', evictable: true,
    })

    expect(store.tabs).toHaveLength(2)
    expect(store.tabs.some(t => t.fullPath === '/scm/docs/SO1/edit')).toBe(false)
    expect(view.fullPath).toBe('/scm/docs/SO1')
    expect(view.key).not.toBe(editKey)
    expect(store.closeTab(view.key)).toBe('/dashboard')
  })

})
