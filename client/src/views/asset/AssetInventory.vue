<template>
  <div class="page page-asset-inventory">
    
    <!-- 盘点列表 / 盘点详情 -->
    <template v-if="!currentInventory">
      <div class="list-toolbar" style="padding: 0 16px 8px">
        <el-button type="primary" size="small" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>新建盘点
        </el-button>
        <el-button plain size="small" :loading="loading" @click="loadList">
          <el-icon><Refresh /></el-icon>刷新
        </el-button>
      </div>
      <el-table ref="tableRef" :data="inventories" size="small" border stripe highlight-current-row
        @row-click="openInventory" style="cursor:pointer" @header-dragend="onDragEnd">
        <el-table-column label="盘点名称" prop="name" min-width="160" :width="widths.name" />
        <el-table-column label="盘点日期" prop="inventory_date" :width="cw('inventory_date', 110)" />
        <el-table-column label="状态" column-key="status" :width="cw('status', 100)" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="资产总数" prop="total_count" :width="cw('total_count', 90)" align="center" />
        <el-table-column label="正常" prop="match_count" :width="cw('match_count', 70)" align="center" />
        <el-table-column label="盘盈" prop="surplus_count" :width="cw('surplus_count', 70)" align="center">
          <template #default="{ row }">
            <span :class="row.surplus_count > 0 ? 'incr' : ''">{{ row.surplus_count }}</span>
          </template>
        </el-table-column>
        <el-table-column label="盘亏" prop="deficit_count" :width="cw('deficit_count', 70)" align="center">
          <template #default="{ row }">
            <span :class="row.deficit_count > 0 ? 'decr' : ''">{{ row.deficit_count }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" prop="created_at" :width="cw('created_at', 160)" />
        <el-table-column label="操作" column-key="操作" :width="cw('操作', 80)" align="center">
          <template #default="{ row }">
            <el-button v-permission="'asset:inventory'" link type="danger" size="small" @click.stop="handleDeleteInventory(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!inventories.length" description="暂无盘点记录" />
    </template>

    <!-- 盘点详情 -->
    <template v-else>
      <div class="detail-header">
        <el-button @click="currentInventory = null" text><el-icon><ArrowLeft /></el-icon>返回列表</el-button>
        <div class="detail-info">
          <b>{{ currentInventory.name }}</b>
          <span>日期：{{ currentInventory.inventory_date }}</span>
          <el-tag :type="statusTag(currentInventory.status)" size="small">{{ statusLabel(currentInventory.status) }}</el-tag>
        </div>
        <div class="detail-actions" v-if="currentInventory.status !== 'completed'">
          <el-button v-permission="'asset:inventory'" type="success" size="small" @click="batchMark('normal')">
            <el-icon><Select /></el-icon>全部正常
          </el-button>
          <el-button v-permission="'asset:inventory'" type="primary" size="small" :loading="completing" @click="handleComplete">
            <el-icon><Check /></el-icon>完成盘点
          </el-button>
        </div>
      </div>

      <div class="inventory-stats" v-if="inventoryItems.length">
        <span>共 {{ inventoryItems.length }} 项</span>
        <el-divider direction="vertical" />
        <span class="match">正常：{{ matchCount }}</span>
        <span class="surplus">盘盈：{{ surplusCount }}</span>
        <span class="deficit">盘亏：{{ deficitCount }}</span>
      </div>

      <el-table :data="inventoryItems" size="small" border stripe max-height="400">
        <el-table-column label="资产编号" prop="asset_no" width="110" />
        <el-table-column label="资产名称" prop="asset_name" min-width="140" show-overflow-tooltip />
        <el-table-column label="类别" prop="category_name" width="90" />
        <el-table-column label="使用部门" prop="dept_name" width="90" />
        <el-table-column label="账面原值" width="110" align="right">
          <template #default="{ row }">{{ fmtAmt(row.book_original_value) }}</template>
        </el-table-column>
        <el-table-column label="账面净值" width="110" align="right">
          <template #default="{ row }">{{ fmtAmt(row.book_net_value) }}</template>
        </el-table-column>
        <el-table-column label="实盘数量" width="100" align="center">
          <template #default="{ row }">
            <el-input-number
              v-if="currentInventory.status !== 'completed'"
              v-model="row.actual_qty"
              :min="0"
              size="small"
              style="width:80px"
              @change="handleItemChange(row)"
            />
            <span v-else>{{ row.actual_qty }}</span>
          </template>
        </el-table-column>
        <el-table-column label="实盘状态" width="110" align="center">
          <template #default="{ row }">
            <el-select
              v-if="currentInventory.status !== 'completed'"
              v-model="row.actual_status"
              size="small"
              style="width:90px"
              @change="handleItemChange(row)"
            >
              <el-option label="正常" value="normal" />
              <el-option label="盘盈" value="surplus" />
              <el-option label="盘亏" value="deficit" />
              <el-option label="损毁" value="damaged" />
            </el-select>
            <el-tag v-else :type="itemStatusTag(row.actual_status)" size="small">
              {{ itemStatusLabel(row.actual_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="差异" width="60" align="center">
          <template #default="{ row }">
            <span v-if="row.actual_qty !== row.book_qty" :class="row.actual_qty > row.book_qty ? 'incr' : 'decr'">
              {{ row.actual_qty > row.book_qty ? '+' : '' }}{{ row.actual_qty - row.book_qty }}
            </span>
            <span v-else class="zero">0</span>
          </template>
        </el-table-column>
        <el-table-column label="差异说明" width="120">
          <template #default="{ row }">
            <el-input
              v-if="currentInventory.status !== 'completed'"
              v-model="row.difference_note"
              size="small"
              placeholder="备注"
              @change="handleItemChange(row)"
            />
            <span v-else>{{ row.difference_note || '-' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 新建盘点弹窗 -->
    <el-dialog v-model="createVisible" title="新建盘点" width="460px" draggable>
      <el-form :model="createForm" label-width="90px" size="small">
        <el-form-item label="盘点名称" required>
          <el-input v-model="createForm.name" placeholder="如 2026年半年度盘点" />
        </el-form-item>
        <el-form-item label="盘点日期" required>
          <el-date-picker v-model="createForm.inventory_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="生成凭证">
          <el-switch v-model="createForm.generate_voucher" />
          <span class="tip-text">完成后自动生成盘盈盘亏凭证</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建并开始盘点</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, ArrowLeft, Select, Check } from '@element-plus/icons-vue'
import { fixedAssetApi, type InventorySummary, type InventoryItem } from '@/api/fixedAsset'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('asset_inventory_list')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const fmtAmt = (v: number) =>
  v == null || v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statusTag = (s: string): any => ({ draft: 'info', in_progress: 'warning', completed: 'success' }[s] || 'info')
const statusLabel = (s: string) => ({ draft: '草稿', in_progress: '盘点中', completed: '已完成' }[s] || s)
const itemStatusTag = (s: string): any => ({ normal: 'success', surplus: 'warning', deficit: 'danger', damaged: 'danger' }[s] || 'info')
const itemStatusLabel = (s: string) => ({ normal: '正常', surplus: '盘盈', deficit: '盘亏', damaged: '损毁' }[s] || s)

// ── 盘点列表 ──────────────────────────────────────────
const inventories = ref<InventorySummary[]>([])
const loading = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const createForm = ref({ name: '', inventory_date: '', remark: '', generate_voucher: false })

async function loadList() {
  loading.value = true
  try {
    const res = await fixedAssetApi.getInventories()
    if (res.code === 0) inventories.value = res.data
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  createForm.value = { name: '', inventory_date: new Date().toISOString().slice(0, 10), remark: '', generate_voucher: false }
  createVisible.value = true
}

async function handleCreate() {
  if (!createForm.value.name || !createForm.value.inventory_date) return ElMessage.warning('请填写盘点名称和日期')
  creating.value = true
  try {
    const res = await fixedAssetApi.createInventory(createForm.value)
    if (res.code === 0) {
      createVisible.value = false
      ElMessage.success('盘点已创建')
      await loadList()
      // 自动打开新盘点
      await openInventory({ id: res.data.id } as any)
    }
  } finally {
    creating.value = false
  }
}

async function handleDeleteInventory(row: InventorySummary) {
  await ElMessageBox.confirm(`确认删除盘点「${row.name}」？`, '提示', { type: 'warning' })
  await fixedAssetApi.deleteInventory(row.id)
  ElMessage.success('已删除')
  loadList()
}

// ── 盘点详情 ──────────────────────────────────────────
const currentInventory = ref<InventorySummary | null>(null)
const inventoryItems = ref<InventoryItem[]>([])
const completing = ref(false)

const matchCount = computed(() => inventoryItems.value.filter(i => i.actual_status === 'normal').length)
const surplusCount = computed(() => inventoryItems.value.filter(i => i.actual_status === 'surplus').length)
// 「损毁」按盘亏口径处理（后端同样并入盘亏统计与核销）
const deficitCount = computed(() => inventoryItems.value.filter(i => i.actual_status === 'deficit' || i.actual_status === 'damaged').length)

/** 实盘状态与数量差必须匹配（与后端 statusQtyMismatch 同规则），否则部分盘亏会被整卡核销 */
function statusQtyMismatch(status: string, bookQty: number, actualQty: number): string | null {
  const diff = actualQty - bookQty
  if (status === 'surplus' && diff <= 0) return '标记为盘盈时实盘数量必须大于账面数量'
  if (status === 'deficit' && diff >= 0) return '标记为盘亏时实盘数量必须小于账面数量'
  if (status === 'normal' && diff !== 0) return '实盘数量与账面不一致时不能标记为正常'
  if (status === 'damaged' && diff > 0) return '标记为损毁时实盘数量不能大于账面数量'
  return null
}

async function openInventory(row: InventorySummary) {
  const res = await fixedAssetApi.getInventoryDetail(row.id)
  if (res.code === 0) {
    currentInventory.value = res.data.inventory
    inventoryItems.value = res.data.items
  }
}

async function handleItemChange(item: InventoryItem) {
  const mismatch = statusQtyMismatch(item.actual_status, Number(item.book_qty || 0), Number(item.actual_qty ?? 0))
  if (mismatch) {
    ElMessage.warning(`${item.asset_name}：${mismatch}`)
    return
  }
  await fixedAssetApi.updateInventoryItem(item.id, {
    actual_qty: item.actual_qty,
    actual_status: item.actual_status,
    difference_note: item.difference_note || undefined,
  })
}

async function batchMark(status: string) {
  const ids = inventoryItems.value.map(i => i.id)
  if (!ids.length) return
  await fixedAssetApi.batchMarkItems(currentInventory.value!.id, { item_ids: ids, actual_status: status })
  ElMessage.success('已批量标记')
  // 刷新
  await openInventory(currentInventory.value!)
}

async function handleComplete() {
  const unchecked = inventoryItems.value.filter(i => i.actual_status === 'normal' && i.actual_qty === 0)
  if (unchecked.length) {
    return ElMessage.warning(`还有 ${unchecked.length} 项未录入实盘数据，请先标记或录入`)
  }
  await ElMessageBox.confirm(
    `确认完成盘点？正常 ${matchCount.value} 项、盘盈 ${surplusCount.value} 项、盘亏 ${deficitCount.value} 项`,
    '完成盘点', { type: 'warning' }
  )
  completing.value = true
  try {
    const res = await fixedAssetApi.completeInventory(currentInventory.value!.id, {
      generate_voucher: createForm.value.generate_voucher,
    })
    if (res.code === 0) {
      ElMessage.success('盘点完成')
      if (res.data.voucher) {
        ElMessage.success(`已生成盘点调整凭证 ${res.data.voucher.voucherNo || ''}`)
      }
      await openInventory(currentInventory.value!)
    }
  } finally {
    completing.value = false
  }
}

onMounted(loadList)
</script>

<style scoped>
.page-asset-inventory { display: flex; flex-direction: column; height: 100%; }
.detail-header { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.detail-info { display: flex; align-items: center; gap: 10px; flex: 1; font-size: var(--cw-text-base); }
.detail-actions { display: flex; gap: 8px; }
.inventory-stats { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: var(--cw-text-base); }
.match { color: #67c23a; }
.surplus { color: #e6a23c; }
.deficit { color: #f56c6c; }
.incr { color: #67c23a; font-weight: 600; }
.decr { color: #f56c6c; font-weight: 600; }
.zero { color: var(--el-text-color-placeholder); }
.tip-text { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
