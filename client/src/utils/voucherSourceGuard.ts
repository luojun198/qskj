/**
 * 固定资产模块生成的凭证（source = asset_*）在凭证录入/查询页只读；出纳生成的凭证（source = cashier）不可在此删除：
 * 不允许编辑与直接删除，只能回到固定资产模块「凭证管理」删除后重新生成（或反折旧 / 撤销处置 / 撤销变动）。
 * 进销存单据生成的凭证（scm_*）同样不可编辑 / 直接删除，只能到「业务凭证中心」删除后重新生成。
 * 与后端 services/voucherDelete.ts 的 asset_ 守卫、routes/voucher.ts 的 PUT 守卫口径一致。
 */

const VOUCHER_MANAGE_HINT = '请到「固定资产 → 凭证管理」删除凭证后重新生成'

const ASSET_SOURCE_HINTS: Record<string, string> = {
  asset_depr: `${VOUCHER_MANAGE_HINT}（或到「取消折旧」反折旧后重新计提）`,
  asset_disposal: `${VOUCHER_MANAGE_HINT}（或到「资产卡片」撤销处置后重新处置）`,
  asset_change: `${VOUCHER_MANAGE_HINT}（或到「资产变动」撤销变动后重新登记）`,
  asset_impairment: `${VOUCHER_MANAGE_HINT}（或到「资产变动」撤销减值后重新登记）`,
  asset_inventory: VOUCHER_MANAGE_HINT,
  asset_purchase: VOUCHER_MANAGE_HINT,
}

export function isAssetVoucher(voucher: { source?: string | null } | null | undefined): boolean {
  return typeof voucher?.source === 'string' && voucher.source.startsWith('asset_')
}

/** 进销存单据生成的凭证（source = scm_<单据类型>；差异结转 scm_variance 不算）：不允许在总账编辑 / 删除 */
export function isScmDocVoucher(voucher: { source?: string | null } | null | undefined): boolean {
  const source = voucher?.source
  return typeof source === 'string' && source.startsWith('scm_') && source !== 'scm_variance'
}

/** 返回该凭证不能编辑/删除的提示；非模块凭证返回 null */
export function getAssetVoucherLockMessage(
  voucher: { source?: string | null } | null | undefined,
  action: '编辑' | '删除'
): string | null {
  // 评审 P2：出纳生成的凭证后端禁止直接删除（voucherMutationGuard），前端此前不拦，点了才报错
  if (voucher?.source === 'cashier' && action === '删除') {
    return '出纳生成的凭证不允许在此删除，请到「出纳 → 日记账」对应记录上删除凭证'
  }
  if (isScmDocVoucher(voucher)) {
    return `进销存生成的凭证不允许${action}，请到「业务凭证中心」删除凭证后重新生成（需调整内容请先修改单据）`
  }
  if (!isAssetVoucher(voucher)) return null
  const hint = ASSET_SOURCE_HINTS[voucher!.source as string] || `${VOUCHER_MANAGE_HINT}（固定资产模块内处理）`
  return `固定资产生成的凭证不允许${action}，${hint}`
}
