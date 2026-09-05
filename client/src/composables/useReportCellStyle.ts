/**
 * report_cells.style_key 的编解码。
 *
 * style_key 是一串空格分隔的 token，与动态报表（DynamicReport.vue:628-711）的约定保持一致，
 * 以便同一份数据在两处呈现相同。已有约定：
 *   align-left|center|right          水平对齐
 *   valign-top|middle|bottom         垂直对齐
 *   font-size-N                      字号
 *   font-bold / font-underline       加粗 / 下划线
 *   font-family-XXX                  字体族（见 FONT_FAMILY_MAP）
 *   border-all|none|outer|header|top|bottom|left|right
 *   border-color-RRGGBB / border-width-N
 *
 * 本文件新增两个 token（动态报表的解析器不认识它们，但会安全忽略，不影响兼容）：
 *   text-color-RRGGBB                文字颜色
 *   bg-color-RRGGBB                  单元格底色
 */

export type CellStyle = {
  textAlign: '' | 'left' | 'center' | 'right'
  verticalAlign: '' | 'top' | 'middle' | 'bottom'
  fontSize: number
  bold: boolean
  underline: boolean
  fontFamily: string
  borderStyle: string
  borderColor: string
  borderWidth: number
  textColor: string
  bgColor: string
}

/** font-family-XXX 的 token ↔ CSS font-family */
export const FONT_FAMILY_OPTIONS = [
  { token: '', label: '默认', css: '' },
  { token: 'SimSun', label: '宋体', css: '"SimSun", 宋体, serif' },
  { token: 'SimHei', label: '黑体', css: '"SimHei", 黑体, sans-serif' },
  { token: 'KaiTi', label: '楷体', css: '"KaiTi", 楷体, serif' },
  { token: 'FangSong', label: '仿宋', css: '"FangSong", 仿宋, serif' },
  { token: 'Microsoft-YaHei', label: '微软雅黑', css: '"Microsoft YaHei", 微软雅黑, sans-serif' },
] as const

/**
 * 字号选项（px）。
 * 覆盖 ACD 还原出来的常见值——原报表用磅值，换算成 px 后是 12/13/15/16/19/21/27/32 这类，
 * 光给整十的档位会对不上；工具栏另外允许直接输入任意值。
 */
export const FONT_SIZE_OPTIONS = [
  9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 24, 26, 28, 32, 36, 40, 48,
]

export const BORDER_STYLE_OPTIONS = [
  { value: 'all', label: '全部框线' },
  { value: 'outer', label: '外框线' },
  { value: 'header', label: '标题线' },
  { value: 'top', label: '上框线' },
  { value: 'bottom', label: '下框线' },
  { value: 'left', label: '左框线' },
  { value: 'right', label: '右框线' },
  { value: 'none', label: '无框线' },
]

/** 数字格式，取值与 report_cells.format_text 一致 */
export const NUMBER_FORMAT_OPTIONS = [
  { value: '', label: '常规' },
  { value: 'integer', label: '整数' },
  { value: '2decimal', label: '两位小数' },
  { value: '4decimal', label: '四位小数' },
  { value: 'thousands', label: '千分位' },
  { value: 'percent', label: '百分比' },
]

const DEFAULT_STYLE: CellStyle = {
  textAlign: '',
  verticalAlign: '',
  fontSize: 0,
  bold: false,
  underline: false,
  fontFamily: '',
  borderStyle: '',
  borderColor: '',
  borderWidth: 0,
  textColor: '',
  bgColor: '',
}

