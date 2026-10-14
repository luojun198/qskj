<template>
  <div class="page page-master-import">
    <header class="import-header">
      <div class="import-header__left">
        <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
        <h3>{{ title }}</h3>
        <el-select v-if="kind === 'partners'" v-model="defaultType" size="small" style="width:170px" :disabled="busy">
          <el-option label="类型留空时：客户兼供应商" value="both" />
          <el-option label="类型留空时：客户" value="customer" />
          <el-option label="类型留空时：供应商" value="supplier" />
        </el-select>
      </div>
      <div class="import-header__right">
        <el-button :icon="Download" @click="downloadTemplate">下载导入模板</el-button>
      </div>
    </header>

    <el-steps :active="step" simple class="import-steps">
      <el-step title="下载模板" />
      <el-step title="上传并预检" />
      <el-step title="导入" />
    </el-steps>

    <section v-if="!rows.length" class="upload-area">
      <el-upload drag :show-file-list="false" :auto-upload="false" accept=".xlsx,.xls" :on-change="onFilePicked">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">把 Excel 文件拖到此处，或<em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">
            一行一个{{ kind === 'items' ? '物料' : '往来单位' }}，首个 Sheet 首行为表头（列名与模板一致，带 * 为必填）。
            导入的档案默认「未审核」；编码已存在时按下面的选项跳过或覆盖。
          </div>
        </template>
      </el-upload>
    </section>

    <template v-else>
      <div class="import-summary">
        <el-tag type="info">文件：{{ fileName }}</el-tag>
        <el-tag>{{ rows.length }} 行</el-tag>
        <template v-if="preview">
          <el-tag type="success">新增 {{ preview.inserted }}</el-tag>
          <el-tag v-if="preview.updated" type="warning">覆盖 {{ preview.updated }}</el-tag>
          <el-tag v-if="preview.skipped" type="info">跳过（编码已存在）{{ preview.skipped }}</el-tag>
          <el-tag v-if="preview.issues.length" type="danger">{{ preview.issues.length }} 行有问题</el-tag>
        </template>
        <el-radio-group v-model="conflict" size="small" :disabled="busy || !!done" @change="validate">
          <el-radio-button value="skip">编码已存在：跳过</el-radio-button>
          <el-radio-button value="overwrite">编码已存在：覆盖</el-radio-button>
        </el-radio-group>
        <el-button size="small" :disabled="busy" @click="reset">重新选择文件</el-button>
      </div>

      <el-alert v-if="preview?.issues.length" type="warning" :closable="false" show-icon class="import-alert"
        title="有问题的行需要先在 Excel 里修正后重新上传；存在问题行时不会导入任何数据（避免只导一半）。" />
      <el-alert v-if="done" type="success" :closable="false" show-icon class="import-alert"
        :title="`导入完成：新增 ${done.inserted}，覆盖 ${done.updated}，跳过 ${done.skipped}。新导入的档案为「未审核」，可在列表勾选后批量审核。`" />

      <div class="table-container">
        <el-table v-if="preview?.issues.length" :data="preview.issues" size="small" border stripe max-height="300">
          <el-table-column label="Excel 行号" prop="row" width="100" align="center" />
          <el-table-column label="编码" prop="code" width="160" show-overflow-tooltip />
          <el-table-column label="问题" prop="message" min-width="420" show-overflow-tooltip />
        </el-table>
        <el-table :data="rows.slice(0, 200)" size="small" border stripe max-height="420" style="margin-top:12px">
          <el-table-column label="行号" prop="_row" width="70" align="center" />
          <el-table-column v-for="c in columns" :key="c.key" :label="c.label" :prop="c.key" min-width="110" show-overflow-tooltip />
        </el-table>
        <div v-if="rows.length > 200" class="tip">仅预览前 200 行</div>
      </div>

      <footer class="import-footer">
        <el-button v-if="!done" type="primary" :loading="busy"
          :disabled="!preview || preview.issues.length > 0 || preview.inserted + preview.updated === 0" @click="doImport">
          导入（新增 {{ preview?.inserted ?? 0 }}，覆盖 {{ preview?.updated ?? 0 }}）
        </el-button>
        <el-button v-else type="primary" @click="goBack">返回{{ kind === 'items' ? '物料档案' : '往来单位' }}</el-button>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Download, UploadFilled } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'

type Result = { total: number; inserted: number; updated: number; skipped: number; issues: Array<{ row: number; code: string; message: string }> }

const route = useRoute()
const router = useRouter()
const kind = computed<'items' | 'partners'>(() => (route.query.kind === 'partners' ? 'partners' : 'items'))
const title = computed(() => (kind.value === 'items' ? '物料档案导入' : '往来单位导入'))
const columns = ref<Array<{ key: string; label: string; required?: boolean; note?: string }>>([])
const defaultType = ref<string>(String(route.query.partner_type || '') || 'both')
const conflict = ref<'skip' | 'overwrite'>('skip')
const fileName = ref('')
const rows = ref<Record<string, any>[]>([])
const preview = ref<Result | null>(null)
const done = ref<Result | null>(null)
const busy = ref(false)
const step = computed(() => (done.value ? 3 : rows.value.length ? 2 : 1))

