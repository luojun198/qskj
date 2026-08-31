/**
 * 分组导航页插画配置
 *
 * 为导航卡片（BentoGrid / ProcessFlow）提供"清新淡彩渐变"插画的调色板与解析逻辑。
 * 插画全部由 NavCardArt.vue 用 SVG/CSS 参数化生成，离线可用、不依赖任何图片二进制资源。
 *
 * - PALETTES：约 12 套淡彩渐变（from/to 为浅色渐变两端，accent 为强调色）。
 * - GROUP_PALETTE：分组标题 → 主调色板，保证同模块色系协调。
 * - FLOW_COLOR_PALETTE：flowConfig 中 FlowNode.color → 调色板，复用现有蓝/绿/橙/紫/红/青语义。
 * - getNavArt：按分组与卡片序号给出 { palette, variant, accent }，相邻卡片用不同形状变体。
 */

export interface Palette {
  /** 渐变起始色（浅） */
  from: string
  /** 渐变结束色（浅） */
  to: string
  /** 强调色（图标 / 装饰形状 / 提示箭头） */
  accent: string
}

export type PaletteName =
  | 'sky'
  | 'mint'
  | 'lavender'
  | 'peach'
  | 'cyan'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'lime'
  | 'indigo'
  | 'slate'
  | 'teal'

/** 12 套清新淡彩渐变调色板 */
export const PALETTES: Record<PaletteName, Palette> = {
  sky: { from: '#eaf3ff', to: '#d6e9ff', accent: '#409eff' },
  mint: { from: '#e9f8ee', to: '#d4f1e0', accent: '#42b883' },
  lavender: { from: '#f1ecfc', to: '#e6d9fb', accent: '#9c6ade' },
  peach: { from: '#fff0e8', to: '#ffe0d1', accent: '#ff8a5b' },
  cyan: { from: '#e6f9fb', to: '#cdf0f5', accent: '#17c0d4' },
  amber: { from: '#fff6e0', to: '#ffeec2', accent: '#f0a020' },
  rose: { from: '#ffecf1', to: '#ffd9e3', accent: '#f56991' },
  violet: { from: '#efeaff', to: '#ddd2ff', accent: '#7c5cff' },
  lime: { from: '#f1f9e3', to: '#e2f2c8', accent: '#82c91e' },
  indigo: { from: '#e9edff', to: '#d4dcff', accent: '#5566e8' },
  slate: { from: '#eef1f6', to: '#dde3ec', accent: '#64748b' },
  teal: { from: '#e3f6f3', to: '#cdeeea', accent: '#14b8a6' },
}

/** 形状变体数量（NavCardArt 内部据此切换装饰图案） */
export const VARIANT_COUNT = 6

/** 分组标题 → 主调色板（同模块协调） */
const GROUP_PALETTE: Record<string, PaletteName> = {
  凭证管理: 'sky',
  账簿管理: 'indigo',
  辅助核算: 'lavender',
  报表管理: 'mint',
  出纳管理: 'cyan',
  固定资产: 'amber',
  销售管理: 'rose',
  采购管理: 'peach',
  生产管理: 'violet',
  委外管理: 'teal',
  库存: 'lime',
  基础设置: 'sky',
  系统管理: 'slate',
  数据安全: 'rose',
}

/** flowConfig 的颜色语义 → 调色板 */
const FLOW_COLOR_PALETTE: Record<string, PaletteName> = {
  blue: 'sky',
  green: 'mint',
  orange: 'peach',
  purple: 'violet',
  red: 'rose',
  cyan: 'cyan',
  yellow: 'amber',
}

/** 所有调色板名（用于按序号轮换出多风格） */
const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]

export interface NavArt {
  palette: PaletteName
  variant: number
  accent: string
}

/**
 * 便当格卡片：按分组取主色板，相邻卡片用不同形状变体。
 * 为增强"多风格"，在主色板基础上按序号小幅偏移色板，使邻卡既协调又各异。
 */
export function getNavArt(groupTitle: string, index: number): NavArt {
  const base = GROUP_PALETTE[groupTitle] || 'sky'
  const baseIdx = PALETTE_NAMES.indexOf(base)
  // 在主色板附近的色板间轮换（±范围内），保证同组协调又不雷同
  const palette = PALETTE_NAMES[(baseIdx + (index % 3)) % PALETTE_NAMES.length]
  return {
    palette,
    variant: index % VARIANT_COUNT,
    accent: PALETTES[palette].accent,
  }
}

/** 流程卡片：依据 FlowNode.color 取色板，按序号取形状变体 */
export function getFlowArt(color: string | undefined, index: number): NavArt {
  const palette = FLOW_COLOR_PALETTE[color || 'blue'] || 'sky'
  return {
    palette,
    variant: index % VARIANT_COUNT,
    accent: PALETTES[palette].accent,
  }
}
