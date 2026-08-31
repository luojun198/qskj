import { defineStore } from 'pinia'
import { ref } from 'vue'
import request from '@/api/request'

export const useSystemParamsStore = defineStore('systemParams', () => {
  const loaded = ref(false)
  const directPrint = ref(false)
  const enableCashFlow = ref(false)
  const allowDirectPost = ref(false)
  const requireAudit = ref(true)

  async function load(force = false) {
    if (loaded.value && !force) return
    try {
      const res = await request.get<any[]>('/system/params')
      const params = res.data || []
      for (const p of params) {
        if (p.param_key === 'direct_print') directPrint.value = p.param_value === 'true'
        if (p.param_key === 'enable_cash_flow') enableCashFlow.value = p.param_value === 'true'
        if (p.param_key === 'allow_direct_post') allowDirectPost.value = p.param_value === 'true'
        if (p.param_key === 'require_audit') requireAudit.value = p.param_value === 'true'
      }
      loaded.value = true
    } catch {
      // 加载失败保持默认值
    }
  }

  function reset() {
    loaded.value = false
  }

  return { loaded, directPrint, enableCashFlow, allowDirectPost, requireAudit, load, reset }
})
