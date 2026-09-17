import { isRef, type Ref } from 'vue'

/** 可被清空的筛选目标：ref 包装的对象/数组/基本类型 或 reactive 对象 */
export type FilterTarget = Ref<any> | Record<string, any>

export interface FilterClearOptions {
  /** 指定特定键在清空时的目标值，未指定则走通用全量清空规则 */
  defaults?: Record<string, any>
  /** 清空时同步重置为 1 的分页 ref */
  page?: Ref<number>
}

/** 深拷贝筛选值 */
function cloneValue(value: any): any {
  if (value === undefined || value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function readValue(target: FilterTarget): any {
  return isRef(target) ? target.value : target
}

/** 清空单个属性的值，使其变为未筛选状态（查全部） */
function clearPropertyValue(key: string, originalVal: any, defaults?: Record<string, any>): any {
  if (defaults && key in defaults) {
    return cloneValue(defaults[key])
  }
  // 特殊字段语义：统计未记账保持为 true 保证统计全量；隐藏零值置为 false 保证全量展示
  if (key === 'include_unposted') return true
  if (key === 'hideZero') return false
  if (key === 'year' || key === 'period') return null

  if (Array.isArray(originalVal)) return []
  if (typeof originalVal === 'string') return ''
  if (typeof originalVal === 'number') return undefined
  if (typeof originalVal === 'boolean') return false
  if (originalVal && typeof originalVal === 'object') {
    const res: Record<string, any> = {}
    for (const subKey of Object.keys(originalVal)) {
      res[subKey] = clearPropertyValue(subKey, originalVal[subKey], defaults)
    }
    return res
  }
  return undefined
}

/**
 * 筛选条件一键清空 composable
 *
 * 将所有筛选目标彻底清空为未筛选状态（所有条件置空查全部），
 * 配合 FilterClearButton 使用：清空后由页面在 @clear 回调中自动执行查询。
 */
export function useFilterClear(
  targets: FilterTarget[],
  options?: FilterClearOptions
) {
  let customDefaults = options?.defaults ? cloneValue(options.defaults) : {}

  function capture(newDefaults?: Record<string, any>) {
    if (newDefaults) {
      customDefaults = cloneValue(newDefaults)
    }
  }

  /** 将所有筛选目标清空所有条件 */
  function clearFilters() {
    targets.forEach(target => {
      if (isRef(target)) {
        const val = target.value
        if (Array.isArray(val)) {
          target.value = []
        } else if (typeof val === 'string') {
          target.value = ''
        } else if (typeof val === 'number') {
          target.value = undefined
        } else if (val && typeof val === 'object') {
          const obj = val as Record<string, any>
          const cleared: Record<string, any> = {}
          for (const key of Object.keys(obj)) {
            cleared[key] = clearPropertyValue(key, obj[key], customDefaults)
          }
          target.value = cleared
        }
      } else {
        const current = readValue(target) as Record<string, any>
        if (current && typeof current === 'object') {
          for (const key of Object.keys(current)) {
            current[key] = clearPropertyValue(key, current[key], customDefaults)
          }
        }
      }
    })

    if (options?.page && isRef(options.page)) {
      options.page.value = 1
    }
  }

  return { clearFilters, capture }
}

