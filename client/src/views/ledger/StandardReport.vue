<template>
  <div class="standard-report-container">
    <!-- 顶部工具栏：报表下拉选择 + 导入/删除 + 视图与期间 -->
    <div class="report-header toolbar">
      <div class="report-header-left">
        <span class="page-title">标准报表</span>
        <el-select
          v-model="activeReportId"
          size="small"
          placeholder="请选择报表"
          style="width: 280px"
          :no-data-text="'暂无报表，请导入'"
          @change="handleSelectReport"
        >
          <el-option
            v-for="report in reports"
            :key="report.id"
            :label="formatReportLabel(report)"
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
        <el-button size="small" plain @click="handleCreateReport">新建报表</el-button>
      </div>
      <div v-if="currentReport" class="report-toolbar">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button label="template">公式</el-radio-button>
          <el-radio-button label="compute">取数</el-radio-button>
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
        <ReportPageSetup
          v-if="currentReport"
          v-model="pageSetup"
          :content-size="reportContentSize"
          :saving="savingPageSetup"
          @save="handleSavePageSetup"
        />
        <el-button
          size="small"
          icon="Download"
          :loading="exportingExcel"
          @click="handleExportExcel"
        >
          导出 Excel
        </el-button>
        <el-button size="small" icon="Printer" @click="openPrint">打印</el-button>
      </div>

      <!-- 公式视图即编辑态：改完自动保存 -->
      <div v-if="currentReport && viewMode === 'template'" class="report-edit-toolbar">
        <span class="cell-addr">{{ selectedAddress }}</span>
        <span v-if="grid.selectionSummary.value" class="selection-summary">
          {{ grid.selectionSummary.value }}
        </span>
        <el-popover placement="bottom-start" :width="420" trigger="click" @show="loadFormulaReference">
          <template #reference>
            <el-button size="small" class="formula-fx-button" title="公式速查">fx</el-button>
          </template>
          <div class="formula-reference">
            <p class="formula-reference-hint">
              点击函数名插入公式栏。支持 + - * / ^ %、括号与嵌套，如
              <code>=ROUND(SUM(C6:C19)/3,2)</code>
            </p>
            <div v-for="group in formulaReferenceGroups" :key="group.name" class="formula-reference-group">
              <div class="formula-reference-group-title">{{ group.name }}</div>
              <div
                v-for="item in group.items"
                :key="item.name"
                class="formula-reference-item"
                @click="insertFormulaName(item)"
              >
                <span class="formula-reference-name">{{ item.signature }}</span>
                <span class="formula-reference-desc">{{ item.description }}</span>
              </div>
            </div>
          </div>
        </el-popover>
        <el-input
          v-model="formulaInput"
          size="small"
          class="formula-input"
          placeholder="输入文字，或以 = / @ 开头输入公式，例如 =SUM(C6:C19)、@ye(1001,99)"
          @keyup.enter="applyFormulaBar"
          @blur="applyFormulaBar"
        />
        <el-button-group>
          <el-button size="small" :disabled="!hasRowSelection" @click="handleRowCol('insert_row')">插入行</el-button>
          <el-button size="small" :disabled="!hasRowSelection" @click="handleRowCol('delete_row')">删除行</el-button>
        </el-button-group>
        <el-button-group>
          <el-button size="small" :disabled="!hasColSelection" @click="handleRowCol('insert_col')">插入列</el-button>
          <el-button size="small" :disabled="!hasColSelection" @click="handleRowCol('delete_col')">删除列</el-button>
        </el-button-group>
        <el-button-group>
          <el-button size="small" :disabled="!grid.canMergeSelection.value" @click="grid.mergeSelection">合并</el-button>
          <el-button size="small" :disabled="!grid.canUnmergeSelection.value" @click="grid.unmergeSelection">取消合并</el-button>
        </el-button-group>
        <span class="save-state" :class="`save-state--${grid.saveState.value}`">
          <template v-if="grid.saveState.value === 'saving'">保存中…</template>
          <template v-else-if="grid.saveState.value === 'error'">
            保存失败
            <el-button link type="danger" size="small" @click="grid.retrySave">重试</el-button>
          </template>
          <template v-else-if="grid.saveState.value === 'saved'">已保存 {{ savedAtText }}</template>
          <template v-else-if="grid.isDirty.value">待保存…</template>
        </span>
      </div>

      <!-- FIX-144：出错格会沿公式链传播到合计，这里汇总提示，格内以红色标出 -->
      <el-alert
        v-if="viewMode === 'compute' && computedErrorCells.length"
        class="compute-error-alert"
        type="error"
        show-icon
        :closable="false"
      >
        <template #title>
          本次取数有 {{ computedErrorCells.length }} 个单元格出错（{{ computedErrorSummary }}），引用它们的合计也已标红，请检查公式或科目
        </template>
      </el-alert>

      <StandardReportStyleToolbar
        v-if="currentReport && viewMode === 'template'"
        :style="grid.currentStyle.value"
        :number-format="currentNumberFormat"
        :disabled="!grid.hasStyleSelection.value"
        @apply="grid.applyStyleToSelection"
        @format="grid.applyNumberFormatToSelection"
        @adjust-font-size="grid.adjustFontSize"
      />
    </div>


    <HiprintDialog
      v-model="printVisible"
      template-type="report"
      :template-key="printTemplateKey"
      :title="currentReport?.name || '标准报表'"
      :get-print-html="buildPrintHtml"
      :raw-html-preview="true"
      :default-paper="pageSetup.paperSize"
      :default-orientation="pageSetup.orientation"
      :margins="printMargins"
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
          <span class="report-option-seq">{{ report.code }}.</span>
          <span class="report-option-name">{{ report.name }}</span>
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
      <!-- 公式与取数共用同一套渲染，格式完全一致；差别只在公式视图多一圈行列头 -->
      <ReportSheetGrid v-if="currentReport" />
      <div v-else class="empty-state">
        <el-empty :description="currentReport ? '该报表无可显示的单元格' : '暂无标准报表，请从登录页导入 ACD 或点击重新导入'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, provide, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ReportSheetGrid from '@/components/report/ReportSheetGrid.vue'
