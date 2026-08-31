<template>
  <div class="page sd-page">
    <!-- 顶部导航 -->
    <div class="sd-header">
      <div class="sd-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="sd-header__sep">/</span>
        <span class="sd-header__title">库存处理 / 生成 MRP 计算单</span>
        <el-tag v-if="docInfo?.doc_no" size="small" style="margin-left:8px">{{ docInfo.doc_no }}</el-tag>
        <el-tag v-if="docInfo?.partner_code" type="info" size="small" effect="plain" style="margin-left:4px">
          {{ docInfo.partner_code }}
        </el-tag>
      </div>
      <div class="sd-header__right">
        <el-tag v-if="processingCompleted" type="success" effect="plain">库存处理已完成</el-tag>
        <el-tag v-else-if="noShippableStock" type="info" effect="plain">暂无可发库存</el-tag>
        <el-button v-if="totalShip > 0" type="success" :loading="shipping" @click="handleShip">
          生成销售出库（{{ shipRowCount }} 行）
        </el-button>
        <el-button v-if="shortageDocs.length" type="info" plain @click="dupDialogVisible = true">历史缺料单（{{ shortageDocs.length }}）</el-button>
        <el-button v-if="totalShort > 0 || mrpDocs.length" type="primary" @click="handleGenShortage">
          {{ mrpDocs.length ? '打开 MRP 计算单' : '生成 MRP 计算单' }}
        </el-button>
      </div>
    </div>

    <div class="sd-body">
      <div class="sd-hint">
        <b>可用库存 = 现存量 − 其它已审核未发货销售订单占用</b>（不含本单）。本次发货默认按订单正常剩余量，开启销售超发后可手工增加到允许上限。
        库存充足的部分可<b>直接发货</b>；不足需求进入<b>MRP 计算单</b>，由 MRP 统一完成多层 BOM、库存、占用和在途净算，再直接下推采购、生产、委外或组装单据。
        <span class="sd-hint-tip">　双击任意行可查看该物料的库存分布（各仓库结存）。</span>
      </div>

      <el-table v-loading="loading" :data="rows" size="small" border stripe height="100%" class="sd-table" @row-dblclick="openStockDist">
        <el-table-column type="index" label="序号" width="54" align="center" />
        <el-table-column label="编号" prop="item_code" width="120" show-overflow-tooltip />
        <el-table-column label="名称" prop="item_name" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="110" show-overflow-tooltip />
        <el-table-column label="仓位" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code || '-' }}</template>
        </el-table-column>
        <el-table-column label="订单数量" width="100" align="right">
          <template #default="{ row }">{{ num(row.order_qty) }}</template>
        </el-table-column>
        <el-table-column label="已下推" width="90" align="right">
          <template #default="{ row }">{{ num(row.pushed_qty) }}</template>
        </el-table-column>
        <el-table-column label="剩余" width="90" align="right">
          <template #default="{ row }">{{ num(row.remain) }}</template>
        </el-table-column>
        <el-table-column label="允许剩余" width="100" align="right">
          <template #default="{ row }">{{ num(row.overrun_remaining) }}</template>
        </el-table-column>
        <el-table-column label="可用库存" width="100" align="right">
          <template #default="{ row }"><span :class="{ 'sd-neg': row.available < 0 }">{{ num(row.available) }}</span></template>
        </el-table-column>
        <el-table-column label="本次发货" width="130" align="right">
          <template #default="{ row }">
            <el-input-number v-model="row.ship_qty" :min="0" :max="row.max_ship_qty" :precision="6"
              :controls="false" size="small" style="width:100%" />
          </template>
        </el-table-column>
        <el-table-column label="成品缺口" width="120" align="right">
          <template #default="{ row }"><span :class="{ 'sd-short': row.short_qty > 0 }">{{ num(row.short_qty) }}</span></template>
        </el-table-column>
      </el-table>
    </div>

    <div class="sd-footer">
      <el-tag type="success" effect="plain">可发合计 {{ num(totalShip) }}</el-tag>
      <el-tag :type="totalShort > 0 ? 'danger' : 'info'" effect="plain">成品缺口合计 {{ num(totalShort) }}</el-tag>
      <span class="sd-tip" v-if="totalShort > 0">成品缺口进入 MRP 计算单，审核后直接生成对应下游单据</span>
    </div>

    <!-- 历史流程生成的缺料单继续保留查看入口，新缺口统一进入 MRP。 -->
    <el-dialog v-model="dupDialogVisible" title="历史缺料单" width="600px">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
        <div class="dup-steps">
          以下为旧流程已经生成的缺料单，仍可查看和继续下推；新的销售需求统一进入 <b>MRP 计算单</b>。
        </div>
      </el-alert>

      <div class="dup-section-title">已生成的缺料单（{{ shortageDocs.length }}）</div>
      <el-table :data="shortageDocs" size="small" border stripe max-height="220">
        <el-table-column label="单号" prop="doc_no" min-width="150" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'audited' ? 'success' : 'info'" size="small" effect="plain">
              {{ row.status === 'audited' ? '已审核' : '草稿' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goProcessMr(row)">
              {{ row.status === 'audited' ? '去多级下推' : '去审核处理' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="dupDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 库存分布：双击行查看该物料在各仓库的结存 -->
    <el-dialog v-model="stockDistVisible" :title="`库存分布 · ${distItem?.item_code || ''} ${distItem?.item_name || ''}`" width="660px">
      <el-table v-if="distRows.length" v-loading="distLoading" :data="distRows" size="small" border stripe max-height="400" show-summary :summary-method="distSummary">
        <el-table-column label="仓库" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code || '-' }}</template>
        </el-table-column>
        <el-table-column label="结存数量" width="100" align="right"><template #default="{ row }">{{ num(row.qty) }}</template></el-table-column>
        <el-table-column label="平均成本" width="110" align="right"><template #default="{ row }">{{ fmt(row.avg_cost) }}</template></el-table-column>
        <el-table-column label="结存金额" width="120" align="right"><template #default="{ row }">{{ fmt(row.amount) }}</template></el-table-column>
        <el-table-column label="采购在途" width="90" align="right"><template #default="{ row }">{{ num(row.unreceived_purchase_qty) }}</template></el-table-column>
        <el-table-column label="销售未发" width="90" align="right"><template #default="{ row }">{{ num(row.unshipped_sales_qty) }}</template></el-table-column>
      </el-table>
      <el-empty v-else v-loading="distLoading" :image-size="60" description="该物料各仓库暂无库存" />
      <template #footer>
        <el-button @click="stockDistVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi, type ScmStockAvailLine } from '@/api/scm'
import { scmDownstreamDocRoute, scmDownstreamMrpRoute } from '@/utils/scmDocNavigation'

const route = useRoute()
const router = useRouter()
const docId = computed(() => route.params.id as string)

const loading = ref(false)
const shipping = ref(false)
const rows = ref<ScmStockAvailLine[]>([])
const docInfo = ref<any>(null)
// 本单已生成的缺料单（防重复下推）
const shortageDocs = ref<Array<{ id: string; doc_no: string; status: string }>>([])
const mrpDocs = ref<Array<{ id: string; doc_no: string; status: string }>>([])
// 「已生成过缺料单」引导弹窗
const dupDialogVisible = ref(false)

const num = (v: number) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '')
}
const round = (n: number) => Math.round(n * 1000000) / 1000000
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 库存分布弹窗（双击行 → 该物料各仓库结存）
const stockDistVisible = ref(false)
const distLoading = ref(false)
const distItem = ref<any>(null)
const distRows = ref<any[]>([])
async function openStockDist(row: any) {
  if (!row?.item_code) return
  distItem.value = { item_code: row.item_code, item_name: row.item_name }
  distRows.value = []
  stockDistVisible.value = true
  distLoading.value = true
  try {
    const res = await scmApi.getStock({ keyword: row.item_code })
    if (res.code === 0) {
      // 只列有结存的仓库（getStock 会带入计划未领用等空仓行，qty=0 的对「库存分布」是噪音）
      distRows.value = (res.data as any[])
        .filter(r => r.item_code === row.item_code && (Number(r.qty) || 0) > 0)
        .sort((a, b) => String(a.warehouse_code).localeCompare(String(b.warehouse_code)))
    }
  } finally {
    distLoading.value = false
  }
}
// 合计行：数量/金额/在途求和，平均成本列不合计
function distSummary({ columns }: any) {
  const sum = (k: string) => num(distRows.value.reduce((s, r) => s + (Number(r[k]) || 0), 0))
  return columns.map((c: any, i: number) => i === 0 ? '合计'
    : c.label === '结存数量' ? sum('qty')
    : c.label === '结存金额' ? fmt(distRows.value.reduce((s, r) => s + (Number(r.amount) || 0), 0))
    : c.label === '采购在途' ? sum('unreceived_purchase_qty')
    : c.label === '销售未发' ? sum('unshipped_sales_qty') : '')
}

