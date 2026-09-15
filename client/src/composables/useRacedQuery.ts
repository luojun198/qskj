import { ref } from 'vue'

/**
 * FIX-157：请求竞态防护。
 *
 * 账簿页面改条件 / 翻页会连发请求，先发的慢响应若后到会覆盖新结果（尤其「改页大小」会触发
 * size-change + current-change 两个事件）。用递增序号标记每次请求，只有最新一次的响应才生效。
 *
 * 用法：
 *   const raced = useRacedQuery()
 *   async function fetchData() {
 *     const res = await raced.run(() => request.get(...))
 *     if (!res) return            // 已被更新的请求取代，丢弃
 *     list.value = res.data
 *   }
 *   <el-table v-loading="raced.loading.value">
 */
export function useRacedQuery() {
  let seq = 0
  const loading = ref(false)

  /** 执行请求；返回 undefined 表示该次响应已过期（期间又发起了新请求） */
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    const mine = ++seq
    loading.value = true
    try {
      const result = await task()
      return mine === seq ? result : undefined
    } catch (error) {
      if (mine === seq) throw error
      return undefined
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  /** 当前序号是否仍是最新（用于手写多段 await 的场景） */
  function isLatest(token: number) {
    return token === seq
  }

  /** 手动领取一个序号（配合 isLatest） */
  function next() {
    return ++seq
  }

  return { loading, run, isLatest, next }
}
