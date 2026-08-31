import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const inputPath = path.join(root, '优化日志.md')
const outputPath = path.join(root, '优化日志.txt')

function stripCode(text) {
  return text.replace(/`([^`]*)`/g, (_, inner) => (/[\u4e00-\u9fff]/.test(inner) ? inner : ''))
}

function normalize(text) {
  return stripCode(text)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?:client|server)\/[\w./-]+/g, '')
    .replace(/\b[\w.-]+\.(vue|ts|tsx|css|md|json|sql|bat|sh|mjs)\b/gi, '')
    .replace(/<\/?[\w-]+[^>]*>/g, '')
    .replace(/（新建）|\(新建\)/g, '')
    .replace(/height="100%"/g, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/\bHero\b/g, '首页')
    .replace(/\bDashboard\b/g, '主面板')
    .replace(/\bborder\b/gi, '边框')
    .replace(/\blink 样式\b/gi, '')
    .replace(/[：:]\s*[、，；]/g, '：')
    .replace(/[；;]{2,}/g, '；')
    .replace(/^[；;,\s]+|[；;,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function qualityBullet(t) {
  if (!t || t.length < 8) return false
  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length
  if (cn < 8) return false
  if (/根因|幂等|flex|Layout|main\s|底边|容器顶边|写入后调用|走\s+的列表|GET\s|built|composable|el-/i.test(t)) return false
  if (/[：:]\s*$/.test(t)) return false
  if (/^[\/\+]|\s\/\s/.test(t)) return false
  if ((t.match(/[、，]/g) || []).length >= 3 && cn < 22) return false
  return true
}

const TECH_LINE =
  /根因[:：]|幂等|事务包裹|回归测试|新增\s*\d+\s*个用例|line\s+\d+|GET\s+\/|POST\s+\/|\/api\/|migration|rebuild|applyVoucher|account_balances|aux_item_id|clientHeight|ResizeObserver|composable|useFill|exportStyled|ensureWorksheet|measureTable|\.page|\.main|100vh|Element Plus|worktree|__tests__|middleware|CSS Grid|ellipsis|size="small"|pagination-bar|compact-data-table|el-card|el-select|scoped|teleport|tooltip|CSS 变量|z-index|单测|测试：|断言/i

function isUserFacingLine(line) {
  const t = normalize(line.replace(/^[-*]\s+/, ''))
  if (TECH_LINE.test(t)) return false
  return qualityBullet(t)
}

function formatImpact(text) {
  let t = normalize(text.replace(/^[-*]\s+/gm, ''))
  t = t
    .replace(/纯前端改动?[；;]?/g, '')
    .replace(/纯前端[；;]?/g, '')
    .replace(/无需重启后端[；;]?/g, '')
    .replace(/后端修改，需要重启服务/g, '更新后需重新启动系统服务')
    .replace(/需要重启服务/g, '需重新启动系统服务')
    .replace(/需重启后端/g, '需重新启动系统服务')
    .replace(/后端改动需重启服务/g, '更新后需重新启动系统服务')
    .replace(/刷新页面即可/g, '刷新页面后生效')
    .replace(/刷新即可/g, '刷新页面后生效')
    .replace(/；+/g, '；')
    .replace(/^[；;,\s]+|[；;,\s]+$/g, '')
    .replace(/；。$/g, '。')
    .replace(/^、+/g, '')
    .replace(/；，/g, '；')
    .replace(/样式，/g, '')
    .replace(/所有走\s+的列表导出/g, '所有列表页导出 Excel')
    .replace(/link 样式/g, '')
  if (!t || t === '；' || t.length < 4) return ''
  return t
}

function formatReason(text) {
  let t = normalize(text.replace(/^[-*]\s+/gm, ''))
  if (/根因[:：]|bug|API|SQL|脚本聚合|测试用例|脏数据|调用方漏调/i.test(t)) {
    const m = t.match(/用户[^。；]+[。；]?/)
    if (m) return m[0].replace(/；$/, '。')
    return ''
  }
  if (!t || t.length < 4) return ''
  return t.endsWith('。') ? t : t + '。'
}

function bulletLines(text) {
  return text
    .split(/\n/)
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(isUserFacingLine)
    .map(l => normalize(l))
    .filter(qualityBullet)
}

/** 部分条目原文偏技术，为用户改写简要说明 */
const DESC_OVERRIDE = {
  '系统参数新增会计准则与 Dashboard 取数规则': [
    '系统参数中新增「会计准则」选项，可按政府会计、小企业、新企业等准则切换。',
    '主面板收入、支出、费用、成本的统计规则随所选会计准则自动调整。',
    '从标准模板建账时会自动写入默认会计准则；主面板展示当前取数口径说明。',
  ],
  '全局列表表格恢复垂直滚动条（视口测算）': [
    '修复所有列表页面表格无法上下滚动的问题。',
    '表头保持固定，数据较多时可在表格区域内滚动查看。',
  ],
  '全局列表表格恢复垂直滚动条': [
    '优化整体页面布局，使账簿、凭证、基础数据等列表表格恢复正常垂直滚动。',
  ],
  '报表页超长内容显示垂直滚动条': [
    '动态报表、现金流量表等内容过长时，可在报表区域内滚动查看，顶部工具栏保持固定。',
  ],
  '列表导出 Excel 统一补齐网格线': [
    '各列表页导出 Excel 时，表格单元格均显示清晰网格线，与界面表格风格一致。',
  ],
  '修复动态报表合并单元格行间间隙': [
    '修复利润表等模板中合并单元格之间出现空白间隙、网格线断裂的问题。',
  ],
  '修复趋势分析未统计管理费用下级科目': [
    '主面板趋势图中「费用」统计现已包含管理费用下的明细科目（如通讯费、办公费等）。',
  ],
}

function fallbackDesc(title) {
  if (DESC_OVERRIDE[title]) return DESC_OVERRIDE[title]
  if (/^修复/.test(title)) return [`${title.replace(/^修复/, '已修复：')}`]
  if (/^新增|^增加/.test(title)) return [`${title}。`]
  if (/^优化/.test(title)) return [`${title}。`]
  return [`已完成「${title}」相关更新，请在对应功能页面查看效果。`]
}

const input = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '')
const lines = input.split(/\r?\n/)

const entries = []
let currentDate = ''
let skipFiles = false
let field = ''
let buf = []
let currentTitle = ''

function flushField() {
  if (!field || !buf.length) {
    buf = []
    return
  }
  const raw = buf.join('\n').trim()
  buf = []
  const f = field
  field = ''

  if (!entries.length) return
  const entry = entries[entries.length - 1]
  if (f === 'desc') entry.desc = bulletLines(raw)
  else if (f === 'reason') entry.reason = raw
  else if (f === 'impact') entry.impact = raw
}

for (const line of lines) {
  const mDate = line.match(/^##\s+(.+)$/)
  const mTitle = line.match(/^###\s+(.+)$/)

  if (mDate) {
    flushField()
    skipFiles = false
    currentDate = mDate[1].trim()
    continue
  }

  if (mTitle) {
    flushField()
    skipFiles = false
    currentTitle = mTitle[1].trim().replace(/^\d+\.\s*/, '')
    entries.push({ date: currentDate, title: currentTitle, desc: [], reason: '', impact: '' })
    continue
  }

  if (/^\*\*修改文件/.test(line.trim())) {
    flushField()
    skipFiles = true
    continue
  }

  if (/^\*\*具体说明/.test(line.trim())) {
    flushField()
    skipFiles = false
    field = 'desc'
    const rest = line.replace(/^\*\*具体说明：?\*\*\s*/, '')
    if (rest.trim()) buf.push(rest)
    continue
  }

  if (/^\*\*原因/.test(line.trim())) {
    flushField()
    skipFiles = false
    field = 'reason'
    const rest = line.replace(/^\*\*原因：?\*\*\s*/, '')
    if (rest.trim()) buf.push(rest)
    continue
  }

  if (/^\*\*影响范围/.test(line.trim())) {
    flushField()
    skipFiles = false
    field = 'impact'
    const rest = line.replace(/^\*\*影响范围：?\*\*\s*/, '')
    if (rest.trim()) buf.push(rest)
    continue
  }

  if (/^---+$/.test(line.trim())) continue

  if (skipFiles) {
    if (line.trim() === '') skipFiles = false
    continue
  }

  if (field) {
    if (line.trim() === '') flushField()
    else if (!/^[-*]\s*`[^`]*`\s*$/.test(line.trim())) buf.push(line)
  }
}
flushField()