import StandardReportStyleToolbar from '@/components/report/StandardReportStyleToolbar.vue'
import ReportPageSetup, {
  type ReportPageSetupValue,
} from '@/components/report/ReportPageSetup.vue'
import { REPORT_GRID_KEY } from '@/components/report/reportGridContext'
import { useStandardReportGrid } from '@/composables/useStandardReportGrid'
import { useSystemParamsStore } from '@/stores/systemParams'
import {
  buildReportExportModel,
  buildReportPrintHtml,
  computeAutoFitScale,
  exportReportToExcel,
} from '@/utils/standardReportExport'
import {
  saveStandardReportPageSetup,
  type RhStandardReportCell, updateStandardReportRowCol, type RhStandardReportRowColAction } from '@/api/ledgerStandardReport'
import '@/views/report/report.styles.css'
import {
  createStandardReport,
  getStandardReports,
  getStandardReportDetail,
  previewAcdForStandardReports,
  uploadAcdForStandardReports,
  deleteStandardReport,
  computeStandardReport,
  getFormulaReference,
  type FormulaReferenceItem,
  type RhStandardReport,
  type RhStandardReportDetail,
  type RhStandardReportComputedCell,
  type RhStandardReportImportOption
} from '@/api/ledgerStandardReport'
import HiprintDialog from '@/components/print/HiprintDialog.vue'

const reports = ref<RhStandardReport[]>([])
const activeReportId = ref<string>('')

/** 下拉与导入列表统一展示「序号.报表名」，序号即 ACD 报表编码（bb00006.vts → 6） */
function formatReportLabel(report: { code?: string | null; name: string }): string {
  const code = String(report.code ?? '').trim()
  return code ? `${code}. ${report.name}` : report.name
}
// 公式视图直接就是编辑态：网格 UI 复用动态报表那套组件，数据由本 composable 适配
const grid = useStandardReportGrid()
provide(REPORT_GRID_KEY, grid.context)

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

