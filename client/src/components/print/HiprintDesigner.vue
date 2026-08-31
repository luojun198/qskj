<template>
  <div class="hiprint-designer">
    <!-- 工具栏 -->
    <div class="designer-toolbar">
      <el-form :inline="true" size="small" class="toolbar-form">
        <el-form-item label="模板名称">
          <el-input v-model="form.name" placeholder="模板名称" style="width: 160px" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.template_type" style="width: 110px" @change="onTypeChange">
            <el-option label="凭证" value="voucher" />
            <el-option label="账册" value="ledger" />
            <el-option label="报表" value="report" />
          </el-select>
        </el-form-item>
        <el-form-item label="业务键">
          <el-select v-model="form.template_key" style="width: 170px" placeholder="业务子类型" allow-create filterable>
            <el-option v-for="opt in keyOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="纸张">
          <el-select v-model="form.paper_size" style="width: 90px" @change="applyPaper">
            <el-option label="A4" value="A4" />
            <el-option label="A5" value="A5" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.paper_size === 'custom'" label="宽×高(mm)">
          <el-input-number v-model="form.paper_width" :min="50" :max="600" size="small" controls-position="right" style="width: 90px" />
          <span style="margin: 0 4px">×</span>
          <el-input-number v-model="form.paper_height" :min="50" :max="600" size="small" controls-position="right" style="width: 90px" @change="applyPaper" />
        </el-form-item>
      </el-form>
      <div class="toolbar-actions">
        <el-upload
          action="#"
          :show-file-list="false"
          :http-request="handleBackgroundUpload"
          accept="image/*"
        >
          <el-button size="small" icon="Picture">套打底图</el-button>
        </el-upload>
        <el-button v-if="form.background_image" size="small" @click="clearBackground">清除底图</el-button>
        <el-button size="small" @click="$emit('cancel')">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </div>

    <!-- 三栏：元素面板 / 设计画布 / 属性面板 -->
    <div class="designer-body" v-loading="initializing">
      <div ref="toolsRef" class="designer-tools hiprint-tools" />
      <div ref="designRef" class="designer-canvas" />
      <div ref="settingsRef" class="designer-settings" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { loadHiprint } from '@/utils/printTemplateHiprint'
import { buildDefaultVoucherPanel } from '@/utils/printTemplateDefaultsHiprint'
import {
  getPrintTemplate,
  createPrintTemplate,
  updatePrintTemplate,
  uploadTemplateBackground,
} from '@/api/printTemplate'
import type { PrintTemplateType, HiprintPanel } from '@/types/print'

interface Props {
  templateId?: string
  /** 新建时的默认类型/业务键 */
  defaultType?: PrintTemplateType
  defaultKey?: string
}
const props = withDefaults(defineProps<Props>(), {
  defaultType: 'voucher',
})
const emit = defineEmits<{ save: [id: string]; cancel: [] }>()

const form = reactive({
  name: '',
  template_type: props.defaultType as PrintTemplateType,
  template_key: props.defaultKey || '',
  paper_size: 'A4',
  paper_width: 210,
  paper_height: 297,
  background_image: '' as string | null,
})

const savedId = ref<string>(props.templateId || '')
const saving = ref(false)
const initializing = ref(true)
const toolsRef = ref<HTMLElement | null>(null)
const designRef = ref<HTMLElement | null>(null)
const settingsRef = ref<HTMLElement | null>(null)

let tp: any = null
let hiprintRef: any = null

