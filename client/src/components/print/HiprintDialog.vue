<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="1320px"
    top="4vh"
    append-to-body
    class="hiprint-dialog"
    @opened="handleOpened"
  >
    <div class="hiprint-toolbar">
      <template v-if="useTemplates && !rawHtmlPreview">
        <span class="label">打印模板</span>
        <el-select
          v-model="selectedTemplateId"
          size="small"
          placeholder="默认模板"
          style="width: 220px"
          :loading="loadingTemplates"
          @change="onTemplateChange"
        >
          <el-option
            v-for="t in templates"
            :key="t.id"
            :label="t.name + (t.is_default ? '（默认）' : '')"
            :value="t.id"
          />
          <el-option
            v-for="b in builtinPanels || []"
            :key="b.id"
            :label="`内置：${b.name}`"
            :value="b.id"
          />
          <el-option v-if="templates.length === 0 && !builtinPanels?.length" label="内置默认排版" value="" />
        </el-select>
      </template>
      <template v-if="showFontSize">
        <span class="label">字号</span>
        <el-select
          v-model="fontSizeKey"
          size="small"
          style="width: 100px"
          @change="renderPreview"
        >
          <el-option label="小" value="small" />
          <el-option label="中" value="medium" />
          <el-option label="大" value="large" />
        </el-select>
      </template>
      <template v-if="voucherPrint">
        <span class="label">纸张</span>
        <el-select
          v-model="paperMode"
          size="small"
          style="width: 150px"
          :disabled="mergeMode"
          @change="handlePaperModeChange"
        >
          <el-option label="适应打印机纸张" value="fit" />
          <el-option :label="actualPaperLabel" value="actual" />
        </el-select>
        <el-tooltip placement="bottom" :show-after="200">
          <template #content>
            <div class="paper-mode-tip">
              <b>适应打印机纸张</b>（推荐）：在打印面板里自选纸张和横向/纵向，凭证按比例自动缩放填满，不变形；<br />
              <b>凭证纸 1:1</b>：按模板尺寸原样打印，需先在打印机里建好同尺寸纸型，适合套打预印凭证纸。<br />
              选择会记在本电脑上。
            </div>
          </template>
          <el-icon class="paper-mode-help"><QuestionFilled /></el-icon>
        </el-tooltip>
        <el-popover placement="bottom" :width="300" trigger="click">
          <template #reference>
            <el-button size="small">边距{{ marginsSummary }}</el-button>
          </template>
          <div class="margin-panel">
            <div class="margin-panel__grid">
              <template v-for="side in MARGIN_SIDES" :key="side.key">
                <span class="margin-panel__label">{{ side.label }}</span>
                <el-input-number
                  v-model="margins[side.key]"
                  size="small"
                  :min="VOUCHER_MARGIN_MIN_MM"
                  :max="VOUCHER_MARGIN_MAX_MM"
                  :step="0.5"
                  :precision="1"
                  controls-position="right"
                  style="width: 96px"
                  @change="handleMarginsChange"
                />
                <span class="margin-panel__unit">mm</span>
              </template>
            </div>
            <div class="margin-panel__tip">
              边距是纸边到凭证内容的距离，默认取模板自身边距。改哪边内容就贴到哪边；四边围出的区域装不下时等比缩小，不变形。设置记在本电脑上。
            </div>
            <div class="margin-panel__actions">
              <el-button size="small" link type="primary" @click="resetMargins">恢复模板默认</el-button>
            </div>
          </div>
        </el-popover>
      </template>
      <el-checkbox
        v-if="allowMergeA4"
        v-model="mergeMode"
        size="small"
        @change="renderPreview"
      >
        合打（A4 一页 2 张）
      </el-checkbox>
      <div class="spacer" />
      <el-button size="small" :loading="rendering" @click="renderPreview">刷新预览</el-button>
      <el-button size="small" :loading="exportingPdf" @click="handleExportPdf">
        导出 PDF
      </el-button>
      <el-button size="small" :loading="printing" @click="handlePrint">
        浏览器打印
      </el-button>
    </div>

    <div v-loading="rendering" class="hiprint-preview-wrap">
      <div ref="previewRef" class="hiprint-preview" />
      <el-empty v-if="!rendering && previewEmpty" description="无可打印内容" />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { QuestionFilled } from '@element-plus/icons-vue'