// 视图模式：进入报表默认取数；template=公式原文 / compute=按期间计算结果
const viewMode = ref<'template' | 'compute'>('compute')
// 视图态交给网格：公式=可编辑并显示行列头，取数=只读且不显行列头
watch(
  viewMode,
  mode => {
    grid.viewMode.value = mode
    grid.showComputed.value = mode === 'compute' && grid.computedMap.value.size > 0
  },
  { immediate: true }
)
const now = new Date()
// 默认年度/期间取账套当前会计区间（后端按最新已过账凭证推导，无凭证时回退 fiscal_year），
// 而不是系统自然年月——否则新装机首次打开取数视图必然全是 0。
const systemParams = useSystemParamsStore()
const computeYear = ref<number>(systemParams.currentYear)
const computePeriod = ref<number>(systemParams.currentPeriod)
const computing = ref(false)
const computedCells = ref<RhStandardReportComputedCell[] | null>(null)
// 年度下拉需覆盖账套会计区间，防止历史账套的年度不在可选范围内
const years = computed(() => {
  const top = Math.max(now.getFullYear(), computeYear.value)
  return Array.from({ length: top - 2000 + 1 }, (_, i) => top - i)
})

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
      grid.loadDetail(res.data)
      syncPageSetup(res.data)
    }
  } catch (error: any) {
    ElMessage.error(error.message || '获取报表详情失败')
  }
}

