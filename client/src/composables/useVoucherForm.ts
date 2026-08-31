import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { useUserStore } from '@/stores/user'
import type { Voucher, VoucherEntry as ServerVoucherEntry } from '@/types/voucher'

export interface VoucherEntry {
  account_id: string
  account_code: string
  account_name: string
  debit_amount: number | null
  credit_amount: number | null
  summary: string
  [key: string]: any
}

export interface VoucherForm {
  id: string
  voucher_type_id: string
  voucher_no: string
  voucher_date: string
  entries: VoucherEntry[]
  remark: string
  maker_name?: string
  auditor_name?: string
  poster_name?: string
  /** 凭证来源：'cashier' 表示出纳生成（编辑时现金分录锁定） */
  source?: string
}

export function useVoucherForm(auxCategories: Ref<any[]>) {
  const form = ref<VoucherForm>(createForm())
  const currentEntry = ref<VoucherEntry | null>(null)

  function createForm(): VoucherForm {
    // 从 Pinia store 取当前用户昵称
    const userStore = useUserStore()
    const currentUser = userStore.userInfo?.nickname || userStore.userInfo?.username || ''
    return {
      id: '',
      voucher_type_id: '',
      voucher_no: '',
      voucher_date: new Date().toISOString().split('T')[0],
      entries: Array.from({ length: 6 }, () => createEntry()),
      remark: '',
      maker_name: currentUser,
      auditor_name: '',
      poster_name: '',
      source: '',
    }
  }

  function createEntry(): VoucherEntry {
    const entry: VoucherEntry = {
      account_id: '',
      account_code: '',
      account_name: '',
      debit_amount: null,
      credit_amount: null,
      summary: '',
      cash_flow_code: '',
      cash_flow_name: '',
    }
    for (const cat of auxCategories.value) {
      entry[`_${cat.code}_id`] = ''
    }
    return entry
  }

  function normalizeEntryForForm(entry: ServerVoucherEntry): VoucherEntry {
    const next = createEntry()
    // 保留 entry 的 id（编辑时需要）
    if (entry.id) {
      next.id = entry.id
    }
    next.account_id = entry.account_id || ''
    next.account_code = entry.account_code || ''
    next.account_name = entry.account_name || ''
    next.summary = entry.summary || ''
    next.debit_amount = entry.direction === 'debit' ? entry.amount || 0 : null
    next.credit_amount = entry.direction === 'credit' ? entry.amount || 0 : null
    next.cash_flow_code = entry.cash_flow_code || ''
    next.cash_flow_name = entry.cash_flow_name || ''

    // 从 aux_data JSON 字段恢复辅助核算数据
    if (entry.aux_data) {
      try {
        const auxData = typeof entry.aux_data === 'string' ? JSON.parse(entry.aux_data) : entry.aux_data
        for (const cat of auxCategories.value) {
          const dynamicKey = `_${cat.code}_id`
          if (auxData[cat.code]?.id) {
            next[dynamicKey] = auxData[cat.code].id
            const itemName = auxData[cat.code]?.name
            if (itemName) {
              next[`_${cat.code}_name`] = String(itemName)
            }
          }
          // 恢复自定义字段值
          const catData = auxData[cat.code]
          if (catData && catData.field_values && typeof catData.field_values === 'object') {
            for (const [fieldKey, fieldValue] of Object.entries(catData.field_values)) {
              next[`_${cat.code}_fv_${fieldKey}`] = fieldValue
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse aux_data:', e)
      }
    }

    // 兼容旧数据：从固定字段恢复
    for (const cat of auxCategories.value) {
      const dynamicKey = `_${cat.code}_id`
      const fixedKey = `${cat.code}_id`
      if (!next[dynamicKey]) {
        next[dynamicKey] = entry[dynamicKey] || entry[fixedKey] || ''
      }
    }

    return next
  }

  function addEntry() {
    const entry = createEntry()
    for (const cat of auxCategories.value) {
      const key = `_${cat.code}_id`
      if (!(key in entry)) entry[key] = ''
    }
    form.value.entries.push(entry)
    currentEntry.value = entry
  }

  function removeEntry(index: number, row: VoucherEntry) {
    form.value.entries.splice(index, 1)
    if (currentEntry.value === row) {
      currentEntry.value = form.value.entries[index] || form.value.entries[index - 1] || null
    }
  }

  function setCurrentEntry(row: VoucherEntry | null) {
    currentEntry.value = row
  }

  const totalDebit = computed(() =>
    form.value.entries.reduce((s: number, e: VoucherEntry) => s + (e.debit_amount || 0), 0)
  )

  const totalCredit = computed(() =>
    form.value.entries.reduce((s: number, e: VoucherEntry) => s + (e.credit_amount || 0), 0)
  )

  const isBalanced = computed(() => Math.abs(totalDebit.value - totalCredit.value) < 0.01)

  function resetForm() {
    form.value = createForm()
    currentEntry.value = null
  }

  // 为现有分录补充动态辅助核算字段（含自定义字段）
  function ensureAuxFields() {
    for (const entry of form.value.entries) {
      for (const cat of auxCategories.value) {
        const key = `_${cat.code}_id`
        if (!(key in entry)) {
          entry[key] = ''
        }
        // 自定义字段初始值
        for (const field of (cat.fields || [])) {
          if (field.is_enabled === 0 || !field.show_in_voucher) continue
          const fvKey = `_${cat.code}_fv_${field.field_key}`
          if (!(fvKey in entry)) {
            entry[fvKey] = ''
          }
        }
      }
    }
  }

  function loadVoucher(voucher: Voucher) {
    const entries = (voucher.entries || []).map((entry) => normalizeEntryForForm(entry))
    while (entries.length < 6) {
      entries.push(createEntry())
    }
    form.value = {
      id: voucher.id,
      voucher_type_id: voucher.voucher_type_id || '',
      voucher_no: voucher.voucher_no || '',
      voucher_date: voucher.voucher_date,
      entries,
      remark: voucher.remark || '',
      maker_name: voucher.maker_name || '',
      auditor_name: voucher.auditor_name || '',
      poster_name: voucher.poster_name || '',
      source: (voucher as any).source || '',
    }
    currentEntry.value = form.value.entries[0] || null
  }

  return {
    form,
    currentEntry,
    totalDebit,
    totalCredit,
    isBalanced,
    createEntry,
    addEntry,
    removeEntry,
    setCurrentEntry,
    resetForm,
    loadVoucher,
    ensureAuxFields,
  }
}
