import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import request from '@/api/request'

export const useSystemParamsStore = defineStore('systemParams', () => {
  const loaded = ref(false)
  const directPrint = ref(false)
  const enableCashFlow = ref(false)
  const enableForeignCurrency = ref(false)
  const baseCurrency = ref('RMB')
  const allowDirectPost = ref(false)
  const requireAudit = ref(true)
  // 当前会计区间：由后端 /system/params 的 meta 给出（最新已过账凭证的 year/period，
  // 无凭证时回退账套 fiscal_year + 当前月），供报表等页面作为默认年度/期间。
  const currentYear = ref<number>(new Date().getFullYear())
  const currentPeriod = ref<number>(new Date().getMonth() + 1)
  // 建账日期（YYYY-MM-DD）与建账年度：年度选择器等页面据此限定可选年份下限
  const startDate = ref<string>('')
  const startYear = computed(() => {
    const y = Number(String(startDate.value).slice(0, 4))
    return Number.isInteger(y) && y > 1900 ? y : 0
  })

  async function load(force = false) {
    if (loaded.value && !force) return
    try {
      const res = await request.get<any[]>('/system/params')
      const params = res.data || []
      const meta = (res as any).meta || {}
      if (Number.isInteger(meta.current_year)) currentYear.value = meta.current_year
      if (Number.isInteger(meta.current_period)) currentPeriod.value = meta.current_period
      for (const p of params) {
        if (p.param_key === 'direct_print') directPrint.value = p.param_value === 'true'
        if (p.param_key === 'enable_cash_flow') enableCashFlow.value = p.param_value === 'true'
        if (p.param_key === 'enable_foreign_currency')
          enableForeignCurrency.value = p.param_value === 'true'
        if (p.param_key === 'base_currency') baseCurrency.value = p.param_value || 'RMB'
        if (p.param_key === 'allow_direct_post') allowDirectPost.value = p.param_value === 'true'
        if (p.param_key === 'require_audit') requireAudit.value = p.param_value === 'true'
        if (p.param_key === 'start_date') startDate.value = p.param_value || ''
      }
      loaded.value = true
    } catch {
      // 加载失败保持默认值
    }
  }

  function reset() {
    loaded.value = false
  }

  return {
    loaded,
    directPrint,
    enableCashFlow,
    enableForeignCurrency,
    baseCurrency,
    allowDirectPost,
    requireAudit,
    currentYear,
    currentPeriod,
    startDate,
    startYear,
    load,
    reset,
  }
})