const handleSelectReport = async (index: string) => {
  activeReportId.value = index
  computedCells.value = null
  grid.computedMap.value = new Map()
  grid.showComputed.value = false
  await loadReportDetail(index)
  if (viewMode.value === 'compute') await runCompute()
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
      // 同步给网格：取数视图据此显示结果并把数值右对齐
      const map = new Map<string, { display_value: string; status: 'ok' | 'error'; numeric_value?: number | null }>()
      for (const cell of res.data.cells || []) {
        map.set(grid.cellKey(cell.row_index, cell.col_index), {
          display_value: cell.display_value,
          status: cell.status,
          numeric_value: cell.numeric_value,
        })
      }
      grid.computedMap.value = map
      grid.showComputed.value = viewMode.value === 'compute'
    } else {
      // 失败时清空旧结果，避免换期间后仍显示过期数据
      computedCells.value = null
      grid.computedMap.value = new Map()
      ElMessage.error(res.message || '计算失败')
    }
  } catch (error: any) {
    computedCells.value = null
    grid.computedMap.value = new Map()
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


// 模板单元格索引：`row_col` -> 单元格
const templateCellMap = computed(() => {
  const map = new Map<string, RhStandardReportCell>()
  if (!currentReport.value) return map
  for (const cell of currentReport.value.cells) {
    map.set(`${cell.row_index}_${cell.col_index}`, cell)
  }
  return map
})

// 计算结果索引：`row_col` -> 计算单元格
/** FIX-144：出错单元格（含被传染的公式格） */
const computedErrorCells = computed(() =>
  (computedCells.value || []).filter(cell => cell.status === 'error')
)
const computedErrorSummary = computed(() =>
  computedErrorCells.value
    .slice(0, 5)
    .map(cell => `${cell.address || `${cell.row_index + 1}行${cell.col_index + 1}列`} ${cell.display_value}`)
    .join('，') + (computedErrorCells.value.length > 5 ? ' …' : '')
)

const computedCellMap = computed(() => {
  const map = new Map<string, RhStandardReportComputedCell>()
  for (const cell of computedCells.value || []) {
    map.set(`${cell.row_index}_${cell.col_index}`, cell)
  }
  return map
})

/** 取数结果为数值 0：屏幕、打印、Excel 一律留白 */
const isZeroResult = (cell: RhStandardReportComputedCell) =>
  cell.status === 'ok' && cell.numeric_value === 0

const cellDisplay = (row: number, col: number): string => {
  const key = `${row}_${col}`
  if (viewMode.value === 'compute') {
    const computed = computedCellMap.value.get(key)
    // 零值留白，与屏幕网格一致
    if (computed && isZeroResult(computed)) return ''
    if (computed) return computed.display_value
    // 计算视图下，文本单元格仍显示原文字（项目名/表头）
    const tpl = templateCellMap.value.get(key)
    return tpl?.formula_text ? '' : tpl?.text_value || ''
  }
  const tpl = templateCellMap.value.get(key)
  if (!tpl) return ''
  return tpl.formula_text || tpl.text_value || ''
}

/** 打印与 Excel 共用的网格模型：列宽/行高/合并/样式/取值全部与屏幕同源 */
const buildExportModel = () => {
  if (!currentReport.value) return null
  return buildReportExportModel({
    name: currentReport.value.name,
    rowCount: gridRowCount.value,
    colCount: gridColCount.value,
    getColWidth: grid.getColWidth,
    getRowHeight: grid.getRowHeight,
    source: currentReport.value.cells,
    getText: cellDisplay,
    getNumeric: (row, col) => {
      if (viewMode.value !== 'compute') return null
      const computed = computedCellMap.value.get(`${row}_${col}`)
      if (!computed || computed.status !== 'ok' || isZeroResult(computed)) return null
      return computed.numeric_value ?? null
    },
    isError: (row, col) =>
      viewMode.value === 'compute' &&
      computedCellMap.value.get(`${row}_${col}`)?.status === 'error',
  })
}

/**
 * 实际打印用的缩放。
 *
 * 报表若从没设过 print_scale，不能一律按 100% 打——ACD 导入的报表默认列宽 160px、
 * 8 列就有 1280px，远宽于 A4 纵向可打印区（约 700px），不缩放必然溢出。
 * 这里退回与「页面设置」同一个自动适配算法。
 */
const effectivePrintScale = computed(() => {
  if (hasExplicitScale.value) return pageSetup.value.scale || 1
  return computeAutoFitScale({
    paperSize: pageSetup.value.paperSize,
    orientation: pageSetup.value.orientation,
    margins: {
      top: pageSetup.value.marginTop,
      bottom: pageSetup.value.marginBottom,
      left: pageSetup.value.marginLeft,
      right: pageSetup.value.marginRight,
    },
    contentSize: reportContentSize.value,
  })
})

/** 导出 Excel：纸张、边距、缩放与页面设置一致 */
const excelPageSetup = computed(() => ({
  paperSize: pageSetup.value.paperSize,
  orientation: pageSetup.value.orientation,
  scale: effectivePrintScale.value,
  marginTop: pageSetup.value.marginTop,
  marginBottom: pageSetup.value.marginBottom,
  marginLeft: pageSetup.value.marginLeft,
  marginRight: pageSetup.value.marginRight,
  fitToPage: !hasExplicitScale.value,
}))

const buildPrintHtml = (): string => {
  const model = buildExportModel()
  if (!model || model.rowCount === 0) return ''
  return buildReportPrintHtml(model, { scale: effectivePrintScale.value })
}

const exportingExcel = ref(false)

const handleExportExcel = async () => {
  const model = buildExportModel()
  if (!model || model.rowCount === 0) {
    ElMessage.warning('当前报表没有可导出的内容')
    return
  }
  try {
    exportingExcel.value = true
    const suffix = viewMode.value === 'compute' ? `${computeYear.value}年${computePeriod.value}期` : '公式'
    await exportReportToExcel(model, `${model.name}_${suffix}`, excelPageSetup.value)
    ElMessage.success('Excel 已导出')
  } catch (error: any) {
    ElMessage.error('导出 Excel 失败：' + (error?.message || error))
  } finally {
    exportingExcel.value = false
  }
}

onMounted(async () => {
  // 先拿到账套会计区间，再套用为取数默认值（load 有缓存，不会重复请求）
  await systemParams.load()
  computeYear.value = systemParams.currentYear
  computePeriod.value = systemParams.currentPeriod
  loadReports()
})

async function handleCreateReport() {
  try {
    const { value } = await ElMessageBox.prompt('请输入报表名称', '新建报表', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '报表名称不能为空',
    })
    const res: any = await createStandardReport({ name: String(value).trim() })
    if (res.code !== 0) throw new Error(res.message || '创建失败')
    ElMessage.success('创建成功')
    await loadReports(res.data?.id)
    viewMode.value = 'template'
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error?.message || '创建失败')
  }
}

// ---------- 公式视图的编辑能力 ----------

const formulaInput = ref('')

// 公式速查（fx 弹层）。首次展开时才拉，避免进页面就多一次请求。
const formulaReference = ref<FormulaReferenceItem[]>([])
const formulaReferenceGroups = computed(() => {
  const groups: Array<{ name: string; items: FormulaReferenceItem[] }> = []
  for (const item of formulaReference.value) {
    const existing = groups.find(group => group.name === item.group)
    if (existing) existing.items.push(item)
    else groups.push({ name: item.group, items: [item] })
  }
  return groups
})