const totalShip = computed(() => round(rows.value.reduce((s, r) => s + (Number(r.ship_qty) || 0), 0)))
const totalShort = computed(() => round(rows.value.reduce((s, r) => s + (Number(r.short_qty) || 0), 0)))
const totalMaxShip = computed(() => round(rows.value.reduce((s, r) => s + (Number(r.max_ship_qty) || 0), 0)))
const shipRowCount = computed(() => rows.value.filter(r => (Number(r.ship_qty) || 0) > 0).length)
const hasRemaining = computed(() => rows.value.some(row => (Number(row.overrun_remaining) || 0) > 0.000001))
const processingCompleted = computed(() =>
  !loading.value && rows.value.length > 0 && !hasRemaining.value
)
const noShippableStock = computed(() =>
  !loading.value && hasRemaining.value && totalMaxShip.value <= 0
)

function goBack() {
  router.push(scmDownstreamDocRoute(docId.value, docInfo.value?.status, undefined, docInfo.value?.doc_type))
}

async function load() {
  loading.value = true
  try {
    const res = await scmApi.getDocAvailability(docId.value)
    if (res.code === 0) {
      rows.value = res.data.lines || []
      docInfo.value = res.data.doc || null
      shortageDocs.value = res.data.shortage_docs || []
      mrpDocs.value = res.data.mrp_docs || []
    }
  } finally {
    loading.value = false
  }
}

