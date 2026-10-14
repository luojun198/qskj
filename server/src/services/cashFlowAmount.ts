import type { Database } from 'better-sqlite3'
import type { AccountScopeContext } from './accountAuthorization.js'
import type { BalanceQueryDb } from './reportBalance.js'
import {
  computeCashFlowByMapping,
  getMainItemAmount,
  getSupplementItemAmount,
} from './cashFlowAutoEngine.js'

/**
 * 现金流量项目金额（@xj_je 口径）
 *
 * 按「科目现金流量项目」自动推算（cashFlowAutoEngine），不再读取分录上人工指定的 cash_flow_code。
 * 返回值按项目自身流向取正：流入项目 = 流入 − 流出，流出项目 = 流出 − 流入（退款多于收付时为负）。
 */
export function getCashFlowAmount(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  cashFlowCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): number {
  const result = computeCashFlowByMapping(db, accountSetId, year, fromPeriod, toPeriod, accountScope)
  const code = String(cashFlowCode || '').trim()
  if (/^F\d+$/i.test(code)) return getSupplementItemAmount(result, code.toUpperCase())
  return getMainItemAmount(result, code)
}

/** 附表（补充资料）项目金额（@xj_fb 口径），F01 为净利润 */
export function getCashFlowSupplementAmount(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  supplementCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): number {
  const result = computeCashFlowByMapping(db, accountSetId, year, fromPeriod, toPeriod, accountScope)
  return getSupplementItemAmount(result, String(supplementCode || '').trim().toUpperCase())
}

/** 带符号净额：流入为正、流出为负（用于三大活动合计） */
export function getSignedCashFlowAmount(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  cashFlowCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): number {
  const result = computeCashFlowByMapping(db, accountSetId, year, fromPeriod, toPeriod, accountScope)
  const amount = getMainItemAmount(result, cashFlowCode)
  return result.itemClass.get(cashFlowCode)?.flow === 'out' ? -amount : amount
}

export type DirectMethodActivityTotals = {
  operating: number
  investing: number
  financing: number
  net: number
  itemCount: number
  itemsWithData: number
}

/** 直接法：三大活动当期净额 */
export function getDirectMethodActivityTotals(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): DirectMethodActivityTotals {
  const result = computeCashFlowByMapping(db, accountSetId, year, fromPeriod, toPeriod, accountScope)
  let itemsWithData = 0
  for (const amt of result.main.values()) {
    if (Math.abs(amt.inflow) >= 0.005 || Math.abs(amt.outflow) >= 0.005) itemsWithData++
  }
  return {
    operating: result.activities.operating,
    investing: result.activities.investing,
    financing: result.activities.financing,
    net: result.activities.net,
    itemCount: result.items.filter(i => i.kind !== 'supplement').length,
    itemsWithData,
  }
}
