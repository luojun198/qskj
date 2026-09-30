import { fetchAuxItemsPage } from '@/composables/useAuxItemsPage'
import { AUX_NONE } from '@/utils/cashierReportFilter'

/**
 * 辅助项目表头筛选的选项加载：按类别 + 关键词远程取一页（不整表加载）；
 * 关键词为空时首项给「（未指定）」，用来筛出没填该类别辅助的流水。
 */
export async function loadAuxItemOptions(categoryId: string, keyword: string): Promise<Array<{ value: string; label: string }>> {
  const { items } = await fetchAuxItemsPage({ category_id: categoryId, keyword, pageSize: 100 })
  const list = items.map((i: any) => ({ value: String(i.id), label: `${i.code || ''} ${i.name || ''}`.trim() || String(i.id) }))
  return keyword ? list : [{ value: AUX_NONE, label: '（未指定）' }, ...list]
}
