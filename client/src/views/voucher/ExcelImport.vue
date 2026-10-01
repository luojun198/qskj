<template>
  <div class="page page-voucher-excel-import">
    <header class="import-header">
      <div class="import-header__left">
        <el-button link :icon="ArrowLeft" @click="router.push('/voucher/entry')">返回</el-button>
        <h3>Excel 转入凭证</h3>
        <span class="import-header__hint">一行一条分录，同一凭证序号的多行合成一张凭证；文件可由录入页「转出」生成</span>
      </div>
      <div class="import-header__right">
        <el-button :icon="Download" :disabled="!columns.length" @click="downloadTemplate">下载模板</el-button>
      </div>
    </header>

    <!-- 转入选项：日期处理 + 编号方式 -->
    <el-form inline class="import-options" size="default">
      <el-form-item label="凭证日期">
        <el-radio-group v-model="options.dateMode" @change="onOptionsChanged">
          <el-radio-button value="original">按 Excel 原日期</el-radio-button>
          <el-radio-button value="monthEnd">统一为指定月份最后一天</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-if="options.dateMode === 'monthEnd'"
          v-model="targetMonth"
          type="month"
          value-format="YYYY-MM"
          placeholder="选择月份"
          :clearable="false"
          class="import-options__month"
          @change="onOptionsChanged"
        />
      </el-form-item>
      <el-form-item label="凭证编号">
        <el-radio-group v-model="options.numberMode" @change="onOptionsChanged">
          <el-radio-button value="auto">按当期最大号顺排</el-radio-button>
          <el-radio-button value="manual">手动起始号</el-radio-button>
        </el-radio-group>
        <el-input-number
          v-if="options.numberMode === 'manual'"
          v-model="options.startNo"
          :min="1"
          :precision="0"
          :controls="false"
          placeholder="起始号"
          class="import-options__no"
          @change="onOptionsChanged"
        />
      </el-form-item>
    </el-form>

    <el-steps :active="step" simple class="import-steps">
      <el-step title="选择文件" />
      <el-step title="数据校验" />
      <el-step title="确认转入" />
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
            仅支持 .xlsx / .xls；首行为表头，数据从第 2 行开始。必填：凭证序号、凭证日期、科目编码、借/贷方金额（二选一）。
          </div>
        </template>
      </el-upload>
    </section>

    <template v-else>
      <div class="import-summary">
        <el-tag type="info">文件：{{ fileName }}</el-tag>
        <el-tag>共 {{ rows.length }} 行</el-tag>
        <el-tag v-if="previews.length" type="success">将生成 {{ previews.length }} 张凭证</el-tag>
        <el-tag v-if="errors.length" type="danger">{{ errorRowCount }} 行有问题</el-tag>
        <el-tag v-else-if="validated" type="success">校验通过</el-tag>
        <el-tag v-if="unknownHeaders.length" type="warning">已忽略无法识别的列：{{ unknownHeaders.join('、') }}</el-tag>
        <el-button size="small" :loading="validating" @click="runValidate">重新校验</el-button>
        <el-button size="small" @click="reset">重新选择文件</el-button>
      </div>

      <el-alert
        v-if="optionErrors.length"
        type="error"
        :closable="false"
        show-icon
        :title="optionErrors.map(e => e.message).join('；')"
        class="import-alert"
      />
      <el-alert
        v-else-if="errors.length"
        type="error"
        :closable="false"
        show-icon
        title="存在校验未通过的数据，修正后重新上传。整批转入要求全部行合法，不会部分写入。"
        class="import-alert"
      />

      <!-- 凭证预览（按分组） -->
      <el-collapse v-if="previews.length" v-model="previewOpen" class="import-preview">
        <el-collapse-item name="preview" :title="`凭证预览（${previews.length} 张）`">
          <el-table :data="previews" size="small" border max-height="220">
            <el-table-column label="凭证序号" prop="seq" width="110" />
            <el-table-column label="凭证类型" prop="voucher_type_name" width="120" />
            <el-table-column label="凭证日期" prop="voucher_date" width="110" />
            <el-table-column label="分录数" prop="entry_count" width="80" align="center" />
            <el-table-column label="借方合计" width="130" align="right">
              <template #default="{ row }">{{ formatAmount(row.total_debit) }}</template>
            </el-table-column>
            <el-table-column label="贷方合计" width="130" align="right">
              <template #default="{ row }">{{ formatAmount(row.total_credit) }}</template>
            </el-table-column>
            <el-table-column label="Excel 行">
              <template #default="{ row }">{{ row.rows.join('、') }}</template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>

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
            :min-width="col.key === 'summary' ? 160 : 100"
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
          <el-table-column label="校验结果" min-width="260" fixed="right">
            <template #default="{ $index }">
              <span v-if="!rowErrors($index + 2).length" class="ok">✓</span>
              <div v-else class="err-list">
                <div v-for="(e, i) in rowErrors($index + 2)" :key="i">{{ e.message }}</div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <footer class="import-footer">
        <el-button
          type="primary"
          :disabled="!validated || !!errors.length || !previews.length"
          :loading="importing"
          @click="doImport"
        >
          确认转入 {{ previews.length }} 张凭证
        </el-button>
        <span v-if="errors.length" class="footer-tip">请先修正 Excel 中的问题行</span>
        <span v-else-if="!validated" class="footer-tip">选项已变更，请先重新校验</span>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Download, UploadFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import {
  voucherExcelApi,
  type VoucherExcelColumn,
  type VoucherExcelImportOptions,
  type VoucherExcelPreview,
  type VoucherExcelRowError,
} from '@/api/voucherExcel'
import { downloadVoucherExcelTemplate, parseVoucherExcelFile } from '@/utils/voucherExcelFormat'
import { useFillHeightTable } from '@/composables/useFillHeightTable'

