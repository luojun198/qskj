/** 让出主线程，避免大批量 Excel 解析时页面假死 */
export function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}