import { getApplicableTemplates, getPrintTemplate } from '@/api/printTemplate'
import {
  loadHiprint,
  buildSingleHtmlPanel,
  buildHtmlPrintData,
  renderHiprintPdfBlob,
  wrapRawPrintPaper,
  printRawHtml,
  renderElementToPdfBlob,
  renderElementsToPdfBlob,
  canMergeA4,
  groupPapersIntoA4Sheets,
  printMergedSheets,
  ensureMergeSheetStyle,
  paperDimensionsMm,
  normalizePanelForRender,
  hiprintBrowserPrintOptions,
  fitVoucherTableCells,
  printVoucherPapers,
  panelSizeMm,
  loadVoucherPaperMode,
  saveVoucherPaperMode,
  loadVoucherMargins,
  saveVoucherMargins,
  normalizeVoucherMargins,
  applyVoucherMargins,
  panelContentBoxMm,
  templateVoucherMargins,
  VOUCHER_MARGIN_MIN_MM,
  VOUCHER_MARGIN_MAX_MM,
  type VoucherPrintMargins,
  type VoucherPaperMode,
  PRINT_FONT_SIZE_MAP,
  type PrintFontSizeKey,
} from '@/utils/printTemplateHiprint'
import type { ApplicableTemplate, PrintTemplateType, PrintTemplate } from '@/types/print'

export type GetPrintHtmlFn = (ctx?: { fontSize?: number }) => string

interface Props {
  modelValue: boolean
  templateType: PrintTemplateType
  templateKey?: string
  title?: string
  /** 打开后直接调起系统打印并关闭 */
  autoPrint?: boolean
  /** html 模式（账册/报表）：返回要打印的二维表格 HTML */
  getPrintHtml?: GetPrintHtmlFn
  /** 字段模式（凭证）：打印数据对象或数组 */
  printData?: Record<string, unknown> | Record<string, unknown>[]
  /** 字段模式无自定义模板时的内置默认面板构造（如凭证默认模板） */
  defaultPanelBuilder?: () => { panels: unknown[] }
  /** 纸张默认（无模板时），如 'A4' */
  defaultPaper?: string
  /** 四向页边距（mm）；不传则用内置默认 */
  margins?: { top: number; bottom: number; left: number; right: number }
  /** 是否允许使用业务打印模板；关闭后固定使用无底图的内置 HTML 排版 */
  useTemplates?: boolean
  /** 无模板时的默认纸张方向 */
  defaultOrientation?: 'portrait' | 'landscape'
  /**
   * 标准报表：预览/打印/PDF 直接使用 getPrintHtml，不经 hiprint 拆表。
   * hiprint 的 html 元素会重排表格，网格会变成孤立方框。
   */
  rawHtmlPreview?: boolean
  /** 显示字号选择（小/中/大），默认中=12px */
  showFontSize?: boolean
  /** 显示「合打」开关（凭证连打：一张 A4 上下各打一张） */
  allowMergeA4?: boolean
  /** 合打开关初始值 */
  mergeA4?: boolean
  /**
   * 字段模式下按面板加工打印数据（如凭证按模板固定行数切页）；
   * 不传则直接用 printData
   */
  preparePrintData?: (panel: unknown) => unknown
  /**
   * 凭证打印：显示「纸张」模式（适应打印机纸张 / 凭证纸 1:1）、分录单元格防撑高，
   * 打印改走自建 iframe（预览 DOM 即打印内容）
   */
  voucherPrint?: boolean
  /** 打开时预选的模板（如进销存单据打印页已选中的自定义模板）；不在可选列表里时按默认模板 */
  initialTemplateId?: string
  /** 字段模式的内置面板（下拉里显示为「内置：xxx」，id 自定，如 __builtin:foreign） */
  builtinPanels?: Array<{ id: string; name: string; build: () => { panels: unknown[] } }>
  /**
   * 自定义默认选择：返回模板 id 或内置面板 id；返回 undefined 走原规则（默认模板 / 第一个）。
   * 函数变化时（如凭证数据加载完才知道是否含外币）在用户未手动改选的前提下重新选择。
   */
  pickTemplate?: (templates: ApplicableTemplate[]) => string | undefined
}

