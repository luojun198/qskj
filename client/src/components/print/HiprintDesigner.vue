<template>
  <div class="hiprint-designer">
    <div class="designer-toolbar">
      <el-form :inline="true" size="small" class="toolbar-form">
        <el-form-item label="模板名称">
          <el-input v-model="form.name" placeholder="模板名称" style="width: 180px" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.template_type" style="width: 110px" @change="onTypeChange">
            <el-option label="凭证" value="voucher" />
            <el-option label="账册" value="ledger" />
            <el-option label="报表" value="report" />
            <el-option label="业务单据" value="scm_doc" />
          </el-select>
        </el-form-item>
        <el-form-item label="业务键">
          <el-select v-model="form.template_key" style="width: 170px" placeholder="业务子类型" allow-create filterable>
            <el-option v-for="opt in keyOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="纸张">
          <el-select v-model="paperPreset" style="width: 150px" @change="onPaperPresetChange">
            <el-option label="凭证纸 210×148" value="voucher" />
            <el-option label="A5" value="A5" />
            <el-option label="A4" value="A4" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="paperPreset === 'custom'" label="宽×高(mm)">
          <el-input-number v-model="form.paper_width" :min="50" :max="600" controls-position="right" style="width: 90px" @change="applyPaper" />
          <span class="size-sep">×</span>
          <el-input-number v-model="form.paper_height" :min="50" :max="600" controls-position="right" style="width: 90px" @change="applyPaper" />
        </el-form-item>
      </el-form>
      <div class="toolbar-actions">
        <el-upload
          action="#"
          :show-file-list="false"
          :http-request="handleBackgroundUpload"
          accept="image/*"
        >
          <el-button size="small">上传凭证底图</el-button>
        </el-upload>
        <el-button v-if="form.background_image" size="small" @click="clearBackground">清除底图</el-button>
        <el-button size="small" @click="handlePreview">示例预览</el-button>
        <el-button size="small" @click="$emit('cancel')">返回</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </div>
    <p class="designer-hint">
      点击左侧字段即可加入画布；套打底图只作对齐参考，打印时可按打印机是否已印表格决定是否保留底图。
    </p>

    <div class="designer-body" v-loading="initializing">
      <div class="designer-tools">
        <div class="tools-title">{{ form.template_type === 'voucher' ? '凭证字段' : '元素' }}</div>
        <template v-if="form.template_type === 'voucher'">
          <button
            v-for="field in textFields"
            :key="field.field"
            type="button"
            class="field-item"
            @click="addTextField(field)"
          >
            {{ field.title }}
          </button>
          <button type="button" class="field-item" @click="addEntriesTable">分录表</button>
          <div v-if="hasEntriesTable" class="summary-card">
            <div class="summary-card-title">分录表 · 打印行数</div>
            <div class="summary-field">
              <span class="summary-label">每张固定</span>
              <el-input-number
                v-model="entriesRows.rows"
                :min="0"
                :max="VOUCHER_MAX_FIXED_ROWS"
                :step="1"
                step-strictly
                size="small"
                controls-position="right"
                class="rows-input"
                @change="applyRowsToPanel"
              />
              <span class="summary-label">行</span>
            </div>
            <p class="summary-hint">
              <template v-if="entriesRows.rows > 0">
                不含合计行；不足补空行，超出自动分页、每页都打 {{ entriesRows.rows }} 行。行高
                {{ entriesRows.rowHeight }}pt，随表格框高度均分。
              </template>
              <template v-else>0 = 不固定，按表格框高度能放几行就打几行。</template>
            </p>
          </div>
          <div v-if="hasEntriesTable" class="summary-card">
            <div class="summary-card-title">分录表 · 合计行</div>
            <el-checkbox
              v-model="entriesSummary.enabled"
              :disabled="!summaryCandidates.length"
              @change="onToggleSummary"
            >
              显示合计行
            </el-checkbox>
            <p v-if="!summaryCandidates.length" class="summary-hint">
              表格里没有可累加的列。请先在右侧属性面板勾选显示借方金额、贷方金额、数量或外币金额。
            </p>
            <template v-if="entriesSummary.enabled">
              <div class="summary-field">
                <span class="summary-label">合计文字</span>
                <el-input
                  v-model="entriesSummary.label"
                  size="small"
                  placeholder="合计"
                  @change="applySummaryToPanel"
                />
              </div>
              <div class="summary-label">参与合计的列</div>
              <el-checkbox-group
                v-model="entriesSummary.fields"
                class="summary-fields"
                @change="applySummaryToPanel"
              >
                <el-checkbox v-for="col in summaryCandidates" :key="col.field" :value="col.field">
                  {{ col.title }}
                </el-checkbox>
              </el-checkbox-group>
            </template>
          </div>
        </template>
        <!-- 业务单据（进销存）：表头字段 + 明细表（第六份反馈：业务单据打印模板定制） -->
        <template v-else-if="form.template_type === 'scm_doc'">
          <button v-for="field in scmTextFields" :key="field.field" type="button" class="field-item" @click="addTextField(field as any)">
            {{ field.title }}
          </button>
          <button type="button" class="field-item" @click="addEntriesTable">明细表</button>
          <p class="summary-hint">点字段加到画布；明细表的列在右侧属性面板里勾选显示、调整顺序和宽度。合计、大写金额用左侧对应字段。</p>
        </template>
        <div v-else ref="toolsRef" class="hiprint-tools" />
        <el-collapse class="advanced-tools">
          <el-collapse-item title="通用元素" name="generic">
            <div ref="genericToolsRef" class="hiprint-tools" />
          </el-collapse-item>
        </el-collapse>
      </div>
      <div id="hiprint-design-canvas" ref="designRef" class="designer-canvas" />
      <div class="designer-settings-wrap">
        <div class="tools-title">属性</div>
        <p class="settings-placeholder">点选画布上的字段后，可改字号、对齐和位置。</p>
        <div id="hiprint-element-settings" ref="settingsRef" class="designer-settings" />
      </div>
    </div>

    <el-dialog v-model="previewVisible" title="示例数据预览" width="920px" append-to-body destroy-on-close>
      <div v-loading="previewing" class="preview-wrap" v-html="previewHtml" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onActivated, onBeforeUnmount, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  centerVoucherHeaderCells,
  loadHiprint,
  mmToPt,
  normalizePanelForRender,
} from '@/utils/printTemplateHiprint'
import {
  VOUCHER_MAX_FIXED_ROWS,
  VOUCHER_TABLE_FIELD,
  VOUCHER_TEXT_FIELDS,
  applyVoucherTableRows,
  applyVoucherTableSummary,
  buildVoucherTableColumns,
  computeVoucherBodyRowHeightPt,
  defaultSummaryFields,
  readVoucherTableRows,
  readVoucherTableSummary,
  summableColumnsOf,
} from '@/utils/hiprintVoucherProvider'
import {
  fillEmptyHiddenTitleTestData,
  isHiddenBoundText,
  patchHiprintHiddenTitleEdit,
  syncHiddenBoundText,
} from '@/utils/hiprintTextEdit'
import { useBaseDataStore } from '@/stores/baseData'
import {
  buildEntriesTable,
  buildSampleVoucherPrintData,
  buildVoucherPanel,
  voucherPresetMeta,
  type VoucherPanelPreset,
} from '@/utils/printTemplateDefaultsHiprint'
import {
  getPrintTemplate,
  createPrintTemplate,
  updatePrintTemplate,
  uploadTemplateBackground,
} from '@/api/printTemplate'
import type { PrintTemplateType, HiprintPanel } from '@/types/print'
import {
  SCM_TABLE_FIELD, SCM_TEXT_FIELDS, buildDefaultScmPanel, buildSampleScmPrintData, buildScmTable, buildScmTableColumns, scmTemplateKey,
} from '@/utils/hiprintScmProvider'
import { DECIMAL_SCOPES } from '@/utils/scmDecimals'

