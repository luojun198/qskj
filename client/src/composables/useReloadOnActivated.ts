import { onActivated } from 'vue'

/**
 * 列表/分析页在 keep-alive 下从「新增/编辑/详情」等全页面返回时刷新数据。
 *
 * Layout.vue 对所有路由页 <keep-alive>，切回页面只触发 onActivated、不重跑 onMounted；
 * 但 KeepAlive 首次挂载也会紧跟着触发一次 activated，这里跳过这一轮，避免与 onMounted 重复请求。
 *
 * 用法：`useReloadOnActivated(() => load())`
 */
export function useReloadOnActivated(reload: () => unknown) {
  let skipInitial = true
  onActivated(() => {
    if (skipInitial) {
      skipInitial = false
      return
    }
    void reload()
  })
}
