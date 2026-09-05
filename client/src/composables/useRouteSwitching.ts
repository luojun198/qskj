import type { Router } from 'vue-router'

/**
 * 路由切换期间的临时降级。
 *
 * 首次进入某个模块要现拉组件，这段等待没法完全消掉；
 * 切换过程中给 <html> 挂上标记，让样式表临时关掉毛玻璃与动画、
 * 并显示一条顶部进度条，避免界面在等待时看起来「僵住」。
 * 切完立刻恢复完整视觉效果。
 */

export const ROUTE_SWITCHING_CLASS = 'cw-route-switching'

/** 导航被取消/出错时的兜底，避免标记永久残留 */
const FAILSAFE_MS = 8000

/** 切换太快时不闪进度条，省得看着抖 */
const SHOW_DELAY_MS = 120

let showTimer: ReturnType<typeof setTimeout> | null = null
let failsafeTimer: ReturnType<typeof setTimeout> | null = null

function clearTimers() {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (failsafeTimer !== null) {
    clearTimeout(failsafeTimer)
    failsafeTimer = null
  }
}

function begin() {
  // 不计数：守卫里的重定向会让 beforeEach 触发多次，而 afterEach 只在最终
  // 落地时触发一次，用计数器会配不平、把标记永久留在页面上。
  // 已经在切换中就沿用当前这一轮的计时器。
  if (showTimer !== null || document.documentElement.classList.contains(ROUTE_SWITCHING_CLASS)) {
    return
  }
  showTimer = setTimeout(() => {
    showTimer = null
    document.documentElement.classList.add(ROUTE_SWITCHING_CLASS)
  }, SHOW_DELAY_MS)
  failsafeTimer = setTimeout(end, FAILSAFE_MS)
}

function end() {
  clearTimers()
  document.documentElement.classList.remove(ROUTE_SWITCHING_CLASS)
}

/**
 * 等新视图渲染完这一帧再恢复特效，避免恢复瞬间又触发一次重绘。
 * 标签页在后台时 requestAnimationFrame 不会触发，必须再挂一个定时器兜底，
 * 否则用户切回来会看到进度条和降级效果一直挂着。
 */
function endAfterPaint() {
  let done = false
  const finish = () => {
    if (done) return
    done = true
    end()
  }
  requestAnimationFrame(finish)
  setTimeout(finish, 50)
}

/** 挂到 router 上 */
export function setupRouteSwitchingIndicator(router: Router) {
  router.beforeEach((_to, _from, next) => {
    begin()
    next()
  })
  router.afterEach(endAfterPaint)
  router.onError(() => end())
}

/** 仅供测试使用 */
export function resetRouteSwitchingState() {
  end()
}
