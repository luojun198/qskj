<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>自动排程</b></div>
      <span class="report-header__note">有限产能顺排：按排序逐张工单、逐道工序在工作中心的日产能日历上占用工时（同一天可分摊），后道紧接前道；排程完工晚于计划完工即「延期」。无工作中心 / 无产能的工序计入「未排产」。先「试算」查看结果，满意后「写入」保存到工单与工序。</span>
    </div>
    <div class="toolbar">
      <el-date-picker v-model="opts.from_date" type="date" value-format="YYYY-MM-DD" placeholder="起始日（默认今天）" size="small" style="width:150px" />
      <el-select v-model="opts.order_by" size="small" style="width:150px">
        <el-option label="优先级 → 交期" value="priority" /><el-option label="交期 → 优先级" value="due_date" /><el-option label="计划号" value="code" />
      </el-select>
      <el-checkbox-group v-model="opts.workdays" size="small">
        <el-checkbox-button v-for="d in 7" :key="d" :value="d">{{ '一二三四五六日'[d - 1] }}</el-checkbox-button>
      </el-checkbox-group>
      <el-button type="primary" size="small" :loading="loading" @click="run(true)">试算</el-button>
      <el-button type="success" size="small" :loading="loading" :disabled="!result" @click="run(false)">写入排程</el-button>
      <el-button size="small" @click="showRuns = !showRuns">历史运行 ({{ runs.length }})</el-button>
    </div>
    <div v-if="result" class="summary-grid">
      <div><span>参与工单</span><b>{{ result.plan_count }}</b></div>
      <div><span>延期工单</span><b :class="{ warn: result.late_count > 0 }">{{ result.late_count }}</b></div>
      <div><span>未排产工时</span><b>{{ num(result.unscheduled_hours) }}</b></div>
      <div><span>本次</span><b>{{ result.run_id ? '已写入' : '试算' }}</b><i>{{ result.from_date }} 起 · 工作日 {{ result.workdays.map((d: number) => '一二三四五六日'[d - 1]).join('') }}</i></div>
    </div>
    <div v-if="showRuns && runs.length" class="runs">
      <el-table :data="runs" size="small" border max-height="200">
        <el-table-column label="运行时间" prop="run_at" width="160" /><el-table-column label="起始日" prop="from_date" width="100" /><el-table-column label="排序" prop="order_by" width="90" /><el-table-column label="工作日" prop="workdays" width="110" />
        <el-table-column label="工单" prop="plan_count" width="70" align="right" /><el-table-column label="延期" prop="late_count" width="70" align="right" /><el-table-column label="未排产工时" prop="unscheduled_hours" width="100" align="right" /><el-table-column label="操作人" prop="run_by" min-width="100" />
      </el-table>
    </div>
    <div class="rpt-table">
      <el-table v-loading="loading" :data="result?.plans || []" border stripe height="100%" row-key="plan_id" :expand-row-keys="expanded" @expand-change="onExpand">
        <el-table-column type="expand">
          <template #default="{ row }">
            <el-table :data="row.processes" size="small" border class="sub">
              <el-table-column label="序" prop="seq" width="50" align="center" />
              <el-table-column label="工序" prop="process_name" min-width="120" />
              <el-table-column label="工作中心" prop="work_center_code" width="110" />
              <el-table-column label="剩余量" width="90" align="right"><template #default="{ row: p }">{{ num(p.remain_qty) }}</template></el-table-column>
              <el-table-column label="工时" width="90" align="right"><template #default="{ row: p }">{{ num(p.hours) }}</template></el-table-column>
              <el-table-column label="排程开始" width="110"><template #default="{ row: p }">{{ p.sched_start || '-' }}</template></el-table-column>
              <el-table-column label="排程结束" width="110"><template #default="{ row: p }">{{ p.sched_end || '-' }}</template></el-table-column>
              <el-table-column label="说明" min-width="140"><template #default="{ row: p }"><span v-if="p.unscheduled" class="warn">未排产（无工作中心或产能为 0）</span><span v-else-if="!p.hours" class="muted">已完成</span></template></el-table-column>
            </el-table>
          </template>
        </el-table-column>
        <el-table-column label="工单" width="150"><template #default="{ row }"><el-link type="primary" @click="router.push(scmProductionPlanOrderRoute(row.plan_id, 'self'))">{{ row.plan_code }}</el-link></template></el-table-column>
        <el-table-column label="优先级" prop="priority" width="80" align="right" />
        <el-table-column label="计划开工" width="110"><template #default="{ row }">{{ row.start_date || '-' }}</template></el-table-column>
        <el-table-column label="计划完工" width="110"><template #default="{ row }">{{ row.end_date || '-' }}</template></el-table-column>
        <el-table-column label="排程开工" width="110"><template #default="{ row }">{{ row.sched_start_date || '-' }}</template></el-table-column>
        <el-table-column label="排程完工" width="110"><template #default="{ row }"><b :class="{ warn: row.late_days > 0 }">{{ row.sched_end_date || '-' }}</b></template></el-table-column>
        <el-table-column label="延期(天)" width="90" align="right"><template #default="{ row }"><span :class="{ warn: row.late_days > 0 }">{{ row.late_days || '' }}</span></template></el-table-column>
        <el-table-column label="总工时" width="90" align="right"><template #default="{ row }">{{ num(row.total_hours) }}</template></el-table-column>
        <el-table-column label="未排产" width="90" align="right"><template #default="{ row }">{{ Number(row.unscheduled_hours) ? num(row.unscheduled_hours) : '' }}</template></el-table-column>
        <el-table-column label="工序" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ row.processes.filter((p: any) => p.hours > 0).map((p: any) => `${p.process_name} ${p.sched_start?.slice(5) || ''}~${p.sched_end?.slice(5) || ''}`).join(' → ') }}</template></el-table-column>
      </el-table>
    </div>
    <div v-if="result?.day_loads?.length" class="dayload">
      <b>工作中心日负荷（本次排程占用）</b>
      <el-table :data="result.day_loads" size="small" border max-height="220">
        <el-table-column label="日期" prop="date" width="110" /><el-table-column label="工作中心" prop="work_center_name" min-width="120" />
        <el-table-column label="日产能" prop="capacity" width="90" align="right" /><el-table-column label="占用" prop="used" width="90" align="right" />
        <el-table-column label="占用率" width="200"><template #default="{ row }"><el-progress :percentage="row.capacity ? Math.min(100, Math.round(row.used / row.capacity * 100)) : 0" :stroke-width="10" :status="row.capacity && row.used >= row.capacity ? 'exception' : undefined" /></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmProductionPlanOrderRoute } from '@/utils/scmDocNavigation'

