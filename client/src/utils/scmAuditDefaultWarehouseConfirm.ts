import { h } from 'vue'
import { ElMessageBox, ElTable, ElTableColumn, ElTag } from 'element-plus'

export interface AuditDefaultWarehouseCandidate {
  seq?: number | null
  item_code: string
  item_name: string
  warehouse_code: string
  warehouse_name?: string
}

export interface AuditDefaultWarehouseConfirmation {
  doc?: { id?: string; doc_no?: string }
  candidates?: AuditDefaultWarehouseCandidate[]
  docs?: Array<{ doc?: { id?: string; doc_no?: string }; candidates?: AuditDefaultWarehouseCandidate[] }>
}

export function flattenAuditDefaultWarehouseCandidates(data: AuditDefaultWarehouseConfirmation) {
  const entries = data.doc ? [data] : (data.docs || [])
  return entries.flatMap(entry => (entry.candidates || []).map(candidate => ({
    doc_no: entry.doc?.doc_no || '—',
    seq: candidate.seq ?? '—',
    item_code: candidate.item_code,
    item_name: candidate.item_name,
    warehouse_code: candidate.warehouse_code,
    ...(candidate.warehouse_name ? { warehouse_name: candidate.warehouse_name } : {}),
  })))
}

export async function confirmAuditDefaultWarehouses(data: AuditDefaultWarehouseConfirmation) {
  const rows = flattenAuditDefaultWarehouseCandidates(data)
  await ElMessageBox({
    title: '确认补齐默认仓库',
    type: 'warning',
    showCancelButton: true,
    confirmButtonText: '补齐并审核',
    cancelButtonText: '取消',
    customClass: 'scm-default-warehouse-confirm',
    message: h('div', { style: 'min-width:960px;max-width:1080px' }, [
      h('div', { style: 'margin-bottom:12px;color:var(--el-text-color-regular);line-height:1.7' }, [
        h('strong', { style: 'color:var(--el-color-warning-dark)' }, `将补齐 ${rows.length} 条明细`),
        `，涉及 ${new Set(rows.map(row => row.doc_no)).size} 张单据。仅填补空仓库，不覆盖已填写的仓库。`,
      ]),
      h(ElTable, { data: rows, border: true, stripe: true, size: 'small', maxHeight: 360, style: 'width:100%' }, {
        default: () => [
          h(ElTableColumn, { prop: 'doc_no', label: '单据号', minWidth: 170 }),
          h(ElTableColumn, { prop: 'seq', label: '行号', width: 72, align: 'center' }),
          h(ElTableColumn, { prop: 'item_code', label: '物料编码', minWidth: 140 }),
          h(ElTableColumn, { prop: 'item_name', label: '物料名称', minWidth: 260, showOverflowTooltip: true }),
          h(ElTableColumn, { label: '当前仓库', width: 110, align: 'center' }, {
            default: () => h('span', { style: 'color:var(--el-text-color-placeholder)' }, '未指定'),
          }),
          h(ElTableColumn, { label: '拟补仓库', minWidth: 140, align: 'center' }, {
            default: (scope: { row: { warehouse_code: string; warehouse_name?: string } }) => h(ElTag, { type: 'success', effect: 'light' }, () => scope.row.warehouse_name || scope.row.warehouse_code),
          }),
        ],
      }),
    ]),
  })
}
