<template>
  <div
    class="print-preview"
    :data-paper-width="template.paper_width"
    :data-paper-height="template.paper_height"
  >
    <div class="preview-container">
      <div class="print-page" :style="pageStyle">
        <!-- 渲染非表格字段元素 -->
        <div
          v-for="element in nonTableElements"
          :key="element.id"
          class="field-element"
          :style="getElementStyle(element)"
        >
          {{ renderElement(element) }}
        </div>

        <!-- 渲染表格元素 -->
        <div
          v-for="element in tableElements"
          :key="element.id"
          class="table-element"
          :style="getElementStyle(element)"
        >
          <table :style="getTableStyle(element)">
            <thead v-if="element.showHeader">
              <tr :style="{ height: `${element.rowHeight || 8}mm` }">
                <th
                  v-for="col in visibleColumns(element)"
                  :key="col.field"
                  :style="getColumnHeaderStyle(col, element)"
                >
                  {{ col.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- 明细行（固定 printRows-1 行，不足补空行） -->
              <tr
                v-for="(row, index) in getTableRows(element)"
                :key="index"
                :style="{ height: `${element.rowHeight || 8}mm` }"
              >
                <td
                  v-for="col in visibleColumns(element)"
                  :key="col.field"
                  :style="getColumnCellStyle(col, element)"
                >
                  {{
                    row ? formatEntryField(row, col.field, element.numberFormat || 'thousand') : ''
                  }}
                </td>
              </tr>
              <!-- 合计行 -->
              <tr :style="{ height: `${element.rowHeight || 8}mm`, fontWeight: 'bold' }">
                <td
                  v-for="(col, colIdx) in visibleColumns(element)"
                  :key="col.field"
                  :style="getTotalCellStyle(col, element, colIdx)"
                >
                  {{ getTotalCellContent(col, element) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { PrintTemplate, VoucherPrintData, FieldElement, TableColumn } from '@/types/print'
import {
  getDataRowsPerPage,
  normalizePrintTemplate,
} from '@/utils/printTemplate'

let globalPrintStyle: HTMLStyleElement | null = null
let printStyleRefCount = 0

function ensurePrintPageStyle(width: number, height: number) {
  if (!globalPrintStyle) {
    globalPrintStyle = document.createElement('style')
    globalPrintStyle.setAttribute('data-print-page-style', '')
    document.head.appendChild(globalPrintStyle)
  }
  globalPrintStyle.textContent = `@media print { @page { margin: 0; size: ${width}mm ${height}mm; } }`
  printStyleRefCount++
}

function removePrintPageStyle() {
  printStyleRefCount = Math.max(0, printStyleRefCount - 1)
  if (printStyleRefCount <= 0 && globalPrintStyle) {
    document.head.removeChild(globalPrintStyle)
    globalPrintStyle = null
  }
}

interface Props {
  template: PrintTemplate
  voucherData: VoucherPrintData
}

const props = defineProps<Props>()

const normalizedTemplate = computed(() => normalizePrintTemplate(props.template))

// 生命周期：动态注入 @page 打印纸张尺寸
onMounted(() => {
  ensurePrintPageStyle(props.template.paper_width, props.template.paper_height)
})

onUnmounted(() => {
  removePrintPageStyle()
})

// 页面样式
const pageStyle = computed(() => ({
  width: `${normalizedTemplate.value.paper_width}mm`,
  height: `${normalizedTemplate.value.paper_height}mm`,
  padding: `${normalizedTemplate.value.margin_top}mm ${normalizedTemplate.value.margin_right}mm ${normalizedTemplate.value.margin_bottom}mm ${normalizedTemplate.value.margin_left}mm`,
  position: 'relative' as const,
  boxSizing: 'border-box' as const,
}))

// 非表格元素
const nonTableElements = computed(() =>
  normalizedTemplate.value.elements.filter(el => el.type !== 'table')
)

// 表格元素
const tableElements = computed(() =>
  normalizedTemplate.value.elements.filter(el => el.type === 'table')
)

// 获取元素样式
function getElementStyle(element: FieldElement) {
  const isTable = element.type === 'table'
  return {
    position: 'absolute' as const,
    left: `${element.x}mm`,
    top: `${element.y}mm`,
    width: `${element.width}mm`,
    height: `${element.height}mm`,
    fontSize: `${element.fontSize}pt`,
    fontWeight: element.fontWeight as 'normal' | 'bold',
    textAlign: element.align as 'left' | 'center' | 'right',
    display: isTable ? ('block' as const) : ('flex' as const),
    alignItems: isTable ? undefined : ('center' as const),
    justifyContent:
      element.align === 'center' ? ('center' as const) : element.align === 'right' ? ('flex-end' as const) : ('flex-start' as const),
    overflow: 'visible' as const,
    whiteSpace: isTable ? ('normal' as const) : ('nowrap' as const),
  }
}

// 凭证类型简称映射
const typeAbbr: Record<string, string> = {
  记账凭证: '记',
  收款凭证: '收',
  付款凭证: '付',
  转账凭证: '转',
}

// 获取凭证类型简称
function getTypeAbbr(name: string): string {
  return typeAbbr[name] || name.charAt(0) || '凭'
}

// 提取凭证序号
function getVoucherSeq(voucherNo: string): string {
  const idx = voucherNo.indexOf('-')
  const seq = idx >= 0 ? voucherNo.slice(idx + 1) : voucherNo
  const num = parseInt(seq, 10)
  return isNaN(num) ? seq : String(num)
}

// 格式化凭证字号（类型简称-序号）
function formatVoucherNo(voucherNo: string, voucherType: string): string {
  const seq = getVoucherSeq(voucherNo)
  const abbr = getTypeAbbr(voucherType || '记')
  return `${abbr}-${seq}`
}

// 渲染元素内容
function renderElement(element: FieldElement): string {
  switch (element.type) {
    case 'title':
    case 'text':
    case 'total_label':
      return element.text || ''

    case 'unit_name':
    case 'account_set_name':
      return props.voucherData.account_set_name || ''

    case 'voucher_no': {
      const base = formatVoucherNo(
        props.voucherData.voucher_no || '',
        props.voucherData.voucher_type || ''
      )
      const totalPages = props.voucherData.totalPages || 1
      if (totalPages > 1) {
        return `${base}  ${props.voucherData.pageIndex}/${totalPages}`
      }
      return base
    }

    case 'date':
      return formatDate(props.voucherData.date, element.dateFormat || 'YYYY-MM-DD')

    case 'voucher_type':
      return props.voucherData.voucher_type || ''

    case 'attachments':
      return `${props.voucherData.attachments || 0}`

    case 'total_debit':
      return formatNumber(props.voucherData.total_debit, element.numberFormat || 'thousand')

    case 'total_credit':
      return formatNumber(props.voucherData.total_credit, element.numberFormat || 'thousand')

    case 'signature_maker':
      return props.voucherData.maker || ''

    case 'signature_auditor':
      return props.voucherData.auditor || ''

    case 'signature_poster':
      return props.voucherData.poster || ''

    case 'signature_supervisor':
      return props.voucherData.supervisor || ''

    default:
      return ''
  }
}

// 格式化日期
function formatDate(date: string, format: string): string {
  if (!date) return ''

  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')

  switch (format) {
    case 'YYYY年MM月DD日':
      return `${year}年${month}月${day}日`
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`
    case 'YYYY-MM-DD':
    default:
      return `${year}-${month}-${day}`
  }
}

// 格式化数字
function formatNumber(value: number, format: string): string {
  if (value === 0 || value === null || value === undefined) return ''

  switch (format) {
    case 'thousand':
      return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'currency':
      return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'plain':
    default:
      return value.toFixed(2)
  }
}

// 获取可见列
function visibleColumns(element: FieldElement) {
  return element.columns?.filter(col => col.visible) || []
}

// 获取表格明细行数据（固定 printRows-1 行，不足补 null 空行）
function getTableRows(element: FieldElement): (any | null)[] {
  const totalRows = element.printRows || 6
  const dataRows = totalRows - 1 // 最后一行留给合计
  // 优先使用分页后的 pageEntries，否则回退到全部 entries
  const entries = props.voucherData.pageEntries || props.voucherData.entries || []
  const rows: (any | null)[] = []
  for (let i = 0; i < dataRows; i++) {
    rows.push(i < entries.length ? entries[i] : null)
  }
  return rows
}

// 合计行单元格内容
function getTotalCellContent(col: TableColumn, element: FieldElement): string {
  const fmt = element.numberFormat || 'thousand'
  const totalPages = props.voucherData.totalPages || 1
  const pageIndex = props.voucherData.pageIndex || 1
  const isLastPage = pageIndex >= totalPages

  switch (col.field) {
    case 'summary':
      return isLastPage ? '合　　计' : '过 次 页'
    case 'debit':
      if (isLastPage) {
        return formatNumber(props.voucherData.total_debit, fmt)
      }
      // 非最后一页：显示截至当前页的累计借方
      return formatNumber(getCumulativeDebit(), fmt)
    case 'credit':
      if (isLastPage) {
        return formatNumber(props.voucherData.total_credit, fmt)
      }
      return formatNumber(getCumulativeCredit(), fmt)
    default:
      return ''
  }
}

// 计算截至当前页的累计借方
function getCumulativeDebit(): number {
  const totalPages = props.voucherData.totalPages || 1
  const pageIndex = props.voucherData.pageIndex || 1
  if (totalPages <= 1) return props.voucherData.total_debit
  // 累计 = 前面所有页的小计 + 当前页小计
  // 由于每页的 pageEntries 已经切好，用 entries 按页数累加
  const entries = props.voucherData.entries || []
  const rowsPerPage = getDataRowsPerPage(normalizedTemplate.value)
  const endIdx = pageIndex * rowsPerPage
  return entries.slice(0, endIdx).reduce((sum, e) => sum + (e.debit || 0), 0)
}

// 计算截至当前页的累计贷方
function getCumulativeCredit(): number {
  const totalPages = props.voucherData.totalPages || 1
  const pageIndex = props.voucherData.pageIndex || 1
  if (totalPages <= 1) return props.voucherData.total_credit
  const entries = props.voucherData.entries || []
  const rowsPerPage = getDataRowsPerPage(normalizedTemplate.value)
  const endIdx = pageIndex * rowsPerPage
  return entries.slice(0, endIdx).reduce((sum, e) => sum + (e.credit || 0), 0)
}

// 合计行单元格样式
function getTotalCellStyle(col: TableColumn, element: FieldElement, _colIdx: number) {
  return {
    width: formatCellWidth(col.width),
    textAlign: (col.field === 'summary' ? 'center' : (col.align || 'left')) as 'left' | 'center' | 'right',
    verticalAlign: (col.verticalAlign || 'middle') as 'top' | 'middle' | 'bottom',
    border: `${element.borderWidth || 1}px solid #000`,
    paddingTop: `${col.paddingTop ?? 1}mm`,
    paddingBottom: `${col.paddingBottom ?? 1}mm`,
    paddingLeft: `${col.paddingLeft ?? 1}mm`,
    paddingRight: `${col.paddingRight ?? 1}mm`,
    height: `${element.rowHeight || 8}mm`,
    fontWeight: 'bold',
  }
}

// 获取表格样式
function getTableStyle(element: FieldElement) {
  return {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: `${element.fontSize}pt`,
  }
}

function formatCellWidth(width: string | number): string {
  if (width == null) return '100px'
  const w = String(width)
  if (w.includes('%')) return w
  return `${w}px`
}

// 获取列头样式
function getColumnHeaderStyle(col: TableColumn, element: FieldElement) {
  return {
    width: formatCellWidth(col.width),
    textAlign: 'center' as const, // 列头永远居中
    verticalAlign: 'middle' as const, // 列头永远垂直居中
    border: `${element.borderWidth || 1}px solid #000`,
    padding: '1mm', // 列头使用固定内边距
    fontWeight: 'bold',
    backgroundColor: '#f5f5f5',
    height: `${element.rowHeight || 8}mm`,
  }
}

// 获取单元格样式
function getColumnCellStyle(col: TableColumn, element: FieldElement) {
  return {
    width: formatCellWidth(col.width),
    textAlign: (col.align || 'left') as 'left' | 'center' | 'right',
    verticalAlign: (col.verticalAlign || 'middle') as 'top' | 'middle' | 'bottom',
    border: `${element.borderWidth || 1}px solid #000`,
    paddingTop: `${col.paddingTop ?? 1}mm`,
    paddingBottom: `${col.paddingBottom ?? 1}mm`,
    paddingLeft: `${col.paddingLeft ?? 1}mm`,
    paddingRight: `${col.paddingRight ?? 1}mm`,
    height: `${element.rowHeight || 8}mm`,
  }
}

// 格式化分录字段
function formatEntryField(entry: any, field: string, numberFormat: string): string {
  // 处理辅助项目列
  if (field.startsWith('aux_')) {
    const categoryCode = field.replace('aux_', '')
    if (entry.aux_data && entry.aux_data[categoryCode]) {
      return entry.aux_data[categoryCode].name || ''
    }
    return ''
  }

  switch (field) {
    case 'summary':
      return entry.summary || ''
    case 'account_code':
      return entry.account_code || ''
    case 'account_name':
      return entry.account_name || ''
    case 'account':
      return [entry.account_code, entry.account_name].filter(Boolean).join(' ')
    case 'debit':
      return entry.debit !== 0 ? formatNumber(entry.debit, numberFormat) : ''
    case 'credit':
      return entry.credit !== 0 ? formatNumber(entry.credit, numberFormat) : ''
    case 'auxiliary':
      return entry.auxiliary || ''
    default:
      return ''
  }
}
</script>

<style scoped>
.print-preview {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #e8e8e8;
  padding: 24px;
}

.preview-container {
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.print-page {
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-family: 'SimSun', 'Microsoft YaHei', sans-serif;
  box-sizing: border-box;
}

.field-element {
  box-sizing: border-box;
}

.table-element {
  box-sizing: border-box;
}

.table-element table {
  table-layout: fixed;
}

@media print {
  .print-preview {
    padding: 0 !important;
    background: #fff !important;
    margin: 0 !important;
    width: 100% !important;
    height: 100% !important;
  }

  .preview-container {
    display: block !important;
    padding: 0 !important;
    margin: 0 !important;
    width: 100% !important;
    height: 100% !important;
  }

  .print-page {
    box-shadow: none !important;
    page-break-after: always;
    margin: 0 !important;
    /* 确保凭证页面尺寸与模版一致 */
    position: relative !important;
  }

  .print-page:last-child {
    page-break-after: auto;
  }

  /* 设置打印页面尺寸 - 移除所有边距 */
  @page {
    margin: 0;
  }

  /* 确保所有元素正确显示 */
  .field-element,
  .table-element {
    page-break-inside: avoid;
  }
}
</style>
