import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface CashFlowItem {
  id: string
  account_set_id: string
  code: string
  name: string
  direction: 'inflow' | 'outflow' | 'neutral'
  parent_code: string | null
  level: number
  is_leaf: number
  sort_order: number
  is_active: number
  /** main 主表项目 / supplement 附表（补充资料）项目 */
  kind?: 'main' | 'supplement'
  created_at: string
  updated_at: string
}

/**
 * 获取现金流量项目列表
 */
export function getCashFlowItems(accountSetId: string): CashFlowItem[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT * FROM cash_flow_items
    WHERE account_set_id = ? AND is_active = 1
    ORDER BY code
  `)
  const items = stmt.all(accountSetId) as CashFlowItem[]
  if (items.length > 0) return items

  // 兼容仅写入核算项目、未同步 cash_flow_items 的账套
  const auxRows = db
    .prepare(
      `SELECT ai.code, ai.name
       FROM aux_items ai
       INNER JOIN aux_categories ac ON ac.id = ai.type
       WHERE ai.account_set_id = ? AND ac.code = 'cash_flow' AND ai.status = 'active'
       ORDER BY ai.code`
    )
    .all(accountSetId) as Array<{ code: string; name: string }>

  const now = new Date().toISOString()
  return auxRows.map(row => ({
    id: row.code,
    account_set_id: accountSetId,
    code: row.code,
    name: row.name,
    direction: 'neutral' as const,
    parent_code: null,
    level: 1,
    is_leaf: 1,
    sort_order: 0,
    is_active: 1,
    created_at: now,
    updated_at: now,
  }))
}

/**
 * 获取现金流量项目树形结构
 */
export function getCashFlowTree(accountSetId: string): any[] {
  const items = getCashFlowItems(accountSetId)
  
  // 构建树形结构
  const itemMap = new Map<string, any>()
  const roots: any[] = []
  
  // 第一遍：创建所有节点
  items.forEach(item => {
    itemMap.set(item.code, {
      ...item,
      children: []
    })
  })
  
  // 第二遍：建立父子关系
  items.forEach(item => {
    const node = itemMap.get(item.code)!
    if (item.parent_code && itemMap.has(item.parent_code)) {
      const parent = itemMap.get(item.parent_code)!
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })
  
  return roots
}

/**
 * 根据编码获取现金流量项目
 */
export function getCashFlowItemByCode(accountSetId: string, code: string): CashFlowItem | null {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT * FROM cash_flow_items
    WHERE account_set_id = ? AND code = ?
  `)
  return stmt.get(accountSetId, code) as CashFlowItem | null
}

/**
 * 创建现金流量项目
 */
