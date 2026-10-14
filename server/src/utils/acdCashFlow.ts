/** ACD xjll_xm 表 jd 字段 → 系统现金流量方向 */

export type CashFlowDirection = 'inflow' | 'outflow' | 'neutral'

/**
 * jd：0=流入（收现），1=流出（付现）。
 * 润衡模板 1000「现金科目内部流转」、4101「汇率影响」的 jd 也是 0，传入编码时把 x0xx / 4xxx 识别为中性。
 */
export function mapAcdCashFlowJd(jd: string | null | undefined, code?: string | null): CashFlowDirection {
  const c = String(code ?? '').trim()
  if (/^[123]0\d\d$/.test(c) || /^4\d{3}$/.test(c)) return 'neutral'
  const v = String(jd ?? '').trim()
  if (v === '0') return 'inflow'
  if (v === '1') return 'outflow'
  return 'neutral'
}

export const CASH_FLOW_DIRECTION_LABELS: Record<CashFlowDirection, string> = {
  inflow: '流入',
  outflow: '流出',
  neutral: '中性',
}

export function formatCashFlowDirectionLabel(
  direction: string | null | undefined
): string {
  if (!direction) return ''
  return CASH_FLOW_DIRECTION_LABELS[direction as CashFlowDirection] || direction
}
