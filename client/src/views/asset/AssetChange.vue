<template>
  <div class="page page-asset-change">
    <header class="change-header">
      <div class="change-header__left">
        <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
        <h3>资产变动</h3>
        <span v-if="asset" class="change-header__asset">
          {{ asset.asset_no }} · {{ asset.asset_name }}
        </span>
      </div>
      <div class="change-header__right">
        <el-button @click="router.push('/asset/change/list')">变动记录</el-button>
      </div>
    </header>

    <!-- 资产选择 -->
    <section class="picker-row">
      <span class="picker-label">选择资产</span>
      <el-select
        v-model="assetId"
        filterable
        remote
        clearable
        placeholder="按编号或名称搜索资产"
        :remote-method="searchAssets"
        :loading="assetLoading"
        style="width: 360px"
        @change="onAssetChange"
      >
        <el-option
          v-for="a in assetOptions"
          :key="a.id"
          :label="`${a.asset_no} ${a.asset_name}`"
          :value="a.id"
        />
      </el-select>
    </section>

    <div v-if="!asset" class="empty-hint">
      <el-empty description="请先选择要办理变动的资产" />
    </div>

    <div v-else class="change-body">
      <!-- 左：资产现状 + 变动表单 -->
      <div class="change-main">
        <el-descriptions :column="4" border size="small" class="asset-brief">
          <el-descriptions-item label="资产类别">{{
            asset.category_name || '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="使用部门">{{ asset.dept_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="使用状态">{{
            asset.status_name || '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="折旧方法">
            {{ DEPR_METHODS[asset.depr_method ?? ''] || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="原值"
            >¥{{ fmtAmt(asset.original_value) }}</el-descriptions-item
          >
          <el-descriptions-item label="累计折旧"
            >¥{{ fmtAmt(asset.accum_depr) }}</el-descriptions-item
          >
          <el-descriptions-item label="净值">
            <b>¥{{ fmtAmt(asset.net_value) }}</b>
          </el-descriptions-item>
          <el-descriptions-item label="已提 / 使用月数">
            {{ asset.depr_months_done }} / {{ asset.use_months ?? '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="asset.scrap_date"
          type="warning"
          show-icon
          :closable="false"
          title="该资产已处置，无法登记变动。如需修改请先在资产卡片中撤销处置。"
          class="scrap-alert"
        />

        <el-tabs v-else v-model="activeKind" class="kind-tabs">
          <el-tab-pane label="原值变动" name="original_value" />
          <el-tab-pane label="部门调拨" name="dept" />
          <el-tab-pane label="使用状态" name="status" />
          <el-tab-pane label="折旧要素" name="depr_factor" />
          <el-tab-pane label="计提减值" name="impairment" />
          <el-tab-pane label="大修改良" name="improvement" />
          <el-tab-pane label="资产拆分" name="split" />
        </el-tabs>

        <div v-if="!asset.scrap_date" class="form-area">
          <el-form :model="form" label-width="120px" size="default">
            <el-form-item label="变动日期" required>
              <el-date-picker
                v-model="form.change_date"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择变动日期"
                style="width: 220px"
                :disabled-date="disableFutureMonth"
              />
            </el-form-item>

            <!-- 原值变动 / 大修改良 -->
            <template v-if="activeKind === 'original_value' || activeKind === 'improvement'">
              <el-form-item
                :label="activeKind === 'improvement' ? '改良支出' : '变动金额'"
                required
              >
                <el-input-number
                  v-model="form.amount"
                  :precision="2"
                  :step="1000"
                  :controls="false"
                  style="width: 220px"
                />
                <span class="field-tip">
                  {{
                    activeKind === 'improvement'
                      ? '资本化支出，计入原值'
                      : '正数为原值增加，负数为原值减少'
                  }}
                </span>
              </el-form-item>
              <el-form-item v-if="activeKind === 'improvement'" label="调整后使用月数">
                <el-input-number
                  v-model="form.use_months"
                  :min="1"
                  :precision="0"
                  :controls="false"
                  style="width: 220px"
                />
                <span class="field-tip"
                  >留空表示不延长年限；须大于已提月数 {{ asset.depr_months_done }}</span
                >
              </el-form-item>
              <el-form-item v-if="activeKind === 'original_value'" label="调整后残值率">
                <el-input-number
                  v-model="form.salvage_rate"
                  :precision="4"
                  :step="0.01"
                  :min="0"
                  :max="0.9999"
                  :controls="false"
                  style="width: 220px"
                />
                <span class="field-tip">留空沿用当前残值率 {{ asset.salvage_rate }}</span>
              </el-form-item>
              <el-form-item label="增减方式">
                <el-select v-model="form.change_type_code" clearable style="width: 220px">
                  <el-option
                    v-for="t in changeTypes"
                    :key="t.code"
                    :label="t.name"
                    :value="t.code"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="生成凭证">
                <el-switch v-model="form.generate_voucher" />
              </el-form-item>
              <el-form-item v-if="form.generate_voucher" label="对方科目" required>
                <div style="width: 320px">
                  <AccountSelect
                    v-model="form.counter_account"
                    :placeholder="
                      activeKind === 'improvement' ? '如 1604 在建工程' : '如 1001 银行存款'
                    "
                  />
                </div>
              </el-form-item>
              <el-form-item v-if="form.generate_voucher" label=" ">
                <span class="voucher-preview">
                  {{ voucherPreview }}
                </span>
              </el-form-item>
            </template>

            <!-- 部门调拨 -->
            <template v-else-if="activeKind === 'dept'">
              <el-form-item label="调入部门" required>
                <el-select v-model="form.dept_code" style="width: 220px" placeholder="选择调入部门">
                  <el-option
                    v-for="d in dicts?.dept || []"
                    :key="d.code"
                    :label="`${d.code} ${d.name}`"
                    :value="d.code"
                    :disabled="d.code === asset.dept_code"
                  />
                </el-select>
                <span class="field-tip">当前：{{ asset.dept_name || '（无）' }}</span>
              </el-form-item>
              <el-form-item label="使用人">
                <el-input
                  v-model="form.user_name"
                  style="width: 220px"
                  placeholder="留空保持不变"
                />
              </el-form-item>
              <el-form-item label="保管人">
                <el-input v-model="form.keeper" style="width: 220px" placeholder="留空保持不变" />
              </el-form-item>
              <el-form-item label="存放地点">
                <el-input
                  v-model="form.install_place"
                  style="width: 320px"
                  placeholder="留空保持不变"
                />
              </el-form-item>
            </template>

            <!-- 使用状态 -->
            <template v-else-if="activeKind === 'status'">
              <el-form-item label="变更为" required>
                <el-select
                  v-model="form.status_code"
                  style="width: 260px"
                  placeholder="选择新的使用状态"
                >
                  <el-option
                    v-for="s in selectableStatuses"
                    :key="s.code"
                    :label="`${s.name}${s.depreciable ? '' : '（不计提折旧）'}`"
                    :value="s.code"
                    :disabled="s.code === asset.status_code"
                  />
                </el-select>
                <span class="field-tip">当前：{{ asset.status_name || '（无）' }}</span>
              </el-form-item>
              <el-alert
                type="info"
                :closable="false"
                show-icon
                title="切换到「不计提折旧」的状态后，该资产从下期起停止计提；报废请走「资产处置」以生成清理凭证。"
              />
            </template>

            <!-- 折旧要素 -->
            <template v-else-if="activeKind === 'depr_factor'">
              <el-form-item label="折旧方法">
                <el-select
                  v-model="form.depr_method"
                  clearable
                  style="width: 220px"
                  placeholder="留空不调整"
                >
                  <el-option
                    v-for="(name, code) in DEPR_METHODS"
                    :key="code"
                    :label="name"
                    :value="code"
                  />
                </el-select>
                <span class="field-tip"
                  >当前：{{ DEPR_METHODS[asset.depr_method ?? ''] || '-' }}</span
                >
              </el-form-item>
              <el-form-item label="使用月数">
                <el-input-number
                  v-model="form.use_months"
                  :min="1"
                  :precision="0"
                  :controls="false"
                  style="width: 220px"
                />
                <span class="field-tip"
                  >当前 {{ asset.use_months ?? '-' }}，须大于已提 {{ asset.depr_months_done }}</span
                >
              </el-form-item>
              <el-form-item label="残值率">
                <el-input-number
                  v-model="form.salvage_rate"
                  :precision="4"
                  :step="0.01"
                  :min="0"
                  :max="0.9999"
                  :controls="false"
                  style="width: 220px"
                />
                <span class="field-tip">当前 {{ asset.salvage_rate }}</span>
              </el-form-item>
              <el-form-item v-if="asset.depr_method === '2'" label="总工作量">
                <el-input-number
                  v-model="form.total_workload"
                  :min="0"
                  :precision="2"
                  :controls="false"
                  style="width: 220px"
                />
                <span class="field-tip">当前 {{ asset.total_workload ?? '-' }}</span>
              </el-form-item>
              <el-alert
                type="info"
                :closable="false"
                show-icon
                title="按会计准则「未来适用法」，历史折旧不重算；调整后按剩余净值在剩余期间内重新摊销。"
              />
            </template>

            <!-- 计提减值 -->
            <template v-else-if="activeKind === 'impairment'">
              <el-form-item label="减值金额" required>
                <el-input-number
                  v-model="form.amount"
                  :min="0"
                  :precision="2"
                  :step="1000"
                  :controls="false"
                  style="width: 220px"
                />
                <span class="field-tip">不得超过当前净值 ¥{{ fmtAmt(asset.net_value) }}</span>
              </el-form-item>
              <el-form-item label="生成凭证">
                <el-switch v-model="form.generate_voucher" />
              </el-form-item>
              <el-alert
                type="warning"
                :closable="false"
                show-icon
                title="固定资产减值准备一经计提不得转回。贷方科目取「资产类别」上配置的减值准备科目，需先在资产档案中设置。"
              />
            </template>

            <!-- 资产拆分 -->
            <template v-else-if="activeKind === 'split'">
              <el-form-item label="拆出子卡片" required>
                <div class="split-table">
                  <el-table :data="form.children" size="small" border>
                    <el-table-column label="资产编号" width="150">
                      <template #default="{ row }">
                        <el-input v-model="row.asset_no" size="small" placeholder="留空自动取号" />
                      </template>
                    </el-table-column>
                    <el-table-column label="资产名称" min-width="160">
                      <template #default="{ row }">
                        <el-input
                          v-model="row.asset_name"
                          size="small"
                          :placeholder="`${asset.asset_name}（拆分）`"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="原值" width="150">
                      <template #default="{ row }">
                        <el-input-number
                          v-model="row.original_value"
                          size="small"
                          :precision="2"
                          :min="0"
                          :controls="false"
                          style="width: 100%"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="数量" width="100">
                      <template #default="{ row }">
                        <el-input-number
                          v-model="row.qty"
                          size="small"
                          :precision="0"
                          :min="1"
                          :controls="false"
                          style="width: 100%"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="操作" width="70" align="center">
                      <template #default="{ $index }">
                        <el-button
                          link
                          type="danger"
                          size="small"
                          @click="form.children.splice($index, 1)"
                        >
                          删除
                        </el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                  <div class="split-foot">
                    <el-button size="small" :icon="Plus" @click="addSplitChild"
                      >添加子卡片</el-button
                    >
                    <span :class="['split-total', splitOverflow ? 'is-error' : '']">
                      拆出合计 ¥{{ fmtAmt(splitTotal) }} / 原值 ¥{{
                        fmtAmt(asset.original_value)
                      }}
                      （原卡片保留 ¥{{ fmtAmt(asset.original_value - splitTotal) }}）
                    </span>
                  </div>
                </div>
              </el-form-item>
              <el-alert
                type="info"
                :closable="false"
                show-icon
                title="累计折旧与减值准备按原值比例分摊到子卡片，原值总额守恒，因此不产生凭证。拆分不可撤销，请核对后提交。"
              />
            </template>

            <el-form-item label="备注">
              <el-input
                v-model="form.remark"
                type="textarea"
                :rows="2"
                style="width: 520px"
                placeholder="变动原因、审批单号等"
              />
            </el-form-item>

            <el-form-item>
              <el-button v-permission="'asset:change'" type="primary" :loading="submitting" @click="submit">提交变动</el-button>
              <el-button @click="resetForm">重置</el-button>
            </el-form-item>
          </el-form>
        </div>
      </div>

      <!-- 右：该资产变动历史 -->
      <aside class="change-history">
        <h4>该资产变动历史</h4>
        <el-empty v-if="!history.length" description="暂无变动记录" :image-size="70" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="h in history"
            :key="h.id"
            :timestamp="h.change_date"
            placement="top"
            :type="kindTagType(h.change_kind)"
          >
            <div class="history-item">
              <div class="history-item__title">{{ h.change_item }}</div>
              <div
                v-if="h.amount"
                class="history-item__amt"
                :class="h.amount > 0 ? 'incr' : 'decr'"
              >
                {{ h.amount > 0 ? '+' : '' }}{{ fmtAmt(h.amount) }}
              </div>
              <div class="history-item__meta">
                <span>{{ h.operator || '-' }}</span>
                <el-tag v-if="h.voucher_no" size="small" type="success">{{ h.voucher_no }}</el-tag>
              </div>
              <el-button v-if="canRevoke(h)" v-permission="'asset:change'" link type="danger" size="small" @click="revoke(h)">
                撤销
              </el-button>
            </div>
          </el-timeline-item>
        </el-timeline>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { confirmRenumberAfterDelete } from '@/composables/useRenumberPrompt'

/** P1-20：变动 / 处置 / 盘点日期不得晚于当前月份（与后端同口径） */
function disableFutureMonth(date: Date): boolean {
  const now = new Date()
  return date.getFullYear() * 100 + date.getMonth() > now.getFullYear() * 100 + now.getMonth()
}
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import {
  fixedAssetApi,
  DEPR_METHODS,
  ASSET_CHANGE_KIND_LABELS,
  type AssetCard,
  type AssetDicts,
  type AssetChangeKind,
  type AssetChangeRow,
  type SplitChildInput,
} from '@/api/fixedAsset'
import AccountSelect from '@/components/base/AccountSelect.vue'

const route = useRoute()
const router = useRouter()

const assetId = ref<string>((route.query.assetId as string) || '')
const asset = ref<AssetCard | null>(null)
const dicts = ref<AssetDicts | null>(null)
const assetOptions = ref<AssetCard[]>([])
const assetLoading = ref(false)
const history = ref<AssetChangeRow[]>([])
const submitting = ref(false)
const activeKind = ref<AssetChangeKind>('original_value')

const today = () => todayStr()

const form = reactive<{
  change_date: string
  amount: number | undefined
  salvage_rate: number | undefined
  use_months: number | undefined
  total_workload: number | undefined
  depr_method: string
  dept_code: string
  user_name: string
  keeper: string
  install_place: string
  status_code: string
  change_type_code: string
  generate_voucher: boolean
  counter_account: string
  remark: string
  children: SplitChildInput[]
}>({
  change_date: today(),
  amount: undefined,
  salvage_rate: undefined,
  use_months: undefined,
  total_workload: undefined,
  depr_method: '',
  dept_code: '',
  user_name: '',
  keeper: '',
  install_place: '',
  status_code: '',
  change_type_code: '',
  generate_voucher: false,
  counter_account: '',
  remark: '',
  children: [],
})

const fmtAmt = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 报废状态不出现在「使用状态变更」下拉里，报废须走处置流程 */
const selectableStatuses = computed(() => (dicts.value?.status || []).filter(s => s.code !== '04'))

/** 原值变动可关联「增减方式」字典，与 ACD 的 zc_yzzj 口径一致 */
const changeTypes = computed(() => dicts.value?.change_type || [])

const splitTotal = computed(() =>
  form.children.reduce((s, c) => s + (Number(c.original_value) || 0), 0)
)
const splitOverflow = computed(
  () => !!asset.value && splitTotal.value >= Number(asset.value.original_value || 0)
)

const voucherPreview = computed(() => {
  if (!form.amount) return ''
  const abs = fmtAmt(Math.abs(form.amount))
  const counter = form.counter_account || '（未选）'
  return form.amount > 0
    ? `借：固定资产 ${abs}　　贷：${counter} ${abs}`
    : `借：${counter} ${abs}　　贷：固定资产 ${abs}`
})

function kindTagType(kind: string) {
  if (kind === 'dispose') return 'danger'
  if (kind === 'impairment') return 'warning'
  if (kind === 'split') return 'info'
  return 'primary'
}

/** 处置、拆分与历史导入记录不支持撤销（与后端 revokeAssetChange 的限制一致） */
function canRevoke(h: AssetChangeRow) {
  return !['dispose', 'split', 'legacy'].includes(h.change_kind)
}

async function searchAssets(keyword: string) {
  assetLoading.value = true
  try {
    const res = await fixedAssetApi.getCards({ keyword, page: 1, page_size: 30 })
    assetOptions.value = (res.data as any).list || []
  } finally {
    assetLoading.value = false
  }
}

async function loadAsset() {
  if (!assetId.value) {
    asset.value = null
    history.value = []
    return
  }
  const res = await fixedAssetApi.getCard(assetId.value)
  asset.value = res.data
  if (asset.value && !assetOptions.value.some(a => a.id === asset.value!.id)) {
    assetOptions.value = [asset.value, ...assetOptions.value]
  }
  await loadHistory()
}

async function loadHistory() {
  if (!asset.value) return
  const res = await fixedAssetApi.listChanges({
    asset_no: asset.value.asset_no,
    page: 1,
    page_size: 50,
  })
  history.value = res.data.list
}

function onAssetChange() {
  resetForm()
  loadAsset()
}

function resetForm() {
  form.change_date = today()
  form.amount = undefined
  form.salvage_rate = undefined
  form.use_months = undefined
  form.total_workload = undefined
  form.depr_method = ''
  form.dept_code = ''
  form.user_name = ''
  form.keeper = ''
  form.install_place = ''
  form.status_code = ''
  form.change_type_code = ''
  form.generate_voucher = false
  form.counter_account = ''
  form.remark = ''
  form.children = []
}

function addSplitChild() {
  form.children.push({ original_value: 0, qty: 1 })
}

/** 按当前变动类型组装 payload，并做提交前校验；校验不通过返回 null */
function buildPayload(): Record<string, unknown> | null {
  switch (activeKind.value) {
    case 'original_value':
      if (!form.amount) {
        ElMessage.warning('请填写变动金额')
        return null
      }
      return { amount: form.amount, salvage_rate: form.salvage_rate }
    case 'improvement':
      if (!form.amount || form.amount <= 0) {
        ElMessage.warning('改良支出必须大于 0')
        return null
      }
      return { amount: form.amount, use_months: form.use_months }
    case 'impairment':
      if (!form.amount || form.amount <= 0) {
        ElMessage.warning('减值金额必须大于 0')
        return null
      }
      // 不用 el-input-number 的 :max 硬截断——超额输入会被静默改成净值并直接提交
      if (asset.value && form.amount > Number(asset.value.net_value || 0)) {
        ElMessage.warning(`减值金额不得超过当前净值 ¥${fmtAmt(asset.value.net_value)}`)
        return null
      }
      return { amount: form.amount }
    case 'dept':
      if (!form.dept_code) {
        ElMessage.warning('请选择调入部门')
        return null
      }
      return {
        dept_code: form.dept_code,
        user_name: form.user_name || undefined,
        keeper: form.keeper || undefined,
        install_place: form.install_place || undefined,
      }
    case 'status':
      if (!form.status_code) {
        ElMessage.warning('请选择新的使用状态')
        return null
      }
      return { status_code: form.status_code }
    case 'depr_factor': {
      const payload: Record<string, unknown> = {}
      if (form.depr_method) payload.depr_method = form.depr_method
      if (form.use_months != null) payload.use_months = form.use_months
      if (form.salvage_rate != null) payload.salvage_rate = form.salvage_rate
      if (form.total_workload != null) payload.total_workload = form.total_workload
      if (Object.keys(payload).length === 0) {
        ElMessage.warning('请至少调整一项折旧要素')
        return null
      }
      return payload
    }
    case 'split':
      if (!form.children.length) {
        ElMessage.warning('请至少添加一张拆分子卡片')
        return null
      }
      if (form.children.some(c => !c.original_value || c.original_value <= 0)) {
        ElMessage.warning('子卡片原值必须大于 0')
        return null
      }
      if (splitOverflow.value) {
        ElMessage.warning('拆出合计必须小于资产原值，原卡片需保留部分价值')
        return null
      }
      return { children: form.children }
    default:
      return {}
  }
}

async function submit() {
  if (!asset.value) return
  if (!form.change_date) return ElMessage.warning('请选择变动日期')
  if (form.generate_voucher && !form.counter_account && activeKind.value !== 'impairment') {
    return ElMessage.warning('生成凭证时必须选择对方科目')
  }

  const payload = buildPayload()
  if (!payload) return

  submitting.value = true
  try {
    const res =
      activeKind.value === 'split'
        ? await fixedAssetApi.splitAsset(asset.value.id, {
            change_date: form.change_date,
            children: form.children,
            remark: form.remark || null,
          })
        : await fixedAssetApi.applyChange(asset.value.id, {
            kind: activeKind.value,
            change_date: form.change_date,
            change_type_code: form.change_type_code || null,
            payload,
            generate_voucher: form.generate_voucher,
            counter_account: form.counter_account || null,
            remark: form.remark || null,
          })

    const data = res.data
    if (data.voucherNo) {
      ElMessage.success(
        `${ASSET_CHANGE_KIND_LABELS[activeKind.value]}成功，已生成凭证 ${data.voucherNo}`
      )
    } else if (data.createdAssets?.length) {
      ElMessage.success(
        `拆分成功，新建 ${data.createdAssets.length} 张卡片：${data.createdAssets
          .map((a: { asset_no: string }) => a.asset_no)
          .join('、')}`
      )
    } else {
      ElMessage.success(`${ASSET_CHANGE_KIND_LABELS[activeKind.value]}成功`)
    }
    if (data.voucherWarning) ElMessage.warning(data.voucherWarning)
    // 已提满资产增值后自动顺延使用月数（后端 P1-18）
    if (data.extendedMonths) ElMessage.info(`该资产此前已提足折旧，已自动延长使用月数 ${data.extendedMonths} 个月以摊销新增价值`)

    resetForm()
    await loadAsset()
  } finally {
    submitting.value = false
  }
}

async function revoke(h: AssetChangeRow) {
  await ElMessageBox.confirm(
    `确定撤销「${h.change_item}」吗？${h.voucher_no ? `关联凭证 ${h.voucher_no} 将一并删除。` : ''}`,
    '撤销变动',
    { type: 'warning' }
  )
  const res = await fixedAssetApi.revokeChange(h.id)
  ElMessage.success(
    res.data.deletedVoucherNo ? `已撤销，凭证 ${res.data.deletedVoucherNo} 已删除` : '已撤销'
  )
  await loadAsset()
  // P2-19：删除变动凭证可能断号，提示重新排号
  await confirmRenumberAfterDelete(res.data.affectedGroups, res.data.deletedVoucherNo ? 1 : 0)
}

function goBack() {
  router.push('/asset/list')
}

// 切换变动类型时清空与上一类型相关的输入，避免误带值提交
watch(activeKind, () => resetForm())

onMounted(async () => {
  const [dictRes] = await Promise.all([fixedAssetApi.getDicts(), searchAssets('')])
  dicts.value = dictRes.data
  await loadAsset()
})
</script>

<style scoped>
.page-asset-change {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--page-pad);
  gap: 12px;
  overflow: hidden;
}

.change-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.change-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.change-header__left h3 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
}

.change-header__asset {
  font-size: var(--cw-text-base);
  color: var(--el-text-color-secondary);
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.picker-label {
  font-size: var(--cw-text-base);
  color: var(--el-text-color-regular);
}

.empty-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.change-body {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

.change-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.asset-brief {
  margin-bottom: 12px;
}

.scrap-alert {
  margin-bottom: 12px;
}

.kind-tabs {
  margin-bottom: 4px;
}

.form-area {
  padding-top: 4px;
}

.field-tip {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.voucher-preview {
  font-size: var(--cw-text-base);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  padding: 6px 12px;
  border-radius: 4px;
}

.split-table {
  width: 640px;
}

.split-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.split-total {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.split-total.is-error {
  color: var(--el-color-danger);
  font-weight: 600;
}

.change-history {
  width: 300px;
  flex-shrink: 0;
  overflow-y: auto;
  border-left: 1px solid var(--el-border-color-lighter);
  padding-left: 16px;
}

.change-history h4 {
  margin: 0 0 12px;
  font-size: var(--cw-text-base);
}

.history-item__title {
  font-size: var(--cw-text-base);
  line-height: 1.5;
}

.history-item__amt {
  font-size: var(--cw-text-base);
  font-weight: 600;
}

.history-item__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.incr {
  color: var(--el-color-success);
}

.decr {
  color: var(--el-color-danger);
}
</style>