// 业务键候选（随类型变化）
const keyOptions = computed(() => {
  if (form.template_type === 'voucher') {
    return [
      { label: '记账凭证（标准）', value: 'voucher:standard' },
      { label: '银行进账单', value: 'voucher:bank_in_slip' },
    ]
  }
  if (form.template_type === 'ledger') {
    return [
      { label: '明细账', value: 'ledger:detail' },
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
}

const onTypeChange = () => {
  if (!form.template_key) form.template_key = keyOptions.value[0]?.value || ''
}

const applyPaper = () => {
  if (!tp) return
  if (form.paper_size === 'custom') {
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

const initDesigner = async (panelJson?: { panels: HiprintPanel[] }) => {
  const mod = await loadHiprint()
  hiprintRef = mod.hiprint
  // 元素面板
  if (toolsRef.value) {
    toolsRef.value.innerHTML = ''
    hiprintRef.PrintElementTypeManager.build(toolsRef.value, 'defaultModule')
  }
  // 模板实例 + 设计画布
  tp = new hiprintRef.PrintTemplate({
    template: panelJson || buildEmptyTemplate(),
    settingContainer: settingsRef.value,
    history: true,
  })
  if (designRef.value) {
    designRef.value.innerHTML = ''
    tp.design(designRef.value)
  }
}

const loadExisting = async () => {
  if (!props.templateId) return null
  const res = await getPrintTemplate(props.templateId)
  if (res.code === 0) {
    const t = res.data
    form.name = t.name
    form.template_type = (t.template_type as PrintTemplateType) || 'voucher'
    form.template_key = t.template_key || ''
    form.paper_size = t.paper_size || 'A4'
    form.paper_width = t.paper_width
    form.paper_height = t.paper_height
    form.background_image = t.background_image || ''
    // 若是 hiprint 模板（有 panel.panels）用之，否则用空模板
    const panel: any = t.panel
    if (panel && Array.isArray(panel.panels) && panel.panels.length > 0) {
      return panel as { panels: HiprintPanel[] }
    }
  }
  return null
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
  // 套打底图需先有模板 id；未保存时先保存
  if (!savedId.value) {
    await handleSave()
    if (!savedId.value) return
  }
  try {
    const res = await uploadTemplateBackground(savedId.value, options.file)
    if (res.code === 0) {
      form.background_image = res.data.background_image
      applyBackgroundToPanel(form.background_image)
      ElMessage.success('底图上传成功，已铺入底层')
    }
  } catch (e: any) {
    ElMessage.error('底图上传失败：' + (e?.message || e))
  }
}

const PX = 3.7795275591
// 把底图作为整页 image 元素铺到底层（panel.background 不打印，故用 image 元素）
const applyBackgroundToPanel = (url: string) => {
  if (!tp) return
  const json = tp.getJson()
  const panel: any = json.panels?.[0]
  if (!panel) return
  const wPx = Math.round((form.paper_width || 210) * PX)
  const hPx = Math.round((form.paper_height || 297) * PX)
  const bgEl = {
    options: { left: 0, top: 0, width: wPx, height: hPx, src: url, fit: 'fill' },
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

onMounted(async () => {
  try {
    await nextTick()
    const existing = await loadExisting()
    // 新建凭证模板：以默认凭证模板做起点（带正确字段绑定，便于拖拽微调/叠底图），不从空白开始
    let seed = existing
    if (!seed && !props.templateId && form.template_type === 'voucher') {
      seed = buildDefaultVoucherPanel() as { panels: HiprintPanel[] }
      form.template_key = form.template_key || 'voucher:standard'
      form.paper_size = 'custom'
      form.paper_width = 210
      form.paper_height = 148
    }
    await initDesigner(seed || undefined)
  } catch (e: any) {
    ElMessage.error('设计器初始化失败：' + (e?.message || e))
  } finally {
    initializing.value = false
  }
})
</script>

<style scoped>
.hiprint-designer {
  display: flex;
  flex-direction: column;
  height: 72vh;
}
.designer-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
  flex-wrap: wrap;
}
.toolbar-form {
  flex: 1;
}
.toolbar-form :deep(.el-form-item) {
  margin-bottom: 6px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.designer-body {
  flex: 1;
  display: flex;
  min-height: 0;
  margin-top: 10px;
  border: 1px solid #ebeef5;
}
.designer-tools {
  width: 200px;
  overflow: auto;
  border-right: 1px solid #ebeef5;
  background: #fafafa;
  padding: 8px;
}
.designer-canvas {
  flex: 1;
  overflow: auto;
  background: #f0f2f5;
  display: flex;
  justify-content: center;
  padding: 16px;
}
.designer-settings {
  width: 260px;
  overflow: auto;
  border-left: 1px solid #ebeef5;
  background: #fafafa;
  padding: 8px;
}
</style>