const router = useRouter()
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()

const columns = ref<VoucherExcelColumn[]>([])
const rows = ref<Record<string, unknown>[]>([])
const errors = ref<VoucherExcelRowError[]>([])
const previews = ref<VoucherExcelPreview[]>([])
const unknownHeaders = ref<string[]>([])
const fileName = ref('')
const validating = ref(false)
const validated = ref(false)
const importing = ref(false)
const previewOpen = ref<string[]>(['preview'])

const options = ref<VoucherExcelImportOptions>({
  dateMode: 'original',
  numberMode: 'auto',
  startNo: 1,
})
const targetMonth = ref(dayjs().format('YYYY-MM'))

const step = computed(() => {
  if (!rows.value.length) return 0
  if (!validated.value || errors.value.length) return 1
  return 2
})

const optionErrors = computed(() => errors.value.filter(e => e.row === 0))
const errorRowCount = computed(() => new Set(errors.value.filter(e => e.row > 0).map(e => e.row)).size)
const rowErrors = (rowNumber: number) => errors.value.filter(e => e.row === rowNumber)
const cellError = (index: number, field: string) =>
  errors.value.some(e => e.row === index + 2 && e.field === field)
const rowClassName = ({ rowIndex }: { rowIndex: number }) =>
  rowErrors(rowIndex + 2).length ? 'row-has-error' : ''

const formatAmount = (n: number) =>
  Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function buildOptions(): VoucherExcelImportOptions {
  const [y, m] = targetMonth.value.split('-').map(Number)
  return {
    dateMode: options.value.dateMode,
    targetYear: options.value.dateMode === 'monthEnd' ? y : undefined,
    targetPeriod: options.value.dateMode === 'monthEnd' ? m : undefined,
    numberMode: options.value.numberMode,
    startNo: options.value.numberMode === 'manual' ? options.value.startNo : undefined,
  }
}

/** 选项影响日期/期间与编号校验，变更后需重新校验 */
function onOptionsChanged() {
  validated.value = false
  if (rows.value.length) void runValidate()
}

async function downloadTemplate() {
  await downloadVoucherExcelTemplate(columns.value)
}

async function onFilePicked(file: any) {
  if (!file?.raw) return
  try {
    const result = await parseVoucherExcelFile(file.raw, columns.value)
    fileName.value = file.name
    rows.value = result.rows
    unknownHeaders.value = result.unknownHeaders
    await runValidate()
  } catch (err: any) {
    ElMessage.error(err?.message || '文件解析失败')
  }
}

/** 校验交给后端，与最终转入共用同一套规则 */
async function runValidate() {
  if (!rows.value.length) return
  validating.value = true
  try {
    const res = await voucherExcelApi.validate(rows.value, buildOptions())
    errors.value = res.data.errors
    previews.value = res.data.vouchers
    validated.value = true
    if (!errors.value.length) ElMessage.success(`校验通过，将生成 ${previews.value.length} 张凭证`)
    else ElMessage.warning(`${errors.value.length} 处问题，请修正后重新上传`)
  } catch {
    // 错误提示由 request 拦截器统一弹出
  } finally {
    validating.value = false
  }
}

async function doImport() {
  const opt = buildOptions()
  const dateDesc =
    opt.dateMode === 'monthEnd' ? `日期统一为 ${targetMonth.value} 月末` : '按 Excel 原日期'
  const noDesc = opt.numberMode === 'manual' ? `从 ${opt.startNo} 号起顺排` : '按当期最大号顺排'
  try {
    await ElMessageBox.confirm(
      `将生成 ${previews.value.length} 张草稿凭证（${dateDesc}，${noDesc}），是否继续？`,
      '确认转入',
      { type: 'warning' }
    )
  } catch {
    return
  }
  importing.value = true
  try {
    const res = await voucherExcelApi.confirm(rows.value, opt)
    ElMessage.success(`转入成功，新增 ${res.data.created} 张凭证（${res.data.voucher_nos.join('、')}）`)
    router.push('/voucher/entry')
  } catch (err: any) {
    const serverErrors = err?.response?.data?.data?.errors
    // 错误提示由 request 拦截器统一弹出；这里只回显行级错误
    if (Array.isArray(serverErrors)) {
      errors.value = serverErrors
    }
  } finally {
    importing.value = false
  }
}

function reset() {
  rows.value = []
  errors.value = []
  previews.value = []
  unknownHeaders.value = []
  fileName.value = ''
  validated.value = false
}

onMounted(async () => {
  const res = await voucherExcelApi.getColumns()
  columns.value = res.data
})
</script>

<style scoped>
.page-voucher-excel-import {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--page-pad);
  gap: 10px;
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

.import-header__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.import-options {
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}

.import-options :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 24px;
}

.import-options__month,
.import-options__no {
  margin-left: 8px;
  width: 140px;
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
  flex-wrap: wrap;
  gap: 10px;
}

.import-alert,
.import-preview {
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
