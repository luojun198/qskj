<template>
  <div class="page avr-page">
    <!-- 顶部导航 -->
    <div class="avr-header">
      <div class="avr-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="avr-header__sep">/</span>
        <span class="avr-header__title">重新生成凭证</span>
        <el-tag v-if="kind" size="small" style="margin-left: 8px">{{ ASSET_VOUCHER_KIND_LABELS[kind] }}</el-tag>
      </div>
      <div class="avr-header__right">
        <el-button plain @click="goBack">取消</el-button>
        <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
          <el-icon><DocumentAdd /></el-icon>生成凭证
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="avr-body">
      <el-empty v-if="!loading && !row" description="未找到该业务记录，或参数不完整" />

      <template v-else-if="row">
        <el-alert v-if="row.hasVoucher" type="warning" :closable="false" show-icon class="avr-tip">
          该业务已有凭证 {{ row.voucherNo }}，请先在「凭证管理」删除后再重新生成。
        </el-alert>
        <el-alert v-else-if="row.regenerateBlockReason" type="warning" :closable="false" show-icon class="avr-tip">
          {{ row.regenerateBlockReason }}
        </el-alert>

        <div class="avr-section-title">业务信息</div>
        <el-descriptions :column="3" border size="small" class="avr-desc">
          <el-descriptions-item label="业务" :span="3">{{ row.title }}</el-descriptions-item>
          <el-descriptions-item label="所属期间">
            {{ row.year && row.period ? `${row.year}年${row.period}月` : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="金额">
            {{ row.amount != null ? fmtAmt(row.amount) : row.summary || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="凭证日期">沿用业务日期，期间不变</el-descriptions-item>
        </el-descriptions>

        <div class="avr-section-title">凭证参数</div>
        <el-form label-width="120px" class="avr-form" @submit.prevent>
          <!-- 购置 -->
          <template v-if="kind === 'purchase'">
            <el-form-item label="借方">固定资产（按资产类别配置的原值科目）</el-form-item>
            <el-form-item label="贷方（资金）">
              <AccountSelect v-model="form.credit_account" placeholder="默认 1001 银行存款" search-keyword="银行存款" />
            </el-form-item>
            <el-form-item label="说明">
              <span class="avr-hint">金额取资产卡片当前原值。如原值有误，请先在资产卡片修正（购置凭证删除后卡片原值不再锁定）。</span>
            </el-form-item>
          </template>

          <!-- 折旧 -->
          <template v-else-if="kind === 'depr'">
            <el-form-item label="累计折旧科目">
              <AccountSelect v-model="form.accum_account" placeholder="默认 1602 累计折旧" search-keyword="累计折旧" />
            </el-form-item>
            <el-form-item label="说明">
              <span class="avr-hint">按该期已保存的折旧明细重新合并生成一张凭证，折旧费用科目取资产用途 / 类别配置。</span>
            </el-form-item>
          </template>

          <!-- 变动 / 减值 -->
          <template v-else-if="kind === 'change'">
            <el-form-item v-if="needCounter" label="对方科目" required>
              <AccountSelect v-model="form.counter_account" placeholder="如 在建工程 / 银行存款" />
            </el-form-item>
            <el-form-item v-else label="说明">
              <span class="avr-hint">减值凭证：借 资产减值损失 / 贷 类别配置的减值准备科目，无需填写对方科目。</span>
            </el-form-item>
          </template>

          <!-- 处置 -->
          <template v-else-if="kind === 'disposal'">
            <el-form-item label="处置收入">
              <el-input-number v-model="form.disposal_income" :min="0" :precision="2" :controls="false" style="width: 200px" />
            </el-form-item>
            <el-form-item label="处置费用">
              <el-input-number v-model="form.disposal_expense" :min="0" :precision="2" :controls="false" style="width: 200px" />
            </el-form-item>
            <el-form-item label="说明">
              <span class="avr-hint">处置收入 / 费用不在业务记录里保存，请按实际重新填写；原值、累计折旧、净值取卡片处置时的数据。</span>
            </el-form-item>
          </template>

          <!-- 盘点 -->
          <template v-else-if="kind === 'inventory'">
            <el-form-item label="盘盈对应科目">
              <AccountSelect v-model="form.surplus_account" placeholder="缺省取资产参数，回退 6901" />
            </el-form-item>
            <el-form-item label="盘亏对应科目">
              <AccountSelect v-model="form.deficit_account" placeholder="缺省取资产参数，回退 1901" />
            </el-form-item>
            <el-form-item label="累计折旧科目">
              <AccountSelect v-model="form.accum_account" placeholder="默认 1602 累计折旧" search-keyword="累计折旧" />
            </el-form-item>
            <el-form-item label="说明">
              <span class="avr-hint">按盘点完成时保存的账面快照重新生成盘盈 / 盘亏调整凭证，卡片处置结果不受影响。</span>
            </el-form-item>
          </template>
        </el-form>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, DocumentAdd } from '@element-plus/icons-vue'
import AccountSelect from '@/components/base/AccountSelect.vue'
import {
  fixedAssetApi,
  ASSET_VOUCHER_KIND_LABELS,
  type AssetVoucherKind,
  type AssetVoucherRow,
} from '@/api/fixedAsset'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const submitting = ref(false)
const row = ref<AssetVoucherRow | null>(null)

const kind = computed(() => {
  const k = String(route.query.kind || '')
  return (k in ASSET_VOUCHER_KIND_LABELS ? k : '') as AssetVoucherKind | ''
})
const refId = computed(() => String(route.query.ref || ''))

const form = reactive({
  credit_account: '',
  counter_account: '',
  accum_account: '',
  surplus_account: '',
  deficit_account: '',
  disposal_income: 0,
  disposal_expense: 0,
})

const needCounter = computed(() => row.value?.changeKind !== 'impairment')
const canSubmit = computed(() => {
  if (!row.value || row.value.hasVoucher || row.value.regenerateBlockReason) return false
  if (kind.value === 'change' && needCounter.value && !form.counter_account) return false
  return true
})

const fmtAmt = (v: number) =>
  (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/asset/vouchers')
}

async function load() {
  if (!kind.value || !refId.value) return
  loading.value = true
  try {
    const res = await fixedAssetApi.listAssetVouchers({ kind: kind.value, ref_id: refId.value, page_size: 5 })
    if (res.code === 0) row.value = res.data.list[0] ?? null
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!kind.value || !canSubmit.value) return
  submitting.value = true
  try {
    const res = await fixedAssetApi.regenerateAssetVoucher({
      kind: kind.value,
      ref_id: refId.value,
      credit_account: form.credit_account || undefined,
      counter_account: form.counter_account || undefined,
      accum_account: form.accum_account || undefined,
      surplus_account: form.surplus_account || undefined,
      deficit_account: form.deficit_account || undefined,
      disposal_income: kind.value === 'disposal' ? form.disposal_income : undefined,
      disposal_expense: kind.value === 'disposal' ? form.disposal_expense : undefined,
    })
    if (res.code === 0) {
      ElMessage.success(`已生成凭证 ${res.data.voucherNo}`)
      router.replace('/asset/vouchers')
    }
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.avr-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.avr-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.avr-header__left { display: flex; align-items: center; }
.avr-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.avr-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.avr-header__right { display: flex; align-items: center; gap: 8px; }
.avr-body { flex: 1; min-height: 0; overflow: auto; padding: var(--block-gap) 16px 16px; }
.avr-tip { margin-bottom: 12px; }
.avr-section-title {
  font-size: var(--cw-text-base); font-weight: 600; color: var(--el-text-color-primary); margin: 4px 0 8px;
}
.avr-desc { margin-bottom: 16px; }
.avr-form { max-width: 720px; }
.avr-hint { color: var(--el-text-color-secondary); line-height: 1.6; }
</style>