export function createCashFlowItem(data: Omit<CashFlowItem, 'id' | 'created_at' | 'updated_at'>): CashFlowItem {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  
  const stmt = db.prepare(`
    INSERT INTO cash_flow_items (
      id, account_set_id, code, name, direction, parent_code, 
      level, is_leaf, sort_order, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    id,
    data.account_set_id,
    data.code,
    data.name,
    data.direction,
    data.parent_code,
    data.level,
    data.is_leaf,
    data.sort_order,
    data.is_active,
    now,
    now
  )
  
  return {
    id,
    ...data,
    created_at: now,
    updated_at: now
  }
}

/**
 * 批量创建现金流量项目
 */
export function batchCreateCashFlowItems(
  accountSetId: string,
  items: Array<{
    code: string
    name: string
    direction: 'inflow' | 'outflow' | 'neutral'
    parent_code?: string
    level?: number
    sort_order?: number
  }>
): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO cash_flow_items (
      id, account_set_id, code, name, direction, parent_code, 
      level, is_leaf, sort_order, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  const now = new Date().toISOString()
  let count = 0
  
  const insertMany = db.transaction(() => {
    for (const item of items) {
      const id = uuidv4()
      stmt.run(
        id,
        accountSetId,
        item.code,
        item.name,
        item.direction,
        item.parent_code || null,
        item.level || 1,
        1, // is_leaf
        item.sort_order || 0,
        1, // is_active
        now,
        now
      )
      count++
    }
  })
  
  insertMany()
  return count
}

/**
 * 更新现金流量项目
 */
export function updateCashFlowItem(
  id: string,
  data: Partial<Omit<CashFlowItem, 'id' | 'account_set_id' | 'created_at' | 'updated_at'>>,
  accountSetId?: string
): void {
  const db = getDb()
  const fields: string[] = []
  const values: any[] = []
  
  if (data.code !== undefined) {
    fields.push('code = ?')
    values.push(data.code)
  }
  if (data.name !== undefined) {
    fields.push('name = ?')
    values.push(data.name)
  }
  if (data.direction !== undefined) {
    fields.push('direction = ?')
    values.push(data.direction)
  }
  if (data.parent_code !== undefined) {
    fields.push('parent_code = ?')
    values.push(data.parent_code)
  }
  if (data.level !== undefined) {
    fields.push('level = ?')
    values.push(data.level)
  }
  if (data.is_leaf !== undefined) {
    fields.push('is_leaf = ?')
    values.push(data.is_leaf)
  }
  if (data.sort_order !== undefined) {
    fields.push('sort_order = ?')
    values.push(data.sort_order)
  }
  if (data.is_active !== undefined) {
    fields.push('is_active = ?')
    values.push(data.is_active)
  }
  
  if (fields.length === 0) return
  
  fields.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  // 传入账套则限定归属，防止跨账套修改（多账套隔离）
  let where = 'WHERE id = ?'
  if (accountSetId != null) {
    where += ' AND account_set_id = ?'
    values.push(accountSetId)
  }

  const stmt = db.prepare(`
    UPDATE cash_flow_items
    SET ${fields.join(', ')}
    ${where}
  `)

  stmt.run(...values)
}

/**
 * 删除现金流量项目（软删除）
 */
export function deleteCashFlowItem(id: string, accountSetId?: string): void {
  const db = getDb()
  const params: any[] = [new Date().toISOString(), id]
  // 传入账套则限定归属，防止跨账套删除（多账套隔离）
  let where = 'WHERE id = ?'
  if (accountSetId != null) {
    where += ' AND account_set_id = ?'
    params.push(accountSetId)
  }
  const stmt = db.prepare(`
    UPDATE cash_flow_items
    SET is_active = 0, updated_at = ?
    ${where}
  `)
  stmt.run(...params)
}

/**
 * 初始化默认现金流量项目（从润衡数据导入）
 */
export function initDefaultCashFlowItems(accountSetId: string): number {
  // 润衡软件的标准现金流量项目
  const defaultItems = [
    // 经营活动现金流量（1xxx）
    { code: '1000', name: '现金科目内部流转', direction: 'neutral' as const, sort_order: 1 },
    { code: '1101', name: '销售商品提供劳务收现', direction: 'inflow' as const, sort_order: 2 },
    { code: '1102', name: '收到的税费返还', direction: 'inflow' as const, sort_order: 3 },
    { code: '1103', name: '其他经营收现', direction: 'inflow' as const, sort_order: 4 },
    { code: '1201', name: '购买商品接受劳务付现', direction: 'outflow' as const, sort_order: 5 },
    { code: '1202', name: '支付给职工或为职工付现', direction: 'outflow' as const, sort_order: 6 },
    { code: '1203', name: '各项税费付现', direction: 'outflow' as const, sort_order: 7 },
    { code: '1204', name: '其他经营活动付现', direction: 'outflow' as const, sort_order: 8 },
    
    // 投资活动现金流量（2xxx）
    { code: '2101', name: '收回投资收现', direction: 'inflow' as const, sort_order: 9 },
    { code: '2102', name: '取得投资收益收现', direction: 'inflow' as const, sort_order: 10 },
    { code: '2103', name: '处置资产收现', direction: 'inflow' as const, sort_order: 11 },
    { code: '2104', name: '其他投资活动收现', direction: 'inflow' as const, sort_order: 12 },
    { code: '2105', name: '处置子公司或其他营业单位收现', direction: 'inflow' as const, sort_order: 13 },
    { code: '2201', name: '购建资产付现', direction: 'outflow' as const, sort_order: 14 },
    { code: '2202', name: '投资付现', direction: 'outflow' as const, sort_order: 15 },
    { code: '2203', name: '其他投资活动付现', direction: 'outflow' as const, sort_order: 16 },
    { code: '2204', name: '取得子公司或其他营业单位付现', direction: 'outflow' as const, sort_order: 17 },
    
    // 筹资活动现金流量（3xxx）
    { code: '3101', name: '吸收投资收现', direction: 'inflow' as const, sort_order: 18 },
    { code: '3102', name: '借款收现', direction: 'inflow' as const, sort_order: 19 },
    { code: '3103', name: '其他筹资活动收现', direction: 'inflow' as const, sort_order: 20 },
    { code: '3201', name: '偿还债务付现', direction: 'outflow' as const, sort_order: 21 },
    { code: '3202', name: '分配利润付现', direction: 'outflow' as const, sort_order: 22 },
    { code: '3203', name: '偿付利息付现', direction: 'outflow' as const, sort_order: 23 },
    { code: '3204', name: '其他筹资活动付现', direction: 'outflow' as const, sort_order: 24 },
    
    // 汇率影响（4xxx）
    { code: '4101', name: '汇率影响', direction: 'neutral' as const, sort_order: 25 },
  ]
  
  return batchCreateCashFlowItems(accountSetId, defaultItems)
}