/** 把 #RRGGBB / RRGGBB 归一成不带 # 的大写六位；非法值返回空串 */
function normalizeColor(value: string | null | undefined) {
  const raw = String(value || '').replace(/^#/, '').trim()
  return /^[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : ''
}

export function parseStyleKey(styleKey: string | null | undefined): CellStyle {
  const style: CellStyle = { ...DEFAULT_STYLE }
  for (const token of String(styleKey || '').split(/\s+/).filter(Boolean)) {
    if (token.startsWith('align-')) {
      style.textAlign = token.slice(6) as CellStyle['textAlign']
    } else if (token.startsWith('valign-')) {
      style.verticalAlign = token.slice(7) as CellStyle['verticalAlign']
    } else if (token.startsWith('font-size-')) {
      style.fontSize = Number(token.slice(10)) || 0
    } else if (token === 'font-bold') {
      style.bold = true
    } else if (token === 'font-underline') {
      style.underline = true
    } else if (token.startsWith('font-family-')) {
      style.fontFamily = token.slice(12)
    } else if (token.startsWith('border-color-')) {
      style.borderColor = normalizeColor(token.slice(13))
    } else if (token.startsWith('border-width-')) {
      style.borderWidth = Number(token.slice(13)) || 0
    } else if (token.startsWith('text-color-')) {
      style.textColor = normalizeColor(token.slice(11))
    } else if (token.startsWith('bg-color-')) {
      style.bgColor = normalizeColor(token.slice(9))
    } else if (token.startsWith('border-')) {
      // border-all / outer / header / top / bottom / left / right / none
      style.borderStyle = token.slice(7)
    }
  }
  return style
}

export function buildStyleKey(style: Partial<CellStyle>): string {
  const tokens: string[] = []
  if (style.textAlign) tokens.push(`align-${style.textAlign}`)
  if (style.verticalAlign) tokens.push(`valign-${style.verticalAlign}`)
  if (style.fontSize) tokens.push(`font-size-${style.fontSize}`)
  if (style.bold) tokens.push('font-bold')
  if (style.underline) tokens.push('font-underline')
  if (style.fontFamily) tokens.push(`font-family-${style.fontFamily}`)
  if (style.borderStyle) tokens.push(`border-${style.borderStyle}`)
  if (style.borderColor) tokens.push(`border-color-${normalizeColor(style.borderColor)}`)
  if (style.borderWidth) tokens.push(`border-width-${style.borderWidth}`)
  if (style.textColor) tokens.push(`text-color-${normalizeColor(style.textColor)}`)
  if (style.bgColor) tokens.push(`bg-color-${normalizeColor(style.bgColor)}`)
  return tokens.join(' ')
}

/** 在既有 style_key 上合并若干改动，返回新的 style_key */
export function mergeStyleKey(styleKey: string | null | undefined, patch: Partial<CellStyle>) {
  return buildStyleKey({ ...parseStyleKey(styleKey), ...patch })
}

export function fontFamilyCss(token: string) {
  return FONT_FAMILY_OPTIONS.find(item => item.token === token)?.css || ''
}

/** 边框样式 → CSS，供网格与打印共用 */
export function borderCss(style: CellStyle) {
  const color = style.borderColor ? `#${style.borderColor}` : '#000'
  const width = style.borderWidth || 1
  const line = `${width}px solid ${color}`
  switch (style.borderStyle) {
    case 'all':
      return { border: line }
    case 'none':
      return { border: 'none' }
    case 'outer':
      return { border: line }
    case 'header':
      return { borderTop: line, borderBottom: line }
    case 'top':
      return { borderTop: line }
    case 'bottom':
      return { borderBottom: line }
    case 'left':
      return { borderLeft: line }
    case 'right':
      return { borderRight: line }
    default:
      return {}
  }
}

/** 数字格式化，与服务端 display_value 配合使用（服务端已格式化时不重复处理） */
export function formatNumberByType(value: string, formatType: string | null | undefined): string {
  if (!formatType) return value
  // 服务端可能已输出千分位，先去掉分隔符再解析，否则 parseFloat("1,234.00") 会得到 1
  const num = Number.parseFloat(String(value).replace(/,/g, ''))
  if (!Number.isFinite(num)) return value
  switch (formatType) {
    case 'integer':
      return String(Math.round(num))
    case '2decimal':
      return num.toFixed(2)
    case '4decimal':
      return num.toFixed(4)
    case 'percent':
      return `${(num * 100).toFixed(2)}%`
    case 'thousands':
      return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    default:
      return value
  }
}

/**
 * 把样式转成 CSS 文本，供打印用（屏幕侧走 borderCss + 内联属性，两者同源于 parseStyleKey）。
 *
 * 注意这里**不输出任何默认边框**：采用 Excel 的约定——屏幕上的浅灰网格线只是编辑辅助，
 * 不参与打印；打印只画用户真正设置过的边框。
 */
export function styleToCssText(style: CellStyle): string {
  let css = ''
  if (style.textAlign) css += `text-align:${style.textAlign};`
  if (style.verticalAlign) css += `vertical-align:${style.verticalAlign};`
  if (style.fontSize) css += `font-size:${style.fontSize}px;`
  if (style.bold) css += 'font-weight:700;'
  if (style.underline) css += 'text-decoration:underline;'
  const family = fontFamilyCss(style.fontFamily)
  if (family) css += `font-family:${family};`
  if (style.textColor) css += `color:#${style.textColor};`
  if (style.bgColor) css += `background-color:#${style.bgColor};-webkit-print-color-adjust:exact;print-color-adjust:exact;`
  for (const [key, value] of Object.entries(borderCss(style))) {
    // borderTop -> border-top
    css += `${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${value};`
  }
  return css
}
