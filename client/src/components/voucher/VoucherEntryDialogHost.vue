<template>
  <VoucherEntryForm
    v-model="dialogVisible"
    :mode="dialogMode"
    :form="form"
    :current-entry="currentEntry"
    :voucher-types="voucherTypes"
    :accounts="accounts"
    :aux-categories="auxCategories"
    :total-debit="totalDebit"
    :total-credit="totalCredit"
    :is-balanced="isBalanced"
    :current-entry-aux-categories="currentEntryAuxCategories"
    :is-parent-account="isParentAccount"
    :enable-cash-flow="enableCashFlow"
    :cash-flow-items="cashFlowItems"
    :enable-foreign-currency="enableForeignCurrency"
    :resolve-exchange-rate="resolveEntryExchangeRate"
    :get-aux-item-names="getAuxItemNames"
    :get-aux-options="voucherAux.getAuxOptions"
    :is-aux-select-loading="isAuxSelectLoading"
    :search-aux-items="voucherAux.searchAuxItems"
    :on-aux-dropdown-open="voucherAux.onDropdownOpen"
    :resolve-aux-item-name="voucherAux.resolveAuxItemName"
    :fetch-next-aux-code="voucherAux.fetchNextAuxCode"
    :ensure-selected-for-entry="ensureAuxSelectedForEntry"
    :on-account-change="onAccountChange"
    :on-amount-change="onAmountChange"
    :add-entry="addEntry"
    :remove-entry="removeEntry"
    :set-current-entry="setCurrentEntry"
    :attachments="attachments"
    :update-attachments="updateAttachments"
    :submit-loading="submitLoading"
    @submit="handleSubmit"
    @print="handlePrint"
    @clear-current-entry="setCurrentEntry(null)"
  />

  <VoucherHiprintDialog v-model="printDialogVisible" :voucher-ids="printVoucherIds" mode="single" />
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import request from '@/api/request'
import { getCashFlowItems } from '@/api/cashFlow'
import VoucherEntryForm from '@/components/voucher/VoucherEntryForm.vue'
import VoucherHiprintDialog from '@/components/print/VoucherHiprintDialog.vue'
import { useVoucherForm } from '@/composables/useVoucherForm'
import type { VoucherEntry } from '@/composables/useVoucherForm'
import { useAuxiliaryAccounting } from '@/composables/useAuxiliaryAccounting'
import { useVoucherAuxItems } from '@/composables/useVoucherAuxItems'
import { buildEntryKey } from '@/stores/voucherModalReturn'
import {
  showSuccess,
  showError,
  showWarning,
  showOperationError,
  extractErrorMessage,
  isNoNegativeBalanceMessage,
  showNoNegativeBalanceAlert,
} from '@/composables/useMessage'
import { useOperationHistory } from '@/composables/useOperationHistory'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useBaseDataStore } from '@/stores/baseData'
import { useUserStore } from '@/stores/user'
import { hasPermission } from '@/utils/permission'

const emit = defineEmits<{
  saved: []
}>()

const baseDataStore = useBaseDataStore()
const systemParamsStore = useSystemParamsStore()
const userStore = useUserStore()
const { addRecord } = useOperationHistory()

const voucherTypes = computed(() => baseDataStore.voucherTypes)
const accounts = computed(() => baseDataStore.accounts)
const auxCategories = computed(() => baseDataStore.auxCategories)
const enableCashFlow = computed(() => systemParamsStore.enableCashFlow)
const enableForeignCurrency = computed(() => systemParamsStore.enableForeignCurrency)

/** 外币科目默认汇率：按凭证日期所在年/期解析（与录入页 Entry.vue 一致） */
async function resolveEntryExchangeRate(currencyCode: string): Promise<number> {
  try {
    const { resolveExchangeRate } = await import('@/api/currency')
    const dateStr = String(form.value?.voucher_date || '')
    const y = dateStr ? Number(dateStr.slice(0, 4)) : systemParamsStore.currentYear
    const p = dateStr ? Number(dateStr.slice(5, 7)) : systemParamsStore.currentPeriod
    const res = await resolveExchangeRate(currencyCode, y || new Date().getFullYear(), p || 1)
    return Number(res.data?.rate) || 1
  } catch {
    return 1
  }
}

const dialogVisible = ref(false)
const dialogMode = ref<'edit' | 'view'>('view')
const submitLoading = ref(false)
const attachments = ref<any[]>([])
const cashFlowItems = ref<Array<{ code: string; name: string }>>([])
const printDialogVisible = ref(false)
const printVoucherIds = ref<Array<string | number>>([])

const {
  form,
  currentEntry,
  totalDebit,
  totalCredit,
  isBalanced,
  addEntry,
  removeEntry,
  setCurrentEntry,
  loadVoucher,
  ensureAuxFields,
} = useVoucherForm(auxCategories)

const voucherAux = useVoucherAuxItems()

const {
  currentEntryAuxCategories,
  isParentAccount,
  getAuxItemNames,
  onAccountChange,
  onAmountChange,
} = useAuxiliaryAccounting(accounts, auxCategories, currentEntry)

function isAuxSelectLoading(catId: string) {
  return !!voucherAux.loadingByCategory.value[catId]
}

function ensureAuxSelectedForEntry(entry: VoucherEntry | null) {
  return voucherAux.ensureSelectedForEntry(entry, currentEntryAuxCategories.value)
}

function updateAttachments(newAttachments: any[]) {
  attachments.value = newAttachments
}

