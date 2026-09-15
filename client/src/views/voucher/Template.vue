<template>
  <div class="page">
    <div class="list-toolbar" style="margin-bottom:8px">
      <el-button type="primary" size="small" @click="handleCreate"><el-icon><Plus /></el-icon>新增模版</el-button>
    </div>
    <el-card style="flex: 1; min-height: 0; overflow: hidden">
      <el-table
        ref="tableRef"
        :data="filteredTemplates"
        border
        size="small"
        class="compact-data-table"
        v-loading="loading"
        empty-text="暂无凭证模版"
        height="100%"
        @header-dragend="onDragEnd"
      >
        <el-table-column prop="template_no" label="模版编号" :width="colWidth('template_no', 120)" />
        <el-table-column prop="template_name" label="模版说明" :width="colWidth('template_name', 200)" />
        <el-table-column prop="voucher_type_name" label="凭证类型" :width="colWidth('voucher_type_name', 120)" />
        <el-table-column prop="entries_count" label="分录数量" :width="colWidth('entries_count', 100)" align="center" />
        <el-table-column prop="created_at" label="创建时间" :width="colWidth('created_at', 180)">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 250)" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="primary" size="small" @click="handleUseTemplate(row)">使用模版</el-button>
            <el-button link type="info" size="small" @click="handleViewDetail(row)">查看详情</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 查看详情对话框 -->
    <el-dialog v-model="detailDialogVisible" title="模版详情" width="800px">
      <div v-if="currentTemplate">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="模版编号">{{ currentTemplate.template_no }}</el-descriptions-item>
          <el-descriptions-item label="模版说明">{{ currentTemplate.template_name }}</el-descriptions-item>
          <el-descriptions-item label="凭证类型">{{ currentTemplate.voucher_type_name || '无' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDateTime(currentTemplate.created_at) }}</el-descriptions-item>
        </el-descriptions>

        <div style="margin-top: 20px">
          <div style="font-weight: 600; margin-bottom: 10px">分录明细：</div>
          <el-table :data="currentTemplate.entries" border size="small" class="compact-data-table">
            <el-table-column prop="seq" label="序号" width="60" align="center" />
            <el-table-column prop="account_code" label="科目编码" width="100" />
            <el-table-column prop="account_name" label="科目名称" width="160" />
            <el-table-column label="借方金额" width="120" align="right">
              <template #default="{ row }">
                <span v-if="row.direction === 'debit'">{{ formatMoney(row.amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="贷方金额" width="120" align="right">
              <template #default="{ row }">
                <span v-if="row.direction === 'credit'">{{ formatMoney(row.amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="summary" label="摘要" min-width="150" />
          </el-table>
        </div>
      </div>
    </el-dialog>

    <!-- 编辑模版对话框 -->
    <VoucherEntryForm
      v-model="editDialogVisible"
      mode="edit"
      :form="editForm"
      :current-entry="currentEntry"
      :voucher-types="voucherTypes"
      :accounts="accounts"
      :aux-categories="auxCategories"
      :total-debit="totalDebit"
      :total-credit="totalCredit"
      :is-balanced="isBalanced"
      :current-entry-aux-categories="currentEntryAuxCategories"
      :is-parent-account="isParentAccount"
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
      :attachments="[]"
      :update-attachments="() => {}"
      :submit-loading="submitLoading"
      @submit="handleSaveSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/api/request'
import { formatAmount } from '@/utils/format'
import dayjs from 'dayjs'
import VoucherEntryForm from '@/components/voucher/VoucherEntryForm.vue'
import { useVoucherForm } from '@/composables/useVoucherForm'
import { useAuxiliaryAccounting } from '@/composables/useAuxiliaryAccounting'
import { useVoucherAuxItems } from '@/composables/useVoucherAuxItems'
import { filterAuxCategoriesForAccount } from '@/utils/accountCashFlow'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('voucher_template')
const router = useRouter()

const templates = ref<any[]>([])
const loading = ref(false)
const searchKeyword = ref('')
const detailDialogVisible = ref(false)
const currentTemplate = ref<any>(null)
const editDialogVisible = ref(false)
const submitLoading = ref(false)
const editingTemplateId = ref('')

// 凭证类型、科目、辅助核算数据
const voucherTypes = ref<any[]>([])
const accounts = ref<any[]>([])
const auxCategories = ref<any[]>([])
const auxItems = ref<any[]>([])

// 使用 composables
const {
  form: editForm,
  currentEntry,
  totalDebit,
  totalCredit,
  isBalanced,
  addEntry,
  removeEntry,
  setCurrentEntry,
  loadVoucher,
  resetForm,
} = useVoucherForm(auxCategories)

const voucherAux = useVoucherAuxItems()

const { currentEntryAuxCategories, getAuxItemNames } = useAuxiliaryAccounting(
  accounts,
  auxCategories,
  currentEntry
)

function isAuxSelectLoading(catId: string) {
  return !!voucherAux.loadingByCategory.value[catId]
}

function ensureAuxSelectedForEntry(entry: any) {
  return voucherAux.ensureSelectedForEntry(entry, currentEntryAuxCategories.value)
}

// 科目相关的辅助方法
const isParentAccount = (accountId: string) => {
  const account = accounts.value.find((a: any) => a.id === accountId)
  return account ? accounts.value.some((a: any) => a.parent_id === accountId) : false
}

const onAccountChange = (entry: any) => {
  const accountId = entry.account_id
  const account = accounts.value.find((a: any) => a.id === accountId)
  if (account) {
    entry.account_code = account.code
    entry.account_name = account.name
  }
}

const onAmountChange = () => {
  // 金额变化时的处理逻辑（如果需要）
}

const filteredTemplates = computed(() => {
  if (!searchKeyword.value) return templates.value
  const keyword = searchKeyword.value.toLowerCase()
  return templates.value.filter(
    t =>
      t.template_no.toLowerCase().includes(keyword) ||
      t.template_name.toLowerCase().includes(keyword)
  )
})

async function loadTemplates() {
  loading.value = true
  try {
    const res = await request.get<any[]>('/voucher-templates', {
      params: { keyword: searchKeyword.value },
    })
    templates.value = res.data
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载模版列表失败')
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  try {
    const [typeRes, accRes, catRes, auxRes] = await Promise.all([
      request.get<any[]>('/base/voucher-types'),
      request.get<any[]>('/base/accounts', { params: { all: 1 } }),
      request.get<any[]>('/base/aux-categories'),
      request.get<any[]>('/base/aux-items'),
    ])
    voucherTypes.value = typeRes.data
    accounts.value = accRes.data
    auxCategories.value = filterAuxCategoriesForAccount(catRes.data || [])
    auxItems.value = auxRes.data
  } catch (error: any) {
    ElMessage.error('加载基础数据失败')
  }
}

async function handleCreate() {
  editingTemplateId.value = ''
  resetForm()
  editDialogVisible.value = true
}

async function handleEdit(row: any) {
  try {
    // 加载模版详情
    const res = await request.get<any>(`/voucher-templates/${row.id}`)
    const template = res.data

    editingTemplateId.value = template.id

    // 构造凭证数据格式
    const voucherData = {
      id: template.id,
      voucher_type_id: template.voucher_type_id || '',
      voucher_no: template.template_no,
      voucher_date: new Date().toISOString().split('T')[0],
      remark: template.remark || '',
      entries: template.entries || [],
    }

    // 加载到表单
    loadVoucher(voucherData as any)

    // 设置模版编号和说明（使用 voucher_no 字段存储模版编号）
    editForm.value.voucher_no = template.template_no
    editForm.value.remark = template.template_name

    editDialogVisible.value = true
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载模版详情失败')
  }
}

function buildTemplateEntries() {
  const validEntries = editForm.value.entries.filter(
    (e: any) => e.account_id && (e.debit_amount > 0 || e.credit_amount > 0)
  )

  return validEntries.map((e: any) => {
    const direction = e.debit_amount > 0 ? 'debit' : 'credit'
    const amount = e.debit_amount > 0 ? e.debit_amount : e.credit_amount

    const auxData: Record<string, any> = {}
    for (const cat of auxCategories.value) {
      const itemId = e[`_${cat.code}_id`]
      if (itemId) {
        const item = auxItems.value.find((i: any) => i.id === itemId)
        if (item) {
          auxData[cat.code] = {
            id: item.id,
            name: item.name,
          }
        }
      }
    }

    return {
      account_id: e.account_id,
      account_code: e.account_code,
      account_name: e.account_name,
      direction,
      amount,
      summary: e.summary,
      aux_data: Object.keys(auxData).length > 0 ? auxData : null,
    }
  })
}

async function handleSaveSubmit() {
  if (!editForm.value.voucher_no?.trim()) {
    ElMessage.warning('请填写模版编号')
    return
  }
  if (!editForm.value.remark?.trim()) {
    ElMessage.warning('请填写模版说明')
    return
  }

  if (!isBalanced.value) {
    ElMessage.warning('借贷不平衡，无法保存')
    return
  }

  const entries = buildTemplateEntries()
  if (entries.length === 0) {
    ElMessage.warning('至少需要一条有效分录')
    return
  }

  submitLoading.value = true
  try {
    const payload = {
      template_no: editForm.value.voucher_no.trim(),
      template_name: editForm.value.remark.trim(),
      voucher_type_id: editForm.value.voucher_type_id || null,
      remark: '',
      entries,
    }

    if (editingTemplateId.value) {
      await request.put(`/voucher-templates/${editingTemplateId.value}`, payload)
      ElMessage.success('模版更新成功')
    } else {
      await request.post('/voucher-templates', payload)
      ElMessage.success('模版创建成功')
    }

    editDialogVisible.value = false
    loadTemplates()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || (editingTemplateId.value ? '更新失败' : '创建失败'))
  } finally {
    submitLoading.value = false
  }
}

async function handleViewDetail(row: any) {
  try {
    const res = await request.get<any>(`/voucher-templates/${row.id}`)
    currentTemplate.value = res.data
    detailDialogVisible.value = true
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载模版详情失败')
  }
}

function handleUseTemplate(row: any) {
  // 跳转到凭证录入页面，携带模版ID参数
  router.push({
    path: '/voucher/entry',
    query: { templateId: row.id },
  })
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定要删除模版「${row.template_no} - ${row.template_name}」吗？`, '删除确认', {
      type: 'warning',
    })

    await request.delete(`/voucher-templates/${row.id}`)
    ElMessage.success('删除成功')
    loadTemplates()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

function formatMoney(val: number) {
  return formatAmount(val || 0)
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return ''
  return dayjs(dateStr).format('YYYY-MM-DD HH:mm:ss')
}

onMounted(() => {
  loadTemplates()
  loadOptions()
})
</script>

<style scoped>
.template-container {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-weight: 600;
  font-size: var(--cw-text-lg);
}

.card-header-actions {
  display: flex;
  align-items: center;
}
</style>
