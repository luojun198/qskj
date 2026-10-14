<template>
  <div class="acd-report">
    <!-- 概要 -->
    <div class="acd-report__kpis">
      <div class="kpi"><div class="kpi__label">物料</div><div class="kpi__value">{{ counter(stats.master.items) }}</div></div>
      <div class="kpi"><div class="kpi__label">往来单位</div><div class="kpi__value">{{ counter(stats.master.partners) }}</div></div>
      <div class="kpi"><div class="kpi__label">仓库</div><div class="kpi__value">{{ counter(stats.master.warehouses) }}</div></div>
      <div class="kpi"><div class="kpi__label">订单</div><div class="kpi__value">{{ typeSummary(stats.documents.orders) }}</div></div>
      <div class="kpi kpi--wide"><div class="kpi__label">出入库单</div><div class="kpi__value">{{ typeSummary(stats.documents.docs) }}</div></div>
      <template v-if="stats.finance">
        <div class="kpi">
          <div class="kpi__label">付款 / 收款</div>
          <div class="kpi__value">{{ stats.finance.payments.docs }} / {{ stats.finance.receipts.docs }} 张</div>
          <div class="kpi__sub">已核销 {{ formatAmount(stats.finance.payments.verified + stats.finance.receipts.verified) }}，未核销 {{ formatAmount(stats.finance.payments.unverified + stats.finance.receipts.unverified) }}</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">发票</div>
          <div class="kpi__value">销售 {{ stats.finance.invoices.RS }} / 采购 {{ stats.finance.invoices.RP }} 张</div>
          <div v-if="report.invoices" class="kpi__sub" :class="invoiceOk ? 'ok' : 'warn'">
            {{ invoiceOk ? '开票金额与润衡一致' : `润衡 ${formatAmount(report.invoices.acd.RS + report.invoices.acd.RP)}，本系统 ${formatAmount(report.invoices.ours.RS + report.invoices.ours.RP)}` }}
          </div>
        </div>
        <div class="kpi"><div class="kpi__label">对账单</div><div class="kpi__value">应收 {{ stats.finance.statements.ar }} / 应付 {{ stats.finance.statements.ap }}</div></div>
      </template>
      <div class="kpi">
        <div class="kpi__label">库存数量核对</div>
        <div class="kpi__value" :class="report.stock.qtyMatched === report.stock.compared ? 'ok' : 'warn'">
          {{ report.stock.qtyMatched }} / {{ report.stock.compared }} 一致
        </div>
      </div>
      <div class="kpi">
        <div class="kpi__label">往来核对（按单位）</div>
        <div class="kpi__value" :class="report.arap.matched === report.arap.partners ? 'ok' : 'warn'">
          {{ report.arap.matched }} / {{ report.arap.partners }} 一致
        </div>
      </div>
    </div>

    <el-tabs v-model="tab" class="acd-report__tabs">
      <el-tab-pane :label="`库存核对（差异 ${report.stock.diffs.length}）`" name="stock">
        <div class="totals">
          <span>润衡库存金额合计 <b>{{ formatAmount(report.stock.acdTotalAmount) }}</b></span>
          <span>本系统 <b>{{ formatAmount(report.stock.totalAmount) }}</b></span>
          <span class="muted">（数量是主要核对口径；金额差异按原因分类如下）</span>
        </div>
        <div class="reasons">
          <el-check-tag v-for="(v, k) in report.stock.byReason" :key="k" :checked="reason === k" @change="reason = reason === k ? '' : String(k)">
            {{ REASONS[k as StockDiffReason] || k }}：{{ v.count }} 项，金额差 {{ formatAmount(v.amount_diff) }}
          </el-check-tag>
        </div>
        <el-table :data="stockRows" size="small" border stripe max-height="420">
          <el-table-column label="仓库" prop="warehouse_code" width="80" />
          <el-table-column label="物料编码" prop="item_code" width="140" show-overflow-tooltip />
          <el-table-column label="物料名称" prop="item_name" min-width="140" show-overflow-tooltip />
          <el-table-column label="润衡数量" width="110" align="right"><template #default="{ row }">{{ qty(row.acd_qty) }}</template></el-table-column>
          <el-table-column label="本系统数量" width="110" align="right">
            <template #default="{ row }"><span :class="{ bad: row.qty_diff }">{{ qty(row.qty) }}</span></template>
          </el-table-column>
          <el-table-column label="润衡金额" width="120" align="right"><template #default="{ row }">{{ formatAmount(row.acd_amount) }}</template></el-table-column>
          <el-table-column label="本系统金额" width="120" align="right"><template #default="{ row }">{{ formatAmount(row.amount) }}</template></el-table-column>
          <el-table-column label="金额差" width="110" align="right"><template #default="{ row }">{{ formatAmount(row.amount_diff) }}</template></el-table-column>
          <el-table-column label="原因" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ REASONS[row.reason as StockDiffReason] }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane :label="`往来核对（差异 ${report.arap.diffs.length}）`" name="arap">
        <div class="totals">
          <span>应收：润衡 <b>{{ formatAmount(report.arap.acdTotal.ar) }}</b> / 本系统 <b>{{ formatAmount(report.arap.total.ar) }}</b></span>
          <span>应付：润衡 <b>{{ formatAmount(report.arap.acdTotal.ap) }}</b> / 本系统 <b>{{ formatAmount(report.arap.total.ap) }}</b></span>
          <span class="muted">（出入库单挂账 − 收付款；发票不影响往来）</span>
        </div>
        <el-table :data="report.arap.diffs" size="small" border stripe max-height="420" empty-text="全部一致">
          <el-table-column label="往来单位" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name }}</template>
          </el-table-column>
          <el-table-column label="方向" width="70"><template #default="{ row }">{{ row.side === 'ar' ? '应收' : '应付' }}</template></el-table-column>
          <el-table-column label="润衡" width="130" align="right"><template #default="{ row }">{{ formatAmount(row.acd) }}</template></el-table-column>
          <el-table-column label="本系统" width="130" align="right"><template #default="{ row }">{{ formatAmount(row.ours) }}</template></el-table-column>
          <el-table-column label="差额" width="120" align="right"><template #default="{ row }">{{ formatAmount(row.diff) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane :label="`负库存（${report.negatives.length}）`" name="neg">
        <el-table :data="report.negatives" size="small" border stripe max-height="420" empty-text="无负库存">
          <el-table-column label="仓库" prop="warehouse_code" width="80" />
          <el-table-column label="物料编码" prop="item_code" width="160" />
          <el-table-column label="物料名称" prop="item_name" min-width="160" show-overflow-tooltip />
          <el-table-column label="数量" width="120" align="right"><template #default="{ row }">{{ qty(row.qty) }}</template></el-table-column>
          <el-table-column label="金额" width="120" align="right"><template #default="{ row }">{{ formatAmount(row.amount) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane :label="`导入提示（${issues.length}）`" name="issues">
        <el-table :data="issues" size="small" border stripe max-height="420" empty-text="无">
          <el-table-column label="级别" width="70" align="center">
            <template #default="{ row }">
              <el-tag :type="row.level === 'error' ? 'danger' : row.level === 'warn' ? 'warning' : 'info'" size="small">
                {{ row.level === 'error' ? '错误' : row.level === 'warn' ? '注意' : '提示' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="分类" prop="category" width="80" />
          <el-table-column label="内容" prop="message" min-width="400" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AcdCounter, AcdImportStats, AcdIssue, AcdVerifyReport, StockDiffReason } from '@/api/scmAcdImport'
import { typeName } from '@/utils/scmDoc'
import { formatAmount } from '@/utils/format'

const props = defineProps<{ stats: AcdImportStats; report: AcdVerifyReport; issues: AcdIssue[] }>()

const REASONS: Record<StockDiffReason, string> = {
  qty: '数量不符',
  acd_residual: '润衡数量为 0 仍挂金额（润衡成本尾差）',
  no_cost_wh: '润衡车间仓不核算金额',
  amount: '金额不符',
}

const tab = ref('stock')
const reason = ref('')
const stockRows = computed(() => reason.value ? props.report.stock.diffs.filter(d => d.reason === reason.value) : props.report.stock.diffs)

const counter = (c: AcdCounter) => `新增 ${c.inserted}${c.updated ? `、覆盖 ${c.updated}` : ''}${c.skipped ? `、跳过 ${c.skipped}` : ''}`
const typeSummary = (m: Record<string, number>) => Object.entries(m).map(([k, n]) => `${typeName(k)} ${n}`).join('、') || '-'
const invoiceOk = computed(() => {
  const i = props.report.invoices
  return !!i && Math.abs(i.acd.RS - i.ours.RS) < 0.05 && Math.abs(i.acd.RP - i.ours.RP) < 0.05
})
const qty = (n: number) => (Number(n) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
</script>

<style scoped>
.acd-report { display: flex; flex-direction: column; gap: 12px; }
.acd-report__kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.kpi { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 8px 12px; background: var(--el-bg-color); }
.kpi--wide { grid-column: span 2; }
.kpi__label { font-size: 12px; color: var(--el-text-color-secondary); }
.kpi__value { margin-top: 4px; font-weight: 600; }
.kpi__value.ok, .kpi__sub.ok { color: var(--el-color-success); }
.kpi__sub { margin-top: 2px; font-size: 12px; color: var(--el-text-color-secondary); }
.kpi__sub.warn { color: var(--el-color-warning); }
.kpi__value.warn { color: var(--el-color-warning); }
.totals { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }
.reasons { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.bad { color: var(--el-color-danger); font-weight: 600; }
</style>