const router = useRouter()
const opts = ref<{ from_date: string; order_by: string; workdays: number[] }>({ from_date: '', order_by: 'priority', workdays: [1, 2, 3, 4, 5] })
const result = ref<any>(null); const runs = ref<any[]>([]); const showRuns = ref(false)
const loading = ref(false)
const expanded = ref<string[]>([])
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
function onExpand(row: any, rows: any[]) { expanded.value = rows.map(r => r.plan_id) }
async function run(dry: boolean) {
  if (!dry) { try { await ElMessageBox.confirm('写入后各工单 / 工序的排程日期将被覆盖（可再次运行更新）。继续？', '写入排程', { type: 'warning' }) } catch { return } }
  loading.value = true
  try {
    const r = await scmApi.runSchedule({ from_date: opts.value.from_date || undefined, order_by: opts.value.order_by, workdays: opts.value.workdays, dry_run: dry })
    if (r.code === 0) { result.value = r.data; if (!dry) { ElMessage.success(`已写入 ${r.data.plan_count} 张工单的排程`); loadRuns() } }
    else ElMessage.error(r.message || '排程失败')
  } finally { loading.value = false }
}
async function loadRuns() { const r = await scmApi.getScheduleRuns(); if (r.code === 0) runs.value = r.data }
onMounted(async () => { await loadRuns(); run(true) })
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.summary-grid i{font-style:normal;font-size:12px;color:var(--el-text-color-secondary)}.rpt-table{flex:1;min-height:200px}.sub{margin:4px 0 4px 48px;width:calc(100% - 60px)}.dayload{display:flex;flex-direction:column;gap:6px;font-size:13px}.warn{color:var(--el-color-danger)}.muted{color:var(--el-text-color-secondary)}
</style>
