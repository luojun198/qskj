/**
 * 物料档案列表（GET /scm/items，搜索 / 分页模式）的多级排序白名单。
 * key 与前端 ItemList.vue 的列设置列 key 一致；表达式只依赖别名 i(scm_item)。
 * 树形模式（all=1）由前端对每层 children 排序，不走这里。
 */
import { buildMultiOrderBy, type BuiltOrderBy } from '../utils/multiSort.js'

export const ITEM_LIST_SORT_WHITELIST: Record<string, string> = {
  code: 'i.code',
  name: 'i.name',
  spec: 'i.spec',
  // 单位按主计量单位名称排序（与列表显示的 unit_name 一致），无主单位时退回 i.unit
  unit: `COALESCE((SELECT u.name FROM scm_item_unit iu JOIN scm_unit u ON u.account_set_id=iu.account_set_id AND u.code=iu.unit_code
    WHERE iu.account_set_id=i.account_set_id AND iu.item_code=i.code AND iu.is_primary=1 LIMIT 1), i.unit)`,
  item_type: 'i.item_type',
  is_leaf: 'COALESCE(i.is_leaf,1)',
  purchase_price: 'i.purchase_price',
  sale_price: 'i.sale_price',
  barcode: 'i.barcode',
  short_code: 'i.short_code',
  is_asset: 'COALESCE(i.is_asset,0)',
  remark: 'i.remark',
}

export const ITEM_LIST_NUMERIC_SORT_KEYS: ReadonlySet<string> = new Set(['is_leaf', 'purchase_price', 'sale_price', 'is_asset'])

/** 自定义字段列 field_<字段键>：取 scm_item.field_values JSON 中的值 */
function resolveCustomField(key: string): string | null {
  const m = /^field_([A-Za-z0-9_]+)$/.exec(key)
  if (!m) return null
  return `(CASE WHEN json_valid(i.field_values) THEN json_extract(i.field_values,'$.${m[1]}') END)`
}

/** 返回完整 `ORDER BY ...`；未传/无有效排序 → 物料编号升序（旧行为）。 */
export function buildItemListOrderBy(sort: unknown): BuiltOrderBy {
  return buildMultiOrderBy(sort, {
    whitelist: ITEM_LIST_SORT_WHITELIST,
    resolve: resolveCustomField,
    numericKeys: ITEM_LIST_NUMERIC_SORT_KEYS,
    defaultOrderBy: 'i.code',
    tieBreakers: ['i.code', 'i.id'],
  })
}
