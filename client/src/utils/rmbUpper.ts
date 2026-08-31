/**
 * 人民币金额大写转换。
 * 从 views/scm/ScmDocPrint.vue 抽出为公共工具，供单据打印、对账单打印等复用。
 * 例：100.05 → 壹佰元零伍分；1000 → 壹仟元整；0 → 零元整。
 */
export function rmbUpper(n: number): string {
  const amount = Math.round((Number(n) || 0) * 100) / 100
  if (amount === 0) return '零元整'
  const neg = amount < 0
  const x = Math.abs(amount)
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const intUnits = ['', '拾', '佰', '仟']
  const bigUnits = ['', '万', '亿', '兆']
  const intPart = Math.floor(x)
  const dec = Math.round((x - intPart) * 100)
  const jiao = Math.floor(dec / 10)
  const fen = dec % 10
  let s = ''
  if (intPart === 0) {
    s = '零'
  } else {
    const group: string[] = []
    // 按 4 位分组
    const groups: number[] = []
    let rest = intPart
    while (rest > 0) { groups.unshift(rest % 10000); rest = Math.floor(rest / 10000) }
    groups.forEach((g, gi) => {
      const big = bigUnits[groups.length - 1 - gi]
      if (g === 0) { group.push('零'); return }
      let gs = ''
      const gd = String(g).padStart(4, '0').split('').map(Number)
      let zero = false
      gd.forEach((d, di) => {
        if (d === 0) { zero = true } else {
          if (zero) gs += '零'
          zero = false
          gs += digits[d] + intUnits[3 - di]
        }
      })
      group.push(gs + big)
    })
    s = group.join('').replace(/零+/g, '零').replace(/零$/, '').replace(/^零+/, '')
  }
  let result = ''
  if (intPart > 0) result += s + '元'
  if (jiao > 0) result += digits[jiao] + '角'
  if (fen > 0) {
    if (jiao === 0 && intPart > 0) result += '零'  // 元与分之间补零，如 100.05→壹佰元零伍分
    result += digits[fen] + '分'
  }
  if (jiao === 0 && fen === 0) result += '整'      // 整元金额
  return (neg ? '负' : '') + result
}
