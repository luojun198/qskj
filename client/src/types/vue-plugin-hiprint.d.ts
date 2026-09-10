/**
 * vue-plugin-hiprint 未提供类型声明，这里给出最小宽松声明以通过 TS 编译。
 * 运行时 API 以官方文档为准：https://github.com/CcSimple/vue-plugin-hiprint
 */
declare module 'vue-plugin-hiprint' {
  // hiprint 模板实例：支持设计、取 HTML、直接打印、导出 PDF
  export interface HiprintTemplateInstance {
    design(elSelector: string, options?: Record<string, unknown>): void
    getHtml(printData?: unknown): JQueryLike
    getHtmlText(printData?: unknown): string
    print(
      printData?: unknown,
      options?: Record<string, unknown>,
      callbacks?: Record<string, unknown>
    ): void
    print2(printData?: unknown, options?: Record<string, unknown>): void
    toPdf(
      printData?: unknown,
      fileName?: string,
      options?: { isDownload?: boolean; type?: string; [key: string]: unknown }
    ): PromiseLike<Blob>
    update(panel: unknown): void
    getJson(): { panels: unknown[]; [key: string]: unknown }
    setPaper(type: string, options?: unknown): void
    clear(): void
    getPrintElementTypeList?(): unknown
    on(event: string, handler: (...args: unknown[]) => void): void
  }

  export interface PrintElementTypeManagerStatic {
    build(el: Element | string, moduleName: string): void
    buildByHtml(el: unknown): void
  }

  interface JQueryLike {
    html(): string
    [key: string]: unknown
  }

  export interface HiprintStatic {
    init(options?: Record<string, unknown>): void
    PrintTemplate: new (options: Record<string, unknown>) => HiprintTemplateInstance
    PrintElementTypeManager: PrintElementTypeManagerStatic
    PrintElementTypeGroup: new (title: string, list: unknown[]) => unknown
    [key: string]: unknown
  }

  export const hiprint: HiprintStatic
  export const hiPrintPlugin: {
    disAutoConnect(): void
    [key: string]: unknown
  }
  export class defaultElementTypeProvider {
    constructor(...args: unknown[])
  }
  export function disAutoConnect(): void
  export function autoConnect(...args: unknown[]): void
}
