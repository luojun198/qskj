<template>
  <div class="page currency-page">
    <div class="page-header">
      <div class="page-title">
        <h3>外币类型</h3>
        <span>{{ currencies.length }} 种 · 本位币 {{ baseCurrency?.code || '-' }}</span>
      </div>
      <div class="page-actions">
        <el-button type="primary" size="small" @click="openCurrencyDialog()">增加</el-button>
        <el-button
          size="small"
          :disabled="!selectedCurrency || !!selectedCurrency.is_base"
          @click="selectedCurrency && handleDeleteCurrency(selectedCurrency)"
        >
          删除
        </el-button>
      </div>
    </div>

    <!-- 主表：币种 + 年初/期末汇率就地编辑 -->
    <el-table
      :data="currencies"
      stripe
      border
      size="small"
      row-key="id"
      highlight-current-row
      class="currency-table"
      @current-change="onCurrentChange"
    >
      <el-table-column prop="code" label="币种" width="100" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column label="年初汇率" width="160" align="right">
        <template #default="{ row }">
          <span v-if="row.is_base" class="rate-readonly">1.0000</span>
          <el-input-number
            v-else
            :model-value="row.begin_rate"
            :min="0"
            :step="0.0001"
            :precision="rateDecimals(row)"
            :controls="false"
            size="small"
            class="rate-input"
            @change="val => saveRateField(row, 'begin_rate', val)"
          />
        </template>
      </el-table-column>
      <el-table-column label="期末汇率" width="160" align="right">
        <template #default="{ row }">
          <span v-if="row.is_base" class="rate-readonly">1.0000</span>
          <el-input-number
            v-else
            :model-value="row.end_rate"
            :min="0"
            :step="0.0001"
            :precision="rateDecimals(row)"
            :controls="false"
            size="small"
            class="rate-input"
            @change="val => saveRateField(row, 'end_rate', val)"
          />
        </template>
      </el-table-column>
      <el-table-column label="本位币" width="80" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.is_base" size="small" type="success">是</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.is_enabled ? 'success' : 'info'">
            {{ row.is_enabled ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openCurrencyDialog(row)">编辑</el-button>
          <el-button
            link
            type="danger"
            size="small"
            :disabled="!!row.is_base"
            @click="handleDeleteCurrency(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 汇兑损益科目 -->
    <div class="currency-settings-row">
      <span class="currency-settings-label">汇兑损益科目：</span>
      <AccountSelect
        v-model="exchangeGainCode"
        placeholder="选择汇兑损益科目（如 6603 财务费用-汇兑损益）"
        class="currency-settings-input"
      />
      <el-button type="primary" size="small" :loading="savingSettings" @click="saveSettings">
        保存
      </el-button>
      <span class="currency-settings-tip">
        期末按期末汇率重估外币科目余额，差额记入此科目 ·
        <router-link to="/voucher/fx-reval">去期末调汇</router-link>
      </span>
    </div>

    <!-- 按期间汇率明细（折叠） -->
    <el-collapse v-model="expandedPanels" class="rate-collapse">
      <el-collapse-item name="rates">
        <template #title>
          <span class="rate-collapse-title">按期间汇率明细</span>
          <span class="rate-collapse-sub">
            可选：为个别「年度 + 期间」单独指定记账汇率；未单独维护的期间一律使用上方「期末汇率」
          </span>
        </template>
        <div class="page-header">
          <div class="page-actions">
            <el-select v-model="filterYear" size="small" style="width: 100px" @change="loadRates">
              <el-option v-for="y in yearOptions" :key="y" :label="`${y}年`" :value="y" />
            </el-select>
            <el-select
              v-model="filterCurrency"
              placeholder="全部币种"
              size="small"
              style="width: 120px"
              @change="loadRates" :empty-values="[null, undefined]"
            >
              <el-option label="全部币种" value="" />
              <el-option
                v-for="c in foreignCurrencies"
                :key="c.code"
                :label="`${c.code} ${c.name}`"
                :value="c.code"
              />
            </el-select>
            <el-button type="primary" size="small" @click="openRateDialog()">录入汇率</el-button>
          </div>
        </div>
        <el-table :data="rates" stripe border size="small" max-height="260" row-key="id">
          <el-table-column prop="currency_code" label="币种" width="100" />
          <el-table-column prop="year" label="年度" width="90" />
          <el-table-column prop="period" label="期间" width="80" />
          <el-table-column prop="rate" label="记账汇率" width="120" align="right" />
          <el-table-column prop="closing_rate" label="期末汇率" width="120" align="right">
            <template #default="{ row }">{{ row.closing_rate ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openRateDialog(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="handleDeleteRate(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-collapse-item>
    </el-collapse>

    <el-dialog
      v-model="currencyDialogVisible"
      :title="editingCurrency ? '编辑币种' : '增加币种'"
      width="440px"
    >
      <el-form :model="currencyForm" label-width="96px">
        <el-form-item label="币种编码" required>
          <el-input
            v-model="currencyForm.code"
            :disabled="!!editingCurrency"
            placeholder="如 USD"
            @blur="fillCurrencyName"
          />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="currencyForm.name" placeholder="如 美元" />
        </el-form-item>
        <el-form-item label="年初汇率">
          <el-input-number
            v-model="currencyForm.begin_rate"
            :min="0"
            :step="0.0001"
            :precision="4"
            :disabled="currencyForm.is_base"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="期末汇率">
          <el-input-number
            v-model="currencyForm.end_rate"
            :min="0"
            :step="0.0001"
            :precision="4"
            :disabled="currencyForm.is_base"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="汇率小数位">
          <el-input-number v-model="currencyForm.rate_decimals" :min="0" :max="8" style="width: 100%" />
        </el-form-item>
        <el-form-item label="本位币">
          <el-switch v-model="currencyForm.is_base" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="currencyForm.is_enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="currencyDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCurrency">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="rateDialogVisible" :title="editingRate ? '编辑汇率' : '录入汇率'" width="440px">
      <el-form :model="rateForm" label-width="96px">
        <el-form-item label="币种" required>
          <el-select v-model="rateForm.currency_code" style="width: 100%" :disabled="!!editingRate">
            <el-option
              v-for="c in foreignCurrencies"
              :key="c.code"
              :label="`${c.code} ${c.name}`"
              :value="c.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="年度" required>
          <el-input-number v-model="rateForm.year" :min="1900" :max="2100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="期间" required>
          <el-input-number v-model="rateForm.period" :min="1" :max="12" style="width: 100%" />
        </el-form-item>
        <el-form-item label="记账汇率" required>
          <el-input-number v-model="rateForm.rate" :min="0" :step="0.0001" :precision="6" style="width: 100%" />
        </el-form-item>
        <el-form-item label="期末汇率">
          <el-input-number
            v-model="rateForm.closing_rate"
            :min="0"
            :step="0.0001"
            :precision="6"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rateDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createCurrency,
  deleteCurrency,
  deleteExchangeRate,
  getCurrencies,
  getCurrencySettings,
  getExchangeRates,
  saveCurrencySettings,
  updateCurrency,
  upsertExchangeRate,
  type Currency,
  type ExchangeRate,
} from '@/api/currency'
import { useSystemParamsStore } from '@/stores/systemParams'
import AccountSelect from '@/components/base/AccountSelect.vue'

const CURRENCY_NAME_MAP: Record<string, string> = {
  RMB: '人民币',
  CNY: '人民币',
  USD: '美元',
  HKD: '港币',
  EUR: '欧元',
  JPY: '日元',
  GBP: '英镑',
}

const systemParamsStore = useSystemParamsStore()
const currencies = ref<Currency[]>([])
const rates = ref<ExchangeRate[]>([])
const saving = ref(false)
const savingSettings = ref(false)
const selectedCurrency = ref<Currency | null>(null)
const exchangeGainCode = ref('')
const expandedPanels = ref<string[]>([])
const filterYear = ref(systemParamsStore.currentYear || new Date().getFullYear())
const filterCurrency = ref('')

const yearOptions = computed(() => {
  const y = filterYear.value
  return [y - 1, y, y + 1]
})

const baseCurrency = computed(() => currencies.value.find(c => c.is_base) || null)
const foreignCurrencies = computed(() => currencies.value.filter(c => !c.is_base))

function rateDecimals(row: Currency) {
  const n = Number(row.rate_decimals)
  return Number.isFinite(n) ? Math.max(2, Math.min(8, n)) : 4
}

function onCurrentChange(row: Currency | null) {
  selectedCurrency.value = row
}

const currencyDialogVisible = ref(false)
const editingCurrency = ref<Currency | null>(null)
const currencyForm = reactive({
  code: '',
  name: '',
  begin_rate: 1,
  end_rate: 1,
  rate_decimals: 4,
  is_base: false,
  is_enabled: true,
})

const rateDialogVisible = ref(false)
const editingRate = ref<ExchangeRate | null>(null)
const rateForm = reactive({
  currency_code: '',
  year: filterYear.value,
  period: systemParamsStore.currentPeriod || 1,
  rate: 1,
  closing_rate: undefined as number | undefined,
})

async function loadCurrencies() {
  const res = await getCurrencies(true)
  currencies.value = res.data || []
}

async function loadRates() {
  const res = await getExchangeRates({
    year: filterYear.value,
    currency_code: filterCurrency.value || undefined,
  })
  rates.value = res.data || []
}

async function loadSettings() {
  try {
    const res = await getCurrencySettings()
    exchangeGainCode.value = res.data?.exchange_gain_account_code || ''
  } catch {
    exchangeGainCode.value = ''
  }
}

/** 表内就地修改年初/期末汇率 */
async function saveRateField(row: Currency, field: 'begin_rate' | 'end_rate', val: number | undefined) {
  const n = Number(val)
  if (!(n > 0)) {
    ElMessage.warning('汇率必须大于 0')
    await loadCurrencies()
    return
  }
  if (Number(row[field]) === n) return
  try {
    await updateCurrency(row.id, { [field]: n })
    row[field] = n
    ElMessage.success(`${row.code} ${field === 'begin_rate' ? '年初' : '期末'}汇率已更新`)
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
    await loadCurrencies()
  }
}

function fillCurrencyName() {
  const code = currencyForm.code.trim().toUpperCase()
  currencyForm.code = code
  if (!currencyForm.name && CURRENCY_NAME_MAP[code]) currencyForm.name = CURRENCY_NAME_MAP[code]
}

function openCurrencyDialog(row?: Currency) {
  editingCurrency.value = row || null
  currencyForm.code = row?.code || ''
  currencyForm.name = row?.name || ''
  currencyForm.begin_rate = row?.begin_rate ?? row?.default_rate ?? 1
  currencyForm.end_rate = row?.end_rate ?? row?.default_rate ?? 1
  currencyForm.rate_decimals = row?.rate_decimals ?? 4
  currencyForm.is_base = !!row?.is_base
  currencyForm.is_enabled = row ? !!row.is_enabled : true
  currencyDialogVisible.value = true
}

async function saveCurrency() {
  fillCurrencyName()
  if (!currencyForm.code.trim() || !currencyForm.name.trim()) {
    ElMessage.warning('请填写币种编码和名称')
    return
  }
  if (!currencyForm.is_base && !(currencyForm.begin_rate > 0 && currencyForm.end_rate > 0)) {
    ElMessage.warning('年初汇率和期末汇率必须大于 0')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: currencyForm.name,
      begin_rate: currencyForm.begin_rate,
      end_rate: currencyForm.end_rate,
      default_rate: currencyForm.end_rate,
      rate_decimals: currencyForm.rate_decimals,
      is_base: currencyForm.is_base,
      is_enabled: currencyForm.is_enabled,
    }
    if (editingCurrency.value) {
      await updateCurrency(editingCurrency.value.id, payload)
    } else {
      await createCurrency({ code: currencyForm.code, ...payload })
    }
    currencyDialogVisible.value = false
    await loadCurrencies()
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleDeleteCurrency(row: Currency) {
  await ElMessageBox.confirm(`确认删除币种 ${row.code}？`, '提示', { type: 'warning' })
  try {
    await deleteCurrency(row.id)
    if (selectedCurrency.value?.id === row.id) selectedCurrency.value = null
    await loadCurrencies()
    ElMessage.success('已删除')
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    await saveCurrencySettings({ exchange_gain_account_code: exchangeGainCode.value || null })
    ElMessage.success('汇兑损益科目已保存')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    savingSettings.value = false
  }
}

function openRateDialog(row?: ExchangeRate) {
  editingRate.value = row || null
  rateForm.currency_code = row?.currency_code || foreignCurrencies.value[0]?.code || ''
  rateForm.year = row?.year || filterYear.value
  rateForm.period = row?.period || systemParamsStore.currentPeriod || 1
  rateForm.rate = row?.rate ?? 1
  rateForm.closing_rate = row?.closing_rate ?? undefined
  rateDialogVisible.value = true
}

async function saveRate() {
  if (!rateForm.currency_code || !(rateForm.rate > 0)) {
    ElMessage.warning('请填写币种和汇率')
    return
  }
  saving.value = true
  try {
    await upsertExchangeRate({
      currency_code: rateForm.currency_code,
      year: rateForm.year,
      period: rateForm.period,
      rate: rateForm.rate,
      closing_rate: rateForm.closing_rate ?? null,
    })
    rateDialogVisible.value = false
    await loadRates()
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleDeleteRate(row: ExchangeRate) {
  await ElMessageBox.confirm('确认删除该汇率？', '提示', { type: 'warning' })
  await deleteExchangeRate(row.id)
  await loadRates()
  ElMessage.success('已删除')
}

onMounted(async () => {
  await systemParamsStore.load()
  filterYear.value = systemParamsStore.currentYear || new Date().getFullYear()
  await Promise.all([loadCurrencies(), loadRates(), loadSettings()])
})
</script>

<style scoped>
.currency-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.page-title h3 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
}
.page-title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.currency-table {
  flex: 0 0 auto;
}
.rate-input {
  width: 130px;
}
.rate-input :deep(.el-input__inner) {
  text-align: right;
}
.rate-readonly {
  color: var(--el-text-color-secondary);
}
.currency-settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}
.currency-settings-label {
  font-weight: 600;
  white-space: nowrap;
}
.currency-settings-input {
  width: 360px;
}
.currency-settings-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.rate-collapse {
  border-top: 1px solid var(--el-border-color-lighter);
}
.rate-collapse-title {
  font-weight: 600;
}
.rate-collapse-sub {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
