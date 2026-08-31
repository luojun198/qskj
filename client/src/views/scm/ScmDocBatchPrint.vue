<template>
  <div class="batch-print-wrap">
    <div class="toolbar no-print">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <span class="title">批量单据打印（{{ docs.length }} 张）</span>
      <el-button type="primary" :disabled="loading || !docs.length" @click="doPrint"><el-icon><Printer /></el-icon>打印全部</el-button>
    </div>
    <div v-loading="loading">
      <section v-for="doc in docs" :key="doc.id" class="paper">
        <header>
          <div class="company">{{ user.accountSetName || 'CW 财务记账系统' }}</div>
          <div class="doc-title">{{ DOC_TITLE[doc.doc_type] || doc.doc_type }}</div>
        </header>
        <div class="meta">
          <span><b>单据号：</b>{{ doc.doc_no }}</span>
          <span><b>日期：</b>{{ doc.doc_date }}</span>
          <span v-if="doc.partner_name || doc.partner_code"><b>往来单位：</b>{{ doc.partner_name || doc.partner_code }}</span>
          <span v-if="doc.warehouse_name || doc.warehouse_code"><b>仓库：</b>{{ doc.warehouse_name || doc.warehouse_code }}</span>
        </div>
        <table>
          <thead><tr><th>#</th><th>物料编码</th><th>物料名称</th><th>规格</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>备注</th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in doc.lines || []" :key="line.id || index">
              <td>{{ index + 1 }}</td><td>{{ line.item_code }}</td><td>{{ line.item_name }}</td><td>{{ line.spec }}</td><td>{{ line.unit }}</td>
              <td class="number">{{ num(line.qty) }}</td><td class="number">{{ money(line.price) }}</td><td class="number">{{ money(line.amount) }}</td><td>{{ line.remark }}</td>
            </tr>
          </tbody>
          <tfoot><tr><td colspan="5">合计</td><td class="number">{{ num(sum(doc.lines, 'qty')) }}</td><td></td><td class="number">{{ money(sum(doc.lines, 'amount')) }}</td><td></td></tr></tfoot>
        </table>
        <footer><span>制单：{{ doc.maker || '' }}</span><span>审核：{{ doc.auditor || '' }}</span><span>状态：{{ doc.status === 'audited' ? '已审核' : '草稿' }}</span></footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back, Printer } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { DOC_TITLE } from '@/utils/scmDoc'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const loading = ref(false)
const docs = ref<any[]>([])
const ids = String(route.query.ids || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 30)
const num = (value: any) => { const n = Number(value) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }
const money = (value: any) => (Number(value) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sum = (lines: any[] = [], key: string) => lines.reduce((total, line) => total + (Number(line[key]) || 0), 0)
const doPrint = () => window.print()

onMounted(async () => {
  loading.value = true
  try {
    const results = await Promise.all(ids.map(id => scmApi.getDoc(id)))
    docs.value = results.filter(result => result.code === 0).map(result => result.data)
  } finally { loading.value = false }
})
</script>

<style scoped>
.batch-print-wrap { min-height: 100%; background: var(--el-bg-color-page); }
.toolbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color); }
.toolbar .title { font-weight: 600; }
.toolbar .el-button:last-child { margin-left: auto; }
.paper { box-sizing: border-box; width: 210mm; min-height: 140mm; margin: 16px auto; padding: 14mm 12mm; background: #fff; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.12); page-break-after: always; }
header { text-align: center; margin-bottom: 10px; }.company { font-size: 18px; font-weight: 700; }.doc-title { font-size: 16px; font-weight: 600; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #000; padding: 4px 5px; } th { background: #f0f0f0; } .number { text-align: right; } tfoot { font-weight: 600; }
footer { display: flex; gap: 32px; margin-top: 18px; }
@media print { .no-print { display: none !important; } .batch-print-wrap { background: #fff; } .paper { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; } @page { size: A4; margin: 12mm; } }
</style>
