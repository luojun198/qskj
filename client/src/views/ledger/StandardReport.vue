<template>
  <div class="standard-report-container">
    <!-- 顶部工具栏：报表下拉选择 + 导入/删除 + 视图与期间 -->
    <div class="report-header">
      <div class="report-header-left">
        <span class="page-title">标准报表</span>
        <el-select
          v-model="activeReportId"
          size="small"
          placeholder="请选择报表"
          style="width: 240px"
          :no-data-text="'暂无报表，请导入'"
          @change="handleSelectReport"
        >
          <el-option
            v-for="report in reports"
            :key="report.id"
            :label="report.name"
            :value="report.id"
          />
        </el-select>
        <el-upload
          action="#"
          :show-file-list="false"
          :http-request="handleImportPreview"
          accept=".acd"
        >
          <el-button type="primary" size="small" :loading="previewing">重新导入</el-button>
        </el-upload>
        <el-button
          v-if="currentReport"
          type="danger"
          size="small"
          plain
          icon="Delete"
          @click="handleDelete(currentReport)"
        >删除</el-button>
      </div>
      <div v-if="currentReport" class="report-toolbar">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button label="template">模板视图</el-radio-button>
          <el-radio-button label="compute">计算视图</el-radio-button>
        </el-radio-group>
        <template v-if="viewMode === 'compute'">
          <el-select v-model="computeYear" size="small" style="width: 110px" placeholder="年度">
            <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
          </el-select>
          <el-select v-model="computePeriod" size="small" style="width: 100px" placeholder="会计期">
            <el-option v-for="p in 12" :key="p" :label="`${p}期`" :value="p" />
          </el-select>
          <el-button type="primary" size="small" :loading="computing" @click="runCompute">
            计算
          </el-button>
        </template>
        <el-button size="small" icon="Printer" @click="openPrint">打印</el-button>
      </div>
    </div>

    <HiprintDialog
      v-model="printVisible"
      template-type="report"
      :template-key="printTemplateKey"
      :title="currentReport?.name || '标准报表'"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
    />

    <el-dialog
      v-model="importDialogVisible"
      title="选择要重新导入的标准报表"
      width="680px"
      destroy-on-close
      :close-on-click-modal="false"
      @closed="resetImportSelection"
    >
      <div class="import-file-row">
        <span class="import-file-label">ACD 文件</span>
        <span class="import-file-name">{{ importFile?.name }}</span>
      </div>
      <el-alert
        v-if="importWarnings.length"
        class="import-warning"
        type="warning"
        show-icon
        :closable="false"
      >
        <template #title>解析时发现 {{ importWarnings.length }} 条提示</template>
        <div v-for="warning in importWarnings" :key="warning" class="warning-line">
          {{ warning }}
        </div>
      </el-alert>
      <div class="import-selection-head">
        <span>可导入报表（{{ importOptions.length }}）</span>
        <el-button link type="primary" @click="toggleSelectAll">
          {{ allImportOptionsSelected ? '取消全选' : '全选' }}
        </el-button>
      </div>
      <el-checkbox-group v-model="selectedReportCodes" class="import-report-list">
        <el-checkbox
          v-for="report in importOptions"
          :key="report.code"
          :value="report.code"
          class="import-report-option"
        >
          <span class="report-option-name">{{ report.name }}</span>
          <span class="report-option-code">编码 {{ report.code }}</span>
          <span class="report-option-file">{{ report.source_file }}</span>
        </el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!importOptions.length" description="ACD 中没有可导入的标准报表" :image-size="72" />
      <template #footer>
        <div class="import-dialog-footer">
          <span>已选择 {{ selectedReportCodes.length }} 张</span>
          <div>
            <el-button @click="importDialogVisible = false">取消</el-button>
            <el-button
              type="primary"
              :loading="importing"
              :disabled="selectedReportCodes.length === 0"
              @click="confirmSelectedImport"
            >
              导入所选报表
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <div class="report-body">
      <table v-if="currentReport && gridRows.length > 0" class="report-grid">
        <tbody>
          <!-- 报表标题（表名）：跨列合并居中 -->
          <tr v-if="!hasTitleInData">
            <td :colspan="gridColCount" class="grid-cell title-cell">{{ currentReport.name }}</td>
          </tr>
          <template v-for="rIdx in gridRows" :key="rIdx">
            <tr v-if="rIdx === titleRowIndex">
              <td :colspan="gridColCount" class="grid-cell title-cell">{{ titleText }}</td>
            </tr>
            <tr v-else>
              <td
                v-for="col in gridColCount"
                :key="col"
                :class="cellClass(rIdx, col - 1)"
              >
                {{ cellDisplay(rIdx, col - 1) }}
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-else class="empty-state">
        <el-empty :description="currentReport ? '该报表无可显示的单元格' : '暂无标准报表，请从登录页导入 ACD 或点击重新导入'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getStandardReports,
  getStandardReportDetail,
  previewAcdForStandardReports,
  uploadAcdForStandardReports,
  deleteStandardReport,
  computeStandardReport,
  type RhStandardReport,
  type RhStandardReportDetail,
  type RhStandardReportComputedCell,
  type RhStandardReportImportOption
} from '@/api/ledgerStandardReport'
import HiprintDialog from '@/components/print/HiprintDialog.vue'

