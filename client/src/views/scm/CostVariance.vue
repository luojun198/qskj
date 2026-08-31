<template>
  <div class="page cv-page">
    <div class="filter-row">
      <span class="title">标准成本差异分析</span>
      <el-date-picker v-model="dateRange" type="daterange" size="small" unlink-panels
        range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期"
        value-format="YYYY-MM-DD" :clearable="false" style="width: 240px" />
      <el-button type="primary" size="small" :loading="loading" @click="load"><el-icon><Refresh /></el-icon>查询</el-button>
      <el-radio-group v-model="filterType" size="small">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="over">超支</el-radio-button>
        <el-radio-button value="save">节约</el-radio-button>
      </el-radio-group>
      <span class="hint">标准=BOM料+工艺(工时×费率)卷算；实际=完工入库(PF已审核)料/人工/制费；差异=实际−标准，正超支负节约</span>
    </div>

    <div v-if="ran && rows.length" class="sum-cards">
      <div class="card"><div class="lbl">标准合计</div><div class="val">{{ fmt(sum.std_total) }}</div></div>
      <div class="card"><div class="lbl">实际合计</div><div class="val">{{ fmt(sum.act_total) }}</div></div>
      <div class="card" :class="varCls(sum.var_total)"><div class="lbl">总差异</div><div class="val">{{ fmtSigned(sum.var_total) }}</div></div>
      <div class="card sub"><div class="lbl">料差异</div><div class="val" :class="txtCls(sum.var_mat)">{{ fmtSigned(sum.var_mat) }}</div></div>
      <div class="card sub"><div class="lbl">人工差异</div><div class="val" :class="txtCls(sum.var_labor)">{{ fmtSigned(sum.var_labor) }}</div></div>
      <div class="card sub"><div class="lbl">制费差异</div><div class="val" :class="txtCls(sum.var_oh)">{{ fmtSigned(sum.var_oh) }}</div></div>
    </div>

    <el-empty v-if="!ran" description="选择日期区间后点「查询」，分析各完工成品标准 vs 实际成本差异" />
    <el-empty v-else-if="!rows.length" description="区间内无已审核的完工入库(PF)记录" />
    <el-table v-else :data="filtered" v-loading="loading" border stripe size="small" height="100%"
      :row-class-name="rowClass" show-summary :summary-method="summaryMethod">
      <el-table-column label="成品" min-width="170" fixed show-overflow-tooltip>
        <template #default="{ row }">{{ row.item_code }} {{ row.item_name }}</template>
      </el-table-column>
      <el-table-column label="完工数" width="90" align="right"><template #default="{ row }">{{ fmt(row.finished_qty) }}</template></el-table-column>
      <el-table-column label="标准" align="center">
        <el-table-column label="料" width="100" align="right"><template #default="{ row }">{{ fmt(row.std_mat) }}</template></el-table-column>
        <el-table-column label="人工" width="100" align="right"><template #default="{ row }">{{ fmt(row.std_labor) }}</template></el-table-column>
        <el-table-column label="制费" width="100" align="right"><template #default="{ row }">{{ fmt(row.std_oh) }}</template></el-table-column>
        <el-table-column label="合计" width="110" align="right"><template #default="{ row }"><b>{{ fmt(row.std_total) }}</b></template></el-table-column>
      </el-table-column>
      <el-table-column label="实际" align="center">
        <el-table-column label="料" width="100" align="right"><template #default="{ row }">{{ fmt(row.act_mat) }}</template></el-table-column>
        <el-table-column label="人工" width="100" align="right"><template #default="{ row }">{{ fmt(row.act_labor) }}</template></el-table-column>
        <el-table-column label="制费" width="100" align="right"><template #default="{ row }">{{ fmt(row.act_oh) }}</template></el-table-column>
        <el-table-column label="合计" width="110" align="right"><template #default="{ row }"><b>{{ fmt(row.act_total) }}</b></template></el-table-column>
      </el-table-column>
      <el-table-column label="差异（实际−标准）" align="center">
        <el-table-column label="料" width="100" align="right"><template #default="{ row }"><span :class="txtCls(row.var_mat)">{{ fmtSigned(row.var_mat) }}</span></template></el-table-column>
        <el-table-column label="人工" width="100" align="right"><template #default="{ row }"><span :class="txtCls(row.var_labor)">{{ fmtSigned(row.var_labor) }}</span></template></el-table-column>
        <el-table-column label="制费" width="100" align="right"><template #default="{ row }"><span :class="txtCls(row.var_oh)">{{ fmtSigned(row.var_oh) }}</span></template></el-table-column>
        <el-table-column label="合计" width="120" align="right"><template #default="{ row }"><b :class="txtCls(row.var_total)">{{ fmtSigned(row.var_total) }}</b></template></el-table-column>
        <el-table-column label="差异率" width="100" align="right">
          <template #default="{ row }"><span :class="txtCls(row.var_total)">{{ rateDisp(row) }}</span></template>
        </el-table-column>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'

