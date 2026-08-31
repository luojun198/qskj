import { yieldToMain } from '@/utils/asyncChunk'

export interface AsyncParseOptions {
  chunkSize?: number
  onProgress?: (pct: number) => void
}

/** 分块执行同步 heavy 任务，避免阻塞主线程 */
export async function runInChunks<T, R>(
  items: T[],
  processor: (item: T, index: number) => R,
  options?: AsyncParseOptions
): Promise<{ results: R[]; blankSkipped: number }> {
  const chunkSize = options?.chunkSize ?? 2000
  const results: R[] = []
  let blankSkipped = 0
  const total = items.length

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total)
    for (let i = start; i < end; i++) {
      const r = processor(items[i], i)
      if (r === null || r === undefined) {
        blankSkipped++
      } else {
        results.push(r as R)
      }
    }
    options?.onProgress?.(total > 0 ? Math.floor((end / total) * 100) : 100)
    await yieldToMain()
  }
  options?.onProgress?.(100)
  return { results, blankSkipped }
}
