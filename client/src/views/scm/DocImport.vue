<template>
  <div class="page page-doc-import">
    <header class="import-header">
      <div class="import-header__left">
        <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
        <h3>单据批量导入</h3>
        <el-select v-model="docType" size="small" style="width:160px" :disabled="busy || created.length > 0" @change="reset">
          <el-option v-for="t in typeOptions" :key="t.code" :label="`${t.name}（${t.code}）`" :value="t.code" />
        </el-select>
      </div>
      <div class="import-header__right">
        <el-button :icon="Download" @click="downloadTemplate">下载导入模板</el-button>
      </div>
    </header>

    <el-steps :active="step" simple class="import-steps">
      <el-step title="下载模板" />
      <el-step title="上传并校验" />
      <el-step title="导入草稿" />
      <el-step title="批量审核生效" />
    </el-steps>

    <!-- 步骤 1/2：上传 -->
    <section v-if="!rows.length && !created.length" class="upload-area">
      <el-upload drag :show-file-list="false" :auto-upload="false" accept=".xlsx,.xls" :on-change="onFilePicked">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">把 Excel 文件拖到此处，或<em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">
            一行一条明细；「单据分组号」相同的行合成一张单据（留空则每行一张）。物料、往来单位、仓库可填编码或名称。
            首个 Sheet 首行为表头，单次最多 {{ maxRows }} 行。
          </div>
        </template>
      </el-upload>
    </section>

    <!-- 校验结果 -->
    <template v-else-if="!created.length">
      <div class="import-summary">
        <el-tag type="info">文件：{{ fileName }}</el-tag>
        <el-tag>{{ rows.length }} 行 → {{ validation?.doc_count ?? 0 }} 张单据</el-tag>
        <el-tag v-if="issues.length" type="danger">{{ issues.length }} 处问题</el-tag>
        <el-tag v-else-if="validation" type="success">校验通过</el-tag>
        <el-button size="small" @click="reset">重新选择文件</el-button>
      </div>

      <el-alert v-if="issues.length" type="warning" :closable="false" show-icon class="import-alert"
        title="存在问题的单据整张不会导入（避免只导入一半明细）。可修正 Excel 后重传，或勾选下方选项仅导入合格单据。" />

      <div class="table-container">
        <el-table v-if="issues.length" :data="issues" size="small" border stripe max-height="260">
          <el-table-column label="Excel 行号" prop="row" width="100" align="center" />
          <el-table-column label="分组号" prop="group_no" width="140" show-overflow-tooltip />
          <el-table-column label="问题" prop="message" min-width="360" show-overflow-tooltip />
        </el-table>
        <el-table :data="validation?.docs || []" size="small" border stripe :max-height="380" style="margin-top:12px">
          <el-table-column label="分组号" prop="group_no" width="140" show-overflow-tooltip />
          <el-table-column label="单据日期" prop="doc_date" width="110" />
          <el-table-column label="往来单位" prop="partner_name" min-width="160" show-overflow-tooltip />
          <el-table-column label="仓库" prop="warehouse_code" width="100" />
          <el-table-column label="明细行数" prop="line_count" width="90" align="right" />
          <el-table-column label="数量合计" prop="total_qty" width="100" align="right" />
          <el-table-column label="金额合计" prop="total_amount" width="120" align="right" />
        </el-table>
        <div v-if="(validation?.doc_count || 0) > 200" class="tip">仅预览前 200 张单据</div>
      </div>

      <footer class="import-footer">
        <el-checkbox v-if="issues.length" v-model="skipInvalid">仅导入校验合格的单据</el-checkbox>
        <el-button v-permission="'scm:import'" type="primary" :loading="busy"
          :disabled="!validation || !validation.doc_count || (issues.length > 0 && !skipInvalid)" @click="doImport">
          导入 {{ validation?.doc_count ?? 0 }} 张草稿单据
        </el-button>
      </footer>
    </template>

    <!-- 导入结果 + 批量审核 -->
    <template v-else>
      <div class="import-summary">
        <el-tag type="success">已导入 {{ created.length }} 张草稿</el-tag>
        <el-tag v-if="saveFailed.length" type="danger">{{ saveFailed.length }} 张保存失败</el-tag>
        <el-tag v-if="auditedIds.size" type="success">已审核 {{ auditedIds.size }} 张</el-tag>
        <el-tag v-if="auditFailed.length" type="danger">审核失败 {{ auditFailed.length }} 张</el-tag>
      </div>

      <el-alert v-if="saveFailed.length" type="error" :closable="false" show-icon class="import-alert"
        :title="`保存失败：${saveFailed.map(f => (f.group_no || '未分组') + '（' + f.message + '）').slice(0, 5).join('；')}${saveFailed.length > 5 ? '…' : ''}`" />

      <el-progress v-if="auditing || auditDone" :percentage="auditPercent" :status="auditFailed.length ? 'warning' : 'success'" style="margin:8px 0" />

      <div class="table-container">
        <el-table :data="created" size="small" border stripe :max-height="420">
          <el-table-column label="单据号" prop="doc_no" width="180" />
          <el-table-column label="分组号" prop="group_no" width="140" show-overflow-tooltip />
          <el-table-column label="金额合计" prop="total_amount" width="120" align="right" />
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag v-if="auditedIds.has(row.id)" type="success" size="small">已审核</el-tag>
              <el-tag v-else-if="failReason(row.id)" type="danger" size="small">审核失败</el-tag>
              <el-tag v-else type="info" size="small">草稿</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审核失败原因" min-width="320" show-overflow-tooltip>
            <template #default="{ row }"><span class="cell-error">{{ failReason(row.id) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="router.push(`/scm/docs/${row.id}/edit`)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <footer class="import-footer">
        <el-checkbox v-model="applyDefaultWh">仓库留空的明细按物料档案默认仓库补齐</el-checkbox>
        <el-button v-permission="'scm:audit'" type="success" :loading="auditing" :disabled="!pendingIds.length" @click="auditAll">
          批量审核生效（{{ pendingIds.length }} 张）
        </el-button>
        <el-button @click="reset">继续导入</el-button>
        <el-button @click="goBack">返回单据列表</el-button>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Download, UploadFilled } from '@element-plus/icons-vue'
