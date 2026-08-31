/*
 * 统一标准模版行高 + 适配 A4。
 * - 标题行(第1行)=28pt，其余内容行=21pt（显式写入，避免未定义行回退到默认 18pt 造成"被压扁"）
 * - 设置 sheet 默认行高=21pt
 * 处理 标准模版/ 与 deploy-final/标准模版/ 下全部 .xlsx 的全部工作表。
 */
const ExcelJS = require('exceljs')
const fs = require('fs')
const path = require('path')

const TITLE_H = 28
const DATA_H = 21

function listXlsx(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) out.push(...listXlsx(full))
    else if (/\.xlsx$/i.test(name)) out.push(full)
  }
  return out
}

function cellHasContent(cell) {
  const v = cell.value
  if (v == null || v === '') return false
  if (typeof v === 'object') {
    if (v.formula != null || v.sharedFormula != null) return true
    if (Array.isArray(v.richText) && v.richText.some(s => (s.text || '').trim())) return true
    if (v.text != null && String(v.text).trim() !== '') return true
    if (v.result != null && String(v.result).trim() !== '') return true
    return false
  }
  return String(v).trim() !== ''
}

function lastContentRow(ws) {
  let last = 0
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    let has = false
    row.eachCell({ includeEmpty: false }, c => {
      if (cellHasContent(c)) has = true
    })
    if (has) last = rn
  })
  // 合并区可能延伸到无值单元格，取并集
  const merges = ws.model && ws.model.merges ? ws.model.merges : []
  for (const ref of merges) {
    const m = /(\d+):[A-Z]*?(\d+)$/.exec(ref) || /[A-Z]+(\d+):[A-Z]+(\d+)/.exec(ref)
    if (m) last = Math.max(last, Number(m[2] || m[1]))
  }
  return last
}

async function processFile(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const report = []
  for (const ws of wb.worksheets) {
    const last = lastContentRow(ws)
    if (last <= 0) continue
    ws.properties.defaultRowHeight = DATA_H
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r)
      row.height = r === 1 ? TITLE_H : DATA_H
    }
    report.push(`${ws.name}: rows 1..${last} -> 标题${TITLE_H}/数据${DATA_H}pt`)
  }
  await wb.xlsx.writeFile(file)
  return report
}

;(async () => {
  const files = [...listXlsx('标准模版'), ...listXlsx(path.join('deploy-final', '标准模版'))]
  console.log(`共 ${files.length} 个模版文件`)
  for (const f of files) {
    try {
      const rep = await processFile(f)
      console.log(`✓ ${f}\n    ${rep.join('\n    ')}`)
    } catch (e) {
      console.error(`✗ ${f}: ${e.message}`)
    }
  }
  console.log('完成')
})()
