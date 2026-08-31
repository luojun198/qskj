import type { RequestConfig } from './request'

/** 大批量导入/删除/清理等长耗时接口的超时（5 分钟） */
export const BATCH_REQUEST_OPTIONS: RequestConfig = {
  timeout: 300_000,
}
