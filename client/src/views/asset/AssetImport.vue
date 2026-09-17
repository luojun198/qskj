<template>
  <div class="page page-asset-import">
    <header class="import-header">
      <div class="import-header__left">
        <el-button link :icon="ArrowLeft" @click="router.push('/asset/list')">返回</el-button>
        <h3>资产卡片批量导入</h3>
      </div>
      <div class="import-header__right">
        <el-button :icon="Download" @click="downloadTemplate">下载导入模板</el-button>
      </div>
    </header>

    <!-- 步骤条：下载模板 → 上传解析 → 校验 → 导入 -->
    <el-steps :active="step" simple class="import-steps">
      <el-step title="下载模板" />
      <el-step title="上传文件" />
      <el-step title="数据校验" />
      <el-step title="确认导入" />
    </el-steps>

    <section v-if="!rows.length" class="upload-area">
      <el-upload
        drag
        :show-file-list="false"
        :auto-upload="false"
        accept=".xlsx,.xls"
        :on-change="onFilePicked"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">把 Excel 文件拖到此处，或<em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">
            仅支持 .xlsx / .xls；请先下载模板，按模板列填写。首行为表头，数据从第 2 行开始。
          </div>
        </template>
      </el-upload>
    </section>

    <template v-else>
      <div class="import-summary">
        <el-tag type="info">文件：{{ fileName }}</el-tag>
        <el-tag>共 {{ rows.length }} 行</el-tag>
        <el-tag v-if="errors.length" type="danger">{{ errorRowCount }} 行有问题</el-tag>
        <el-tag v-else type="success">校验通过</el-tag>
        <el-button size="small" @click="reset">重新选择文件</el-button>
      </div>

      <el-alert
        v-if="errors.length"
        type="error"
        :closable="false"
        show-icon
        title="存在校验未通过的数据，修正后重新上传。整批导入要求全部行合法，不会部分写入。"
        class="import-alert"
      />

      <div ref="tableContainerRef" class="table-container">
        <el-table
          :data="rows"
          size="small"
          border
          stripe
          :height="tableHeight"
          :row-class-name="rowClassName"
        >
          <el-table-column label="行号" width="64" align="center">
            <template #default="{ $index }">{{ $index + 2 }}</template>
          </el-table-column>
          <el-table-column
            v-for="col in columns"
            :key="col.key"
            :label="col.label"
            :min-width="col.key === 'asset_name' || col.key === 'install_place' ? 140 : 110"
            show-overflow-tooltip
          >
            <template #header>
              {{ col.label }}<span v-if="col.required" class="req">*</span>
            </template>
            <template #default="{ row, $index }">
              <span :class="cellError($index, col.key) ? 'cell-error' : ''">
                {{ row[col.key] ?? '' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="校验结果" min-width="240" fixed="right">
            <template #default="{ $index }">
              <span v-if="!rowErrors(($index + 2)).length" class="ok">✓</span>
              <div v-else class="err-list">
                <div v-for="(e, i) in rowErrors($index + 2)" :key="i">{{ e.message }}</div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <footer class="import-footer">
        <el-button
          v-permission="'asset:edit'"
          type="primary"
          :disabled="!!errors.length"
          :loading="importing"
          @click="doImport"
        >
          确认导入 {{ rows.length }} 张卡片
        </el-button>
        <span v-if="errors.length" class="footer-tip">请先修正 Excel 中的问题行</span>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Download, UploadFilled } from '@element-plus/icons-vue'
import { fixedAssetApi, type ImportColumn, type ImportRowError } from '@/api/fixedAsset'
import { useFillHeightTable } from '@/composables/useFillHeightTable'

const router = useRouter()
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()

const columns = ref<ImportColumn[]>([])
const rows = ref<Record<string, unknown>[]>([])
const errors = ref<ImportRowError[]>([])
const fileName = ref('')
const importing = ref(false)

const step = computed(() => {
  if (!rows.value.length) return 1
  if (errors.value.length) return 2
  return 3
})

const errorRowCount = computed(() => new Set(errors.value.map(e => e.row)).size)

const rowErrors = (rowNumber: number) => errors.value.filter(e => e.row === rowNumber)

const cellError = (index: number, field: string) =>
  errors.value.some(e => e.row === index + 2 && e.field === field)

const rowClassName = ({ rowIndex }: { rowIndex: number }) =>
  rowErrors(rowIndex + 2).length ? 'row-has-error' : ''

/** 生成并下载导入模板（表头 + 一行示例） */
async function downloadTemplate() {
  const { utils, writeFile } = await import('xlsx')
  const header = columns.value.map(c => (c.required ? `${c.label}*` : c.label))
  const sample = [
    'GD0001',
    '示例设备',
    '01',
    '01',
    '01',
    '01',
    '2026-01-05',
    '2026-01-15',
    '12000',
    '0.05',
    '1',
    '120',
    '',
    '0',
    '0',
    '1',
    '台',
    '张三',
    '李四',
    '一号车间',
    '示例行，导入前请删除',
  ]
  const ws = utils.aoa_to_sheet([header, sample])
  ws['!cols'] = columns.value.map(c => ({ wch: Math.max(10, c.label.length * 2 + 2) }))
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, '资产卡片')
  writeFile(wb, '固定资产卡片导入模板.xlsx')
}

