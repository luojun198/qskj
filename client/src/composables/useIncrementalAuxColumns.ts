import { shallowRef, watch, type Ref, type ComputedRef } from 'vue'
import { discoverAuxColumnsFromRows, type AuxColumnDef } from '@/utils/voucherFlatList'
import { loadColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

export interface DynamicColSetting extends ColumnSetting {
  dynamic?: boolean
}

/**
 * 增量发现辅助列，并只在「出现新类别」时合并进列设置，避免每次 append 触发 el-table 整表重建。
 */
export function useIncrementalAuxColumns(options: {
  flatList: Ref<any[]> | ComputedRef<any[]>
  auxCategories: Ref<any[]> | ComputedRef<any[]>
  storageKey: string
  baseVisibleCols: DynamicColSetting[]
  visibleCols: Ref<DynamicColSetting[]>
}) {
  const discoveredDynamicCols = shallowRef<DynamicColSetting[]>([])
  const seenKeys = new Set<string>()
  let scannedLen = 0

  function resetDiscovery() {
    discoveredDynamicCols.value = []
    seenKeys.clear()
    scannedLen = 0
  }

  function absorb(rows: any[]) {
    if (!rows.length) return
    const newly = discoverAuxColumnsFromRows(rows, {
      mode: 'query',
      auxCategories: options.auxCategories.value,
      alreadySeen: seenKeys,
    })
    if (!newly.length) return

    const mapped: DynamicColSetting[] = newly.map(col => ({
      key: col.key,
      label: col.label || col.name,
      visible: true,
      dynamic: true,
      group: col.group || '辅助核算',
    }))
    discoveredDynamicCols.value = discoveredDynamicCols.value.concat(mapped)

    // 只追加新列，不整表重载列设置（避免抖动）
    const existingKeys = new Set(options.visibleCols.value.map(c => c.key))
    const toAppend = mapped.filter(c => !existingKeys.has(c.key))
    if (toAppend.length) {
      // 合并已保存的可见性偏好
      const withPrefs = loadColumnSettings(options.storageKey, [
        ...options.visibleCols.value,
        ...toAppend,
      ])
      // loadColumnSettings 可能重排；保留现有顺序，仅在末尾补新列
      const prefMap = new Map(withPrefs.map(c => [c.key, c]))
      options.visibleCols.value = [
        ...options.visibleCols.value.map(c => ({
          ...c,
          ...(prefMap.get(c.key) || {}),
          dynamic: c.dynamic || mapped.some(m => m.key === c.key),
        })),
        ...toAppend.map(c => ({
          ...c,
          ...(prefMap.get(c.key) || {}),
          dynamic: true,
        })),
      ]
    }
  }

  watch(
    () => options.flatList.value,
    rows => {
      if (!rows.length) {
        resetDiscovery()
        // 恢复为基础列
        options.visibleCols.value = loadColumnSettings(
          options.storageKey,
          options.baseVisibleCols.map(c => ({ ...c }))
        )
        return
      }
      if (rows.length < scannedLen) {
        resetDiscovery()
        absorb(rows)
        scannedLen = rows.length
        // 全量重置后重建 visibleCols（含动态列）
        options.visibleCols.value = loadColumnSettings(options.storageKey, [
          ...options.baseVisibleCols.map(c => ({ ...c })),
          ...discoveredDynamicCols.value.map(c => ({ ...c })),
        ]).map(column => ({
          ...column,
          dynamic: discoveredDynamicCols.value.some(d => d.key === column.key),
        }))
        return
      }
      if (rows.length > scannedLen) {
        absorb(rows.slice(scannedLen))
        scannedLen = rows.length
      }
    },
    { immediate: true }
  )

  return { discoveredDynamicCols, resetDiscovery }
}

export type { AuxColumnDef }
