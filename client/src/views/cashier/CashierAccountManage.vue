<template>
  <div class="page ca-page">
    <!-- 顶部：类型页签 + 操作 -->
    <div class="ca-toolbar">
      <el-radio-group v-model="kind" size="small">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="cash">库存现金</el-radio-button>
        <el-radio-button value="bank">银行存款</el-radio-button>
        <el-radio-button value="other">其他货币资金</el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" size="small" clearable placeholder="编码 / 名称 / 开户行 / 账号" style="width:220px" />
      <el-checkbox v-model="showDisabled" size="small">显示停用</el-checkbox>
      <span class="ca-tip">出纳账户可自定义名称；关联总账科目后才能生成凭证，未关联的账户可正常录单、查账。</span>
      <el-button type="primary" size="small" @click="startCreate"><el-icon><Plus /></el-icon>新增账户</el-button>
    </div>

    <div class="ca-body">
      <!-- 左：账户列表 -->
      <div class="ca-list">
        <el-table :data="filtered" v-loading="loading" border stripe size="small" height="100%" highlight-current-row
          :row-class-name="({ row }) => (row.id === editing?.id ? 'is-editing' : '')" @row-click="startEdit">
          <el-table-column label="编码" prop="code" width="110" />
          <el-table-column label="账户名称" prop="name" min-width="180" show-overflow-tooltip />
          <el-table-column label="类型" width="100"><template #default="{ row }">{{ KIND_LABEL[row.kind] }}</template></el-table-column>
          <el-table-column label="币别" width="70" align="center"><template #default="{ row }">{{ row.currency_code || '本位币' }}</template></el-table-column>
          <el-table-column label="开户行 / 账号" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ [row.bank_name, row.bank_account_no].filter(Boolean).join(' / ') }}</template>
          </el-table-column>
          <el-table-column label="入账科目" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.gl_account_code">{{ row.gl_account_code }} {{ row.gl_account_name || '' }}</span>
              <span v-else class="ca-warn">未关联（不能生成凭证）</span>
            </template>
          </el-table-column>
          <el-table-column label="流水" width="70" align="right"><template #default="{ row }">{{ row.journal_count || '' }}</template></el-table-column>
          <el-table-column label="状态" width="70" align="center">
            <template #default="{ row }"><el-tag size="small" effect="plain" :type="row.is_enabled ? 'success' : 'info'">{{ row.is_enabled ? '启用' : '停用' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="100" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="startEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click.stop="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 右：编辑面板（同页，不弹窗） -->
      <div v-if="editing" class="ca-editor">
        <div class="ca-editor__hd">
          <span>{{ editing.id ? '编辑出纳账户' : '新增出纳账户' }}</span>
          <el-button link size="small" @click="editing = null">关闭</el-button>
        </div>
        <el-form label-width="84px" size="small" class="ca-form">
          <el-form-item label="账户类型" required>
            <el-radio-group v-model="editing.kind">
              <el-radio value="cash">库存现金</el-radio><el-radio value="bank">银行存款</el-radio><el-radio value="other">其他货币资金</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="编码" required>
            <el-input v-model="editing.code" :disabled="!!editing.id && !!editing.journal_count" placeholder="如 ZD001" maxlength="30" />
          </el-form-item>
          <el-form-item label="账户名称" required><el-input v-model="editing.name" placeholder="如 招商银行深圳龙华支行" /></el-form-item>
          <el-form-item label="币别">
            <el-select v-model="editing.currency_code" clearable placeholder="本位币" :disabled="!!editing.id && !!editing.journal_count" style="width:100%">
              <el-option v-for="c in foreignCurrencies" :key="c.code" :label="`${c.code} ${c.name || ''}`" :value="c.code" />
            </el-select>
          </el-form-item>
          <template v-if="editing.kind !== 'cash'">
            <el-form-item label="开户行"><el-input v-model="editing.bank_name" /></el-form-item>
            <el-form-item label="银行账号"><el-input v-model="editing.bank_account_no" /></el-form-item>
          </template>
          <el-form-item label="入账科目">
            <AccountSelect v-model="editing.gl_account_code" placeholder="关联总账末级科目（可空）" :search-keyword="editing.kind === 'cash' ? '库存现金' : editing.kind === 'other' ? '其他货币资金' : '银行存款'" />
            <div class="ca-hint">生成凭证时，现金 / 银行分录记到此科目；不关联则只在出纳记账，不能生成凭证。</div>
          </el-form-item>
          <el-form-item label="启用"><el-switch v-model="enabledSwitch" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="editing.remark" type="textarea" :rows="2" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="save">保存</el-button>
            <el-button @click="editing = null">取消</el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { cashierApi, type CashierAccountRecord } from '@/api/cashier'