const loadFormulaReference = async () => {
  if (formulaReference.value.length > 0) return
  try {
    const res = await getFormulaReference()
    if (res.code === 0) formulaReference.value = res.data || []
  } catch {
    // 速查表拉不到不影响手写公式，静默即可
  }
}

/** 把函数名插进公式栏；公式栏还没有 = 开头时补上 */
const insertFormulaName = (item: FormulaReferenceItem) => {
  const call = item.name.startsWith('@') ? `${item.name.toLowerCase()}(` : `${item.name}(`
  const current = formulaInput.value
  formulaInput.value = current.startsWith('=') ? `${current}${call}` : `=${call}`
}

// 当前选区首格的数字格式，供格式工具栏回显
const currentNumberFormat = computed(() => {
  if (grid.selectedRow.value === null || grid.selectedCol.value === null) return ''
  const cell = grid.cellMap.value.get(grid.cellKey(grid.selectedRow.value, grid.selectedCol.value))
  return cell?.format_text || ''
})

// ---------- 打印页面设置 ----------

const savingPageSetup = ref(false)
const pageSetup = ref<ReportPageSetupValue>({
  paperSize: 'A4',
  orientation: 'portrait',
  scale: 1,
  marginTop: 8,
  marginBottom: 8,
  marginLeft: 8,
  marginRight: 8,
})

/** 传给打印面板的四向页边距 */
const printMargins = computed(() => ({
  top: pageSetup.value.marginTop,
  bottom: pageSetup.value.marginBottom,
  left: pageSetup.value.marginLeft,
  right: pageSetup.value.marginRight,
}))

/** 报表内容的实际像素尺寸，供页面设置自动计算缩放 */
const reportContentSize = computed(() => {
  // 用打印实际输出的行列数（数据范围），而不是网格的显示范围：
  // 公式视图会多补几行几列空白，算进来会让缩放比例偏小，打印出来整体缩水。
  const cols = gridColCount.value
  const rows = gridRowCount.value
  let width = 0
  for (let index = 0; index < cols; index += 1) width += grid.getColWidth(index)
  let height = 0
  for (let index = 0; index < rows; index += 1) height += grid.getRowHeight(index)
  return { width, height }
})

/** 该报表是否显式存过打印缩放；没存过就走自动适配，而不是默认 100% */
const hasExplicitScale = ref(false)

/** 切换报表时把该报表存的页面设置读出来 */
function syncPageSetup(detail: RhStandardReportDetail) {
  hasExplicitScale.value = detail.print_scale != null
  pageSetup.value = {
    paperSize: detail.paper_size || 'A4',
    orientation: (detail.paper_orientation as 'portrait' | 'landscape') || 'portrait',
    scale: detail.print_scale || 1,
    marginTop: detail.margin_top ?? 8,
    marginBottom: detail.margin_bottom ?? 8,
    marginLeft: detail.margin_left ?? 8,
    marginRight: detail.margin_right ?? 8,
  }
}

async function handleSavePageSetup(value: ReportPageSetupValue) {
  if (!currentReport.value) return
  savingPageSetup.value = true
  try {
    const res: any = await saveStandardReportPageSetup(currentReport.value.id, {
      paper_size: value.paperSize,
      paper_orientation: value.orientation,
      print_scale: value.scale,
      margin_top: value.marginTop,
      margin_bottom: value.marginBottom,
      margin_left: value.marginLeft,
      margin_right: value.marginRight,
    })
    if (res.code !== 0) throw new Error(res.message || '保存失败')
    // 存过之后就以用户设定为准，不再自动适配
    hasExplicitScale.value = true
    pageSetup.value = { ...value }
    ElMessage.success('页面设置已保存')
  } catch (error: any) {
    ElMessage.error(error?.message || '保存页面设置失败')
  } finally {
    savingPageSetup.value = false
  }
}

const selectedAddress = computed(() => {
  if (grid.selectedRow.value === null || grid.selectedCol.value === null) return '—'
  return `${grid.toColumnName(grid.selectedCol.value)}${grid.selectedRow.value + 1}`
})
const hasRowSelection = computed(() => grid.selectedRow.value !== null)
const hasColSelection = computed(() => grid.selectedCol.value !== null)
const savedAtText = computed(() =>
  grid.lastSavedAt.value ? grid.lastSavedAt.value.toLocaleTimeString('zh-CN', { hour12: false }) : ''
)

