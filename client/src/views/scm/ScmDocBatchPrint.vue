<template>
  <div class="batch-print-wrap">
    <div class="toolbar no-print">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <span class="title">批量单据打印（{{ docs.length }} 张）</span>
      <!-- 第五份反馈：打印模板切换；默认按各类单据设置的默认模板 -->
      <span class="t-label">模板</span>
      <el-select v-model="layoutOverride" style="width:170px">
        <el-option value="" label="按各单据默认模板" />
        <el-option v-for="o in SCM_PRINT_LAYOUTS" :key="o.value" :value="o.value" :label="o.label" />
      </el-select>
      <el-button type="primary" :disabled="loading || !docs.length" @click="doPrint"><el-icon><Printer /></el-icon>打印全部</el-button>
    </div>
    <div v-loading="loading">
      <section v-for="doc in docs" :key="doc.id" class="paper">
        <ScmDocPaper :doc="doc" :layout="layoutOf(doc)" :field-defs="fieldDefsByType[doc.doc_type] || []" />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back, Printer } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import ScmDocPaper from '@/components/scm/ScmDocPaper.vue'
import { SCM_PRINT_LAYOUTS, loadScmPrintLayouts, type ScmPrintLayout } from '@/utils/scmPrintLayout'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const docs = ref<any[]>([])
const ids = String(route.query.ids || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 30)
const defaults = ref<Record<string, ScmPrintLayout>>({})
const layoutOverride = ref<ScmPrintLayout | ''>('')
const fieldDefsByType = ref<Record<string, any[]>>({})
const layoutOf = (doc: any): ScmPrintLayout => layoutOverride.value || defaults.value[doc.doc_type] || 'standard'
const doPrint = () => window.print()

onMounted(async () => {
  loading.value = true
  try {
    const [results, layouts] = await Promise.all([Promise.all(ids.map(id => scmApi.getDoc(id))), loadScmPrintLayouts()])
    docs.value = results.filter(result => result.code === 0).map(result => result.data)
    defaults.value = layouts
    const types = [...new Set(docs.value.map(d => d.doc_type))]
    await Promise.all(types.map(t => scmApi.getDocFieldDefs(t)
      .then(fr => { if (fr.code === 0) fieldDefsByType.value[t] = fr.data })
      .catch(() => { /* 无自定义字段 */ })))
  } finally { loading.value = false }
})
</script>

<style scoped>
.batch-print-wrap { min-height: 100%; background: var(--el-bg-color-page); }
.toolbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color); }
.toolbar .title { font-weight: 600; }
.t-label { margin-left: 16px; color: var(--el-text-color-secondary); }
.toolbar .el-button:last-child { margin-left: auto; }
.paper { box-sizing: border-box; width: 210mm; min-height: 140mm; margin: 16px auto; padding: 14mm 12mm; background: #fff; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.12); page-break-after: always; }
@media print { .no-print { display: none !important; } .batch-print-wrap { background: #fff; } .paper { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; } @page { size: A4; margin: 12mm; } }
</style>
