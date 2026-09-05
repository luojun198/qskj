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
          @change="renderPreview"
        >
          <el-option
            v-for="t in templates"
            :key="t.id"
            :label="t.name + (t.is_default ? '（默认）' : '')"
            :value="t.id"
          />
          <el-option v-if="templates.length === 0" label="内置默认排版" value="" />
        </el-select>
      </template>
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
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getApplicableTemplates, getPrintTemplate } from '@/api/printTemplate'
import {
  loadHiprint,
  buildSingleHtmlPanel,
  buildHtmlPrintData,
  renderHiprintPdfBlob,
  wrapRawPrintPaper,
  printRawHtml,
  renderElementToPdfBlob,
  paperDimensionsMm,
} from '@/utils/printTemplateHiprint'
import type { ApplicableTemplate, PrintTemplateType, PrintTemplate } from '@/types/print'

interface Props {
  modelValue: boolean
  templateType: PrintTemplateType
  templateKey: string
  title?: string
  /** html 模式（账册/报表）：返回要打印的二维表格 HTML */
  getPrintHtml?: () => string
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
}

const props = withDefaults(defineProps<Props>(), {
  title: '打印',
  defaultPaper: 'A4',
  useTemplates: true,
  defaultOrientation: 'portrait',
  rawHtmlPreview: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const dialogTitle = computed(() => props.title || '打印')

const templates = ref<ApplicableTemplate[]>([])
const selectedTemplateId = ref<string>('')
const loadingTemplates = ref(false)
const rendering = ref(false)
const printing = ref(false)
const exportingPdf = ref(false)
const previewEmpty = ref(false)
const previewRef = ref<HTMLElement | null>(null)

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
      template_key: props.templateKey,
    })
    if (res.code === 0) {
      templates.value = res.data
      const def = res.data.find(t => t.is_default) || res.data[0]
      selectedTemplateId.value = def ? def.id : ''
    }
  } catch (e: any) {
    // 模板加载失败不阻断：走内置默认排版
    templates.value = []
    selectedTemplateId.value = ''
  } finally {
    loadingTemplates.value = false
  }
}

/** 取得当前要用的 hiprint 面板（有自定义模板用其 panel，否则用内置单 HTML 面板） */
const resolvePanelAndData = async (): Promise<{ panel: any; data: any } | null> => {
  // html 模式：账册/报表
  const html = props.getPrintHtml ? props.getPrintHtml() : ''

  let detail: PrintTemplate | null = null
  if (props.useTemplates && selectedTemplateId.value) {
    try {
      const res = await getPrintTemplate(selectedTemplateId.value)
      if (res.code === 0) detail = res.data
    } catch {
      detail = null
    }
  }

  // 自定义 hiprint 模板（有 panels 且含面板）→ 字段绑定模式（凭证为主）
  const designedPanels = (detail?.panel as any)?.panels
  if (Array.isArray(designedPanels) && designedPanels.length > 0 && props.printData) {
    return { panel: detail!.panel, data: props.printData }
  }

  // 字段模式但无自定义模板：用内置默认面板（凭证默认模板）
  if (props.printData && props.defaultPanelBuilder) {
    return { panel: props.defaultPanelBuilder(), data: props.printData }
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
      const html = props.getPrintHtml()
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
    if (previewRef.value) {
      previewRef.value.innerHTML = ''
      const $html = currentTp.getHtml(resolved.data) as any
      const node = $html && ($html[0] || (typeof $html.get === 'function' && $html.get(0)))
      if (node) previewRef.value.appendChild(node)
      else previewRef.value.innerHTML = String($html)
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
      const html = props.getPrintHtml()
      if (!html) {
        ElMessage.warning('无可打印内容')
        return
      }
      printRawHtml(html, rawPrintOptions())
      return
    }
    const mod = await loadHiprint()
    const resolved = await resolvePanelAndData()
    if (!resolved) {
      ElMessage.warning('无可打印内容')
      return
    }
    const tp = new mod.hiprint.PrintTemplate({ template: resolved.panel })
    tp.print(resolved.data)
  } catch (e: any) {
    ElMessage.error('打印失败：' + (e?.message || e))
  } finally {
    printing.value = false
  }
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

const handleOpened = async () => {
  await loadTemplates()
  await renderPreview()
}

watch(
  () => props.modelValue,
  v => {
    if (!v && previewRef.value) previewRef.value.innerHTML = ''
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
</style>