const reports = ref<RhStandardReport[]>([])
const activeReportId = ref<string>('')
const currentReport = ref<RhStandardReportDetail | null>(null)
const previewing = ref(false)
const importing = ref(false)
const importDialogVisible = ref(false)
const importFile = ref<File | null>(null)
const importOptions = ref<RhStandardReportImportOption[]>([])
const selectedReportCodes = ref<string[]>([])
const importWarnings = ref<string[]>([])
const allImportOptionsSelected = computed(
  () => importOptions.value.length > 0 && selectedReportCodes.value.length === importOptions.value.length
)

// 打印
const printVisible = ref(false)
const printTemplateKey = computed(() => `report:${currentReport.value?.code || 'standard'}`)
const openPrint = () => {
  if (!currentReport.value) return
  printVisible.value = true
}

// 视图模式：template=模板结构（公式文本）/ compute=按期间计算结果
const viewMode = ref<'template' | 'compute'>('template')
const now = new Date()
const computeYear = ref<number>(now.getFullYear())
const computePeriod = ref<number>(now.getMonth() + 1)
const computing = ref(false)
const computedCells = ref<RhStandardReportComputedCell[] | null>(null)
const years = Array.from({ length: now.getFullYear() - 2000 + 1 }, (_, i) => now.getFullYear() - i)

const loadReports = async (preferredReportId?: string) => {
  try {
    const res = await getStandardReports()
    if (res.code === 0) {
      reports.value = res.data
      if (reports.value.length === 0) {
        activeReportId.value = ''
        currentReport.value = null
        return
      }

      const target =
        reports.value.find(report => report.id === preferredReportId) ||
        reports.value.find(report => report.id === activeReportId.value) ||
        reports.value[0]
      if (target) await handleSelectReport(target.id)
    }
  } catch (error: any) {
    ElMessage.error(error.message || '获取报表列表失败')
  }
}

const loadReportDetail = async (id: string) => {
  try {
    const res = await getStandardReportDetail(id)
    if (res.code === 0) {
      currentReport.value = res.data
    }
  } catch (error: any) {
    ElMessage.error(error.message || '获取报表详情失败')
  }
}

const handleSelectReport = async (index: string) => {
  activeReportId.value = index
  // 切换报表时重置为模板视图并清空旧的计算结果
  viewMode.value = 'template'
  computedCells.value = null
  await loadReportDetail(index)
}