async function ensureBaseData() {
  await Promise.all([
    baseDataStore.loadVoucherTypes(),
    baseDataStore.loadAccounts(),
    baseDataStore.loadAuxCategories(),
    systemParamsStore.load(),
  ])
  ensureAuxFields()
  try {
    const res = await getCashFlowItems(userStore.accountSetId)
    cashFlowItems.value = (res.data || []).map(item => ({
      code: item.code,
      name: item.name,
    }))
  } catch {
    cashFlowItems.value = []
  }
}

async function fetchAttachments(voucherId: string) {
  try {
    const res = await request.get<any[]>(`/voucher/vouchers/${voucherId}/attachments`)
    attachments.value = res.data || []
  } catch {
    attachments.value = []
  }
}

async function open(row: any) {
  const voucherId = row._voucherId || row.id
  if (!voucherId) return
  await loadVoucherDialog(String(voucherId), row)
}

function findEntryByKey(key?: string): VoucherEntry | null {
  if (!key) return null
  for (const [index, entry] of form.value.entries.entries()) {
    if (buildEntryKey(entry, index) === key) return entry
  }
  if (key.startsWith('acc:')) {
    const accId = key.slice(4)
    return form.value.entries.find(e => e.account_id === accId) || null
  }
  if (key.startsWith('idx:')) {
    const parts = key.split(':')
    const index = Number(parts[1])
    if (Number.isFinite(index) && form.value.entries[index]) {
      return form.value.entries[index]
    }
  }
  return null
}

async function restore(voucherId: string, options?: { currentEntryKey?: string }) {
  await loadVoucherDialog(voucherId)
  await nextTick()
  const entry = findEntryByKey(options?.currentEntryKey)
  if (entry) setCurrentEntry(entry)
}

async function loadVoucherDialog(voucherId: string, row?: any) {
  submitLoading.value = true
  try {
    await ensureBaseData()
    const res = await request.get(`/voucher/vouchers/${voucherId}`)
    const voucher = res.data
    const status = voucher.status || row?.status
    const canEdit = status === 'draft' && hasPermission('voucher:entry')
    dialogMode.value = canEdit ? 'edit' : 'view'

    loadVoucher(voucher)
    ensureAuxFields()
    await fetchAttachments(voucherId)
    dialogVisible.value = true
  } catch (error) {
    showOperationError('加载凭证', error)
  } finally {
    submitLoading.value = false
  }
}

function handlePrint() {
  if (form.value.id) {
    printVoucherIds.value = [form.value.id]
    printDialogVisible.value = true
  }
}

async function handleSubmit() {
  if (dialogMode.value !== 'edit') return

  if (!form.value.voucher_date) {
    showWarning('请选择凭证日期')
    return
  }
  if (Math.abs(totalDebit.value - totalCredit.value) > 0.01) {
    showError('借贷不平衡')
    return
  }
  // 外币科目必须通过气泡录入原币与汇率
  if (enableForeignCurrency.value) {
    for (const e of form.value.entries) {
      if (!e.account_id || !(e.debit_amount || e.credit_amount)) continue
      const acc = accounts.value.find(a => a.id === e.account_id) as any
      if (!acc || Number(acc.is_foreign) !== 1) continue
      if (!(Number(e.foreign_amount) !== 0 && Number.isFinite(Number(e.foreign_amount)))) {
        showWarning(`分录「${acc.code} ${acc.name}」为外币科目，请录入原币金额`)
        return
      }
      if (!(Number(e.exchange_rate) > 0)) {
        showWarning(`分录「${acc.code} ${acc.name}」为外币科目，请录入汇率`)
        return
      }
    }
  }

  submitLoading.value = true
  try {
    const payload = {
      voucher_type_id: form.value.voucher_type_id,
      voucher_no: form.value.voucher_no,
      voucher_date: form.value.voucher_date,
      remark: form.value.remark,
      entries: form.value.entries
        .filter(e => e.account_id && (e.debit_amount || e.credit_amount))
        .map(e => ({
          account_id: e.account_id,
          summary: e.summary,
          direction: e.debit_amount ? 'debit' : 'credit',
          amount: e.debit_amount || e.credit_amount,
          cash_flow_code: e.cash_flow_code,
          currency_code: e.currency_code || null,
          exchange_rate: e.exchange_rate ?? null,
          foreign_amount: e.foreign_amount ?? null,
          aux_data: buildAuxData(e),
        })),
    }

    await request.put(`/voucher/vouchers/${form.value.id}`, payload)
    showSuccess('保存成功')
    addRecord('编辑凭证', `凭证 ${form.value.voucher_no}`)
    dialogVisible.value = false
    emit('saved')
  } catch (error: any) {
    const msg = extractErrorMessage(error)
    if (isNoNegativeBalanceMessage(msg)) {
      showNoNegativeBalanceAlert(msg)
    } else {
      showOperationError('保存凭证', error)
    }
  } finally {
    submitLoading.value = false
  }
}

function buildAuxData(entry: VoucherEntry) {
  const auxData: Record<string, any> = {}
  for (const cat of auxCategories.value) {
    const itemId = entry[`_${cat.code}_id`]
    if (!itemId) continue
    const item = voucherAux.getAuxItemFromCache(cat.id, itemId)
    auxData[cat.code] = {
      id: itemId,
      name: item?.name || entry[`_${cat.code}_name`] || '',
      field_values: {},
    }
    for (const field of cat.fields || []) {
      if (field.is_enabled === 0 || !field.show_in_voucher) continue
      const fvKey = `_${cat.code}_fv_${field.field_key}`
      if (entry[fvKey] != null && entry[fvKey] !== '') {
        auxData[cat.code].field_values[field.field_key] = entry[fvKey]
      }
    }
  }
  return Object.keys(auxData).length > 0 ? auxData : undefined
}

defineExpose({ open, restore, loadVoucherDialog })
</script>