interface Props {
  templateId?: string
  defaultType?: PrintTemplateType
  defaultKey?: string
  preset?: VoucherPanelPreset | string
}
const props = withDefaults(defineProps<Props>(), {
  defaultType: 'voucher',
})
const emit = defineEmits<{ save: [id: string]; cancel: [] }>()

const form = reactive({
  name: '',
  template_type: props.defaultType as PrintTemplateType,
  template_key: props.defaultKey || '',
  paper_size: 'custom',
  paper_width: 210,
  paper_height: 148,
  background_image: '' as string | null,
})

const paperPreset = ref('voucher')
const savedId = ref<string>(props.templateId || '')
const saving = ref(false)
const initializing = ref(true)
const previewVisible = ref(false)
const previewing = ref(false)
const previewHtml = ref('')
const toolsRef = ref<HTMLElement | null>(null)
const genericToolsRef = ref<HTMLElement | null>(null)
const designRef = ref<HTMLElement | null>(null)
const settingsRef = ref<HTMLElement | null>(null)

let tp: any = null
let hiprintRef: any = null
let disposed = false
/** 用户在 hiprint 加载完成前离开页面时置 true，等 keep-alive 再激活时补做初始化 */
let pendingInit = false

/** 页面被 keep-alive 停用或已卸载时，画布节点不在文档中，此时不能再让 hiprint 往上挂设计器 */
const canvasAttached = () => !disposed && !!designRef.value?.isConnected

const textFields = VOUCHER_TEXT_FIELDS
const baseDataStore = useBaseDataStore()
let restoringTable = false
let restoringTitle = false

const voucherColumnCatalog = () => (form.template_type === 'scm_doc' ? buildScmTableColumns() : buildVoucherTableColumns(baseDataStore.auxCategories))
const scmTextFields = SCM_TEXT_FIELDS

const designerFields = () => form.template_type === 'scm_doc' ? [
  ...SCM_TEXT_FIELDS.map(f => ({ text: f.title, field: f.field })),
  { text: '明细表', field: SCM_TABLE_FIELD },
] : [
  ...VOUCHER_TEXT_FIELDS.map(f => ({ text: f.title, field: f.field })),
  { text: '分录表', field: VOUCHER_TABLE_FIELD },
  ...baseDataStore.auxCategories
    .filter(c => c.code)
    .map(c => ({ text: c.name || c.code, field: `aux_${c.code}` })),
]

function listPrintElements(): any[] {
  const panels = tp?.printPanels
  if (Array.isArray(panels)) return panels.flatMap((p: any) => p.printElements || [])
  return tp?.editingPanel?.printElements || []
}

function attachVoucherTableCatalog() {
  if (!tp) return
  const catalog = voucherColumnCatalog()
  for (const el of listPrintElements()) {
    const type = el?.printElementType
    if (!type || type.type !== 'table') continue
    const current = Array.isArray(type.columns?.[0]) ? type.columns[0] : []
    const have = new Set(current.map((c: any) => c.columnId || c.field))
    for (const col of catalog) {
      if (have.has(col.columnId || col.field)) continue
      current.push({ ...col })
      have.add(col.columnId || col.field)
    }
    type.columns = [current]
    if (typeof type.makeColumnObj === 'function') type.makeColumnObj(current)
  }
}

