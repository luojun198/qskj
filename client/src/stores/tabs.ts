import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getScmDocTabFamily, getScmReportTabFamily, type TabKind } from '@/utils/viewKey'

export interface TabItem {
  key: string
  identity: string
  fullPath: string
  title: string
  pinned: boolean
  lastActiveAt: number
  kind: TabKind
  evictable: boolean
}

export const MAX_TABS = 12

let uidSeq = 0
function nextUid(): string { return `tab_${++uidSeq}_${Date.now()}` }

/** 查看/编辑同一张供应链单据时，即使没有携带列表上下文，也应复用同一标签。 */
function getScmDocResource(fullPath: string): string | undefined {
  const path = fullPath.split('?')[0] || ''
  const match = path.match(/^\/scm\/docs\/([^/]+)(?:\/edit)?$/)
  return match?.[1]
}

export function getVisibleTabKeys(tabs: TabItem[], activeKey: string, limit: number): Set<string> {
  const safeLimit = Math.max(1, limit)
  const selected = new Set<string>()
  for (const tab of tabs) {
    if (tab.pinned) selected.add(tab.key)
  }
  if (activeKey) selected.add(activeKey)

  const candidates = tabs
    .filter(tab => !selected.has(tab.key))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  for (const tab of candidates) {
    if (selected.size >= safeLimit) break
    selected.add(tab.key)
  }
  return selected
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>([])
  const activeKey = ref('')
  const activeTab = computed(() => tabs.value.find(t => t.key === activeKey.value) || null)

  function findByIdentity(identity: string) { return tabs.value.find(t => t.identity === identity) }

  function openOrActivate(input: {
    identity: string
    fullPath: string
    title: string
    pinned?: boolean
    kind?: TabKind
    evictable?: boolean
  }): TabItem {
    let tab = findByIdentity(input.identity)
    // 兼容热更新或旧持久化数据中的逐报表标签身份，首次切换即收口到报表工作台标签。
    const reportFamily = getScmReportTabFamily(input.fullPath)
    if (!tab && reportFamily) {
      tab = tabs.value.find(item => getScmReportTabFamily(item.fullPath) === reportFamily)
      if (tab) tab.identity = input.identity
    }
    // 单据列表/新增/查看/编辑按 doc_type 收口到一个标签；同时清理热更新前遗留的同类型重复标签。
    const scmDocFamily = getScmDocTabFamily(input.fullPath)
    if (scmDocFamily) {
      const familyTabs = tabs.value.filter(item => getScmDocTabFamily(item.fullPath) === scmDocFamily)
      const activeFamilyTab = familyTabs.find(item => item.key === activeKey.value)
      tab = activeFamilyTab || tab || familyTabs.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
      if (tab) {
        tab.identity = input.identity
        tabs.value = tabs.value.filter(item => item === tab || getScmDocTabFamily(item.fullPath) !== scmDocFamily)
      }
    }
    // 直接打开的单据可能没有 nav_list_doc_type，无法按 doc_type 归族。
    // 此时仍按单据 id 合并查看/编辑路由，尤其要清掉“已审核单据误入编辑路由”纠偏后留下的旧编辑标签，
    // 否则关闭查看标签会再次激活旧编辑地址并反复提示“该单据已审核，转为查看模式”。
    const scmDocResource = getScmDocResource(input.fullPath)
    if (scmDocResource) {
      const resourceTabs = tabs.value.filter(item => getScmDocResource(item.fullPath) === scmDocResource)
      const activeResourceTab = resourceTabs.find(item => item.key === activeKey.value)
      tab = activeResourceTab || tab || resourceTabs.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
      if (tab) {
        tab.identity = input.identity
        tabs.value = tabs.value.filter(item => item === tab || getScmDocResource(item.fullPath) !== scmDocResource)
      }
    }
    if (tab) {
      const resourceChanged = tab.fullPath !== input.fullPath
      tab.fullPath = input.fullPath
      if (input.title) tab.title = input.title
      tab.kind = input.kind || tab.kind
      tab.evictable = input.evictable ?? tab.evictable
      tab.lastActiveAt = Date.now()
      // 可复用详情或同类型单据工作页切换路由时销毁旧实例，避免 KeepAlive 按旧 key 继续显示上一页正文。
      if (resourceChanged && (tab.kind === 'transient' || !!scmDocFamily)) tab.key = nextUid()
    } else {
      if (tabs.value.filter(t => !t.pinned).length >= MAX_TABS) evictLru()
      tab = {
        key: nextUid(),
        identity: input.identity,
        fullPath: input.fullPath,
        title: input.title || '页面',
        pinned: !!input.pinned,
        lastActiveAt: Date.now(),
        kind: input.kind || (input.pinned ? 'fixed' : 'normal'),
        evictable: input.evictable ?? !input.pinned,
      }
      tabs.value.push(tab)
    }
    activeKey.value = tab.key
    return tab
  }

  function ensureHome(input: { identity: string; fullPath: string; title: string }) {
    const exist = findByIdentity(input.identity)
    if (exist) {
      exist.pinned = true
      exist.kind = 'fixed'
      exist.evictable = false
      return
    }
    tabs.value.unshift({
      key: nextUid(), identity: input.identity, fullPath: input.fullPath, title: input.title,
      pinned: true, lastActiveAt: 0, kind: 'fixed', evictable: false,
    })
  }

  /** 优先回收只读动态页，再按最久未使用顺序回收普通页；编辑页永不自动回收。 */
  function evictLru(): boolean {
    const closable = tabs.value.filter(t => !t.pinned && t.key !== activeKey.value && t.evictable)
    if (!closable.length) return false
    closable.sort((a, b) => {
      const kindDiff = Number(a.kind !== 'transient') - Number(b.kind !== 'transient')
      return kindDiff || a.lastActiveAt - b.lastActiveAt
    })
    const i = tabs.value.findIndex(t => t.key === closable[0].key)
    if (i >= 0) tabs.value.splice(i, 1)
    return i >= 0
  }

  function closeTab(key: string): string | null {
    const i = tabs.value.findIndex(t => t.key === key)
    if (i < 0 || tabs.value[i].pinned) return null
    const wasActive = tabs.value[i].key === activeKey.value
    tabs.value.splice(i, 1)
    if (!wasActive) return null
    const neighbor = tabs.value[i] || tabs.value[i - 1] || tabs.value[tabs.value.length - 1]
    return neighbor ? neighbor.fullPath : null
  }

  function closeOthers(key: string): string | null {
    tabs.value = tabs.value.filter(t => t.pinned || t.key === key)
    return tabs.value.find(t => t.key === key)?.fullPath || tabs.value[0]?.fullPath || null
  }

  function closeAll(): string | null {
    tabs.value = tabs.value.filter(t => t.pinned)
    return tabs.value[0]?.fullPath || null
  }

  function setTitle(fullPath: string, title: string) {
    if (!title) return
    const t = tabs.value.find(x => x.fullPath === fullPath)
    if (t) t.title = title
  }

  function refreshTab(key: string) {
    const t = tabs.value.find(x => x.key === key)
    if (!t) return
    const newKey = nextUid()
    const wasActive = activeKey.value === key
    t.key = newKey
    if (wasActive) activeKey.value = newKey
  }

  /**
   * 快捷翻阅在路由完成后收口标签：目标标签已由 Layout 创建或聚焦，
   * 此处移除来源编辑标签，避免“上单/下单”连续累积编辑标签。
   */
  function finishTabReplacement(sourceKey: string, targetIdentity: string): TabItem | null {
    const target = findByIdentity(targetIdentity)
    if (!target) return null
    const sourceIndex = tabs.value.findIndex(t => t.key === sourceKey)
    if (sourceIndex >= 0 && tabs.value[sourceIndex].key !== target.key && !tabs.value[sourceIndex].pinned) {
      tabs.value.splice(sourceIndex, 1)
    }
    target.lastActiveAt = Date.now()
    activeKey.value = target.key
    return target
  }

  function reset() { tabs.value = []; activeKey.value = '' }

  return {
    tabs, activeKey, activeTab,
    openOrActivate, ensureHome, setTitle, closeTab, closeOthers, closeAll, refreshTab, finishTabReplacement,
    reset,
  }
})