const MAX_ROWS = 20000
const errMsg = (e: any, fallback: string) => e?.response?.data?.message || e?.message || fallback

function goBack() {
  if (kind.value === 'items') router.push('/scm/items')
  else router.push({ path: '/scm/partners', query: route.query.partner_type ? { partner_type: route.query.partner_type } : {} })
}
function reset() { fileName.value = ''; rows.value = []; preview.value = null; done.value = null }

async function downloadTemplate() {
  if (!columns.value.length) return
  const { utils, writeFile } = await import('xlsx')
  const header = columns.value.map(c => c.label + (c.required ? '*' : ''))
  const sample = kind.value === 'items'
    ? { code: 'A0001', name: '示例物料', spec: '10uF', unit: '个', item_type: '原辅材料', purchase_price: 1.5, batch_flag: '否' }
    : { code: 'K0001', name: '示例客户', partner_type: '客户', contact: '张三', phone: '13800000000', credit_days: 30 }
  const wb = utils.book_new()
  const ws = utils.aoa_to_sheet([header, columns.value.map(c => (sample as any)[c.key] ?? '')])
  ws['!cols'] = header.map(h => ({ wch: Math.max(12, h.length * 2 + 2) }))
  utils.book_append_sheet(wb, ws, '导入数据')
  const help = utils.aoa_to_sheet([['列名', '是否必填', '说明'], ...columns.value.map(c => [c.label, c.required ? '是' : '', c.note || ''])])
  help['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 60 }]
  utils.book_append_sheet(wb, help, '填写说明')
  writeFile(wb, `${title.value}模板.xlsx`)
}

async function onFilePicked(file: any) {
  const raw: File | undefined = file?.raw
  if (!raw) return
  try {
    const { read, utils } = await import('xlsx')
    const wb = read(await raw.arrayBuffer(), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: false })
    if (aoa.length < 2) { ElMessage.warning('文件中没有数据行'); return }
    const labelToKey = new Map(columns.value.map(c => [c.label, c.key]))
    const head = (aoa[0] as any[]).map(h => labelToKey.get(String(h ?? '').replace(/[*＊\s]/g, '')))
    const missing = columns.value.filter(c => c.required && !head.includes(c.key)).map(c => c.label)
    if (missing.length) { ElMessage.error(`缺少必填列：${missing.join('、')}，请使用下载的模板`); return }
    const out: Record<string, any>[] = []
    aoa.slice(1).forEach((r: any[], i) => {
      if (!r.some(v => String(v ?? '').trim() !== '')) return
      const o: Record<string, any> = { _row: i + 2 }
      head.forEach((k, idx) => { if (k) o[k] = r[idx] })
      out.push(o)
    })
    if (!out.length) { ElMessage.warning('文件中没有数据行'); return }
    if (out.length > MAX_ROWS) { ElMessage.error(`单次最多 ${MAX_ROWS} 行，当前 ${out.length} 行，请拆分文件`); return }
    fileName.value = raw.name
    rows.value = out
    done.value = null
    await validate()
  } catch (e: any) {
    ElMessage.error(`读取文件失败：${e?.message || e}`)
  }
}

async function call(dryRun: boolean) {
  const r = await scmApi.importMaster(kind.value, { rows: rows.value, conflict: conflict.value, dry_run: dryRun, default_type: defaultType.value })
  return r.data as Result
}

async function validate() {
  if (!rows.value.length) return
  busy.value = true
  try { preview.value = await call(true) }
  catch (e: any) { ElMessage.error(errMsg(e, '预检失败')) }
  finally { busy.value = false }
}

async function doImport() {
  busy.value = true
  try {
    const r = await call(false)
    if (r.issues.length) { preview.value = r; ElMessage.error('有问题行，未导入'); return }
    done.value = r
    ElMessage.success(`导入完成：新增 ${r.inserted}，覆盖 ${r.updated}`)
  } catch (e: any) {
    ElMessage.error(errMsg(e, '导入失败'))
  } finally { busy.value = false }
}

onMounted(async () => {
  try { columns.value = (await scmApi.getMasterImportColumns(kind.value)).data } catch (e: any) { ElMessage.error(errMsg(e, '加载导入列失败')) }
})
</script>

<style scoped>
.page-master-import { display: flex; flex-direction: column; gap: var(--block-gap); padding: var(--page-pad); }
.import-header { display: flex; align-items: center; justify-content: space-between; }
.import-header__left { display: flex; align-items: center; gap: 12px; }
.import-header__left h3 { margin: 0; }
.import-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.import-footer { display: flex; align-items: center; gap: 12px; }
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
</style>