/* --------- 分录表合计行：读写画布上表格元素的 hiprint 原生 tableSummary* 列属性 --------- */

const hasEntriesTable = ref(false)
const summaryCandidates = ref<Array<{ field: string; title: string }>>([])
const entriesSummary = reactive({ enabled: false, fields: [] as string[], label: '合计' })

/** 凭证模板只会有一张分录表，取第一张即可 */
function findEntriesTable(panel: any) {
  return (panel?.printElements || []).find((el: any) => el?.printElementType?.type === 'table')
}

function tableColumnsOf(el: any): any[] {
  const cols = el?.options?.columns
  return Array.isArray(cols?.[0]) ? cols[0] : []
}

/** 从画布回读合计行配置与候选列（用户在原生面板里勾掉某列显示后，这里同步消失） */
function syncSummaryFromPanel() {
  if (!tp) return
  const el = findEntriesTable(tp.getJson()?.panels?.[0])
  hasEntriesTable.value = !!el
  if (!el) {
    summaryCandidates.value = []
    return
  }
  const cols = tableColumnsOf(el)
  summaryCandidates.value = summableColumnsOf(cols).map(col => ({
    field: String(col.field),
    title: String(col.title || col.field),
  }))
  const config = readVoucherTableSummary(cols)
  entriesSummary.enabled = config.enabled
  entriesSummary.fields = config.fields
  entriesSummary.label = config.label
}

/**
 * 「显示合计行」开关。
 *
 * 合计行的开关状态并不单独存字段，而是由「有没有列设了 tableSummary」反推出来的
 * （见 readVoucherTableSummary）。所以打开开关时若一个字段都没选，写回去等于什么都没写，
 * 回读又会把开关重置成关闭 —— 表现就是复选框勾不上。这里在打开时补一份默认选择。
 */
function onToggleSummary() {
  if (entriesSummary.enabled && !entriesSummary.fields.length) {
    entriesSummary.fields = defaultSummaryFields(summaryCandidates.value.map(col => col.field))
  }
  applySummaryToPanel()
}

/** 把面板上的选择写回表格元素；写法与 addEntriesTable 一致（改 json → tp.update） */
function applySummaryToPanel() {
  if (!tp) return
  const json = tp.getJson()
  const el = findEntriesTable(json?.panels?.[0])
  if (!el?.options) return
  const columns = applyVoucherTableSummary(tableColumnsOf(el), {
    enabled: entriesSummary.enabled,
    fields: entriesSummary.fields,
    label: entriesSummary.label || '合计',
  })
  el.options.columns = [columns]
  if (Array.isArray(el.printElementType?.columns?.[0])) {
    el.printElementType.columns = [columns.map(col => ({ ...col }))]
  }
  // 合计行贴在表格框底部靠 autoCompletion 补空行；'last' = 只在最后一页出表尾
  el.options.tableFooterRepeat = entriesSummary.enabled ? 'last' : 'no'
  if (entriesSummary.enabled) el.options.autoCompletion = true
  tp.update(json)
  bindTableGuards()
}

/* --------- 分录表固定行数：读写 hiprint 原生 maxRows / autoCompletion / tableBodyRowHeight --------- */

const entriesRows = reactive({ rows: 0, rowHeight: 0 })


/** 画布上的表格运行时实例（带 designTarget），getJson 出来的副本没有 DOM */
function findLiveEntriesTable(): any {
  const panel = tp?.printPanels?.[0] || tp?.editingPanel
  return findEntriesTable(panel)
}

/**
 * 把统一行高刷到画布 DOM：列头 / 表体 / 合计行三处 td。
 * 列头与表体 hiprint 会按 options 自己刷；合计行没有原生行高选项，画布上只能这样补
 * （打印时由 VOUCHER_SUMMARY_FORMATTER_SRC 写进合计单元格）。
 */
function paintUniformRowHeight(liveEl: any, rowHeight: number) {
  const node: HTMLElement | undefined = liveEl?.designTarget?.[0] || liveEl?.designTarget
  node
    ?.querySelectorAll?.('thead tr td:not([rowspan]), tbody tr td:not([rowspan]), tfoot tr td')
    .forEach(td => {
      ;(td as HTMLElement).style.height = `${rowHeight}pt`
    })
}

/**
 * 回读固定行数，并在表格框高度变化（拖拽 resize、restoreCollapsedTables 补高）后重算行高。
 * 重算只改 options + DOM，不走 tp.update：dataChanged 回调里整页重建会把刚点出来的属性面板清掉。
 */
function syncRowsFromPanel() {
  const el = findLiveEntriesTable()
  if (!el?.options) {
    entriesRows.rows = 0
    entriesRows.rowHeight = 0
    return
  }
  const current = readVoucherTableRows(el.options)
  entriesRows.rows = current.rows
  if (!current.rows) {
    entriesRows.rowHeight = 0
    return
  }
  const rowHeight = computeVoucherBodyRowHeightPt({
    tableHeightPt: Number(el.options.height || 0),
    rows: current.rows,
    summaryOn: readVoucherTableSummary(tableColumnsOf(el)).enabled,
  })
  entriesRows.rowHeight = rowHeight
  // 合计行画布上没有原生行高，每次刷新都补一遍；options 只在行高变化（含老模板没存表头行高）时写
  paintUniformRowHeight(el, rowHeight)
  if (Math.abs(rowHeight - current.rowHeight) < 0.5 && el.options.tableHeaderRowHeight === rowHeight) return
  el.options.tableBodyRowHeight = rowHeight
  el.options.tableHeaderRowHeight = rowHeight
}

