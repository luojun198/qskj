import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ScmAuxProblem } from '@/api/scmVoucherSetting'

/** 「辅助核算对应不上」页的上下文：未对应项 + 重新生成凭证的回调（函数无法放进 URL） */
export const useScmAuxUnmatchedStore = defineStore('scmAuxUnmatched', () => {
  const problems = ref<ScmAuxProblem[]>([])
  const retry = ref<(() => Promise<unknown>) | null>(null)
  /** 重试成功后刷新来源页（列表 / 单据详情） */
  const onDone = ref<(() => unknown) | null>(null)
  /** 自动新建失败项的原因：key 见 auxFailKey */
  const failures = ref<Record<string, string>>({})
  /** 每次 open 自增：用于识别重试过程中又被重新打开（仍有未对应项） */
  const version = ref(0)

  function open(items: ScmAuxProblem[], retryFn: () => Promise<unknown>, done?: () => unknown) {
    problems.value = items
    retry.value = retryFn
    onDone.value = done ?? null
    failures.value = {}
    version.value++
  }
  function clear() {
    problems.value = []
    retry.value = null
    onDone.value = null
    failures.value = {}
  }
  return { problems, retry, onDone, failures, version, open, clear }
})