async function handleShip() {
  const shipLines = rows.value.filter(r => (Number(r.ship_qty) || 0) > 0)
  if (!shipLines.length) return ElMessage.warning('没有可发货数量')
  const exceeded = shipLines.find(r => (Number(r.ship_qty) || 0) > (Number(r.max_ship_qty) || 0) + 0.000001)
  if (exceeded) return ElMessage.warning(`物料 ${exceeded.item_code} 本次发货超过允许上限`)
  shipping.value = true
  try {
    const lines = shipLines.map(r => {
      const qty = Number(r.ship_qty) || 0
      const price = Number(r.price) || 0
      const taxRate = r.tax_rate === null || r.tax_rate === undefined ? null : Number(r.tax_rate)
      return {
        item_code: r.item_code,
        item_name: r.item_name || '',
        warehouse_code: r.warehouse_code || docInfo.value?.warehouse_code || '',
        qty,
        price,
        amount: Math.round(qty * price * 100) / 100,
        price_with_tax: Number(r.price_with_tax) || undefined,
        unit_cost: Number(r.unit_cost) || 0,
        tax_rate: taxRate,
        tax_amount: taxRate === null ? null : Math.round(qty * price * taxRate) / 100,
        source_line_id: r.line_id,
      }
    })
    const headerWh = docInfo.value?.warehouse_code || shipLines[0]?.warehouse_code || ''
    const res = await scmApi.createDoc({
      doc_type: 'SO',
      source_doc_id: docId.value,
      partner_code: docInfo.value?.partner_code || '',
      warehouse_code: headerWh,
      lines,
    })
    if (res.code === 0) {
      ElMessage.success(`已生成销售出库草稿 ${res.data.doc_no}，请复核后审核发货`)
      router.push(scmDownstreamDocRoute(res.data.id, 'draft', undefined, 'SO'))
    }
  } finally {
    shipping.value = false
  }
}

function handleGenShortage() {
  if (mrpDocs.value.length) {
    const row = mrpDocs.value[0]
    router.push(scmDownstreamMrpRoute(row.id, row.status))
    return
  }
  const shortLines = rows.value.filter(r => (Number(r.short_qty) || 0) > 0)
  if (!shortLines.length) return ElMessage.warning('没有缺口数量')
  router.push({ name: 'ScmMrpNew', query: { source_kind: 'sales_order', source_id: docId.value } })
}

// 引导窗「去处理已生成的缺料单」：已审核→缺料下推预览；草稿→直接编辑
function goProcessMr(row: { id: string; status: string }) {
  dupDialogVisible.value = false
  if (row.status === 'audited') router.push({ name: 'ScmMrPushPreview', params: { id: row.id } })
  else router.push(scmDownstreamDocRoute(row.id, row.status))
}

onMounted(load)
</script>

<style scoped>
.sd-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.sd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.sd-header__left { display: flex; align-items: center; }
.sd-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.sd-header__title { font-size: 15px; font-weight: 600; }
.sd-header__right { display: flex; align-items: center; gap: 8px; }
.sd-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px 0; }
.sd-hint { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 10px; line-height: 1.6; }
.sd-table { flex: 1; min-height: 0; }
.sd-footer {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; border-top: 1px solid var(--el-border-color-lighter);
}
.sd-tip { margin-left: auto; font-size: 13px; color: var(--el-text-color-secondary); }
.sd-short { color: var(--el-color-danger); font-weight: 600; }
.sd-neg { color: var(--el-color-danger); }
.sd-ship { color: var(--el-color-success); font-weight: 600; }
.dup-steps { font-size: 13px; line-height: 1.7; }
.dup-section-title { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); margin-bottom: 6px; }
.dup-newshort { font-size: 13px; color: var(--el-text-color-regular); }
.dup-newshort__sub { color: var(--el-text-color-secondary); }
.dup-newshort__mode { margin-top: 6px; color: var(--el-text-color-secondary); }
.sd-hint-tip { color: var(--el-color-primary); }
.sd-table :deep(.el-table__body-wrapper .el-table__row) { cursor: pointer; }
</style>