/** 面板改行数 → 写回表格元素；写法与 applySummaryToPanel 一致（改 json → tp.update） */
function applyRowsToPanel() {
  if (!tp) return
  const json = tp.getJson()
  const panel = json?.panels?.[0]
  const el = findEntriesTable(panel)
  if (!el?.options) return
  const rows = Math.max(0, Math.floor(Number(entriesRows.rows) || 0))
  el.options = applyVoucherTableRows(el.options, { rows })
  tp.update(json)
  bindTableGuards()
  if (rows > 0) {
    // 补空行补到的是页脚线而不是表格底边：页脚线若压在表格框里面，N 行就补不满
    const bottom = Number(el.options.top || 0) + Number(el.options.height || 0)
    const footerLine = Number(panel?.paperFooter || 0)
    if (footerLine && footerLine < bottom - 1) {
      ElMessage.warning('页脚线在分录表框之内，空行只会补到页脚线，可能凑不齐固定行数。请把页脚线拖到表格底边以下。')
    }
  }
}

function tableHeightFor(panel: any, tableEl: any): number {
  const top = Number(tableEl?.options?.top || 0)
  const footerPt = Number(panel?.paperFooter) || mmToPt(form.paper_height - 8)
  const below = ((panel?.printElements || []) as any[])
    .filter(el => el !== tableEl && el?.printElementType?.type !== 'table')
    .map(el => Number(el?.options?.top || 0))
    .filter(t => t > top + 8)
  const next = below.length ? Math.min(...below) : footerPt
  return Math.max(next - top - mmToPt(2), mmToPt(28))
}

function restoreCollapsedTables() {
  if (!tp || restoringTable) return
  const panel = tp.printPanels?.[0] || tp.editingPanel
  if (!panel) return
  const tables = (panel.printElements || []).filter((el: any) => el?.printElementType?.type === 'table')
  for (const el of tables) {
    const node = el.designTarget?.[0] || el.designTarget
    const optionH = Number(el.options?.height || 0)
    const styleH = node?.style ? parseFloat(node.style.height) || 0 : 0
    const boxH = node?.getBoundingClientRect?.().height || 0
    if (optionH >= 8 && styleH >= 8 && boxH >= 8) continue
    const height = tableHeightFor(panel, el)
    if (el.options) {
      el.options.height = height
      el.options.lHeight = height
    }
    if (node?.style) {
      node.style.height = `${height}pt`
      node.style.minHeight = `${height}pt`
      node.style.overflow = 'visible'
    }
  }
}

function restoreHiddenTitleTestData() {
  if (!tp || restoringTitle) return
  // 点选分录表时 hiprint 会先出属性再抛 dataChanged。这里若 tp.update 整页重建，
  // 刚挂上的属性面板会被清掉，看起来就像「点分录表右边没有属性」。
  if (tp.lastPrintElement) return
  const json = tp.getJson?.()
  const panel = json?.panels?.[0]
  if (!panel?.printElements) return
  const { elements, changed } = fillEmptyHiddenTitleTestData(panel.printElements)
  if (!changed) return
  restoringTitle = true
  try {
    panel.printElements = elements
    tp.update(json)
  } finally {
    queueMicrotask(() => {
      restoringTitle = false
    })
  }
}

function applyTitleToSelected(title: string) {
  if (!tp) return
  const selected = typeof tp.getSelectEls === 'function' ? tp.getSelectEls() : []
  const els = selected?.length ? selected : tp.lastPrintElement ? [tp.lastPrintElement] : []
  for (const el of els) {
    if (!isHiddenBoundText(el?.options)) continue
    const next = syncHiddenBoundText(el.options, title)
    if (el.options.testData === next.testData && el.options.title === next.title) continue
    el.options.title = next.title
    el.options.testData = next.testData
    if (typeof el.updateOption === 'function') el.updateOption('testData', next.testData, true)
    else el.updateDesignViewFromOptions?.()
  }
}

function bindHiddenTitleCanvasSync() {
  if (!tp) return
  patchHiprintHiddenTitleEdit(listPrintElements())
  restoreHiddenTitleTestData()
  const root = settingsRef.value
  if (!root || root.dataset.cwTitleSync === '1') return
  root.dataset.cwTitleSync = '1'
  const onTitleField = (e: Event) => {
    const target = e.target as HTMLElement | null
    if (!(target instanceof HTMLTextAreaElement)) return
    const label = target.closest('.hiprint-option-item')?.querySelector('.hiprint-option-item-label')
    if (label?.textContent?.trim() !== '标题') return
    applyTitleToSelected(target.value)
  }
  root.addEventListener('change', onTitleField)
  root.addEventListener('input', onTitleField)
}

/**
 * 点表格任意位置都出属性。
 *
 * hiprint 的 TablePrintElement 覆盖了 BasePrintElement.getDesignTarget，覆盖版里没有基类那句
 * 「designTarget.click → 触发选中事件」的绑定，只在 setColumnsOptions 里给表头 td 绑了 click。
 * 结果就是点表体没反应，必须点列头。这里补回元素级选中；表头仍走原生逻辑，以保留「列属性」页签。
 */