/** 解析 Excel：按表头中文名反查列 key，容忍列顺序调整与必填星号 */
async function onFilePicked(file: any) {
  if (!file?.raw) return
  fileName.value = file.name

  const { utils, read } = await import('xlsx')
  const buffer = await file.raw.arrayBuffer()
  const workbook = read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })

  if (matrix.length < 2) {
    ElMessage.warning('文件中没有数据行')
    return
  }

  const header = (matrix[0] as unknown[]).map(h => String(h ?? '').replace(/\*$/, '').trim())
  const labelToKey = new Map(columns.value.map(c => [c.label, c.key]))
  const keyByIndex = header.map(h => labelToKey.get(h) ?? null)

  if (!keyByIndex.some(Boolean)) {
    ElMessage.error('表头无法识别，请使用「下载导入模板」中的表头')
    return
  }

  const parsed: Record<string, unknown>[] = []
  for (const raw of matrix.slice(1)) {
    const arr = raw as unknown[]
    const obj: Record<string, unknown> = {}
    keyByIndex.forEach((key, i) => {
      if (!key) return
      const v = arr[i]
      obj[key] = v instanceof Date ? v.toISOString().slice(0, 10) : v
    })
    // 整行为空则跳过（Excel 常见的尾部空行）
    if (Object.values(obj).every(v => v == null || String(v).trim() === '')) continue
    parsed.push(obj)
  }

  if (!parsed.length) {
    ElMessage.warning('文件中没有有效数据行')
    return
  }

  rows.value = parsed
  await runValidate()
}

/** 校验交给后端，与最终导入共用同一套规则，避免前后端规则漂移 */
async function runValidate() {
  const res = await fixedAssetApi.validateImport(rows.value)
  errors.value = res.data.errors
  if (!errors.value.length) ElMessage.success(`校验通过，共 ${rows.value.length} 行`)
  else ElMessage.warning(`${errorRowCount.value} 行存在问题，请修正后重新上传`)
}

async function doImport() {
  importing.value = true
  try {
    const res = await fixedAssetApi.batchImport(rows.value)
    ElMessage.success(`导入成功，新增 ${res.data.successCount} 张资产卡片`)
    router.push('/asset/list')
  } finally {
    importing.value = false
  }
}

function reset() {
  rows.value = []
  errors.value = []
  fileName.value = ''
}

onMounted(async () => {
  const res = await fixedAssetApi.getImportColumns()
  columns.value = res.data
})
</script>

<style scoped>
.page-asset-import {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 14px 18px;
  gap: 12px;
  overflow: hidden;
}

.import-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.import-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.import-header__left h3 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
}

.import-steps {
  flex-shrink: 0;
}

.upload-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.import-summary {
  display: flex;
  align-items: center;
  gap: 10px;
}

.import-alert {
  flex-shrink: 0;
}

.table-container {
  flex: 1;
  min-height: 0;
}

.req {
  color: var(--el-color-danger);
  margin-left: 2px;
}

.cell-error {
  color: var(--el-color-danger);
  font-weight: 600;
}

:deep(.row-has-error) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}

.err-list {
  font-size: 12px;
  color: var(--el-color-danger);
  line-height: 1.5;
}

.ok {
  color: var(--el-color-success);
}

.import-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.footer-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
