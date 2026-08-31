import { watch } from 'vue'

/**
 * 让明细数组「末尾始终保留一个空行」——录入时不必反复点「添加行」。
 *
 * 末行被「填过」（默认判据：`item_code` 非空）就自动追加一个新空行；
 * 追加后末行为空 → 判据为假 → 不再追加，**自收敛不会死循环**。
 * 空行不入库：各表保存已自行过滤（`item_code && qty>0`），此处只管录入体验。
 *
 * @param getArr  返回被维护的明细数组（如 `() => lines.value`、`() => form.value.lines`）
 * @param makeRow 生成一个空行
 * @param opts.enabled 何时启用（如非只读、非组装单主表）；返回 false 时不补空行
 * @param opts.filled  判断某行是否「已填」，默认看 `item_code`
 */
export function useAutoBlankRow(
  getArr: () => any[] | null | undefined,
  makeRow: () => any,
  opts: { enabled?: () => boolean; filled?: (r: any) => boolean } = {},
) {
  const filled = opts.filled ?? ((r: any) => !!(r && r.item_code))
  const ensure = () => {
    if (opts.enabled && !opts.enabled()) return
    const arr = getArr()
    if (!arr) return
    if (arr.length === 0 || filled(arr[arr.length - 1])) arr.push(makeRow())
  }
  watch(getArr, ensure, { deep: true, immediate: true })
  return { ensure }
}