import { scmApi, type ScmDocType } from '@/api/scm'

const route = useRoute()
const router = useRouter()

interface Col { key: string; label: string; required?: boolean; note?: string }

const docType = ref(String(route.query.doc_type || 'PI'))
const allTypes = ref<ScmDocType[]>([])
const importTypes = ref<string[]>([])
const columns = ref<Col[]>([])
const maxRows = ref(5000)

const typeOptions = computed(() => allTypes.value.filter(t => importTypes.value.includes(t.code)))

const fileName = ref('')
const rows = ref<Record<string, any>[]>([])
const validation = ref<{ doc_count: number; line_count: number; docs: any[] } | null>(null)
const issues = ref<Array<{ row: number; group_no: string; message: string }>>([])
const skipInvalid = ref(false)
const busy = ref(false)

const created = ref<Array<{ id: string; doc_no: string; group_no: string; total_amount: number }>>([])
const saveFailed = ref<Array<{ group_no: string; message: string }>>([])
const auditedIds = ref<Set<string>>(new Set())
const auditFailed = ref<Array<{ id: string; doc_no: string; message: string }>>([])
const auditing = ref(false)
const auditDone = ref(false)
const applyDefaultWh = ref(true)

const step = computed(() => created.value.length ? 3 : rows.value.length ? 2 : 1)
const pendingIds = computed(() => created.value.filter(c => !auditedIds.value.has(c.id)).map(c => c.id))
const auditPercent = computed(() => created.value.length ? Math.round((auditedIds.value.size + auditFailed.value.length) / created.value.length * 100) : 0)
const failReason = (id: string) => auditFailed.value.find(f => f.id === id)?.message || ''

onMounted(async () => {
  try {
    const [types, cols] = await Promise.all([scmApi.getDocTypes(), scmApi.importDocColumns()])
    allTypes.value = (types as any)?.data ?? types as any
    const c: any = (cols as any)?.data ?? cols
    importTypes.value = c.doc_types
    columns.value = c.columns
    maxRows.value = c.max_rows
    if (!importTypes.value.includes(docType.value)) docType.value = importTypes.value[0]
  } catch (e: any) {
    ElMessage.error(errMsg(e, '加载导入配置失败'))
  }
})

function errMsg(e: any, fallback: string): string {
  return e?.response?.data?.message || e?.message || fallback
}

function goBack() { router.push({ path: '/scm/docs', query: { doc_type: docType.value } }) }

function reset() {
  fileName.value = ''; rows.value = []; validation.value = null; issues.value = []; skipInvalid.value = false
  created.value = []; saveFailed.value = []; auditedIds.value = new Set(); auditFailed.value = []
  auditing.value = false; auditDone.value = false
}

