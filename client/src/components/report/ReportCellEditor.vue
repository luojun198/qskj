<template>
  <div v-if="cell" class="cell-editor">
    <div class="editor-header">
      <h4>单元格编辑</h4>
      <div class="cell-address">{{ cellAddress }}</div>
    </div>

    <el-form label-position="top" size="small">
      <el-form-item label="单元格类型">
        <el-select v-model="localCellType" style="width: 100%">
          <el-option label="文本" value="text" />
          <el-option label="公式" value="formula" />
          <el-option label="数字" value="number" />
          <el-option label="空白" value="empty" />
        </el-select>
      </el-form-item>

      <el-form-item label="文本值">
        <el-input v-model="localTextValue" type="textarea" :rows="3" placeholder="输入文本内容" />
      </el-form-item>

      <el-form-item label="公式">
        <el-input v-model="localFormulaText" type="textarea" :rows="4" placeholder="例如：@ye(1001,4)-@ye(1602,4)" />
      </el-form-item>

      <el-form-item label="格式">
        <el-input v-model="localFormatText" placeholder="例如：#,##0.00" />
      </el-form-item>

      <el-form-item label="执行结果">
        <el-input :model-value="executionDisplayValue" disabled />
      </el-form-item>

      <el-alert v-if="executionError" type="error" :closable="false" show-icon :title="executionError" />
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="支持从 Excel 复制多行多列后，选中左上角目标单元格直接粘贴；也可点击表格单元格直接编辑。"
        class="paste-tip"
      />

      <div class="position-grid">
        <el-form-item label="目标行">
          <el-input-number v-model="targetRow" :min="1" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="目标列">
          <el-input-number v-model="targetCol" :min="1" :step="1" style="width: 100%" />
        </el-form-item>
      </div>

      <div class="editor-actions editor-actions--multi">
        <el-button @click="emitCopy">复制到目标位置</el-button>
        <el-button @click="emitMove">移走到目标位置</el-button>
        <el-button type="primary" @click="emitDraft">应用到草稿</el-button>
      </div>
    </el-form>
  </div>
  <EmptyState v-else type="data" description="请选择一个单元格后再编辑" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import EmptyState from '@/components/EmptyState.vue'

type EditableCell = {
  id: string
  row_index: number
  col_index: number
  cell_type: string
  text_value: string | null
  formula_text: string | null
  format_text: string | null
}

type ExecutionCell = {
  display_value: string
  error: string | null
} | null

const props = defineProps<{
  cell: EditableCell | null
  executionCell?: ExecutionCell
}>()

const emit = defineEmits<{
  updateDraft: [payload: {
    id?: string
    row_index: number
    col_index: number
    cell_type: string
    text_value: string | null
    formula_text: string | null
    format_text: string | null
  }]
  copyCell: [payload: { targetRowIndex: number; targetColIndex: number }]
  moveCell: [payload: { targetRowIndex: number; targetColIndex: number }]
}>()

const localCellType = ref('text')
const localTextValue = ref('')
const localFormulaText = ref('')
const localFormatText = ref('')
const targetRow = ref(1)
const targetCol = ref(1)

watch(
  () => props.cell,
  cell => {
    localCellType.value = cell?.cell_type || 'text'
    localTextValue.value = cell?.text_value || ''
    localFormulaText.value = cell?.formula_text || ''
    localFormatText.value = cell?.format_text || ''
    targetRow.value = (cell?.row_index || 0) + 1
    targetCol.value = (cell?.col_index || 0) + 1
  },
  { immediate: true }
)

const cellAddress = computed(() => {
  if (!props.cell) return ''
  let col = props.cell.col_index
  let name = ''
  do {
    name = String.fromCharCode(65 + (col % 26)) + name
    col = Math.floor(col / 26) - 1
  } while (col >= 0)
  return `${name}${props.cell.row_index + 1}`
})

const executionDisplayValue = computed(() => props.executionCell?.display_value || '')
const executionError = computed(() => props.executionCell?.error || '')

function emitDraft() {
  if (!props.cell) return
  emit('updateDraft', {
    id: props.cell.id || undefined,
    row_index: props.cell.row_index,
    col_index: props.cell.col_index,
    cell_type: localCellType.value,
    text_value: localTextValue.value || null,
    formula_text: localFormulaText.value || null,
    format_text: localFormatText.value || null,
  })
}

function emitCopy() {
  if (!props.cell) return
  emitDraft()
  emit('copyCell', {
    targetRowIndex: Math.max(targetRow.value - 1, 0),
    targetColIndex: Math.max(targetCol.value - 1, 0),
  })
}

function emitMove() {
  if (!props.cell) return
  emitDraft()
  emit('moveCell', {
    targetRowIndex: Math.max(targetRow.value - 1, 0),
    targetColIndex: Math.max(targetCol.value - 1, 0),
  })
}
</script>

<style scoped>
.cell-editor {
  border-left: 1px solid #ebeef5;
  padding-left: 16px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.editor-header h4 {
  margin: 0;
}

.cell-address {
  font-size: 13px;
  color: #909399;
}

.paste-tip {
  margin-top: 12px;
}

.position-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.editor-actions--multi {
  flex-wrap: wrap;
  gap: 8px;
}
</style>
