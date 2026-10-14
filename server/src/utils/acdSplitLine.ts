// ACD 文本表按行按 Tab 切列的公共函数（含引号内 Tab 还原）
/**
 * 按 Tab 切列，并还原「被双引号包裹、内部含 Tab」的字段。
 * ACD 导出时若字段内容含 Tab（如摘要「公司<Tab>-货款」），会把整个字段用 "..." 包起来；
 * 直接 split('\t') 会让其后所有列右移一位，借贷金额错位成 0（FIX：出纳日记账丢失 57 号等行）。
 * 仅当字段以 " 开头且不以 " 结尾时才向后合并，其余字段（含普通的单个引号）保持原样。
 */
export function splitAcdLine(line: string): string[] {
  const parts = line.split('\t')
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.startsWith('"') && !(p.length > 1 && p.endsWith('"'))) {
      let j = i
      let merged = p
      while (j + 1 < parts.length && !parts[j].endsWith('"')) {
        j++
        merged += '\t' + parts[j]
      }
      if (parts[j].endsWith('"') && j > i) {
        out.push(merged.slice(1, -1).replace(/	/g, ' '))
        i = j
        continue
      }
    }
    out.push(p)
  }
  return out
}