async function downloadTemplate() {
  if (!columns.value.length) return
  const { utils, writeFile } = await import('xlsx')
  const header = columns.value.map(c => c.label + (c.required ? '*' : ''))
  const sample = ['1', '', '', '', '', '', '10', '1.00', '13', '', '', '', '']
  const wb = utils.book_new()
  const ws = utils.aoa_to_sheet([header, sample])
  ws['!cols'] = header.map(() => ({ wch: 16 }))
  utils.book_append_sheet(wb, ws, '导入数据')
  const help = utils.aoa_to_sheet([['列名', '是否必填', '说明'], ...columns.value.map(c => [c.label, c.required ? '是' : '', c.note || ''])])
  help['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 60 }]
  utils.book_append_sheet(wb, help, '填写说明')
  writeFile(wb, `${docType.value}_单据导入模板.xlsx`)
}

async function onFilePicked(file: any) {
  const raw: File | undefined = file?.raw
  if (!raw) return
  try {
    const { read, utils } = await import('xlsx')
    const wb = read(await raw.arrayBuffer(), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: true })
    if (aoa.length < 2) { ElMessage.warning('文件中没有数据行'); return }
    const labelToKey = new Map(columns.value.map(c => [c.label, c.key]))
    const head = (aoa[0] as any[]).map(h => labelToKey.get(String(h ?? '').replace(/[*＊\s]/g, '')))
    const missing = columns.value.filter(c => c.required && !head.includes(c.key)).map(c => c.label)
    if (missing.length) { ElMessage.error(`模板缺少必填列：${missing.join('、')}，请使用下载的模板`); return }
    const out: Record<string, any>[] = []
    aoa.slice(1).forEach((r: any[], i) => {
      if (!r.some(v => String(v ?? '').trim() !== '')) return
      const o: Record<string, any> = { _row: i + 2 }
      head.forEach((k, idx) => { if (k) o[k] = r[idx] })
      out.push(o)
    })
    if (!out.length) { ElMessage.warning('文件中没有数据行'); return }
    if (out.length > maxRows.value) { ElMessage.error(`单次最多 ${maxRows.value} 行，当前 ${out.length} 行，请拆分文件`); return }
    fileName.value = raw.name
    rows.value = out
    await validate()
  } catch (e: any) {
    ElMessage.error(`读取文件失败：${e?.message || e}`)
  }
}

async function validate() {
  busy.value = true
  try {
    const res: any = await scmApi.importDocValidate({ doc_type: docType.value, rows: rows.value })
    const d = res?.data ?? res
    validation.value = d
    issues.value = d.issues || []
  } catch (e: any) {
    ElMessage.error(errMsg(e, '校验失败'))
    reset()
  } finally { busy.value = false }
}

async function doImport() {
  busy.value = true
  try {
    const res: any = await scmApi.importDocs({ doc_type: docType.value, rows: rows.value, skip_invalid: skipInvalid.value })
    const d = res?.data ?? res
    created.value = d.created || []
    saveFailed.value = d.failed || []
    if (!created.value.length) {
      ElMessage.error('没有单据导入成功')
      return
    }
    ElMessage.success(`已导入 ${created.value.length} 张草稿单据`)
  } catch (e: any) {
    ElMessage.error(errMsg(e, '导入失败'))
  } finally { busy.value = false }
}

async function auditAll() {
  const ids = [...pendingIds.value]
  try {
    await ElMessageBox.confirm(`将逐张审核 ${ids.length} 张单据，审核后立即影响库存与往来，成功的即时生效，失败的保留草稿并列出原因。确认继续？`, '批量审核生效', { type: 'warning' })
  } catch { return }
  auditing.value = true; auditDone.value = false
  auditFailed.value = []
  const BATCH = 50
  try {
    for (let i = 0; i < ids.length; i += BATCH) {
      const res: any = await scmApi.auditDocsOneByOne({ ids: ids.slice(i, i + BATCH), apply_item_default_warehouses: applyDefaultWh.value })
      const d = res?.data ?? res
      const next = new Set(auditedIds.value)
      d.succeeded.forEach((s: any) => next.add(s.id))
      auditedIds.value = next
      auditFailed.value = auditFailed.value.concat(d.failed.filter((f: any) => !next.has(f.id)))
    }
    auditDone.value = true
    if (auditFailed.value.length) ElMessage.warning(`审核完成：成功 ${auditedIds.value.size} 张，失败 ${auditFailed.value.length} 张（见列表原因）`)
    else ElMessage.success(`已审核生效 ${auditedIds.value.size} 张单据`)
  } catch (e: any) {
    ElMessage.error(errMsg(e, '批量审核中断，可再次点击继续'))
  } finally { auditing.value = false }
}
</script>

<style scoped>
.page-doc-import { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
.import-header { display: flex; align-items: center; justify-content: space-between; }
.import-header__left { display: flex; align-items: center; gap: 12px; }
.import-header__left h3 { margin: 0; }
.import-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.import-footer { display: flex; align-items: center; gap: 12px; }
.cell-error { color: var(--el-color-danger); }
.tip { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 6px; }
</style>