/** 选中格变化时把原始内容同步到公式栏 */
watch([grid.selectedRow, grid.selectedCol], () => {
  if (grid.selectedRow.value === null || grid.selectedCol.value === null) {
    formulaInput.value = ''
    return
  }
  const cell = grid.cellMap.value.get(grid.cellKey(grid.selectedRow.value, grid.selectedCol.value))
  formulaInput.value = cell?.formula_text || cell?.text_value || ''
})

function applyFormulaBar() {
  if (grid.selectedRow.value === null || grid.selectedCol.value === null) return
  const cell = grid.cellMap.value.get(grid.cellKey(grid.selectedRow.value, grid.selectedCol.value))
  const current = cell?.formula_text || cell?.text_value || ''
  if (formulaInput.value === current) return
  grid.setCellValue(grid.selectedRow.value, grid.selectedCol.value, formulaInput.value)
}

const ROWCOL_LABEL: Record<RhStandardReportRowColAction, string> = {
  insert_row: '插入行',
  delete_row: '删除行',
  insert_col: '插入列',
  delete_col: '删除列',
}

async function handleRowCol(action: RhStandardReportRowColAction) {
  if (!currentReport.value) return
  const isRow = action.endsWith('_row')
  const index = isRow ? grid.selectedRow.value : grid.selectedCol.value
  if (index === null) return

  // 行列结构改动在服务端是一个事务（含公式引用平移），先把未决的单元格改动落库
  await grid.flushSave()

  if (action.startsWith('delete')) {
    try {
      await ElMessageBox.confirm(
        `确认${ROWCOL_LABEL[action]}？该${isRow ? '行' : '列'}的内容会被删除，指向它的公式会变成 #REF!。`,
        ROWCOL_LABEL[action],
        { type: 'warning' }
      )
    } catch {
      return
    }
  }

  try {
    const res: any = await updateStandardReportRowCol(currentReport.value.id, {
      action,
      index,
      count: 1,
    })
    if (res.code !== 0) throw new Error(res.message || '操作失败')
    ElMessage.success(`${ROWCOL_LABEL[action]}成功`)
    await loadReportDetail(currentReport.value.id)
  } catch (error: any) {
    ElMessage.error(error?.message || `${ROWCOL_LABEL[action]}失败`)
  }
}

// 离开页面前把未决的改动存下来
onBeforeUnmount(() => {
  void grid.flushSave()
  grid.dispose()
})
</script>

<style scoped>
.compute-error-alert {
  margin: 4px 0 8px;
}

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

.report-option-file {
  display: block;
}

.report-option-seq,
.report-option-name {
  color: #303133;
  font-weight: 600;
}

/* 序号右侧留白，与报表名同行显示 */
.report-option-seq {
  margin-right: 4px;
}

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
  font-size: var(--cw-text-base);
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

/* —— 公式视图的编辑工具条 —— */
.report-edit-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.report-edit-toolbar .cell-addr {
  min-width: 54px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  text-align: center;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-blank);
}

.report-edit-toolbar .selection-summary {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 12px;
  white-space: nowrap;
}

.report-edit-toolbar .formula-input {
  flex: 1;
  min-width: 260px;
}

.report-edit-toolbar .formula-fx-button {
  font-style: italic;
  font-weight: 600;
  min-width: 34px;
  padding: 0 8px;
}

.formula-reference {
  max-height: 420px;
  overflow-y: auto;
}

.formula-reference-hint {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.formula-reference-hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--el-fill-color-light);
}

.formula-reference-group + .formula-reference-group {
  margin-top: 10px;
}

.formula-reference-group-title {
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.formula-reference-item {
  display: flex;
  gap: 10px;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.formula-reference-item:hover {
  background: var(--el-fill-color-light);
}

.formula-reference-name {
  flex: 0 0 46%;
  font-family: Consolas, Monaco, monospace;
  color: var(--el-color-primary);
}

.formula-reference-desc {
  flex: 1;
  color: var(--el-text-color-regular);
}

.report-edit-toolbar .save-state {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.report-edit-toolbar .save-state--saving {
  color: var(--el-color-primary);
}

.report-edit-toolbar .save-state--saved {
  color: var(--el-color-success);
}

.report-edit-toolbar .save-state--error {
  color: var(--el-color-danger);
}
</style>
