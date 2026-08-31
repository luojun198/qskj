<template>
  <div class="page page-bank-import">
    
    <!-- 步骤 1：选择文件 + 科目 -->
    <div class="import-step">
      <el-steps :active="step" finish-status="success" simple>
        <el-step title="上传文件" />
        <el-step title="列映射" />
        <el-step title="预览确认" />
      </el-steps>
    </div>

    <!-- Step 0: 上传 -->
    <div v-if="step === 0" class="step-body">
      <div style="margin-bottom:12px">
        <el-button plain size="small" @click="downloadTemplate">
          <el-icon><Download /></el-icon>下载导入模版
        </el-button>
      </div>
      <el-select v-model="accountCode" filterable placeholder="选择银行科目" style="width:260px;margin-bottom:12px">
        <el-option-group label="银行存款科目">
          <el-option v-for="a in bankAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-option-group>
      </el-select>
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls,.csv"
        :on-change="handleFileChange"
        drag
      >
        <el-icon :size="40"><UploadFilled /></el-icon>
        <div class="upload-text">将 Excel/CSV 文件拖到此处，或<em>点击选择</em></div>
      </el-upload>
    </div>

    <!-- Step 1: 列映射 -->
    <div v-if="step === 1" class="step-body">
      <div v-if="profiles[accountCode]" style="margin-bottom:8px">
        <el-alert title="已加载上次列映射配置" type="success" :closable="false" show-icon />
      </div>
      <el-form label-width="90px" size="small">
        <el-form-item label="跳过行数">
          <el-input-number v-model="skipRows" :min="0" :max="20" />
          <span class="tip">（通常跳过文件标题/空行）</span>
        </el-form-item>
        <el-form-item label="表头行号">
          <el-input-number v-model="headerRow" :min="-1" :max="20" />
          <span class="tip">（-1=无表头，则跳过一行）</span>
        </el-form-item>
      </el-form>
      <el-descriptions :column="1" border size="small" title="列映射（下拉选择 Excel 列号）">
        <el-descriptions-item label="日期">
          <el-select v-model="mapping.biz_date" clearable placeholder="选择日期列" style="width:180px">
            <el-option v-for="(v,i) in colOptions" :key="i" :label="'列 ' + colLabel(i) + (i===headerRow?' (表头)':'')" :value="i" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="借方（收入）">
          <el-select v-model="mapping.debit" clearable placeholder="选择借方列" style="width:180px">
            <el-option v-for="(v,i) in colOptions" :key="i" :label="'列 ' + colLabel(i)" :value="i" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="贷方（支出）">
          <el-select v-model="mapping.credit" clearable placeholder="选择贷方列" style="width:180px">
            <el-option v-for="(v,i) in colOptions" :key="i" :label="'列 ' + colLabel(i)" :value="i" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="票据号">
          <el-select v-model="mapping.bill_no" clearable placeholder="选择票据号列" style="width:180px">
            <el-option v-for="(v,i) in colOptions" :key="i" :label="'列 ' + colLabel(i)" :value="i" />
          </el-select>
        </el-descriptions-item>
        <el-descriptions-item label="结算方式">
          <el-select v-model="mapping.settle_type" clearable placeholder="选择结算方式列" style="width:180px">
            <el-option v-for="(v,i) in colOptions" :key="i" :label="'列 ' + colLabel(i)" :value="i" />
          </el-select>
        </el-descriptions-item>
      </el-descriptions>

      <h4 style="margin:12px 0 4px">数据预览（前 10 行）</h4>
      <div class="preview-table">
        <table>
          <thead>
            <tr><th v-for="(_, i) in sampleCols" :key="i" :class="{ mapped: isMapped(i) }">{{ colLabel(i) }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in sampleRows" :key="ri">
              <td v-for="(_, ci) in sampleCols" :key="ci" :class="{ mapped: isMapped(ci) }">{{ row[ci] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="margin-top:12px">
        <el-button @click="step=0">上一步</el-button>
        <el-button type="primary" @click="step=2">下一步：预览确认</el-button>
      </div>
    </div>

    <!-- Step 2: 确认导入 -->
    <div v-if="step === 2" class="step-body">
      <el-alert :title="`即将导入 ${totalRows - skipRows - (headerRow>=0?1:0)} 条记录到「${accountCode}」`" type="warning" show-icon :closable="false" />
      <div style="margin-top:12px">
        <el-button @click="step=1">上一步</el-button>
        <el-button type="success" :loading="importing" @click="handleImport">确认导入</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Download } from '@element-plus/icons-vue'
import { cashierApi } from '@/api/cashier'

const accounts = ref<{ code: string; name: string; is_cash: number; is_bank: number }[]>([])
const bankAccounts = computed(() => accounts.value.filter(a => a.is_bank && !a.is_cash))
const accountCode = ref('')
const step = ref(0)
const importing = ref(false)
const previewId = ref('')
const totalRows = ref(0)
const sampleRows = ref<any[][]>([])
const sampleCols = computed(() => sampleRows.value[0]?.length ?? 0)
const profiles = ref<Record<string, any>>({})
const skipRows = ref(0)
const headerRow = ref(0)
const mapping = reactive<Record<string, number | undefined>>({
  biz_date: undefined, debit: undefined, credit: undefined, bill_no: undefined, settle_type: undefined,
})

const colOptions = computed(() => sampleCols.value)

const colLabel = (i: number) => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return i < 26 ? letters[i] : String(i)
}

const isMapped = (i: number) => Object.values(mapping).includes(i)

function downloadTemplate() {
  const rows = [
    ['日期', '借方金额', '贷方金额', '票据号', '结算方式'],
    ['2026-01-01', '10000.00', '', 'PJ2026001', '转账'],
    ['2026-01-02', '', '5000.00', 'PJ2026002', '现金'],
  ]
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '银行对账单导入模版.csv'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  const res = await cashierApi.getAccounts()
  if (res.code === 0) accounts.value = res.data
  if (bankAccounts.value.length) accountCode.value = bankAccounts.value[0].code
  const pr = await cashierApi.getImportProfiles()
  if (pr.code === 0) profiles.value = pr.data
})