const rows = ref<any[]>([])
const loading = ref(false)
const ran = ref(false)
const filterType = ref('')
const dateRange = ref<[string, string]>(['2026-01-01', '2026-12-31'])

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtSigned = (v: any) => { const n = Number(v) || 0; return (n > 0 ? '+' : '') + fmt(n) }
const txtCls = (v: any) => { const n = Number(v) || 0; return n > 0.005 ? 'over' : n < -0.005 ? 'save' : '' }
const varCls = (v: any) => txtCls(v)

const filtered = computed(() => {
  if (filterType.value === 'over') return rows.value.filter(r => Number(r.var_total) > 0.005)
  if (filterType.value === 'save') return rows.value.filter(r => Number(r.var_total) < -0.005)
  return rows.value
})
// 汇总卡片与表格合计口径一致：均随「超支/节约」筛选联动（评审 P1-2）
const sum = computed(() => {
  const acc: any = { std_total: 0, act_total: 0, var_total: 0, var_mat: 0, var_labor: 0, var_oh: 0 }
  for (const r of filtered.value) {
    acc.std_total += Number(r.std_total) || 0
    acc.act_total += Number(r.act_total) || 0
    acc.var_total += Number(r.var_total) || 0
    acc.var_mat += Number(r.var_mat) || 0
    acc.var_labor += Number(r.var_labor) || 0
    acc.var_oh += Number(r.var_oh) || 0
  }
  return acc
})
// 差异率显示：标准成本为 0（无 BOM 无工艺）却有实际成本时显示「—」而非误导性的 0%（评审 P2-2）
const rateDisp = (row: any) => {
  if ((Number(row.std_total) || 0) === 0) return (Number(row.act_total) || 0) !== 0 ? '—' : '0%'
  return (row.var_rate > 0 ? '+' : '') + row.var_rate + '%'
}

function rowClass({ row }: any) {
  const v = Number(row.var_total) || 0
  return v > 0.005 ? 'over-row' : v < -0.005 ? 'save-row' : ''
}
// 合计行：数值列求和（差异列带符号）
function summaryMethod({ columns, data }: any) {
  const sums: string[] = []
  const sumBy = (key: string) => data.reduce((s: number, r: any) => s + (Number(r[key]) || 0), 0)
  const map: Record<number, () => string> = {
    0: () => '合计',
    1: () => fmt(sumBy('finished_qty')),
    2: () => fmt(sumBy('std_mat')), 3: () => fmt(sumBy('std_labor')), 4: () => fmt(sumBy('std_oh')), 5: () => fmt(sumBy('std_total')),
    6: () => fmt(sumBy('act_mat')), 7: () => fmt(sumBy('act_labor')), 8: () => fmt(sumBy('act_oh')), 9: () => fmt(sumBy('act_total')),
    10: () => fmtSigned(sumBy('var_mat')), 11: () => fmtSigned(sumBy('var_labor')), 12: () => fmtSigned(sumBy('var_oh')),
    13: () => fmtSigned(sumBy('var_total')),
    14: () => { const s = sumBy('std_total'); const v = sumBy('var_total'); return s !== 0 ? (v > 0 ? '+' : '') + Math.round(v / s * 10000) / 100 + '%' : (sumBy('act_total') ? '—' : '') },
  }
  columns.forEach((_: any, i: number) => { sums[i] = map[i] ? map[i]() : '' })
  return sums
}

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getCostVariance({ start_date: dateRange.value?.[0], end_date: dateRange.value?.[1] })
    if (r.code === 0) { rows.value = r.data || []; ran.value = true }
  } finally { loading.value = false }
}
</script>

<style scoped>
.cv-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); max-width: 480px; }
.sum-cards { display: flex; gap: 10px; flex-wrap: wrap; }
.sum-cards .card { flex: 1; min-width: 120px; padding: 8px 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-light); }
.sum-cards .card.sub { background: transparent; }
.sum-cards .card .lbl { font-size: 12px; color: var(--el-text-color-secondary); }
.sum-cards .card .val { font-size: 18px; font-weight: 600; margin-top: 2px; }
.over { color: var(--el-color-danger); }
.save { color: var(--el-color-success); }
:deep(.over-row) { background: var(--el-color-danger-light-9) !important; }
:deep(.save-row) { background: var(--el-color-success-light-9) !important; }
</style>