import { getCurrencies } from '@/api/currency'
import AccountSelect from '@/components/base/AccountSelect.vue'

const KIND_LABEL: Record<string, string> = { cash: '库存现金', bank: '银行存款', other: '其他货币资金' }
const rows = ref<CashierAccountRecord[]>([])
const loading = ref(false)
const saving = ref(false)
const kind = ref('')
const keyword = ref('')
const showDisabled = ref(false)
const editing = ref<(Partial<CashierAccountRecord> & { journal_count?: number }) | null>(null)
const foreignCurrencies = ref<Array<{ code: string; name?: string }>>([])

const enabledSwitch = computed({
  get: () => Number(editing.value?.is_enabled ?? 1) === 1,
  set: v => { if (editing.value) editing.value.is_enabled = v ? 1 : 0 },
})
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return rows.value.filter(r => (!kind.value || r.kind === kind.value)
    && (showDisabled.value || r.is_enabled)
    && (!kw || [r.code, r.name, r.bank_name, r.bank_account_no].some(v => String(v || '').toLowerCase().includes(kw))))
})

async function load() {
  loading.value = true
  try {
    const r = await cashierApi.listAccountRecords()
    rows.value = r.data || []
  } finally { loading.value = false }
}
function startCreate() {
  editing.value = { code: '', name: '', kind: (kind.value as any) || 'bank', currency_code: null, bank_name: '', bank_account_no: '', gl_account_code: '', is_enabled: 1, remark: '' }
}
function startEdit(row: CashierAccountRecord) {
  editing.value = { ...row, gl_account_code: row.gl_account_code || '' }
}
async function save() {
  const e = editing.value
  if (!e) return
  if (!String(e.code || '').trim()) return ElMessage.warning('请填写账户编码')
  if (!String(e.name || '').trim()) return ElMessage.warning('请填写账户名称')
  saving.value = true
  try {
    const data = { ...e, gl_account_code: e.gl_account_code || null, currency_code: e.currency_code || null }
    if (e.id) await cashierApi.updateAccountRecord(e.id, data)
    else await cashierApi.createAccountRecord(data)
    ElMessage.success('已保存')
    editing.value = null
    await load()
  } catch { /* 请求拦截器已提示原因 */ } finally { saving.value = false }
}
async function remove(row: CashierAccountRecord) {
  try { await ElMessageBox.confirm(`删除出纳账户「${row.code} ${row.name}」？`, '提示', { type: 'warning' }) } catch { return }
  try {
    await cashierApi.deleteAccountRecord(row.id)
    ElMessage.success('已删除')
    if (editing.value?.id === row.id) editing.value = null
    await load()
  } catch { /* 拦截器已提示（有流水的请停用） */ }
}

onMounted(async () => {
  await load()
  try {
    const c = await getCurrencies()
    foreignCurrencies.value = ((c.data || []) as any[]).filter(x => !x.is_base)
  } catch { /* 币别读取失败时只能选本位币 */ }
})
onActivated(load)
</script>

<style scoped>
.ca-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.ca-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ca-tip { flex: 1; font-size: 12px; color: var(--el-text-color-secondary); }
.ca-body { flex: 1; min-height: 0; display: flex; gap: 12px; }
.ca-list { flex: 1; min-width: 0; }
.ca-editor { width: 380px; flex-shrink: 0; border: 1px solid var(--el-border-color-light); border-radius: 6px; background: var(--el-bg-color); overflow: auto; }
.ca-editor__hd { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--el-border-color-lighter); font-weight: 600; }
.ca-form { padding: 12px 14px 4px 4px; }
.ca-hint { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.5; margin-top: 4px; }
.ca-warn { color: var(--el-color-warning); }
:deep(.is-editing) td { background: var(--el-color-primary-light-9) !important; }
</style>