async function handleFileChange(file: any) {
  if (!accountCode.value) return ElMessage.warning('请先选择银行科目')
  const raw = file.raw
  if (!raw) return
  try {
    const res = await cashierApi.uploadStatement(raw)
    if (res.code === 0) {
      previewId.value = res.data.preview_id
      totalRows.value = res.data.total_rows
      sampleRows.value = res.data.sample_rows
      // 加载已保存的列映射
      const saved = profiles.value[accountCode.value]
      if (saved) {
        skipRows.value = saved.skip_rows ?? 0
        headerRow.value = saved.header_row ?? 0
        Object.assign(mapping, saved.mapping ?? {})
      } else {
        // 智能猜测：第一列=日期，第二列=借方，第三列=贷方
        mapping.biz_date = 0
        mapping.debit = 1
        mapping.credit = 2
        mapping.bill_no = undefined
        mapping.settle_type = undefined
      }
      step.value = 1
    }
  } catch { ElMessage.error('文件上传失败') }
}

async function handleImport() {
  importing.value = true
  try {
    const res = await cashierApi.confirmImport({
      preview_id: previewId.value,
      account_code: accountCode.value,
      mapping: mapping as Record<string, number>,
      skip_rows: skipRows.value,
      header_row: headerRow.value,
    })
    if (res.code === 0) {
      ElMessage.success(`导入成功，共 ${res.data.inserted} 条记录`)
      step.value = 0
    }
  } catch { ElMessage.error('导入失败') }
  finally { importing.value = false }
}
</script>

<style scoped>
.page-bank-import { height: 100%; overflow: auto; padding: 16px; }
.import-step { margin-bottom: 16px; }
.step-body { max-width: 720px; }
.upload-text { font-size: 13px; color: var(--el-text-color-secondary); margin-top: 8px; }
.tip { font-size: 12px; color: var(--el-text-color-secondary); margin-left: 8px; }
.preview-table { overflow: auto; max-height: 320px; border: 1px solid var(--el-border-color); border-radius: 4px; }
.preview-table table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
.preview-table th, .preview-table td { border: 1px solid var(--el-border-color-lighter); padding: 2px 8px; white-space: nowrap; }
.preview-table th { background: var(--el-fill-color-light); }
.preview-table th.mapped, .preview-table td.mapped { background: #ecf5ff; font-weight: 600; }
</style>