function bindTableSelectClick() {
  if (!tp) return
  const hinnn = (window as any).hinnn
  if (typeof hinnn?.event?.trigger !== 'function') return
  for (const el of listPrintElements()) {
    if (el?.printElementType?.type !== 'table') continue
    const node: HTMLElement | undefined = el.designTarget?.[0] || el.designTarget
    if (!node?.dataset || node.dataset.cwTableSelect === '1') continue
    node.dataset.cwTableSelect = '1'
    node.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('thead') || target?.closest('.del-btn')) return
      const key = el.getPrintElementSelectEventKey?.()
      if (key) hinnn.event.trigger(key, { printElement: el })
    })
  }
}

function bindTableGuards() {
  if (!tp) return
  const refresh = () => {
    if (restoringTable || restoringTitle) return
    restoringTable = true
    try {
      attachVoucherTableCatalog()
      restoreCollapsedTables()
      syncSummaryFromPanel()
      syncRowsFromPanel()
      patchHiprintHiddenTitleEdit(listPrintElements())
      bindTableSelectClick()
    } finally {
      queueMicrotask(() => {
        restoringTable = false
      })
    }
  }
  tp.onDataChanged = refresh
  tp.onUpdateError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err || '')
    if (message && !message.includes("reading 'style'")) {
      ElMessage.error('更新表格失败：' + message)
    }
    refresh()
  }
  if (typeof tp.on === 'function') {
    try {
      tp.on('hiprintTemplateDataChanged', refresh)
    } catch {
      /* 旧版 hiprint 无此事件 */
    }
  }
  refresh()
}

const keyOptions = computed(() => {
  if (form.template_type === 'scm_doc') {
    return [
      { label: '所有业务单据通用', value: scmTemplateKey('*') },
      ...DECIMAL_SCOPES.filter(s => /^[A-Z]/.test(s.key)).map(s => ({ label: s.label, value: scmTemplateKey(s.key) })),
      { label: '收款单', value: scmTemplateKey('RCV') },
      { label: '付款单', value: scmTemplateKey('PAY') },
    ]
  }
  if (form.template_type === 'voucher') {
    return [
      { label: '记账凭证（标准）', value: 'voucher:standard' },
      { label: '记账凭证（复币）', value: 'voucher:foreign' },
      { label: '银行进账单', value: 'voucher:bank_in_slip' },
    ]
  }
  if (form.template_type === 'ledger') {
    return [
      { label: '明细账', value: 'ledger:detail' },
      { label: '外币明细账', value: 'ledger:foreign-detail' },
      { label: '数量明细账', value: 'ledger:quantity-detail' },
      { label: '数量复币明细账', value: 'ledger:quantity-foreign-detail' },
      { label: '总账', value: 'ledger:general' },
      { label: '余额表', value: 'ledger:balance' },
      { label: '序时账', value: 'ledger:chronological' },
    ]
  }
  return [
    { label: '资产负债表', value: 'report:balance_sheet' },
    { label: '利润表', value: 'report:income_statement' },
    { label: '通用动态报表', value: 'report:dynamic' },
  ]
})

const PRESET: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  voucher: { w: 210, h: 148 },
}

const onTypeChange = () => {
  if (!form.template_key) form.template_key = keyOptions.value[0]?.value || ''
}

const syncPaperPreset = () => {
  if (form.paper_size === 'A4') paperPreset.value = 'A4'
  else if (form.paper_size === 'A5') paperPreset.value = 'A5'
  else if (form.paper_width === 210 && form.paper_height === 148) paperPreset.value = 'voucher'
  else paperPreset.value = 'custom'
}

const onPaperPresetChange = () => {
  if (paperPreset.value === 'custom') {
    form.paper_size = 'custom'
  } else if (paperPreset.value === 'voucher') {
    form.paper_size = 'custom'
    form.paper_width = 210
    form.paper_height = 148
  } else {
    const p = PRESET[paperPreset.value]
    form.paper_size = paperPreset.value
    if (p) {
      form.paper_width = p.w
      form.paper_height = p.h
    }
  }
  applyPaper()
}

const applyPaper = () => {
  if (!tp) return
  if (form.paper_size === 'custom' || paperPreset.value === 'voucher') {
    tp.setPaper('other', { width: form.paper_width, height: form.paper_height })
  } else {
    const p = PRESET[form.paper_size] || PRESET.A4
    form.paper_width = p.w
    form.paper_height = p.h
    tp.setPaper(form.paper_size, {})
  }
}

const buildEmptyTemplate = (): { panels: HiprintPanel[] } => ({
  panels: [
    {
      index: 0,
      paperType: form.paper_size === 'custom' ? 'other' : form.paper_size,
      width: form.paper_width,
      height: form.paper_height,
      paperHeader: 30,
      paperFooter: 800,
      printElements: [],
      ...(form.background_image ? { background: form.background_image } : {}),
    },
  ],
})

/** 返回 false 表示页面已离开，本次初始化中止（并记为待重做） */
const initDesigner = async (panelJson?: { panels: HiprintPanel[] }): Promise<boolean> => {
  const mod = await loadHiprint()
  if (!canvasAttached()) return false
  hiprintRef = mod.hiprint
  if (toolsRef.value && form.template_type !== 'voucher') {
    toolsRef.value.innerHTML = ''
    hiprintRef.PrintElementTypeManager.build(toolsRef.value, 'defaultModule')
  }
  if (genericToolsRef.value) {
    genericToolsRef.value.innerHTML = ''
    hiprintRef.PrintElementTypeManager.build(genericToolsRef.value, 'defaultModule')
  }
  const seed = panelJson || buildEmptyTemplate()
  await nextTick()
  if (!canvasAttached()) return false
  tp = new hiprintRef.PrintTemplate({
    template: seed,
    settingContainer: settingsRef.value || '#hiprint-element-settings',
    history: true,
    fields: designerFields(),
  })
  const canvas = designRef.value as HTMLElement
  canvas.innerHTML = ''
  tp.design(canvas)
  const current = tp.getJson?.()
  if (panelJson && !(current?.panels?.[0]?.printElements || []).length) {
    tp.update(seed)
  }
  bindTableGuards()
  bindHiddenTitleCanvasSync()
  return true
}

