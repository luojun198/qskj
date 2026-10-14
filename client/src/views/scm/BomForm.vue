<template>
  <div class="page bom-form-page">
    <!-- 顶部工具栏 -->
    <div class="bom-form-header">
      <div class="bom-form-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="bom-form-header__sep">/</span>
        <span class="bom-form-header__title">{{ pageTitle }}</span>
      </div>
      <div class="bom-form-header__right">
        <SaveAsButton doc :title="pageTitle" />
        <el-button size="small" @click="goBack">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </div>

    <!-- 表单主体 -->
    <div class="bom-form-body">
      <el-form :model="form" label-width="80px" size="small">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="BOM编码" required>
              <el-input v-model="form.code" :disabled="!!editId" placeholder="BOM唯一编码" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="BOM名称">
              <el-input v-model="form.name" placeholder="选填名称" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="成品物料" required>
              <ItemPicker v-model="form.item_code" placeholder="选择成品物料" @pick="onPickBomProduct" />
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="版本"><el-input v-model="form.version" placeholder="如 1.0" /></el-form-item>
          </el-col>
          <el-col :span="7">
            <el-form-item label="有效期">
              <el-date-picker v-model="effectiveRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="生效" end-placeholder="失效" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="默认版本"><el-switch v-model="form.is_default" :active-value="1" :inactive-value="0" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <div class="bom-lines-toolbar">
        <el-button size="small" plain @click="batchVisible = true"><el-icon><Grid /></el-icon>批量选择组件</el-button>
        <span class="bom-lines-summary">
          共 {{ form.lines.filter((l:any) => l.item_code).length }} 个组件
        </span>
      </div>

      <!-- 组件明细表格 -->
      <el-table v-col-width="'scm_BomForm_1'" :data="form.lines" border size="small" :height="tableHeight" style="width:100%" @cell-click="handleCellClick" class="compact-data-table">
        <el-table-column label="序号" width="52" align="center">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column label="组件物料" min-width="150" prop="item_code">
          <template #default="{ row, $index }">
            <ItemPicker v-if="isEditing($index, 'item_code')" v-model="row.item_code" auto-open :browsable="false" @pick="(item:any) => { row.item_code = item.code; row.item_name = item.name; row.spec = item.spec || ''; row.unit = item.unit; stopEdit() }" v-focus />
            <div v-else class="editable-cell">{{ row.item_code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="170" prop="item_name">
          <template #default="{ row }">
            <div class="static-cell">{{ row.item_name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="规格" min-width="120" prop="spec" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="static-cell">{{ row.spec || '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用量" width="120" align="right" prop="qty">
          <template #default="{ row, $index }">
            <el-input-number v-if="isEditing($index, 'qty')" v-model="row.qty" :min="0" :precision="4" size="small" :controls="false" style="width:100%" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.qty }}</div>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="100" prop="unit">
          <template #default="{ row, $index }">
            <el-input v-if="isEditing($index, 'unit')" v-model="row.unit" size="small" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.unit }}</div>
          </template>
        </el-table-column>
        <el-table-column label="损耗率%" width="100" align="right" prop="scrap_rate">
          <template #default="{ row, $index }">
            <el-input-number v-if="isEditing($index, 'scrap_rate')" v-model="row.scrap_rate" :min="0" :max="100" :precision="2" size="small" :controls="false" style="width:100%" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.scrap_rate }}</div>
          </template>
        </el-table-column>
        <el-table-column label="行类型" width="110">
          <template #header>
            行类型
            <el-tooltip content="主件：用料，进需求/领料/成本上卷。副产品：完工入库时按 BOM 用量 × 完工数自动产出，按物料档案参考成本（无则进价）作固定价值扣减主产品料成本。联产品：同样自动产出，与主产品按「数量 × 参考成本」分摊料成本；人工/制费全部归主产品。" placement="top">
              <el-icon style="vertical-align:middle"><QuestionFilled /></el-icon>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <el-select v-model="row.line_type" size="small" style="width:100%">
              <el-option label="主件" value="component" />
              <el-option label="副产品" value="by_product" />
              <el-option label="联产品" value="co_product" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="替代料组" width="100">
          <template #header>
            替代料组
            <el-tooltip content="同组内优先级最小的为主料（承载用量），其余为替代料；MRP/领料建议按主料计算，主料缺料时提示替代料在库量，领料可直接领替代料" placement="top">
              <el-icon style="vertical-align:middle"><QuestionFilled /></el-icon>
            </el-tooltip>
          </template>
          <template #default="{ row }"><el-input v-model="row.sub_group" size="small" placeholder="同组可替代" /></template>
        </el-table-column>
        <el-table-column label="替代优先级" width="90">
          <template #default="{ row }"><el-input-number v-model="row.sub_priority" size="small" :min="0" :precision="0" :controls="false" :disabled="!row.sub_group" style="width:100%" placeholder="1=主料" /></template>
        </el-table-column>
        <el-table-column label="备注" min-width="140" prop="remark">
          <template #default="{ row, $index }">
            <el-input v-if="isEditing($index, 'remark')" v-model="row.remark" size="small" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.remark }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="50" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" @click="form.lines.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 批量选择组件物料（系统通用模态框，多选） -->
    <ItemBatchPicker v-model="batchVisible" @confirm="onBatchAddLines" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Grid, QuestionFilled } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import ItemPicker from '@/components/scm/ItemPicker.vue'