const out = []
out.push('CW 财务系统 — 功能更新与优化记录（用户阅读版）')
out.push('='.repeat(52))
out.push('')
out.push('说明：')
out.push('  本文档由系统维护日志整理而成，便于了解各版本的功能改进与问题修复。')
out.push('  已去除程序代码、文件名等技术信息，仅保留与日常使用相关的内容。')
out.push('')

let lastDate = ''
for (const entry of entries) {
  if (entry.date && entry.date !== lastDate) {
    lastDate = entry.date
    out.push('')
    out.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    out.push(`  日期：${entry.date}`)
    out.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    out.push('')
  }

  out.push(`● ${entry.title}`)

  let desc = entry.desc?.length ? entry.desc : fallbackDesc(entry.title)
  if (DESC_OVERRIDE[entry.title]) desc = DESC_OVERRIDE[entry.title]

  out.push('  【更新内容】')
  for (const item of desc) out.push(`    · ${item}`)
  out.push('')

  const reason = formatReason(entry.reason || '')
  if (reason) {
    out.push('  【改进原因】')
    out.push(`    ${reason}`)
    out.push('')
  }

  const impact = formatImpact(entry.impact || '')
  if (impact) {
    out.push('  【使用说明】')
    out.push(`    ${impact}`)
    out.push('')
  }
}

out.push('')
out.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
out.push('  文档结束')
out.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
out.push('')

const final = out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'
fs.writeFileSync(outputPath, final, 'utf8')
console.log(`已生成：${outputPath}`)
console.log(`共 ${final.split('\n').length} 行，${entries.length} 条记录`)