const loadExisting = async () => {
  if (!props.templateId) return null
  const res = await getPrintTemplate(props.templateId)
  if (res.code === 0) {
    const t = res.data
    form.name = t.name
    form.template_type = (t.template_type as PrintTemplateType) || 'voucher'
    form.template_key = t.template_key || ''
    form.paper_size = String(t.paper_size).toLowerCase() === 'a4' ? 'A4' : String(t.paper_size).toLowerCase() === 'a5' ? 'A5' : t.paper_size || 'custom'
    form.paper_width = t.paper_width
    form.paper_height = t.paper_height
    form.background_image = t.background_image || ''
    syncPaperPreset()
    const panel: any = t.panel
    if (panel && Array.isArray(panel.panels) && panel.panels.length > 0) {
      // 老模板列定义没有 halign：加载时补上列头居中，画布与打印一致，保存时一并落库
      return centerVoucherHeaderCells(panel as { panels: HiprintPanel[] })
    }
  }
  return null
}

const applyPresetDefaults = (preset: VoucherPanelPreset) => {
  const meta = voucherPresetMeta(preset)
  form.name = form.name || meta.name
  form.template_type = 'voucher'
  form.template_key = meta.template_key
  form.paper_size = meta.paper_size
  form.paper_width = meta.paper_width
  form.paper_height = meta.paper_height
  syncPaperPreset()
}