const runCompute = async () => {
  if (!currentReport.value) return
  try {
    computing.value = true
    const res = await computeStandardReport(currentReport.value.id, {
      year: computeYear.value,
      period: computePeriod.value
    })
    if (res.code === 0) {
      computedCells.value = res.data.cells
    } else {
      ElMessage.error(res.message || '计算失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '计算出错')
  } finally {
    computing.value = false
  }
}

const resetImportSelection = () => {
  importFile.value = null
  importOptions.value = []
  selectedReportCodes.value = []
  importWarnings.value = []
}

const toggleSelectAll = () => {
  selectedReportCodes.value = allImportOptionsSelected.value
    ? []
    : importOptions.value.map(report => report.code)
}

const handleImportPreview = async (options: any) => {
  try {
    previewing.value = true
    const file = options.file as File
    const res = await previewAcdForStandardReports(file)
    if (res.code === 0) {
      importFile.value = file
      importOptions.value = res.data.reports
      importWarnings.value = res.data.warnings || []
      selectedReportCodes.value = []
      importDialogVisible.value = true
    } else {
      ElMessage.error(res.message || 'ACD 解析失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || 'ACD 解析失败')
  } finally {
    previewing.value = false
  }
}

const confirmSelectedImport = async () => {
  if (!importFile.value || selectedReportCodes.value.length === 0) return
  try {
    importing.value = true
    const res = await uploadAcdForStandardReports(importFile.value, selectedReportCodes.value)
    if (res.code !== 0) {
      ElMessage.error(res.message || '重新导入失败')
      return
    }

    const currentCode = currentReport.value?.code
    const preferred =
      res.data.find(report => report.code === currentCode)?.id || res.data[0]?.id
    importDialogVisible.value = false
    ElMessage.success(`成功更新 ${res.data.length} 张标准报表`)
    await loadReports(preferred)
  } catch (error: any) {
    ElMessage.error(error.message || '重新导入失败')
  } finally {
    importing.value = false
  }
}

const handleDelete = async (report: RhStandardReport) => {
  try {
    await ElMessageBox.confirm(`确定要删除报表 "${report.name}" 吗？`, '提示', {
      type: 'warning'
    })
    const res = await deleteStandardReport(report.id)
    if (res.code === 0) {
      ElMessage.success('删除成功')
      if (activeReportId.value === report.id) {
        activeReportId.value = ''
        currentReport.value = null
      }
      await loadReports()
    }
  } catch {
    // canceled
  }
}

// 网格尺寸：按单元格最大行列还原二维表
const gridColCount = computed(() => {
  if (!currentReport.value) return 0
  let maxCol = 0
  for (const cell of currentReport.value.cells) {
    if (cell.col_index > maxCol) maxCol = cell.col_index
  }
  return maxCol + 1
})

const gridRowCount = computed(() => {
  if (!currentReport.value) return 0
  let maxRow = 0
  for (const cell of currentReport.value.cells) {
    if (cell.row_index > maxRow) maxRow = cell.row_index
  }
  return maxRow + 1
})

const gridRows = computed(() => Array.from({ length: gridRowCount.value }, (_, i) => i))

const normalizeTitle = (value: string) => value.replace(/[\s　]/g, '')

// 报表标题（表名）所在行：单元格文字去空格后与报表名一致，则该行作为标题跨列合并居中
const titleRowIndex = computed<number | null>(() => {
  if (!currentReport.value) return null
  const target = normalizeTitle(currentReport.value.name)
  if (!target) return null
  // 该行须仅有一个文本单元格，避免误吞数据行
  const cellsByRow = new Map<number, { count: number; first: { row_index: number; text_value: string | null; formula_text: string | null } }>()
  for (const cell of currentReport.value.cells) {
    const entry = cellsByRow.get(cell.row_index)
    if (entry) entry.count += 1
    else cellsByRow.set(cell.row_index, { count: 1, first: cell })
  }
  for (const [rowIndex, entry] of cellsByRow) {
    if (entry.count !== 1) continue
    if (entry.first.formula_text) continue
    if (normalizeTitle(entry.first.text_value || '') === target) return rowIndex
  }
  return null
})

const titleText = computed(() => currentReport.value?.name || '')
const hasTitleInData = computed(() => titleRowIndex.value !== null)

// 模板单元格索引：`row_col` -> 单元格
const templateCellMap = computed(() => {
  const map = new Map<string, { text_value: string | null; formula_text: string | null }>()
  if (!currentReport.value) return map
  for (const cell of currentReport.value.cells) {
    map.set(`${cell.row_index}_${cell.col_index}`, cell)
  }
  return map
})

// 计算结果索引：`row_col` -> 计算单元格
const computedCellMap = computed(() => {
  const map = new Map<string, RhStandardReportComputedCell>()
  for (const cell of computedCells.value || []) {
    map.set(`${cell.row_index}_${cell.col_index}`, cell)
  }
  return map
})

const cellDisplay = (row: number, col: number): string => {
  const key = `${row}_${col}`
  if (viewMode.value === 'compute') {
    const computed = computedCellMap.value.get(key)
    if (computed) return computed.display_value
    // 计算视图下，文本单元格仍显示原文字（项目名/表头）
    const tpl = templateCellMap.value.get(key)
    return tpl?.formula_text ? '' : tpl?.text_value || ''
  }
  const tpl = templateCellMap.value.get(key)
  if (!tpl) return ''
  return tpl.formula_text || tpl.text_value || ''
}

const cellClass = (row: number, col: number): string => {
  const key = `${row}_${col}`
  const tpl = templateCellMap.value.get(key)
  if (viewMode.value === 'compute') {
    const computed = computedCellMap.value.get(key)
    if (computed?.status === 'error') return 'grid-cell error-cell'
    if (computed && computed.numeric_value !== null) return 'grid-cell num-cell'
    return 'grid-cell'
  }
  if (tpl?.formula_text) return 'grid-cell formula-cell'
  return 'grid-cell'
}

// 生成自包含 HTML（内联样式）供 hiprint 打印 —— 还原二维网格 + 合并居中标题
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const buildPrintHtml = (): string => {
  if (!currentReport.value || gridRows.value.length === 0) return ''
  const cols = gridColCount.value
  const tdBase =
    'border:1px solid #000;padding:3px 8px;font-size:12px;height:24px;white-space:nowrap;'
  const titleStyle =
    'border:none;text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;height:38px;'

  const rowsHtml: string[] = []
  // 标题
  if (!hasTitleInData.value) {
    rowsHtml.push(`<tr><td colspan="${cols}" style="${titleStyle}">${escapeHtml(currentReport.value.name)}</td></tr>`)
  }
  for (const r of gridRows.value) {
    if (r === titleRowIndex.value) {
      rowsHtml.push(`<tr><td colspan="${cols}" style="${titleStyle}">${escapeHtml(titleText.value)}</td></tr>`)
      continue
    }
    const tds: string[] = []
    for (let c = 0; c < cols; c++) {
      const key = `${r}_${c}`
      const text = cellDisplay(r, c)
      let style = tdBase
      if (viewMode.value === 'compute') {
        const computed = computedCellMap.value.get(key)
        if (computed?.status === 'error') style += 'color:#c00;text-align:right;'
        else if (computed && computed.numeric_value !== null) style += 'text-align:right;'
      } else if (templateCellMap.value.get(key)?.formula_text) {
        style += 'color:#666;font-family:monospace;font-size:11px;'
      }
      tds.push(`<td style="${style}">${escapeHtml(text)}</td>`)
    }
    rowsHtml.push(`<tr>${tds.join('')}</tr>`)
  }

  return `<table style="border-collapse:collapse;width:100%;font-family:'SimSun','宋体',serif;">
    <tbody>${rowsHtml.join('')}</tbody>
  </table>`
}

onMounted(() => {
  loadReports()
})
</script>

<style scoped>
.standard-report-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,21,41,.08);
}

.report-header {
  padding: 12px 24px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.report-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.report-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.import-file-row,
.import-selection-head,
.import-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.import-file-row {
  justify-content: flex-start;
  padding: 10px 12px;
  border-radius: 6px;
  background: #f5f7fa;
}

.import-file-label {
  color: #909399;
}

.import-file-name {
  color: #303133;
  font-weight: 500;
  word-break: break-all;
}

.import-warning {
  margin-top: 12px;
}

.warning-line {
  margin-top: 4px;
  line-height: 1.5;
}

.import-selection-head {
  margin: 16px 0 8px;
  font-weight: 600;
  color: #303133;
}

.import-report-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
}

.import-report-option {
  width: 100%;
  height: auto;
  margin: 0;
  padding: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  align-items: flex-start;
}

.report-option-name,
.report-option-code,
.report-option-file {
  display: block;
}

.report-option-name {
  color: #303133;
  font-weight: 600;
}

.report-option-code,
.report-option-file {
  margin-top: 3px;
  color: #909399;
  font-size: 12px;
}

@media (max-width: 760px) {
  .import-report-list {
    grid-template-columns: 1fr;
  }
}

.report-body {
  flex: 1;
  padding: 16px 24px;
  overflow: auto;
}

/* 二维报表网格：还原 VTS 真实行列布局 */
.report-grid {
  border-collapse: collapse;
  width: max-content;
  font-size: 13px;
}

.report-grid .grid-cell {
  border: 1px solid #e4e7ed;
  padding: 4px 10px;
  min-width: 90px;
  max-width: 320px;
  height: 28px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #303133;
}

/* 报表标题（表名）：跨列合并、居中、加粗加大 */
.report-grid .title-cell {
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #303133;
  height: 40px;
}

.report-grid .formula-cell {
  font-family: 'Consolas', 'Courier New', monospace;
  color: #909399;
  font-size: 12px;
}

.report-grid .num-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.report-grid .error-cell {
  color: #f56c6c;
  text-align: right;
}

.empty-state {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
