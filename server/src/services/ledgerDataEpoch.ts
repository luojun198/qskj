/**
 * GL-6：账簿数据版本号（进程内）。记账 / 反记账后自增，供短时取数缓存（如现金流量自动推算）判断失效。
 * 单独成文件、无依赖，避免 voucherPosting 为了失效缓存而反向引用报表模块。
 */
let epoch = 0

export function getLedgerDataEpoch() {
  return epoch
}

export function bumpLedgerDataEpoch() {
  epoch += 1
}
