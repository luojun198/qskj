import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue'

/**
 * 账册页的「科目级次」筛选：顶层 / 上级 / 下级 / 底层。
 *
 * 与科目维护的四按钮同一套文案与快捷键，但语义不同：科目维护是树的展开/收拢，
 * 账册页（科目余额表、总分类账）是扁平列表，由后端按 `level <= N` 过滤——
 * 这里维护的是那个 N。null 表示「底层」，不限制级次，接口返回全部。
 *
 * 「当前有效级次」：有筛选时就是该数字；底层时取当前数据里最深的级次，
 * 这样「上级」从底层退回时落到 max-1，而不是写死的 4。
 */
export interface AccountLevelFilterOptions {
  /** 当前数据里最深的科目级次；没有数据时返回 0 */
  getMaxLevel: () => number
  /** 级次变化后触发（通常是重新查询） */
  onChange: () => void
  /** 数据为空时「底层」视作几级，默认 6（账套默认级数） */
  fallbackMaxLevel?: number
  /** 是否挂全局快捷键（Ctrl+\ / Ctrl+Shift+\ / Ctrl+↑ / Ctrl+↓），默认 true */
  shortcuts?: boolean
}

export function useAccountLevelFilter(options: AccountLevelFilterOptions) {
  const accountLevel: Ref<number | null> = ref(null)
  const fallback = options.fallbackMaxLevel ?? 6

  const maxLevel = computed(() => {
    const max = options.getMaxLevel()
    return max > 0 ? max : fallback
  })

  /** 有筛选时是该级次；底层时是数据最深级 */
  const effectiveLevel = computed(() => accountLevel.value ?? maxLevel.value)

  const atTop = computed(() => effectiveLevel.value <= 1)
  const atBottom = computed(() => accountLevel.value === null || accountLevel.value >= maxLevel.value)

  function setLevel(next: number | null) {
    // 到达或超过最深级就等价于底层，不再传级次给接口
    const normalized = next !== null && next >= maxLevel.value ? null : next
    if (normalized === accountLevel.value) return
    accountLevel.value = normalized
    options.onChange()
  }

  function goTop() {
    setLevel(1)
  }

  function goUp() {
    if (atTop.value) return
    setLevel(effectiveLevel.value - 1)
  }

  function goDown() {
    if (atBottom.value) return
    setLevel(effectiveLevel.value + 1)
  }

  function goBottom() {
    setLevel(null)
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!event.ctrlKey) return
    if (event.key === '\\') {
      event.preventDefault()
      if (event.shiftKey) goBottom()
      else goTop()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      goUp()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      goDown()
    }
  }

  if (options.shortcuts !== false) {
    onMounted(() => window.addEventListener('keydown', handleKeydown))
    onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
  }

  return {
    accountLevel,
    effectiveLevel,
    maxLevel,
    atTop,
    atBottom,
    goTop,
    goUp,
    goDown,
    goBottom,
    setLevel,
  }
}