const props = withDefaults(defineProps<Props>(), {
  title: '打印',
  defaultPaper: 'A4',
  useTemplates: true,
  defaultOrientation: 'portrait',
  rawHtmlPreview: false,
  showFontSize: false,
  autoPrint: false,
  allowMergeA4: false,
  mergeA4: false,
  voucherPrint: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const dialogTitle = computed(() => props.title || '打印')

const templates = ref<ApplicableTemplate[]>([])
const selectedTemplateId = ref<string>('')
/** 用户在下拉里手动改选过：之后不再自动改选 */
let userPickedTemplate = false
function onTemplateChange() {
  userPickedTemplate = true
  renderPreview()
}
function defaultTemplateSelection(list: ApplicableTemplate[]): string {
  const preset = props.initialTemplateId ? list.find(t => t.id === props.initialTemplateId) : undefined
  if (preset) return preset.id
  const picked = props.pickTemplate?.(list)
  if (picked !== undefined) return picked
  const def = list.find(t => t.is_default) || list[0]
  return def ? def.id : props.builtinPanels?.[0]?.id || ''
}
const loadingTemplates = ref(false)
const rendering = ref(false)
const printing = ref(false)
const exportingPdf = ref(false)
const previewEmpty = ref(false)
const previewRef = ref<HTMLElement | null>(null)
const fontSizeKey = ref<PrintFontSizeKey>('medium')
const mergeMode = ref(props.mergeA4)
const paperMode = ref<VoucherPaperMode>(loadVoucherPaperMode())
/** 最近一次预览用的面板（取纸张尺寸） */
const currentPanel = shallowRef<unknown>(null)

const actualPaperLabel = computed(() => {
  const size = panelSizeMm(currentPanel.value)
  return size ? `凭证纸 1:1（${size.width}×${size.height}）` : '凭证纸 1:1'
})

function handlePaperModeChange(mode: VoucherPaperMode) {
  saveVoucherPaperMode(mode)
}

const MARGIN_SIDES: Array<{ key: keyof VoucherPrintMargins; label: string }> = [
  { key: 'top', label: '上' },
  { key: 'bottom', label: '下' },
  { key: 'left', label: '左' },
  { key: 'right', label: '右' },
]
/** 本电脑保存的边距；null = 用模板自身边距 */
const savedMargins = ref<VoucherPrintMargins | null>(loadVoucherMargins())
/** 弹窗里编辑的四向边距（mm）：没调过时显示模板自身边距 */
const margins = ref<VoucherPrintMargins>({ top: 0, bottom: 0, left: 0, right: 0 })
const marginsSummary = computed(() => {
  const m = savedMargins.value
  return m ? `（上${m.top} 下${m.bottom} 左${m.left} 右${m.right}）` : ''
})

/** 把边距套到预览纸面上（打印直接用预览 DOM，所以打印也带上） */
function applyMarginsToPreview() {
  if (!props.voucherPrint || !previewRef.value) return
  const paper = panelSizeMm(currentPanel.value)
  const box = panelContentBoxMm(currentPanel.value)
  if (!paper || !box) return
  margins.value = savedMargins.value ? { ...savedMargins.value } : templateVoucherMargins(box, paper)
  applyVoucherMargins(previewRef.value, margins.value, box, paper)
}

function handleMarginsChange() {
  savedMargins.value = normalizeVoucherMargins(margins.value)
  saveVoucherMargins(savedMargins.value)
  applyMarginsToPreview()
}

function resetMargins() {
  savedMargins.value = null
  saveVoucherMargins(null)
  applyMarginsToPreview()
}

/** 本次渲染是否真正按合打输出（模板高于半张 A4 时回退逐张） */
let mergeWarned = false
function shouldMerge(panel: unknown): boolean {
  if (!props.allowMergeA4 || !mergeMode.value) return false
  if (canMergeA4(panel)) return true
  if (!mergeWarned) {
    mergeWarned = true
    ElMessage.warning('当前打印模板高度超过半张 A4，无法合打，已按逐张打印')
  }
  return false
}

/** hiprint getHtml 的结果转成 DOM 节点 */
function htmlToNode($html: any): Node | string {
  const node = $html && ($html[0] || (typeof $html.get === 'function' && $html.get(0)))
  return node || String($html)
}

function resolvePrintHtml(): string {
  if (!props.getPrintHtml) return ''
  const fontSize = props.showFontSize ? PRINT_FONT_SIZE_MAP[fontSizeKey.value] : undefined
  return props.getPrintHtml(fontSize != null ? { fontSize } : undefined)
}

// 当前 hiprint 模板实例
let currentTp: any = null

const loadTemplates = async () => {
  if (!props.useTemplates) {
    templates.value = []
    selectedTemplateId.value = ''
    return
  }
  loadingTemplates.value = true
  try {
    const res = await getApplicableTemplates({
      template_type: props.templateType,
      ...(props.templateKey ? { template_key: props.templateKey } : {}),
    })
    if (res.code === 0) {
      templates.value = res.data
      selectedTemplateId.value = defaultTemplateSelection(res.data)
    }
  } catch (e: any) {
    // 模板加载失败不阻断：走内置默认排版
    templates.value = []
    selectedTemplateId.value = defaultTemplateSelection([])
  } finally {
    loadingTemplates.value = false
  }
}

function fieldPrintData(panel: unknown) {
  return props.preparePrintData ? props.preparePrintData(panel) : props.printData
}

/** 取得当前要用的 hiprint 面板（有自定义模板用其 panel，否则用内置单 HTML 面板） */
const resolvePanelAndData = async (): Promise<{ panel: any; data: any } | null> => {
  // html 模式：账册/报表
  const html = resolvePrintHtml()

  const builtin = props.builtinPanels?.find(b => b.id === selectedTemplateId.value)
  if (builtin && props.printData) {
    const panel = normalizePanelForRender(builtin.build())
    return { panel, data: fieldPrintData(panel) }
  }

  let detail: PrintTemplate | null = null
  if (props.useTemplates && selectedTemplateId.value && !builtin) {
    try {
      const res = await getPrintTemplate(selectedTemplateId.value)
      if (res.code === 0) detail = res.data
    } catch {
      detail = null
    }
  }

  // 自定义 hiprint 模板（有 panels 且含面板）→ 字段绑定模式（凭证为主）
  const designedPanels = (detail?.panel as any)?.panels
  // normalizePanelForRender：把非表格元素钉在设计坐标上（否则 hiprint 打印时会让分录表
  // 后面的签章行跟着表格真实高度下移，和设计器对不上），并注入合计行的求和渲染函数
  if (Array.isArray(designedPanels) && designedPanels.length > 0 && props.printData) {
    const panel = normalizePanelForRender(detail!.panel)
    return { panel, data: fieldPrintData(panel) }
  }

  // 字段模式但无自定义模板：用内置默认面板（凭证默认模板）
  if (props.printData && props.defaultPanelBuilder) {
    const panel = normalizePanelForRender(props.defaultPanelBuilder())
    return { panel, data: fieldPrintData(panel) }
  }

  // 否则 html 模式：用模板纸张/底图包一个单 html 面板
  if (!html) return null
  const paper =
    detail?.paper_size && detail.paper_size !== 'custom' ? detail.paper_size : props.defaultPaper
  const panel = buildSingleHtmlPanel({
    html,
    paperType: paper,
    widthMm: detail?.paper_size === 'custom' ? detail?.paper_width : undefined,
    heightMm: detail?.paper_size === 'custom' ? detail?.paper_height : undefined,
    orientation: props.defaultOrientation,
    marginsMm: props.margins,
    background: props.useTemplates ? detail?.background_image || null : null,
  })
  return { panel, data: buildHtmlPrintData(html) }
}

function rawPrintOptions() {
  return {
    paperType: props.defaultPaper,
    orientation: props.defaultOrientation,
    marginsMm: props.margins,
    title: props.title,
  }
}

const renderPreview = async () => {
  rendering.value = true
  previewEmpty.value = false
  try {
    if (props.rawHtmlPreview && props.getPrintHtml) {
      const html = resolvePrintHtml()
      if (!html) {
        previewEmpty.value = true
        if (previewRef.value) previewRef.value.innerHTML = ''
        return
      }
      if (previewRef.value) previewRef.value.innerHTML = wrapRawPrintPaper(html, rawPrintOptions())
      currentTp = null
      return
    }

    const mod = await loadHiprint()
    const resolved = await resolvePanelAndData()
    if (!resolved) {
      previewEmpty.value = true
      if (previewRef.value) previewRef.value.innerHTML = ''
      return
    }
    currentTp = new mod.hiprint.PrintTemplate({ template: resolved.panel })
    currentPanel.value = resolved.panel
    if (previewRef.value) {
      previewRef.value.innerHTML = ''
      const node = htmlToNode(currentTp.getHtml(resolved.data))
      if (typeof node === 'string') previewRef.value.innerHTML = node
      else previewRef.value.appendChild(node)
      // 长摘要缩字 / 两行显示，不让行高被撑开（打印直接用这份 DOM）
      if (props.voucherPrint) {
        fitVoucherTableCells(previewRef.value)
        applyMarginsToPreview()
      }
      if (shouldMerge(resolved.panel)) {
        ensureMergeSheetStyle()
        groupPapersIntoA4Sheets(previewRef.value)
      }
    }
  } catch (e: any) {
    ElMessage.error('预览失败：' + (e?.message || e))
    previewEmpty.value = true
  } finally {
    rendering.value = false
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const handlePrint = async () => {
  printing.value = true
  try {
    if (props.rawHtmlPreview && props.getPrintHtml) {
      const html = resolvePrintHtml()
      if (!html) {
        ElMessage.warning('无可打印内容')
        return
      }
      printRawHtml(html, rawPrintOptions())
      return
    }
    if (props.voucherPrint) {
      await printVoucherFromPreview()
      return
    }
    const mod = await loadHiprint()
    const resolved = await resolvePanelAndData()
    if (!resolved) {
      ElMessage.warning('无可打印内容')
      return
    }
    const tp = new mod.hiprint.PrintTemplate({ template: resolved.panel })
    if (shouldMerge(resolved.panel)) {
      // 合打：渲染出逐张纸面后每 2 张拼进一张 A4，自建 iframe 打印
      const box = document.createElement('div')
      const node = htmlToNode(tp.getHtml(resolved.data))
      if (typeof node === 'string') box.innerHTML = node
      else box.appendChild(node)
      groupPapersIntoA4Sheets(box)
      printMergedSheets(box.innerHTML, props.title)
      return
    }
    // 第三参：把 print-lock.css 与项目覆盖样式带进打印 iframe（否则表格无网格线、纸张失效）
    tp.print(resolved.data, {}, hiprintBrowserPrintOptions())
  } catch (e: any) {
    ElMessage.error('打印失败：' + (e?.message || e))
  } finally {
    printing.value = false
  }
}

/**
 * 凭证打印：直接打印预览里的纸面（已按行数切页、已防撑高），所见即所得；
 * @page 由我们按纸张模式写，不再用 hiprint 写死的 `size: 宽mm 高mm`（会让打印面板丢失横向选项）。
 */
async function printVoucherFromPreview() {
  if (!previewRef.value?.querySelector('.hiprint-printPaper')) await renderPreview()
  const box = previewRef.value
  if (!box || !box.querySelector('.hiprint-printPaper')) {
    ElMessage.warning('无可打印内容')
    return
  }
  if (box.querySelector('.cw-merge-sheet')) {
    printMergedSheets(box.innerHTML, props.title)
    return
  }
  const size = panelSizeMm(currentPanel.value) || paperDimensionsMm(props.defaultPaper, props.defaultOrientation)
  printVoucherPapers(box, {
    mode: paperMode.value,
    widthMm: size.width,
    heightMm: size.height,
    title: props.title,
  })
}

const handleExportPdf = async () => {
  if (exportingPdf.value) return
  exportingPdf.value = true
  try {
    if (props.rawHtmlPreview && props.getPrintHtml) {
      const paper = previewRef.value?.querySelector('.cw-raw-paper') as HTMLElement | null
      if (!paper) {
        ElMessage.warning('请先刷新预览')
        return
      }
      const dim = paperDimensionsMm(props.defaultPaper, props.defaultOrientation)
      const blob = await renderElementToPdfBlob(paper, dim)
      downloadBlob(blob, `${props.title || '打印'}.pdf`)
      ElMessage.success('PDF 已导出')
      return
    }
    const mod = await loadHiprint()
    const resolved = await resolvePanelAndData()
    if (!resolved) {
      ElMessage.warning('无可打印内容')
      return
    }
    if (shouldMerge(resolved.panel)) {
      const sheets = Array.from(
        previewRef.value?.querySelectorAll<HTMLElement>('.cw-merge-sheet') || []
      )
      if (sheets.length === 0) {
        ElMessage.warning('请先刷新预览')
        return
      }
      const blob = await renderElementsToPdfBlob(sheets, { width: 210, height: 297 })
      downloadBlob(blob, `${props.title || '打印'}.pdf`)
      ElMessage.success('PDF 已导出')
      return
    }
    const tp = new mod.hiprint.PrintTemplate({ template: resolved.panel })
    const fileName = `${props.title || '打印'}.pdf`
    const blob = await renderHiprintPdfBlob(tp, resolved.data, fileName)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success('PDF 已导出')
  } catch (e: any) {
    ElMessage.error('导出 PDF 失败：' + (e?.message || e))
  } finally {
    exportingPdf.value = false
  }
}

function hasPrintData(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0
  return !!data && typeof data === 'object' && Object.keys(data as object).length > 0
}

let autoPrinted = false

async function maybeAutoPrint() {
  if (!props.autoPrint || autoPrinted) return
  if (props.printData && !hasPrintData(props.printData)) return
  if (previewEmpty.value) return
  autoPrinted = true
  await handlePrint()
  visible.value = false
}

watch(
  () => props.pickTemplate,
  async () => {
    if (!visible.value || userPickedTemplate || loadingTemplates.value) return
    const next = defaultTemplateSelection(templates.value)
    if (next === selectedTemplateId.value) return
    selectedTemplateId.value = next
    await renderPreview()
  }
)

const handleOpened = async () => {
  userPickedTemplate = false
  await loadTemplates()
  await renderPreview()
  await maybeAutoPrint()
}

watch(
  () => props.modelValue,
  v => {
    if (v) {
      mergeMode.value = props.mergeA4
      mergeWarned = false
    } else {
      autoPrinted = false
      if (previewRef.value) previewRef.value.innerHTML = ''
    }
  }
)

watch(
  () => props.printData,
  async () => {
    if (!visible.value) return
    await renderPreview()
    await maybeAutoPrint()
  }
)
</script>

<style scoped>
/* 窄屏兜底：对话框宽度固定 1320px 以完整容纳横向 A4 纸张（≈1123px）
   外加对话框内边距与阴影余量，避免出现横向滚动条；
   视口更窄时限制不超过 96vw，防止对话框溢出屏幕。 */
.hiprint-dialog {
  max-width: 96vw;
}
.hiprint-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 12px;
}
.hiprint-toolbar .label {
  font-size: 13px;
  color: #606266;
}
.hiprint-toolbar .paper-mode-help {
  color: #909399;
  cursor: help;
}
.margin-panel__grid {
  display: grid;
  grid-template-columns: 24px 96px 24px;
  row-gap: 8px;
  column-gap: 6px;
  align-items: center;
  justify-content: center;
}
.margin-panel__label,
.margin-panel__unit {
  font-size: 13px;
  color: #606266;
}
.margin-panel__tip {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}
.margin-panel__actions {
  margin-top: 6px;
  text-align: right;
}
.paper-mode-tip {
  max-width: 320px;
  line-height: 1.6;
}
.hiprint-toolbar .spacer {
  flex: 1;
}
.hiprint-preview-wrap {
  /* 用 block + text-align:center 代替 flex 居中：横向 A4≈1123px 较宽，
     flex 的 justify-content:center 在纸张宽于容器时会把左侧推出可视区且无法滚到，
     改为 inline-block 居中可避免。对话框已加宽到容纳整张纸，故强制隐藏横向滚动条，
     仅在内容超高时纵向滚动。 */
  min-height: 70vh;
  max-height: 80vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f5f7fa;
  padding: 16px 8px;
  text-align: center;
}
.hiprint-preview {
  display: inline-block;
  text-align: left;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}
.hiprint-preview :deep(.cw-raw-paper) {
  margin: 0 auto;
}
/* 合打预览：A4 纸之间留灰色间隔 */
.hiprint-preview :deep(.cw-merge-root) {
  background: #f5f7fa;
}
.hiprint-preview :deep(.cw-merge-sheet + .cw-merge-sheet) {
  margin-top: 12px;
}
</style>