const handleSave = async () => {
  if (!form.name.trim()) {
    ElMessage.warning('请输入模板名称')
    return
  }
  if (!tp) return
  saving.value = true
  try {
    const panel = tp.getJson()
    const payload = {
      name: form.name.trim(),
      template_type: form.template_type,
      template_key: form.template_key || null,
      paper_size: form.paper_size,
      paper_width: form.paper_width,
      paper_height: form.paper_height,
      margin_top: 8,
      margin_bottom: 8,
      margin_left: 12,
      margin_right: 12,
      panel,
      elements: [],
    }
    let id = savedId.value
    if (id) {
      await updatePrintTemplate(id, payload)
    } else {
      const res = await createPrintTemplate(payload)
      if (res.code === 0) id = res.data.id
    }
    savedId.value = id
    ElMessage.success('保存成功')
    emit('save', id)
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

const handleBackgroundUpload = async (options: any) => {
  if (!savedId.value) {
    await handleSave()
    if (!savedId.value) return
  }
  try {
    const res = await uploadTemplateBackground(savedId.value, options.file)
    if (res.code === 0) {
      form.background_image = res.data.background_image
      applyBackgroundToPanel(form.background_image || '')
      ElMessage.success('底图已铺入画布，请把字段对齐格线')
    }
  } catch (e: any) {
    ElMessage.error('底图上传失败：' + (e?.message || e))
  }
}

const applyBackgroundToPanel = (url: string) => {
  if (!tp) return
  const json = tp.getJson()
  const panel: any = json.panels?.[0]
  if (!panel) return
  const wPt = mmToPt(form.paper_width || 210)
  const hPt = mmToPt(form.paper_height || 297)
  const bgEl = {
    options: { left: 0, top: 0, width: wPt, height: hPt, src: url, fit: 'fill' },
    printElementType: { title: '底图', type: 'image' },
  }
  panel.printElements = (panel.printElements || []).filter(
    (el: any) => el?.printElementType?.title !== '底图'
  )
  panel.printElements.unshift(bgEl)
  panel.background = url
  tp.update(json)
}

const clearBackground = () => {
  form.background_image = ''
  if (tp) {
    const json = tp.getJson()
    const panel: any = json.panels?.[0]
    if (panel) {
      panel.printElements = (panel.printElements || []).filter(
        (el: any) => el?.printElementType?.title !== '底图'
      )
      delete panel.background
      tp.update(json)
    }
  }
}

function nextTopMm() {
  if (!tp) return 8
  const els = tp.getJson()?.panels?.[0]?.printElements || []
  let max = 8
  for (const el of els as any[]) {
    const topPt = Number(el?.options?.top || 0)
    const heightPt = Number(el?.options?.height || 16)
    max = Math.max(max, (topPt + heightPt) * (25.4 / 72) + 3)
  }
  return Math.min(max, Math.max(form.paper_height - 12, 8))
}

const addTextField = (field: (typeof VOUCHER_TEXT_FIELDS)[number]) => {
  if (!tp) return
  const json = tp.getJson()
  const panel = json.panels?.[0]
  if (!panel) return
  panel.printElements = panel.printElements || []
  panel.printElements.push({
    options: {
      left: mmToPt(12),
      top: mmToPt(nextTopMm()),
      width: mmToPt(50),
      height: mmToPt(7),
      field: field.field,
      title: field.testData,
      testData: field.testData,
      fontSize: field.fontSize,
      fontWeight: 'fontWeight' in field ? field.fontWeight : '400',
      textAlign: 'textAlign' in field ? field.textAlign : 'left',
      hideTitle: true,
      // 固定坐标：打印时不跟随分录表实际高度浮动（见 pinDesignedPanelElements 注释）
      fixed: true,
    },
    printElementType: { type: 'text', title: field.title },
  })
  tp.update(json)
}

/**
 * 分录表需要在页脚线之前留出足够高度，hiprint 对落在页脚以下的表格不渲染。
 * 因此不能像文本字段那样简单追加到最底部，而是找画布上最大的一段纵向空白（一般就是
 * 表头字段与合计行之间原表格所在位置），把表放回去。
 */
function tableTopPt(panel: any): number {
  const footerPt = Number(panel?.paperFooter) || mmToPt(form.paper_height - 8)
  const startPt = mmToPt(8)
  const spans = ((panel?.printElements || []) as any[])
    .map(el => {
      const top = Number(el?.options?.top || 0)
      const height = Number(el?.options?.height || 20)
      return [top, top + height] as [number, number]
    })
    .filter(([top]) => top < footerPt)
    .sort((a, b) => a[0] - b[0])

  let cursor = startPt
  let best: [number, number] = [startPt, 0]
  for (const [top, bottom] of spans) {
    if (top - cursor > best[1]) best = [cursor, top - cursor]
    cursor = Math.max(cursor, bottom)
  }
  if (footerPt - cursor > best[1]) best = [cursor, footerPt - cursor]

  const minTableHeightPt = mmToPt(30)
  if (best[1] >= minTableHeightPt) return best[0] + mmToPt(2)
  return mmToPt(30)
}

const addEntriesTable = () => {
  if (!tp) return
  const json = tp.getJson()
  const panel = json.panels?.[0]
  if (!panel) return
  const widthMm = Math.max(form.paper_width - 24, 80)
  const top = tableTopPt(panel)
  const heightPt = tableHeightFor(panel, { options: { top } })
  panel.printElements = panel.printElements || []
  if (form.template_type === 'scm_doc') {
    const scmDraft = buildScmTable(10, 0, Math.max(form.paper_width - 20, 80), 40)
    scmDraft.options.top = top
    scmDraft.options.height = heightPt
    panel.printElements.push(scmDraft)
    tp.update(json)
    bindTableGuards()
    return
  }
  const draft = buildEntriesTable(12, 0, widthMm, 0, baseDataStore.auxCategories)
  draft.options.top = top
  draft.options.height = heightPt
  // buildEntriesTable 时高度还是 0，行高按最终高度重算一次
  draft.options = applyVoucherTableRows(draft.options, {
    rows: readVoucherTableRows(draft.options).rows,
  }) as typeof draft.options
  panel.printElements.push(draft)
  tp.update(json)
  bindTableGuards()
}

const handlePreview = async () => {
  if (!tp) return
  previewVisible.value = true
  previewing.value = true
  try {
    const panel = tp.getJson()
    const mod = await loadHiprint()
    const previewTp = new mod.hiprint.PrintTemplate({ template: normalizePanelForRender(panel) })
    const $html = previewTp.getHtml(form.template_type === 'scm_doc' ? buildSampleScmPrintData() : buildSampleVoucherPrintData()) as any
    const node = $html && ($html[0] || (typeof $html.get === 'function' && $html.get(0)))
    previewHtml.value = node ? node.outerHTML : String($html || '')
  } catch (e: any) {
    ElMessage.error('预览失败：' + (e?.message || e))
    previewHtml.value = ''
  } finally {
    previewing.value = false
  }
}

let seedPanel: { panels: HiprintPanel[] } | undefined

const runInit = async () => {
  initializing.value = true
  pendingInit = false
  try {
    const ok = await initDesigner(seedPanel)
    if (!ok) pendingInit = true
  } catch (e: any) {
    if (!canvasAttached()) {
      pendingInit = true
      return
    }
    ElMessage.error('设计器初始化失败：' + (e?.message || e))
  } finally {
    initializing.value = false
  }
}

onMounted(async () => {
  try {
    await nextTick()
    try {
      await baseDataStore.loadAuxCategories()
    } catch {
      /* 辅助类别加载失败时仍可编辑基础分录列 */
    }
    const existing = await loadExisting()
    let seed = existing
    if (!seed && !props.templateId && (props.preset === 'scm' || form.template_type === 'scm_doc')) {
      // 业务单据：从内置起始版面开始（241×140 三联单宽度）
      form.template_type = 'scm_doc'
      form.template_key = props.defaultKey || scmTemplateKey('*')
      form.paper_size = 'custom'
      form.paper_width = 241
      form.paper_height = 140
      paperPreset.value = 'custom'
      const keyLabel = keyOptions.value.find(o => o.value === form.template_key)?.label || '业务单据'
      if (!form.name) form.name = `${keyLabel.replace('所有业务单据通用', '业务单据')}模板`
      seed = buildDefaultScmPanel(241, 140) as unknown as { panels: HiprintPanel[] }
    }
    if (!seed && !props.templateId) {
      const preset = (['standard', 'blank', 'a4', 'foreign'].includes(String(props.preset))
        ? props.preset
        : 'standard') as VoucherPanelPreset
      if (form.template_type === 'voucher' || props.preset) {
        applyPresetDefaults(preset)
        seed = buildVoucherPanel(preset, baseDataStore.auxCategories) as { panels: HiprintPanel[] }
      }
    }
    if (!form.template_key) form.template_key = keyOptions.value[0]?.value || 'voucher:standard'
    if (!form.name && form.template_type === 'voucher') form.name = voucherPresetMeta('standard').name
    seedPanel = seed || undefined
  } catch (e: any) {
    ElMessage.error('设计器初始化失败：' + (e?.message || e))
    initializing.value = false
    return
  }
  await runInit()
})

onActivated(() => {
  if (pendingInit && !tp) void runInit()
})

onBeforeUnmount(() => {
  disposed = true
})
</script>

<style scoped>
.hiprint-designer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #fff;
}
.designer-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 16px 0;
  flex-wrap: wrap;
}
.toolbar-form {
  flex: 1;
}
.toolbar-form :deep(.el-form-item) {
  margin-bottom: 8px;
}
.size-sep {
  margin: 0 4px;
  color: #909399;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.designer-hint {
  margin: 0;
  padding: 0 16px 8px;
  font-size: 12px;
  color: #909399;
}
.designer-body {
  flex: 1;
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--el-border-color-lighter);
}
.designer-tools,
.designer-settings-wrap {
  flex: none;
  width: 220px;
  overflow: auto;
  background: #f7f8fa;
  padding: 10px 8px;
}
/* 画布两侧留白远多于纸张需要，属性面板（hiprint 原生两列布局）优先占宽 */
.designer-settings-wrap {
  width: clamp(300px, 26vw, 420px);
  padding: 10px 10px 16px;
  border-left: 1px solid var(--el-border-color-lighter);
}
/* 窄屏上纸张本身就已挤占画布，属性栏退回最小宽度 */
@media (max-width: 1440px) {
  .designer-settings-wrap {
    width: 300px;
  }
}
.designer-tools {
  border-right: 1px solid var(--el-border-color-lighter);
}
.tools-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.advanced-tools {
  margin-top: 8px;
  border: none;
}
.advanced-tools :deep(.el-collapse-item__header) {
  height: 36px;
  font-size: 12px;
  background: transparent;
}
.designer-canvas {
  flex: 1;
  overflow: auto;
  background: #eef1f6;
  display: flex;
  justify-content: center;
  padding: 12px 8px;
}
.designer-canvas :deep(.hiprint-printPaper) {
  box-shadow: 0 8px 28px rgba(15, 35, 40, 0.12);
  background: #fff;
}
.designer-canvas :deep(.hiprint-printElement-table) {
  min-height: 48pt;
  overflow: visible;
}
.designer-canvas :deep(.hiprint-printElement-table[style*='height: 0']) {
  height: auto !important;
}
/* 覆盖 hiprint 默认大红方块，改为十字移动图标（仅设计态，不进预览/打印） */
.designer-canvas :deep(.hiprint-printElement-table-handle) {
  width: 18px;
  height: 18px;
  background-color: #fff !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23606266' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='5 9 2 12 5 15'/%3E%3Cpolyline points='9 5 12 2 15 5'/%3E%3Cpolyline points='15 19 12 22 9 19'/%3E%3Cpolyline points='19 9 22 12 19 15'/%3E%3Cline x1='2' y1='12' x2='22' y2='12'/%3E%3Cline x1='12' y1='2' x2='12' y2='22'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  background-size: 14px 14px !important;
  border: 1px solid #dcdfe6;
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  cursor: move;
  z-index: 2;
}
.designer-canvas :deep(.hiprint-printElement-table-handle:hover) {
  border-color: #909399;
  background-color: #f5f7fa !important;
}
.settings-placeholder {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
.designer-settings-wrap:has(#hiprint-element-settings .hiprint-option-item) .settings-placeholder,
.designer-settings-wrap:has(#hiprint-element-settings .prop-tabs) .settings-placeholder {
  display: none;
}
.designer-settings :deep(.hiprint-option-items) {
  padding: 4px 0 0;
}
.designer-settings :deep(.hiprint-option-item) {
  margin-bottom: 4px;
  padding: 3px 4px 4px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  background: #fff;
}
.designer-settings :deep(.hiprint-option-item-label),
.designer-settings :deep(label) {
  display: block;
  margin: 0 0 2px;
  font-size: 12px;
  line-height: 1.3;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.designer-settings :deep(input:not([type='checkbox']):not([type='radio'])),
.designer-settings :deep(select),
.designer-settings :deep(textarea) {
  width: 100%;
  box-sizing: border-box;
  min-height: 24px;
  height: 24px;
  padding: 2px 6px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
}
.designer-settings :deep(textarea) {
  height: 26px;
  resize: vertical;
}
.designer-settings :deep(.prop-tab-items) {
  height: 28px;
  line-height: 28px;
}
.designer-settings :deep(.prop-tab-items .tab-title) {
  height: 28px;
  line-height: 28px;
  padding: 0 8px;
  font-size: 12px;
}
.hiprint-tools :deep(.ep-draggable-item) {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
}
.hiprint-tools :deep(.ep-draggable-item) {
  margin-bottom: 6px;
  padding: 6px 8px;
  font-size: 12px;
  cursor: grab;
}
.field-item {
  display: block;
  width: 100%;
  margin-bottom: 6px;
  padding: 7px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
  color: #303133;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.field-item:hover {
  border-color: #67c23a;
  color: #529b2e;
}
.summary-card {
  margin-top: 10px;
  padding: 8px 10px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fff;
}
.summary-card-title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #303133;
}
.summary-field {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0;
}
.summary-label {
  flex: none;
  font-size: 12px;
  color: #606266;
}
.rows-input {
  width: 96px;
}
.summary-fields {
  display: flex;
  flex-direction: column;
  margin-top: 4px;
}
.summary-fields :deep(.el-checkbox) {
  height: 24px;
  margin-right: 0;
}
.summary-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.preview-wrap {
  min-height: 360px;
  background: #f5f7fa;
  padding: 16px;
  text-align: center;
  overflow: auto;
}
.preview-wrap :deep(.hiprint-printPaper) {
  margin: 0 auto;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
</style>
