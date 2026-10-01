<template>
  <div class="page scm-due-page">
    <div class="filter-row">
      <span class="lbl">截止日期</span>
      <el-date-picker v-model="asOf" type="date" value-format="YYYY-MM-DD" placeholder="截止日期" style="width:150px" size="small" />
      <span class="lbl">临近到期(天)</span>
      <el-input-number v-model="upcomingDays" :min="0" :max="90" :controls="false" size="small" style="width:80px" />
      <el-button type="primary" plain size="small" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
      <span class="total-hint">逾期合计 <b class="over">{{ fmt(overdueTotal) }}</b>　临近到期 <b class="soon">{{ fmt(upcomingTotal) }}</b></span>
    </div>

    <!-- 信用额度控制设置 -->
    <div class="credit-box toolbar">
      <span class="credit-title">销售信用额度控制</span>
      <el-switch v-model="creditEnabled" active-text="启用" inline-prompt size="small" style="margin:0 12px" />
      <el-radio-group v-model="creditMode" size="small" :disabled="!creditEnabled">
        <el-radio-button value="warn">仅提示</el-radio-button>
        <el-radio-button value="block">超额阻断</el-radio-button>
      </el-radio-group>
      <el-button size="small" type="primary" plain style="margin-left:12px" :loading="savingParam" @click="saveCredit">保存设置</el-button>
      <span class="credit-note">已用额度 = 客户未核销应收 + 本单发货额；开启后销售出库审核时校验 credit_limit。</span>
    </div>

    <div class="body">
      <div class="section">
        <div class="sec-hd over">逾期未收/未付（{{ overdue.length }} 笔）</div>
        <el-table :data="overdue" v-loading="loading" border stripe size="small" height="100%">
          <el-table-column type="index" label="序号" width="54" align="center" />
          <el-table-column label="往来单位" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
          </el-table-column>
          <el-table-column label="单据" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ typeName(row.doc_type) }} {{ row.doc_no }}</template>
          </el-table-column>
          <el-table-column label="到期日" prop="due_date" width="110" />
          <el-table-column label="逾期天数" width="90" align="right">
            <template #default="{ row }"><span class="over">{{ row.overdue_days }}</span></template>
          </el-table-column>
          <el-table-column label="未核销金额" width="120" align="right">
            <template #default="{ row }">{{ fmt(row.open_amount) }}</template>
          </el-table-column>
        </el-table>
      </div>
      <div class="section">
        <div class="sec-hd soon">临近到期（{{ upcoming.length }} 笔，{{ upcomingDays }} 天内）</div>
        <el-table :data="upcoming" v-loading="loading" border stripe size="small" height="100%">
          <el-table-column type="index" label="序号" width="54" align="center" />
          <el-table-column label="往来单位" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
          </el-table-column>
          <el-table-column label="单据" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ typeName(row.doc_type) }} {{ row.doc_no }}</template>
          </el-table-column>
          <el-table-column label="到期日" prop="due_date" width="110" />
          <el-table-column label="距到期" width="90" align="right">
            <template #default="{ row }">{{ -row.overdue_days }} 天</template>
          </el-table-column>
          <el-table-column label="未核销金额" width="120" align="right">
            <template #default="{ row }">{{ fmt(row.open_amount) }}</template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'

const asOf = ref('')
const upcomingDays = ref(7)
const { clearFilters } = useFilterClear([asOf, upcomingDays])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  load()
}
const loading = ref(false)
const overdue = ref<any[]>([])
const upcoming = ref<any[]>([])
const overdueTotal = ref(0)
const upcomingTotal = ref(0)
const creditEnabled = ref(false)
const creditMode = ref<'warn' | 'block'>('warn')
const savingParam = ref(false)

const DOC_TYPE_NAMES: Record<string, string> = {
  PI: '采购入库', RP: '采购发票', SO: '销售出库', RS: '销售发票', WI: '委外入库',
}
const typeName = (t: string) => DOC_TYPE_NAMES[t] || t
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getArapDueReminder({ as_of_date: asOf.value || undefined, upcoming_days: upcomingDays.value })
    if (r.code === 0) {
      overdue.value = r.data.overdue || []
      upcoming.value = r.data.upcoming || []
      overdueTotal.value = r.data.overdue_total || 0
      upcomingTotal.value = r.data.upcoming_total || 0
    }
  } finally { loading.value = false }
}

async function loadCredit() {
  const r = await scmApi.getParams()
  if (r.code === 0) {
    creditEnabled.value = r.data.find(p => p.param_key === 'scm:credit_control_enabled')?.param_value === '1'
    creditMode.value = (r.data.find(p => p.param_key === 'scm:credit_control_mode')?.param_value as any) || 'warn'
  }
}
async function saveCredit() {
  savingParam.value = true
  try {
    await scmApi.saveParams([
      { param_key: 'scm:credit_control_enabled', param_value: creditEnabled.value ? '1' : '0' },
      { param_key: 'scm:credit_control_mode', param_value: creditMode.value },
    ])
    ElMessage.success('信用控制设置已保存')
  } finally { savingParam.value = false }
}

onMounted(() => { load(); loadCredit() })
</script>

<style scoped>
.scm-due-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .lbl { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.total-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.total-hint .over { color: var(--el-color-danger); }
.total-hint .soon { color: var(--el-color-warning); }
.credit-box { display: flex; align-items: center; padding: 6px 10px; background: var(--el-fill-color-light); border-radius: 6px; font-size: var(--cw-text-base); flex-wrap: wrap; }
.credit-title { font-weight: 600; }
.credit-note { margin-left: 14px; color: var(--el-text-color-secondary); }
.body { flex: 1; min-height: 0; display: flex; gap: 12px; }
.section { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sec-hd { font-size: var(--cw-text-base); font-weight: 600; margin-bottom: 4px; }
.sec-hd.over { color: var(--el-color-danger); }
.sec-hd.soon { color: var(--el-color-warning); }
.over { color: var(--el-color-danger); font-weight: 600; }
</style>
