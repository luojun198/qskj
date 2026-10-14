/**
 * BOM 选版与替代料（阶段 C-1）。
 *
 * - 选版：`pickActiveBom` 按「启用 + 生效期覆盖 asOf 日期」筛选，再按 默认 → 生效日晚者 → 版本号 → 编码 取一张。
 *   原来所有运算只看 status='active' ORDER BY is_default,code，版本与生效/失效日期写入后无任何读取方。
 * - 替代料：同一 `sub_group` 内的行互为替代，`sub_priority` 最小（或未填）的是主料，其余按优先级依次替代。
 *   需求 / 用料按主料展开；主料库存不足时，`substituteStock` 给出同组替代料可用库存供 MRP 净需求抵扣与领料建议。
 */
import { todayStr } from '../utils/localDate.js'
import type Database from 'better-sqlite3'

export interface BomHead { id: string; code: string; version?: string | null }

export function pickActiveBom(db: Database.Database, aid: string, itemCode: string, asOf?: string | null): BomHead | null {
  const d = String(asOf || '').slice(0, 10) || todayStr()
  return (db.prepare(`SELECT id, code, version FROM scm_bom
    WHERE account_set_id=? AND item_code=? AND status='active'
      AND (effective_date IS NULL OR effective_date='' OR substr(effective_date,1,10) <= ?)
      AND (expire_date IS NULL OR expire_date='' OR substr(expire_date,1,10) >= ?)
    ORDER BY is_default DESC, COALESCE(substr(effective_date,1,10),'') DESC, COALESCE(version,'') DESC, code
    LIMIT 1`).get(aid, itemCode, d, d) as BomHead | undefined) || null
}

export interface BomComponent {
  item_code: string
  qty: number
  unit?: string | null
  scrap_rate: number
  remark?: string | null
  sub_group?: string | null
  sub_priority?: number | null
  /** 同组替代料（按优先级排序），不含自身 */
  substitutes: Array<{ item_code: string; qty: number; sub_priority: number }>
}

/**
 * 读取 BOM 主件行并折叠替代料：每个替代组只保留主料一行（承载用量），其余替代料挂在 `substitutes` 上。
 * 不分组或分组内只有一行的按原样返回。
 */
export function bomComponents(db: Database.Database, bomId: string): BomComponent[] {
  const rows = db.prepare(`SELECT item_code, qty, unit, COALESCE(scrap_rate,0) AS scrap_rate, remark, sub_group, COALESCE(sub_priority,0) AS sub_priority
    FROM scm_bom_line WHERE bom_id=? AND line_type='component' ORDER BY seq`).all(bomId) as any[]
  const out: BomComponent[] = []
  const groups = new Map<string, BomComponent>()
  for (const r of rows) {
    const g = String(r.sub_group || '').trim()
    if (!g) { out.push({ ...r, substitutes: [] }); continue }
    const primary = groups.get(g)
    if (!primary) {
      const c: BomComponent = { ...r, substitutes: [] }
      groups.set(g, c); out.push(c)
      continue
    }
    // 优先级更小的成为主料，原主料退为替代
    if (Number(r.sub_priority) < Number(primary.sub_priority)) {
      primary.substitutes.push({ item_code: primary.item_code, qty: Number(primary.qty) || 0, sub_priority: Number(primary.sub_priority) || 0 })
      primary.item_code = r.item_code; primary.qty = r.qty; primary.unit = r.unit; primary.scrap_rate = r.scrap_rate
      primary.remark = r.remark; primary.sub_priority = r.sub_priority
    } else {
      primary.substitutes.push({ item_code: r.item_code, qty: Number(r.qty) || 0, sub_priority: Number(r.sub_priority) || 0 })
    }
  }
  for (const c of out) c.substitutes.sort((a, b) => a.sub_priority - b.sub_priority)
  return out
}

/** 替代料可用库存（全仓在库合计，按优先级排序），供主料缺料时抵扣 */
export function substituteStock(db: Database.Database, aid: string, comp: BomComponent, warehouse?: string | null) {
  return comp.substitutes.map(s => {
    const row = warehouse
      ? db.prepare('SELECT COALESCE(SUM(qty),0) q FROM scm_stock WHERE account_set_id=? AND item_code=? AND warehouse_code=?').get(aid, s.item_code, warehouse) as any
      : db.prepare('SELECT COALESCE(SUM(qty),0) q FROM scm_stock WHERE account_set_id=? AND item_code=?').get(aid, s.item_code) as any
    return { item_code: s.item_code, sub_priority: s.sub_priority, on_hand: Math.max(0, Number(row?.q) || 0) }
  })
}

/**
 * BOM 必须至少有一行「主件」：计划用料、领料 / 委外发料、成本上卷只取主件，
 * 全部选成副产品 / 联产品时计划用料为 0、委外发料无物料可发（客户反馈）。
 */
export function bomLinesError(lines: unknown): string | null {
  if (!Array.isArray(lines)) return null
  const valid = lines.filter((l: any) => l && l.item_code)
  if (!valid.length) return null
  if (!valid.some((l: any) => (l.line_type || 'component') === 'component')) {
    return 'BOM 至少需要一行「主件」组件：副产品 / 联产品不计入用料，全部选成副产品时计划将没有用料、无法领料或委外发料'
  }
  return null
}
