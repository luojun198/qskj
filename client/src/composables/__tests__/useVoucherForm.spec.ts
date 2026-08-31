import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useVoucherForm } from '@/composables/useVoucherForm'

describe('useVoucherForm', () => {
  const auxCategories = ref([
    { id: 'dept', code: 'dept', name: '部门' },
    { id: 'project', code: 'project', name: '项目' },
  ])

  let composable: ReturnType<typeof useVoucherForm>

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => ''),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    setActivePinia(createPinia())
    composable = useVoucherForm(auxCategories)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should initialize with default form', () => {
    expect(composable.form.value).toBeDefined()
    expect(composable.form.value.entries).toHaveLength(6)
    expect(composable.currentEntry.value).toBeNull()
  })

  it('should calculate total debit correctly', () => {
    composable.form.value.entries[0].debit_amount = 100
    composable.form.value.entries[1].debit_amount = 200
    expect(composable.totalDebit.value).toBe(300)
  })

  it('should calculate total credit correctly', () => {
    composable.form.value.entries[0].credit_amount = 150
    composable.form.value.entries[1].credit_amount = 250
    expect(composable.totalCredit.value).toBe(400)
  })

  it('should check if form is balanced', () => {
    composable.form.value.entries[0].debit_amount = 100
    composable.form.value.entries[1].credit_amount = 100
    expect(composable.isBalanced.value).toBe(true)

    composable.form.value.entries[2].debit_amount = 50
    expect(composable.isBalanced.value).toBe(false)
  })

  it('should add new entry', () => {
    const initialLength = composable.form.value.entries.length
    composable.addEntry()
    expect(composable.form.value.entries.length).toBe(initialLength + 1)
  })

  it('should remove entry', () => {
    composable.form.value.entries = [
      composable.createEntry(),
      composable.createEntry(),
      composable.createEntry(),
    ]
    const entryToRemove = composable.form.value.entries[1]
    composable.removeEntry(1, entryToRemove)
    expect(composable.form.value.entries.length).toBe(2)
  })

  it('should set current entry', () => {
    const entry = composable.form.value.entries[0]
    composable.setCurrentEntry(entry)
    expect(composable.currentEntry.value).toBe(entry)
  })

  it('should create entry with default values', () => {
    const entry = composable.createEntry()
    expect(entry.account_id).toBe('')
    expect(entry.debit_amount).toBeNull()
    expect(entry.credit_amount).toBeNull()
    expect(entry.summary).toBe('')
  })
})
