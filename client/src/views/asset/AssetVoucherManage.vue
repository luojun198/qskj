<template>
  <div class="page avm-page">
    <!-- 顶部导航 -->
    <div class="avm-header">
      <div class="avm-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="avm-header__sep">/</span>
        <span class="avm-header__title">凭证管理</span>
        <el-tag v-if="stat.missing" type="warning" size="small" effect="plain" style="margin-left: 8px">
          未生成 {{ stat.missing }}
        </el-tag>
      </div>
      <div class="avm-header__right">
        <el-button plain :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="avm-body">
      <el-alert type="info" :closable="false" show-icon class="avm-rules">
        <template #title>使用说明</template>
        固定资产生成的凭证在总账里不能直接修改。凭证有错时，在这里<b>删除凭证</b>（业务记录、卡片、折旧数据都保留），
        改好科目 / 日期后点<b>重新生成</b>。已<b>记账</b>的凭证须先到总账「取消记账」；所属期间<b>已结账</b>的不能删除或生成。
      </el-alert>

      <div class="avm-filters">
        <el-select v-model="filters.kind" placeholder="凭证类型" clearable style="width: 150px" @change="reload">
          <el-option v-for="(name, code) in ASSET_VOUCHER_KIND_LABELS" :key="code" :label="name" :value="code" />
        </el-select>
        <el-date-picker
          v-model="period"
          type="month"
          value-format="YYYY-MM"
          placeholder="所属期间"
          clearable
          style="width: 150px"
          @change="reload"
        />
        <el-select v-model="filters.status" placeholder="凭证状态" clearable style="width: 130px" @change="reload">
          <el-option label="已生成" value="generated" />
          <el-option label="未生成" value="missing" />
        </el-select>
        <el-input
          v-model="filters.keyword"
          placeholder="资产编号 / 名称 / 凭证号"
          clearable
          style="width: 220px"
          :prefix-icon="Search"
          @keyup.enter="reload"
          @clear="reload"
        />
        <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" size="small" border stripe empty-text="暂无符合条件的记录" class="avm-table">
        <el-table-column label="类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ ASSET_VOUCHER_KIND_LABELS[row.kind as AssetVoucherKind] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="业务" prop="title" min-width="240" show-overflow-tooltip />
        <el-table-column label="期间" width="90" align="center">
          <template #default="{ row }">{{ periodText(row) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">
            <template v-if="row.amount != null">{{ fmtAmt(row.amount) }}</template>
            <span v-else class="avm-muted">{{ row.summary || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="凭证" min-width="190">
          <template #default="{ row }">
            <template v-if="row.hasVoucher">
              <el-button link type="primary" size="small" @click="openVoucher(row)">{{ row.voucherNo }}</el-button>
              <el-tag size="small" effect="plain" :type="row.voucherStatus === 'posted' ? 'warning' : 'success'" style="margin-left: 6px">
                {{ VOUCHER_STATUS_LABELS[row.voucherStatus || 'draft'] }}
              </el-tag>
            </template>
            <el-tag v-else type="info" size="small" effect="plain">未生成</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.hasVoucher && row.deleteBlockReason" class="avm-blocked">{{ row.deleteBlockReason }}</span>
            <span v-else-if="!row.hasVoucher && row.regenerateBlockReason" class="avm-blocked">{{ row.regenerateBlockReason }}</span>
            <span v-else class="avm-ok">{{ row.hasVoucher ? '可删除后重新生成' : '可重新生成' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <template v-if="row.hasVoucher">
              <el-tooltip :content="row.deleteBlockReason || ''" :disabled="!row.deleteBlockReason" placement="top">
                <span>
                  <el-button
                    link
                    type="danger"
                    size="small"
                    :disabled="!!row.deleteBlockReason"
                    :loading="acting === rowKey(row)"
                    @click="handleDelete(row)"
                  >删除凭证</el-button>
                </span>
              </el-tooltip>
            </template>
            <template v-else>
              <el-tooltip :content="row.regenerateBlockReason || ''" :disabled="!row.regenerateBlockReason" placement="top">
                <span>
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :disabled="!!row.regenerateBlockReason"
                    @click="goRegenerate(row)"
                  >重新生成</el-button>
                </span>
              </el-tooltip>
            </template>
          </template>
        </el-table-column>
      </el-table>

      <div class="avm-footer">
        <el-pagination
          v-model:current-page="filters.page"
          v-model:page-size="filters.page_size"
          :total="total"
          :page-sizes="[50, 100, 200]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="reload"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh, Search } from '@element-plus/icons-vue'
import {
  fixedAssetApi,
  ASSET_VOUCHER_KIND_LABELS,
  type AssetVoucherKind,
  type AssetVoucherRow,
} from '@/api/fixedAsset'
import { confirmRenumberAfterDelete } from '@/composables/useRenumberPrompt'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { VOUCHER_STATUS_LABELS } from './deprHistory'

const router = useRouter()

const loading = ref(false)
const acting = ref('')
const rows = ref<AssetVoucherRow[]>([])
const total = ref(0)
const period = ref<string>('')

const filters = reactive({
  kind: '' as AssetVoucherKind | '',
  status: '' as 'generated' | 'missing' | '',
  keyword: '',
  page: 1,
  page_size: 50,
})

// 头部「未生成」计数：仅在无筛选时用当前结果统计，避免额外请求
const stat = computed(() => ({
  missing: rows.value.filter(r => !r.hasVoucher).length,
}))

const fmtAmt = (v: number) =>
  (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const rowKey = (r: AssetVoucherRow) => `${r.kind}:${r.refId}`

function periodText(r: AssetVoucherRow) {
  return r.year && r.period ? `${r.year}-${String(r.period).padStart(2, '0')}` : '-'
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/asset/list')
}

async function load() {
  loading.value = true
  try {
    const [y, m] = period.value ? period.value.split('-').map(Number) : [undefined, undefined]
    const res = await fixedAssetApi.listAssetVouchers({
      kind: filters.kind || undefined,
      status: filters.status || undefined,
      keyword: filters.keyword.trim() || undefined,
      year: y,
      month: m,
      page: filters.page,
      page_size: filters.page_size,
    })
    if (res.code === 0) {
      rows.value = res.data.list
      total.value = res.data.total
    }
  } finally {
    loading.value = false
  }
}

function reload() {
  filters.page = 1
  return load()
}

function openVoucher(row: AssetVoucherRow) {
  router.push({ path: '/voucher/query', query: { voucher_id: row.voucherId } })
}

function goRegenerate(row: AssetVoucherRow) {
  router.push({ path: '/asset/vouchers/regenerate', query: { kind: row.kind, ref: row.refId } })
}

async function handleDelete(row: AssetVoucherRow) {
  if (row.deleteBlockReason) return ElMessage.warning(row.deleteBlockReason)
  const audited = row.voucherStatus === 'audited'
  await ElMessageBox.confirm(
    `确认删除凭证「${row.voucherNo}」？业务记录（${row.title}）会保留并回到「未生成」，之后可在此重新生成。` +
      (audited ? '该凭证已审核，删除后需重新审核新生成的凭证。' : ''),
    '删除凭证',
    { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' }
  )
  acting.value = rowKey(row)
  try {
    const res = await fixedAssetApi.deleteAssetVoucher({ kind: row.kind, ref_id: row.refId })
    if (res.code === 0) {
      ElMessage.success(`已删除凭证 ${res.data.voucherNo || row.voucherNo}，可重新生成`)
      await load()
      await confirmRenumberAfterDelete(res.data.affectedGroups, res.data.voucherNo ? 1 : 0)
    }
  } finally {
    acting.value = ''
  }
}

onMounted(load)
useReloadOnActivated(load)
</script>

<style scoped>
.avm-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.avm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.avm-header__left { display: flex; align-items: center; }
.avm-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.avm-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.avm-header__right { display: flex; align-items: center; gap: 8px; }
.avm-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; padding: var(--block-gap) 0 0; }
.avm-rules { margin-bottom: 12px; line-height: 1.6; }
.avm-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.avm-table { flex-shrink: 0; }
.avm-footer { display: flex; justify-content: flex-end; padding: 10px 0; }
.avm-blocked { color: var(--el-color-warning); }
.avm-ok { color: var(--el-color-success); }
.avm-muted { color: var(--el-text-color-secondary); }
</style>
