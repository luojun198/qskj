/**
 * hiprint 文本元素在「隐藏标题 + 绑定字段」时，画布只渲染 testData。
 * 自带的双击编辑会按「标题：测试数据」去拆内容：显示文本若等于标题，就会把 testData 清掉，
 * 属性面板改「标题」也不会写回 testData，中间虚线框因此是空的。
 */

export interface HiprintTextOptions {
  hideTitle?: boolean
  field?: string
  title?: string
  testData?: string
}

export function isHiddenBoundText(options: HiprintTextOptions | null | undefined): boolean {
  return !!(options?.field && options.hideTitle)
}

/** 隐藏标题的绑定文本：标题与测试数据都应等于画布上看到的那一行 */
export function syncHiddenBoundText(
  options: HiprintTextOptions,
  preferred?: string
): { title: string; testData: string } {
  const text = String(preferred ?? options.testData ?? options.title ?? '')
  return { title: text, testData: text }
}

/** 双击编辑结束：隐藏标题时整段都是正文，不能再按「标题：」拆 */
export function applyEditedTextContent(
  options: HiprintTextOptions,
  editedText: string
): { title: string; testData: string } {
  const text = String(editedText ?? '')
  if (isHiddenBoundText(options)) return syncHiddenBoundText(options, text)
  const title = String(options.title ?? '')
  if (options.field && text.startsWith(title)) {
    if (text.length > title.length) {
      return { title: title.split('：')[0], testData: text.split('：').slice(1).join('：') }
    }
    return { title: text, testData: '' }
  }
  return { title: text.split('：')[0] || text, testData: String(options.testData ?? '') }
}

type PrintElementLike = {
  options?: HiprintTextOptions & Record<string, unknown>
  updateByContent?: (silent?: boolean) => void
  updateDesignViewFromOptions?: () => void
  designTarget?: { find: (sel: string) => { text: () => string } }
  _editing?: boolean
}

let patched = false

function patchUpdateByContent(proto: PrintElementLike) {
  const orig = proto.updateByContent
  if (typeof orig !== 'function' || (orig as { __cwHiddenTitlePatch?: boolean }).__cwHiddenTitlePatch) {
    return
  }
  const wrapped = function (this: PrintElementLike, silent?: boolean) {
    let captured: string | undefined
    if (this._editing && isHiddenBoundText(this.options)) {
      try {
        captured = this.designTarget?.find?.('.hiprint-printElement-content')?.text?.() ?? ''
      } catch {
        captured = undefined
      }
    }
    orig.call(this, silent)
    if (captured === undefined || !this.options) return
    const next = applyEditedTextContent(this.options, captured)
    this.options.title = next.title
    this.options.testData = next.testData
    this.updateDesignViewFromOptions?.()
  }
  wrapped.__cwHiddenTitlePatch = true
  proto.updateByContent = wrapped
}

/** 从已挂到画布的文本元素上拿到原型并补丁，只做一次 */
export function patchHiprintHiddenTitleEdit(printElements: PrintElementLike[]): void {
  if (patched) return
  for (const el of printElements) {
    if (typeof el?.updateByContent !== 'function') continue
    patchUpdateByContent(Object.getPrototypeOf(el) as PrintElementLike)
    patched = true
    return
  }
}

/** 已保存模板若 testData 被清空，用标题填回，让虚线框重新有字 */
export function fillEmptyHiddenTitleTestData<T extends { options?: HiprintTextOptions }>(
  elements: T[]
): { elements: T[]; changed: boolean } {
  let changed = false
  const next = elements.map(el => {
    const opt = el?.options
    if (!isHiddenBoundText(opt) || !opt) return el
    if (String(opt.testData || '') || !String(opt.title || '')) return el
    changed = true
    return { ...el, options: { ...opt, testData: opt.title } }
  })
  return { elements: next, changed }
}
