<template>
  <div class="page md-page">
    <!-- 顶部导航：返回 + 标题 + 客户/币别/订单数 -->
    <div class="md-header">
      <div class="md-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="md-header__sep">/</span>
        <span class="md-header__title">合并出库 / 多订单发货</span>
        <el-tag v-if="partnerName" type="info" size="small" effect="plain" style="margin-left:8px">{{ partnerName }}</el-tag>
        <el-tag v-if="currency" size="small" effect="plain" style="margin-left:4px">{{ currency }}</el-tag>
        <el-tag size="small" style="margin-left:4px">{{ docCount }} 张订单</el-tag>
      </div>
      <div class="md-header__right">
        <el-tag v-if="!loading && !rows.length" type="info" effect="plain">无可发货明细</el-tag>
        <el-button v-if="shipRowCount > 0" type="success" :loading="shipping" @click="handleShip">
          生成销售出库草稿（{{ shipRowCount }} 行）
        </el-button>
      </div>
    </div>

    <div class="md-body">
      <div class="md-hint">
        <b>本次发货默认等于订单剩余量，不受可用库存限制。</b>
        可用库存仅供参考；可在「本次发货」列调低数量，但不能超过订单剩余。
      </div>

      <el-table
        v-loading="loading"
        :data="rows"
        size="small"
        border
        stripe
        height="100%"
        class="md-table"
        :span-method="spanSourceGroup"
      >
        <el-table-column type="index" label="序号" width="54" align="center" />
        <el-table-column label="源单号" width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="md-doc-no">{{ row.source_doc_no || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="源单日期" width="100" align="center">
          <template #default="{ row }">{{ row.source_doc_date || '-' }}</template>
        </el-table-column>
        <el-table-column label="编号" prop="item_code" width="120" show-overflow-tooltip />
        <el-table-column label="名称" prop="item_name" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="110" show-overflow-tooltip />
        <el-table-column label="单位" prop="unit" width="60" align="center" />
        <el-table-column label="仓库" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code || '-' }}</template>
        </el-table-column>
        <el-table-column label="订单数量" width="90" align="right">
          <template #default="{ row }">{{ num(row.order_qty) }}</template>
        </el-table-column>
        <el-table-column label="已下推" width="80" align="right">
          <template #default="{ row }">{{ num(row.pushed_qty) }}</template>
        </el-table-column>
        <el-table-column label="订单剩余" width="90" align="right">
          <template #default="{ row }">{{ num(row.base_remaining ?? row.remain) }}</template>
        </el-table-column>
        <el-table-column label="可用库存" width="90" align="right">
          <template #default="{ row }">
            <span :class="{ 'md-neg': (Number(row.available) || 0) < 0 }">{{ num(row.available) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本次发货" width="140" align="right">
          <template #default="{ row }">
            <el-input-number
              v-model="row.ship_qty"
              :min="0"
              :max="Number(row.base_remaining ?? row.remain) || 0"
              :precision="6"
              :controls="false"
              size="small"
              style="width:100%"
              @change="onShipChange(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="本次未发" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'md-short': unsentOf(row) > 0.000001 }">{{ num(unsentOf(row)) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="md-footer">
      <el-tag type="success" effect="plain">本次发货合计 {{ num(totalShip) }}</el-tag>
      <el-tag type="info" effect="plain">订单剩余合计 {{ num(totalRemain) }}</el-tag>
      <el-tag :type="totalUnsent > 0 ? 'danger' : 'info'" effect="plain">本次未发合计 {{ num(totalUnsent) }}</el-tag>
      <span class="md-tip" v-if="totalUnsent > 0">本次未发部分可在下次发货或进入 MRP 计算单补料</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi, type ScmStockAvailLine, type ScmDoc } from '@/api/scm'
import { scmDownstreamDocRoute } from '@/utils/scmDocNavigation'
import { mergeSalesDispatchLines } from '@/utils/scmSalesDispatch'
import { sourceFieldValues } from '@/utils/scmMultiSource'

const route = useRoute()
const router = useRouter()

type AvailLine = ScmStockAvailLine & { source_doc_no?: string; source_doc_date?: string }

const loading = ref(false)
const shipping = ref(false)
const rows = ref<AvailLine[]>([])
const docs = ref<ScmDoc[]>([])
const sourceIds = ref<string[]>([])

const num = (v: number) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '')
}
const round = (n: number) => Math.round(n * 1000000) / 1000000

const docCount = computed(() => docs.value.length)
const partnerName = computed(() => {
  const p = docs.value[0]?.partner_name || docs.value[0]?.partner_code
  return p || ''
})
const currency = computed(() => docs.value[0]?.currency || '')

/** 本次未发 = 订单剩余 − 本次发货（>0 表示有缺口） */
function unsentOf(row: AvailLine): number {
  const remain = Number(row.base_remaining ?? row.remain) || 0
  const ship = Number(row.ship_qty) || 0
  return round(Math.max(0, remain - ship))
}

/** 发货数量变更时确保非负且不超过允许上限 */
function onShipChange(row: AvailLine) {
  let v = Number(row.ship_qty) || 0
  if (v < 0) v = 0
  const max = Number(row.base_remaining ?? row.remain) || 0
  if (v > max + 0.000001) {
    v = max
    ElMessage.warning(`物料 ${row.item_code} 本次发货不能超过允许剩余 ${num(max)}`)
  }
  row.ship_qty = v
}

const totalShip = computed(() => round(rows.value.reduce((s, r) => s + (Number(r.ship_qty) || 0), 0)))
const totalRemain = computed(() => round(rows.value.reduce((s, r) => s + (Number(r.base_remaining ?? r.remain) || 0), 0)))
const totalUnsent = computed(() => round(rows.value.reduce((s, r) => s + unsentOf(r), 0)))
const shipRowCount = computed(() => rows.value.filter(r => (Number(r.ship_qty) || 0) > 0).length)

/** 行样式：库存为 0 的行整行标灰，提示用户该行默认不发 */
/**
 * 同一源单的多行连续排列时，合并「源单号 / 源单日期」单元格，便于视觉上区分多张订单。
 * 仅对相邻同源单行做合并。
 */
function spanSourceGroup({ row, columnIndex }: { row: AvailLine; columnIndex: number }) {
  if (columnIndex !== 1 && columnIndex !== 2) return undefined as any
  const idx = rows.value.indexOf(row)
  if (idx < 0) return undefined as any
  const curDoc = row.source_doc_id || ''
  if (idx === 0 || (rows.value[idx - 1].source_doc_id || '') !== curDoc) {
    // 计算从当前行起连续同源单的行数
    let span = 1
    for (let i = idx + 1; i < rows.value.length; i++) {
      if ((rows.value[i].source_doc_id || '') === curDoc) span++
      else break
    }
    return { rowspan: span, colspan: 1 }
  }
  return { rowspan: 0, colspan: 0 }
}

function goBack() {
  router.back()
}

async function load() {
  if (!sourceIds.value.length) {
    ElMessage.warning('未提供销售订单')
    return
  }
  loading.value = true
  try {
    const res = await scmApi.getBatchDocAvailability(sourceIds.value)
    if (res.code !== 0) return
    if (res.data.existing_doc) {
      const existing = res.data.existing_doc
      ElMessage.info(`选中订单已生成销售出库草稿 ${existing.doc_no}，已为你打开`)
      await router.replace(scmDownstreamDocRoute(existing.id, existing.status, undefined, 'SO'))
      return
    }
    docs.value = res.data.docs || []
    const lines = (res.data.lines || []) as AvailLine[]
    // 默认本次发货 = min(订单剩余, 可用库存)（即后端已算出的 ship_qty）
    // 后端已按订单日期先后分配共享库存池，前端无需重复计算
    rows.value = lines.map(line => {
      const remain = Number(line.base_remaining ?? line.remain) || 0
      return { ...line, ship_qty: remain }
    })
  } finally {
    loading.value = false
  }
}

async function handleShip() {
  const shipRows = rows.value.filter(r => (Number(r.ship_qty) || 0) > 0)
  if (!shipRows.length) {
    ElMessage.warning('没有可发货数量')
    return
  }
  // 超上限校验（防用户手工输入越界）
  const exceeded = shipRows.find(r => (Number(r.ship_qty) || 0) > (Number(r.base_remaining ?? r.remain) || 0) + 0.000001)
  if (exceeded) {
    ElMessage.warning(`物料 ${exceeded.item_code} 本次发货超过允许剩余`)
    return
  }
  shipping.value = true
  try {
    const rawLines = shipRows.map(r => {
      const qty = Number(r.ship_qty) || 0
      const price = Number(r.price) || 0
      const taxRate = r.tax_rate === null || r.tax_rate === undefined ? null : Number(r.tax_rate)
      return {
        item_code: r.item_code,
        item_name: r.item_name || '',
        spec: r.spec || '',
        unit: r.unit || '',
        warehouse_code: r.warehouse_code || docs.value[0]?.warehouse_code || '',
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
    let lines = rawLines
    const mergedLines = mergeSalesDispatchLines(rawLines)
    if (mergedLines.length < rawLines.length) {
      try {
        await ElMessageBox.confirm(
          `发现 ${rawLines.length - mergedLines.length} 条同物料、同仓库、同单价明细可合并。是否合并？`,
          '合并出库明细',
          { confirmButtonText: '合并生成', cancelButtonText: '分行生成', type: 'info', distinguishCancelAndClose: true },
        )
        lines = mergedLines
      } catch (action) {
        if (action === 'close') return
      }
    }
    const headerWh = docs.value[0]?.warehouse_code || shipRows[0]?.warehouse_code || ''
    const res = await scmApi.createDoc({
      doc_type: 'SO',
      // 多源头场景：表头 source_doc_id 留空，靠行级 source_line_id 溯源
      partner_code: docs.value[0]?.partner_code || '',
      warehouse_code: headerWh,
      currency: docs.value[0]?.currency || '',
      exchange_rate: Number(docs.value[0]?.exchange_rate) || undefined,
      field_values: { external_order_no: sourceFieldValues(docs.value, 'external_order_no') },
      lines,
    } as any)
    if (res.code === 0) {
      ElMessage.success(`已生成销售出库草稿 ${res.data.doc_no}，请复核后审核发货`)
      router.push(scmDownstreamDocRoute(res.data.id, 'draft'))
    }
  } finally {
    shipping.value = false
  }
}

onMounted(() => {
  const raw = route.query.source_doc_ids
  const ids = (Array.isArray(raw) ? raw.join(',') : String(raw || ''))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  sourceIds.value = ids
  load()
})
</script>

<style scoped>
.md-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.md-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.md-header__left { display: flex; align-items: center; flex-wrap: wrap; }
.md-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.md-header__title { font-size: 15px; font-weight: 600; }
.md-header__right { display: flex; align-items: center; gap: 8px; }
.md-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px 0; }
.md-hint {
  font-size: 13px; color: var(--el-text-color-secondary);
  margin-bottom: 10px; line-height: 1.7;
  padding: 8px 12px; background: var(--el-fill-color-light); border-radius: 4px;
}
.md-table { flex: 1; min-height: 0; }
.md-footer {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; border-top: 1px solid var(--el-border-color-lighter);
}
.md-tip { margin-left: auto; font-size: 13px; color: var(--el-text-color-secondary); }
.md-short { color: var(--el-color-danger); font-weight: 600; }
.md-neg { color: var(--el-color-danger); }
.md-doc-no { font-family: var(--el-font-family-mono, monospace); font-size: 12px; }
</style>
