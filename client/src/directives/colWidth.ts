import { watch, type Directive, type WatchStopHandle } from 'vue'
import { resolveTableColumnKey } from '@/composables/useColumnWidthMemory'

/**
 * v-col-width="'表标识'"：给任意 el-table 加列宽记忆（零侵入，不用改每列的 width）
 * - 拖动列头边框后，列宽按「账套 + 表标识」存 localStorage，下次打开自动套用
 * - 表头右键「还原列宽」，或派发 window 事件 COL_WIDTH_RESET_EVENT 一键还原
 */
export const COL_WIDTH_RESET_EVENT = 'col-width-reset'

const storageKeyOf = (key: string) => `table_col_width_${localStorage.getItem('accountSetId') || ''}_${key}`

/** 还原指定表标识的列宽（供「列设置 → 恢复默认」等入口调用） */
export function resetColWidth(...keys: string[]) {
  keys.forEach(key => {
    try { localStorage.removeItem(storageKeyOf(key)) } catch { /* 忽略 */ }
  })
  window.dispatchEvent(new CustomEvent(COL_WIDTH_RESET_EVENT, { detail: keys }))
}

interface Ctx {
  stop?: WatchStopHandle
  onMouseDown: (e: MouseEvent) => void
  onContext: (e: MouseEvent) => void
  onReset: (e: Event) => void
  closeMenu: () => void
}
const ctxMap = new WeakMap<HTMLElement, Ctx>()

function readSaved(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKeyOf(key))
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export const colWidth: Directive<HTMLElement, string> = {
  mounted(el, binding, vnode) {
    const tableKey = () => String(binding.value || '')
    const table = () => (vnode.component?.proxy as any) || null
    const columns = (): any[] => table()?.store?.states?._columns?.value || []
    const orig = new WeakMap<object, { width: any; minWidth: any }>()
    const keyOfCol = (c: any) => (c.type && c.type !== 'default') ? undefined : resolveTableColumnKey(c)

    function apply() {
      if (!tableKey()) return
      const saved = readSaved(tableKey())
      let changed = false
      columns().forEach(c => {
        const k = keyOfCol(c)
        if (!k) return
        if (!orig.has(c)) orig.set(c, { width: c.width, minWidth: c.minWidth })
        const w = saved[k]
        if (w && w > 0 && c.width !== w) { c.width = w; c.realWidth = w; changed = true }
      })
      if (changed) table()?.doLayout?.()
    }

    function restore() {
      columns().forEach(c => {
        const o = orig.get(c)
        if (o) { c.width = o.width; c.minWidth = o.minWidth }
      })
      table()?.doLayout?.()
    }

    // 拖动检测：EP 在鼠标停在列边框时把 body cursor 设为 col-resize，按下前后对比各列实宽即可知道被拖的是哪列
    let snapshot: Map<any, number> | null = null
    const onMouseDown = () => {
      if (document.body.style.cursor !== 'col-resize') return
      snapshot = new Map(columns().map(c => [c, c.realWidth ?? c.width]))
      const onUp = () => {
        document.removeEventListener('mouseup', onUp, true)
        setTimeout(() => {
          if (!snapshot || !tableKey()) return
          const saved = readSaved(tableKey())
          columns().forEach(c => {
            const k = keyOfCol(c)
            const before = snapshot!.get(c)
            const now = c.realWidth ?? c.width
            if (k && before != null && now > 0 && Math.round(now) !== Math.round(before)) saved[k] = Math.round(now)
          })
          snapshot = null
          try { localStorage.setItem(storageKeyOf(tableKey()), JSON.stringify(saved)) } catch { /* 忽略 */ }
        }, 0)
      }
      document.addEventListener('mouseup', onUp, true)
    }

    // 表头右键：还原列宽
    let menu: HTMLElement | null = null
    const closeMenu = () => {
      menu?.remove(); menu = null
      document.removeEventListener('mousedown', closeMenu, true)
    }
    const onContext = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('.el-table__header-wrapper')) return
      e.preventDefault()
      closeMenu()
      menu = document.createElement('div')
      menu.textContent = '还原列宽'
      menu.style.cssText = `position:fixed;z-index:9999;left:${e.clientX}px;top:${e.clientY}px;padding:6px 14px;font-size:12px;background:#fff;color:#303133;border:1px solid #e4e7ed;border-radius:4px;box-shadow:0 2px 12px rgba(0,0,0,.15);cursor:pointer`
      menu.addEventListener('mousedown', ev => {
        ev.stopPropagation()
        resetColWidth(tableKey())
        closeMenu()
      })
      document.body.appendChild(menu)
      document.addEventListener('mousedown', closeMenu, true)
    }

    const onReset = (e: Event) => {
      const keys: string[] = (e as CustomEvent).detail || []
      if (keys.includes(tableKey())) restore()
    }

    el.addEventListener('mousedown', onMouseDown, true)
    el.addEventListener('contextmenu', onContext)
    window.addEventListener(COL_WIDTH_RESET_EVENT, onReset)
    // 列随数据/条件动态增减时重新套用
    const stop = watch(() => columns().length, () => apply(), { flush: 'post' })
    ctxMap.set(el, { stop, onMouseDown, onContext, onReset, closeMenu })
    apply()
  },
  unmounted(el) {
    const ctx = ctxMap.get(el)
    if (!ctx) return
    ctx.stop?.()
    ctx.closeMenu()
    el.removeEventListener('mousedown', ctx.onMouseDown, true)
    el.removeEventListener('contextmenu', ctx.onContext)
    window.removeEventListener(COL_WIDTH_RESET_EVENT, ctx.onReset)
    ctxMap.delete(el)
  },
}
