/**
 * 固定资产模块生成的凭证（source = asset_*）在凭证录入/查询页只读：
 * 不允许编辑与直接删除，只能回到固定资产模块反折旧 / 撤销处置 / 撤销变动后重新生成。
 * 与后端 services/voucherDelete.ts 的 asset_ 守卫、routes/voucher.ts 的 PUT 守卫口径一致。
 */

const ASSET_SOURCE_HINTS: Record<string, string> = {
  asset_depr: '请到「固定资产 → 取消折旧」反折旧后重新计提',
  asset_disposal: '请到「固定资产 → 资产卡片」撤销处置后重新处置',
  asset_change: '请到「固定资产 → 资产变动」撤销变动后重新登记',
  asset_impairment: '请到「固定资产 → 资产变动」撤销减值后重新登记',
  asset_inventory: '请到「固定资产 → 资产盘点」删除盘点结果后重新处理',
  asset_purchase: '请到「固定资产 → 资产卡片」删除资产后重新新增',
}

export function isAssetVoucher(voucher: { source?: string | null } | null | undefined): boolean {
  return typeof voucher?.source === 'string' && voucher.source.startsWith('asset_')
}

/** 返回该凭证不能编辑/删除的提示；非固定资产凭证返回 null */
export function getAssetVoucherLockMessage(
  voucher: { source?: string | null } | null | undefined,
  action: '编辑' | '删除'
): string | null {
  if (!isAssetVoucher(voucher)) return null
  const hint = ASSET_SOURCE_HINTS[voucher!.source as string] || '请到固定资产模块撤销对应业务后重新生成'
  return `固定资产生成的凭证不允许${action}，${hint}`
}