import ItemBatchPicker from '@/components/scm/ItemBatchPicker.vue'
import { useAutoBlankRow } from '@/composables/useAutoBlankRow'

const route = useRoute()
const router = useRouter()

const isNew = computed(() => route.name === 'ScmBomNew')
const editId = computed(() => isNew.value ? null : (route.params.id as string))
const pageTitle = computed(() => isNew.value ? '新增BOM' : '编辑BOM')
const tableHeight = computed(() => 'calc(100vh - 220px)')

const form = ref<Record<string, any>>({
  code: '', name: '', item_code: '', version: '1.0', effective_date: null, expire_date: null, is_default: 1, lines: []
})
/** 选 BOM 成品：默认名称；外购物料一般不需要 BOM，提示到物料档案改来源（自制 / 委外 / 组装） */
function onPickBomProduct(item: any) {
  if (!form.value.name) form.value.name = item.name + ' BOM'
  if ((item.source_type || 'purchase') === 'purchase') {
    ElMessage.warning(`物料 ${item.code} 在物料档案中的来源是「采购」，MRP 不会展开它的 BOM；如需自制或委外，请到物料档案改来源`)
  }
}
const saving = ref(false)

// 有效期区间（daterange）↔ effective_date/expire_date
const effectiveRange = computed({
  get: (): [string, string] | null => (form.value.effective_date || form.value.expire_date) ? [form.value.effective_date || '', form.value.expire_date || ''] : null,
  set: (v: [string, string] | null) => { form.value.effective_date = v?.[0] || null; form.value.expire_date = v?.[1] || null },
})

// 组件明细表末尾自动保留空行（免点「添加组件物料」；空行保存已过滤）
useAutoBlankRow(() => form.value.lines, () => ({ item_code: '', item_name: '', spec: '', qty: 1, unit: '', scrap_rate: 0, remark: '', line_type: 'component', sub_group: '', sub_priority: 0 }))

