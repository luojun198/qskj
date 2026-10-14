import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { scmApi } from '@/api/scm'
import { formatDecimal, parseDecimals, resolveDecimals, type DecimalsConfig, type DecimalSetting } from '@/utils/scmDecimals'

/**
 * 进销存小数位（scm:decimals）：各单据 / 报表页共用，切账套或保存参数后 reload。
 * 用法：const d = useScmDecimalsStore(); d.load(); d.qty(v, 'SOa') / d.price(v, 'SOa') / d.amount(v, 'SOa') / d.get('SOa')
 */
export const useScmDecimalsStore = defineStore('scmDecimals', () => {
  const config = ref<DecimalsConfig | null>(null)
  const loaded = ref(false)
  let inflight: Promise<void> | null = null

  async function load(force = false) {
    if (loaded.value && !force) return
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const r = await scmApi.getParams()
        const p = (r.data as any[]).find(x => x.param_key === 'scm:decimals')
        config.value = parseDecimals(p?.param_value)
        loaded.value = true
      } catch { /* 读不到按默认 */ }
    })().finally(() => { inflight = null })
    return inflight
  }

  const configured = computed(() => !!config.value)
  const get = (scope?: string | null): DecimalSetting => resolveDecimals(config.value, scope)
  /** 数量：未设置时去掉末尾 0（沿用旧显示） */
  const qty = (v: unknown, scope?: string | null) => formatDecimal(v, get(scope).qty, { fixed: configured.value, trimWhenAuto: true })
  const price = (v: unknown, scope?: string | null) => formatDecimal(v, get(scope).price, { fixed: configured.value, trimWhenAuto: true, grouping: false })
  const amount = (v: unknown, scope?: string | null) => formatDecimal(v, get(scope).amount, { fixed: true })

  function reset() { loaded.value = false }

  return { config, configured, loaded, load, reset, get, qty, price, amount }
})
