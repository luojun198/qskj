import { computed } from 'vue'
import { useSystemParamsStore } from '@/stores/systemParams'

/** 本地日期 → YYYY-MM-DD（不走 toISOString，避免时区把日期推前一天） */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 总账开账日期下限：凭证 / 业务单据的日期选择器禁选开账日期之前的日子。
 * 后端是最终防线（voucherMutationGuard.assertNotBeforeGlStart），这里只改善体验。
 */
export function useGlStartDate() {
  const store = useSystemParamsStore()
  store.load()
  const glStartDate = computed(() => store.startDate || '')

  /** 是否早于开账日期 */
  function isBeforeGlStart(d: Date | string | null | undefined): boolean {
    if (!d || !glStartDate.value) return false
    const s = typeof d === 'string' ? d.slice(0, 10) : ymd(d)
    return s < glStartDate.value
  }

  /** el-date-picker :disabled-date 用；可再叠加其它限制（如禁选未来月份） */
  function disabledBeforeGlStart(d: Date, extra?: (d: Date) => boolean): boolean {
    return isBeforeGlStart(d) || (extra ? extra(d) : false)
  }

  /** 是否晚于可写入的最晚期间（自然月与已结账下一期取较晚者，与后端 assertNotAfterCurrentPeriod 同口径） */
  function isAfterWritablePeriod(d: Date): boolean {
    return d.getFullYear() * 100 + d.getMonth() + 1 > store.maxWritableYm
  }

  return { glStartDate, isBeforeGlStart, disabledBeforeGlStart, isAfterWritablePeriod }
}