const editingCell = ref<{rowIndex: number, field: string} | null>(null)
const vFocus = {
  mounted: (el: HTMLElement) => {
    const input = (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement | null
    if (input) {
      input.focus()
      input.select()
    }
  }
}

function isEditing(rowIndex: number, field: string) {
  return editingCell.value?.rowIndex === rowIndex && editingCell.value?.field === field
}

function handleCellClick(row: any, column: any) {
  const rowIndex = form.value.lines.indexOf(row)
  const field = column.property
  if (['item_code', 'qty', 'unit', 'scrap_rate', 'remark'].includes(field)) {
    editingCell.value = { rowIndex, field }
  }
}

function stopEdit() {
  editingCell.value = null
}

onMounted(async () => {
  if (editId.value) {
    const r = await scmApi.getBom(editId.value)
    if (r.code === 0) {
      const d = r.data as any
      form.value = {
        code: d.code,
        name: d.name,
        item_code: d.item_code,
        version: d.version || '1.0',
        effective_date: d.effective_date || null,
        expire_date: d.expire_date || null,
        is_default: d.is_default === 0 ? 0 : 1,
        lines: (d.lines || []).map((l: any) => ({ ...l, line_type: l.line_type || 'component', sub_group: l.sub_group || '', sub_priority: Number(l.sub_priority) || 0 })),
      }
    }
  } else {
    form.value.lines = [{ item_code: '', item_name: '', spec: '', qty: 1, unit: '', scrap_rate: 0, remark: '', line_type: 'component', sub_group: '', sub_priority: 0 }]
    try {
      const r = await scmApi.getBomNextNo()
      if (r.code === 0) form.value.code = r.data.next_no
    } catch { }
  }
})

const batchVisible = ref(false)
// 批量选择组件：去重后追加到明细，并移除初始的空行
function onBatchAddLines(items: any[]) {
  if (!items || !items.length) return
  const existed = new Set(form.value.lines.map((l: any) => l.item_code).filter(Boolean))
  // 去掉只有空行占位的首行
  form.value.lines = form.value.lines.filter((l: any) => l.item_code)
  for (const it of items) {
    if (existed.has(it.code)) continue
    existed.add(it.code)
    form.value.lines.push({
      item_code: it.code,
      item_name: it.name,
      spec: it.spec || '',
      qty: 1,
      unit: it.unit_name || it.unit || '',
      scrap_rate: 0,
      remark: '',
      // 批量选来的组件默认是主件（用料），与手工新增行一致
      line_type: 'component',
      sub_group: '',
      sub_priority: 0,
    })
  }
}

async function handleSave() {
  if (!form.value.code || !form.value.item_code) return ElMessage.warning('编码和成品物料不能为空')
  const cleanLines = form.value.lines.filter((l: any) => l.item_code && Number(l.qty) > 0)
  if (!cleanLines.length) return ElMessage.warning('请添加至少一行有效组件物料')
  // 主件才计入计划用料 / 领料 / 委外发料；全部是副产品时计划将没有用料（与服务端校验一致）
  if (!cleanLines.some((l: any) => (l.line_type || 'component') === 'component')) {
    return ElMessage.warning('至少需要一行「主件」：副产品 / 联产品不计入用料，全部选成副产品时计划没有用料、无法领料或委外发料')
  }
  
  saving.value = true
  try {
    const payload = { ...form.value, lines: cleanLines }
    if (editId.value) {
      await scmApi.updateBom(editId.value, payload)
    } else {
      await scmApi.createBom(payload)
    }
    ElMessage.success('保存成功')
    goBack()
  } finally {
    saving.value = false
  }
}

function goBack() {
  router.push('/scm/boms')
}
</script>

<style scoped>
.bom-form-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.bom-form-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0;
}
.bom-form-header__left { display: flex; align-items: center; gap: 6px; font-size: var(--cw-text-base); }
.bom-form-header__sep { color: var(--el-text-color-placeholder); }
.bom-form-header__title { font-weight: 600; color: var(--el-text-color-primary); }
.bom-form-header__right { display: flex; gap: 8px; }
.bom-form-body { flex: 1; overflow: auto; padding: 14px 16px; }
.bom-lines-toolbar {
  display: flex; align-items: center; gap: 8px; margin: 10px 0 8px;
}
.bom-lines-summary { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }

.compact-data-table :deep(.el-table__cell) {
  padding: 0;
}
.compact-data-table :deep(.cell) {
  padding: 0 4px;
  line-height: 28px;
}
.editable-cell {
  min-height: 28px;
  cursor: pointer;
  width: 100%;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.editable-cell:hover {
  background-color: var(--el-fill-color-light);
}
</style>
