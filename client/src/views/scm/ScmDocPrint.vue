<template>
  <div class="print-wrap">
    <!-- 操作条（打印时隐藏） -->
    <div class="toolbar no-print">
      <el-button @click="goBack"><el-icon><Back /></el-icon>返回</el-button>
      <span class="t-title">单据打印预览</span>
      <!-- 第五份反馈：打印模板切换；第六份反馈：可选自定义业务单据模板。「设为默认」按单据类型记住（账套内共用） -->
      <span class="t-label">模板</span>
      <el-select v-model="choice" size="default" style="width:220px" @change="renderCustom">
        <el-option-group label="内置版式">
          <el-option v-for="o in SCM_PRINT_LAYOUTS" :key="o.value" :value="o.value" :label="o.label">
            <span>{{ o.label }}</span><span class="opt-desc">{{ o.desc }}</span>
          </el-option>
        </el-option-group>
        <el-option-group v-if="customTemplates.length" label="自定义模板">
          <el-option v-for="t in customTemplates" :key="t.id" :value="`tpl:${t.id}`" :label="t.name">
            <span>{{ t.name }}</span><span class="opt-desc">{{ t.template_key === scmTemplateKey('*') ? '通用' : '本类单据' }}</span>
          </el-option>
        </el-option-group>
      </el-select>
      <el-tag v-if="doc && choice === defaultChoice" size="small" type="success" effect="plain">默认</el-tag>
      <el-button v-else-if="doc" link type="primary" :loading="savingDefault" @click="setDefault">设为默认</el-button>
      <el-button v-if="canDesign" link type="primary" @click="designTemplate">{{ isCustom ? '修改模板' : '设计模板' }}</el-button>
      <el-button type="primary" :disabled="loading || rendering" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-loading="loading || rendering" class="paper" :class="{ 'paper--custom': isCustom }">
      <ScmDocPaper v-if="doc && !isCustom" :doc="doc" :layout="builtinLayout" :field-defs="docFieldDefs" />
      <div v-else ref="customRef" class="custom-preview" />
    </div>

    <HiprintDialog
      v-if="doc"
      v-model="dialogVisible"
      template-type="scm_doc"
      :title="`打印 ${docTitle} ${doc.doc_no || ''}`"
      :print-data="printData"
      :default-panel-builder="defaultPanel"
      :initial-template-id="customId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'
import ScmDocPaper from '@/components/scm/ScmDocPaper.vue'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { getApplicableTemplates, getPrintTemplate } from '@/api/printTemplate'
import { loadHiprint, normalizePanelForRender } from '@/utils/printTemplateHiprint'
import { buildDefaultScmPanel, scmDocToHiprintData, scmTemplateKey, SCM_TEMPLATE_TYPE } from '@/utils/hiprintScmProvider'
import { DOC_TITLE } from '@/utils/scmDoc'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { useUserStore } from '@/stores/user'
import { hasPermission } from '@/utils/permission'
import {
  SCM_PRINT_LAYOUTS, isScmPrintLayout, isTemplateChoice, loadScmPrintChoices, saveScmPrintLayout,
  type ScmPrintChoice, type ScmPrintLayout,
} from '@/utils/scmPrintLayout'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const decStore = useScmDecimalsStore()

const loading = ref(false)
const rendering = ref(false)
const doc = ref<any>(null)
const partner = ref<any>(null)
const warehouses = ref<any[]>([])
// 表头/表尾自定义字段（定义取自配置，值取自 doc.field_values）
const docFieldDefs = ref<any[]>([])
const initialQuery = route.query.layout
const choice = ref<ScmPrintChoice>(isScmPrintLayout(initialQuery) ? initialQuery : 'standard')
const defaultChoice = ref<ScmPrintChoice>('standard')
const savingDefault = ref(false)
const customTemplates = ref<Array<{ id: string; name: string; template_key?: string | null }>>([])
const customRef = ref<HTMLElement | null>(null)
const dialogVisible = ref(false)

const isCustom = computed(() => isTemplateChoice(choice.value))
const customId = computed(() => (isCustom.value ? String(choice.value).slice(4) : ''))
const builtinLayout = computed<ScmPrintLayout>(() => (isScmPrintLayout(choice.value) ? choice.value : 'standard'))
const docTitle = computed(() => DOC_TITLE[doc.value?.doc_type] || '单据')
const canDesign = computed(() => hasPermission('system:print'))

