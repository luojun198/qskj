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
import { hasPermission } from '@/utils/permission'
import { getAssetVoucherLockMessage } from '@/utils/voucherSourceGuard'

const emit = defineEmits<{
  saved: []
}>()

const baseDataStore = useBaseDataStore()
const systemParamsStore = useSystemParamsStore()
const { addRecord } = useOperationHistory()

const voucherTypes = computed(() => baseDataStore.voucherTypes)
const accounts = computed(() => baseDataStore.accounts)
const auxCategories = computed(() => baseDataStore.auxCategories)
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
    const voucher: any = res.data
    const status = voucher.status || row?.status
    // 固定资产 / 进销存生成的凭证只读（后端同样拦截），只能回对应模块处理
    const lockMessage = getAssetVoucherLockMessage(voucher, '编辑')
    const canEdit = status === 'draft' && hasPermission('voucher:entry') && !lockMessage
    if (lockMessage && status === 'draft') showWarning(lockMessage)
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
  if (voucherTypes.value.length > 0 && !form.value.voucher_type_id) {
    showWarning('请选择凭证类型')
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
        // 与录入页 Entry.vue 一致：整行带上（account_code / account_name、辅助核算 _xx_id 等），
        // 后端按这些字段落库；只挑几个字段会因 account_code 为空被数据库拒绝
        .map(e => ({
          ...e,
          direction: e.debit_amount ? 'debit' : 'credit',
          amount: e.debit_amount || e.credit_amount,
          currency_code: e.currency_code || null,
          exchange_rate: e.exchange_rate ?? null,
          foreign_amount: e.foreign_amount ?? null,
        })),
    }

    await request.put(`/voucher/vouchers/${form.value.id}`, payload)
    showSuccess('保存成功')
    addRecord('update', '凭证管理', `凭证 ${form.value.voucher_no}`)
    dialogVisible.value = false
    emit('saved')
  } catch (error: any) {
    const msg = extractErrorMessage(error)
    if (isNoNegativeBalanceMessage(msg)) {
      showNoNegativeBalanceAlert(undefined, msg)
    } else {
      showOperationError('保存凭证', error)
    }
  } finally {
    submitLoading.value = false
  }
}

defineExpose({ open, restore, loadVoucherDialog })
</script>