const printData = computed(() => (doc.value ? scmDocToHiprintData(doc.value, {
  company: user.accountSetName || '',
  title: `${docTitle.value}`,
  partner: partner.value,
  warehouseName: code => warehouses.value.find(w => w.code === code)?.name || code,
  fmt: {
    qty: v => decStore.qty(Number(v) || 0, doc.value?.doc_type),
    price: v => decStore.price(Number(v) || 0, doc.value?.doc_type),
    amount: v => decStore.amount(Number(v) || 0, doc.value?.doc_type),
  },
}) : {}))
const defaultPanel = () => buildDefaultScmPanel() as any

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getDoc(route.params.id as string)
    if (r.code !== 0) { ElMessage.error(r.message || '加载失败'); return }
    doc.value = r.data
    const docType = (r.data as any).doc_type
    const [, choices, tpls, ps, ws] = await Promise.all([
      scmApi.getDocFieldDefs(docType).then(fr => { if (fr.code === 0) docFieldDefs.value = fr.data }).catch(() => { /* 无自定义字段 */ }),
      loadScmPrintChoices(),
      getApplicableTemplates({ template_type: SCM_TEMPLATE_TYPE as any }).catch(() => ({ code: -1, data: [] as any[] })),
      (r.data as any).partner_code ? scmApi.getPartners({ keyword: (r.data as any).partner_code }).catch(() => ({ code: -1, data: [] as any[] })) : Promise.resolve({ code: -1, data: [] as any[] }),
      scmApi.getWarehouses().catch(() => ({ code: -1, data: [] as any[] })),
      decStore.load(),
    ])
    customTemplates.value = ((tpls as any).data || []).filter((t: any) => [scmTemplateKey(docType), scmTemplateKey('*')].includes(t.template_key || ''))
    partner.value = ((ps as any).data || []).find((p: any) => p.code === (r.data as any).partner_code) || null
    warehouses.value = (ws as any).data || []
    let def: ScmPrintChoice = choices[docType] || 'standard'
    if (isTemplateChoice(def) && !customTemplates.value.some(t => `tpl:${t.id}` === def)) def = 'standard'   // 模板已删除
    defaultChoice.value = def
    if (!isScmPrintLayout(initialQuery)) choice.value = def
    if (isCustom.value) await renderCustom()
  } finally { loading.value = false }
}

/** 自定义模板：用 hiprint 渲染到预览区（打印走打印对话框，纸张与边距更准） */
async function renderCustom() {
  if (!isCustom.value || !doc.value) return
  rendering.value = true
  try {
    const res = await getPrintTemplate(customId.value)
    const mod = await loadHiprint()
    await nextTick()
    const tp = new mod.hiprint.PrintTemplate({ template: normalizePanelForRender((res as any).data.panel) })
    const $html = tp.getHtml(printData.value) as any
    const node = $html && ($html[0] || (typeof $html.get === 'function' && $html.get(0)))
    if (customRef.value) {
      customRef.value.innerHTML = ''
      if (node) customRef.value.appendChild(node)
    }
  } catch (e: any) {
    ElMessage.error(`模板渲染失败：${e?.message || e}`)
  } finally { rendering.value = false }
}

async function setDefault() {
  if (!doc.value) return
  savingDefault.value = true
  try {
    await saveScmPrintLayout(doc.value.doc_type, choice.value)
    defaultChoice.value = choice.value
    ElMessage.success('已设为该类单据的默认打印模板')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '设置失败')
  } finally { savingDefault.value = false }
}

function designTemplate() {
  if (isCustom.value) router.push(`/base/print-template/design/${customId.value}`)
  else router.push({ path: '/base/print-template/design', query: { preset: 'scm', key: scmTemplateKey(doc.value?.doc_type || '*') } })
}

function doPrint() {
  if (isCustom.value) dialogVisible.value = true
  else window.print()
}
function goBack() { router.back() }
onMounted(load)
</script>

<style scoped>
.print-wrap { background: var(--el-bg-color-page, #f5f5f5); min-height: 100%; }
.toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; position: sticky; top: 0; z-index: 2; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light); }
.t-title { font-weight: 600; }
.t-label { margin-left: 16px; color: var(--el-text-color-secondary); }
.opt-desc { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.toolbar > .el-button:last-of-type { margin-left: auto; }

.paper {
  width: 210mm; min-height: 140mm; margin: 16px auto; padding: 14mm 12mm;
  background: #fff; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.12);
}
.paper--custom { width: fit-content; min-width: 210mm; padding: 0; }
.custom-preview { overflow: auto; }

@media print {
  .no-print { display: none !important; }
  .print-wrap { background: #fff; }
  .paper { width: auto; margin: 0; padding: 0; box-shadow: none; min-height: auto; }
  @page { size: A4; margin: 12mm; }
}
</style>
