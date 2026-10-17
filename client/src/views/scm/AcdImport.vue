<template>
  <div class="page acd-page">
    <!-- 顶部导航 -->
    <header class="acd-header">
      <div class="acd-header__left">
        <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
        <span class="acd-header__sep">/</span>
        <h3>进销存 ACD 导入</h3>
        <el-tag v-if="preview?.meta.company" size="small">{{ preview.meta.company }}</el-tag>
        <el-tag v-if="preview?.dateRange.from" type="info" size="small" effect="plain">
          {{ preview.dateRange.from }} ~ {{ preview.dateRange.to }}
        </el-tag>
      </div>
      <div class="acd-header__right">
        <el-radio-group v-model="tab" size="small">
          <el-radio-button value="import">导入</el-radio-button>
          <el-radio-button value="history">导入历史（{{ batches.length }}）</el-radio-button>
        </el-radio-group>
      </div>
    </header>

    <!-- ═══ 导入 ═══ -->
    <template v-if="tab === 'import'">
      <el-steps :active="step" simple class="acd-steps">
        <el-step title="选择文件" />
        <el-step title="预检" />
        <el-step title="导入" />
        <el-step title="核对报告" />
      </el-steps>

      <!-- 1. 上传 -->
      <section v-if="step === 0" class="acd-upload">
        <el-upload drag :show-file-list="false" :auto-upload="false" accept=".acd" :on-change="onFilePicked" :disabled="busy">
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">把润衡<b>进销存</b>备份文件（.acd）拖到此处，或<em>点击选择</em></div>
          <template #tip>
            <div class="el-upload__tip acd-tip">
              <p>导入到<b>当前账套</b>的进销存模块：物料、往来单位、仓库、订单、出入库单、盘点单、收付款单、发票、对账单，只写进销存数据，不影响总账 / 出纳 / 固定资产。</p>
              <p>口径：单据全部按「已审核」导入并标记「原系统已制证」（不再生成凭证）；出入库成本沿用润衡记录的成本；润衡「成品入库」导为其他入库（收发类别：成品入库）。</p>
              <p>要求：当前账套还没有进销存单据（第一期只支持全量导入）；导入前会自动备份本账套，导入后可整体撤销。</p>
            </div>
          </template>
        </el-upload>
        <div v-if="busy" class="acd-busy"><el-icon class="is-loading"><Loading /></el-icon> 正在解析 {{ fileName }} …</div>
      </section>

      <!-- 2. 预检 -->
      <section v-else-if="step === 1 && preview" class="acd-body">
        <el-alert v-for="b in preview.blockers" :key="b" type="error" :closable="false" show-icon :title="b" />
        <el-alert v-for="w in preview.warnings" :key="w" type="warning" :closable="false" show-icon :title="w" />

        <div class="acd-grid">
          <div class="acd-card">
            <div class="acd-card__title">文件信息</div>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="文件">{{ preview.meta.fileName }}</el-descriptions-item>
              <el-descriptions-item label="单位名称">{{ preview.meta.company || '-' }}</el-descriptions-item>
              <el-descriptions-item label="关联财务账套">{{ preview.meta.linkedAccountSet || '-' }}</el-descriptions-item>
              <el-descriptions-item label="润衡版本">{{ preview.meta.version || '-' }}</el-descriptions-item>
              <el-descriptions-item label="单据日期">{{ preview.dateRange.from || '-' }} ~ {{ preview.dateRange.to || '-' }}</el-descriptions-item>
              <el-descriptions-item label="本账套现有">
                单据 {{ preview.existing.docs }}、物料 {{ preview.existing.items }}、往来 {{ preview.existing.partners }}、仓库 {{ preview.existing.warehouses }}
              </el-descriptions-item>
            </el-descriptions>
          </div>
          <div class="acd-card">
            <div class="acd-card__title">文件中的数据</div>
            <el-table :data="preview.tables" size="small" border>
              <el-table-column label="内容" prop="label" min-width="140" />
              <el-table-column label="润衡表" prop="table" width="90" />
              <el-table-column label="行数" prop="rows" width="80" align="right" />
            </el-table>
          </div>
        </div>

        <div class="acd-grid">
          <div class="acd-card">
            <div class="acd-card__title">单据类型对应</div>
            <el-table :data="docTypeRows" size="small" border>
              <el-table-column label="润衡单据" min-width="120">
                <template #default="{ row }">{{ row.label }}（{{ row.acd }}）</template>
              </el-table-column>
              <el-table-column label="导入为" min-width="140">
                <template #default="{ row }">
                  <span v-if="row.target">{{ typeName(row.target) }}<span v-if="row.note" class="acd-muted">（{{ row.note }}）</span></span>
                  <el-tag v-else type="danger" size="small">暂不支持，跳过</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="张数" prop="count" width="70" align="right" />
              <el-table-column label="明细行" prop="lines" width="80" align="right" />
            </el-table>
          </div>
          <div class="acd-card">
            <div class="acd-card__title">收付款 / 发票 / 对账单</div>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="付款单">{{ preview.finance.payments }} 张，{{ formatAmount(preview.finance.paymentAmount) }}</el-descriptions-item>
              <el-descriptions-item label="收款单">{{ preview.finance.receipts }} 张，{{ formatAmount(preview.finance.receiptAmount) }}</el-descriptions-item>
              <el-descriptions-item label="发票">{{ preview.finance.invoices }} 张，价税合计 {{ formatAmount(preview.finance.invoiceAmount) }}</el-descriptions-item>
              <el-descriptions-item label="对账单">{{ preview.finance.statements }} 张（润衡只有金额和说明，导为已审核的历史对账单）</el-descriptions-item>
              <el-descriptions-item label="结算科目">
                <div v-for="a in preview.finance.settleAccounts" :key="a.lx">
                  {{ a.name || a.lx }} → {{ a.account || '-' }}
                  <el-tag v-if="a.account && !a.exists" type="warning" size="small" effect="plain">出纳账户中不存在</el-tag>
                </div>
              </el-descriptions-item>
            </el-descriptions>
            <div class="acd-muted" style="margin-top:6px">收付款会核销对应的出入库单，但不写出纳日记账（出纳以财务账套为准）；发票按开票金额关联来源单据，不调整往来。</div>
          </div>
        </div>

        <div class="acd-grid">
          <div class="acd-card">
            <div class="acd-card__title">导入选项</div>
            <el-form label-width="110px" size="small">
              <el-form-item label="档案编码冲突">
                <el-radio-group v-model="conflict">
                  <el-radio value="skip">跳过（保留本账套现有档案）</el-radio>
                  <el-radio value="overwrite">覆盖（以润衡档案为准）</el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="冲突档案">
                <span v-if="!conflictCount" class="acd-muted">无</span>
                <span v-else>
                  物料 {{ preview.conflicts.items.length }}、往来 {{ preview.conflicts.partners.length }}、仓库 {{ preview.conflicts.warehouses.length }}
                  <span class="acd-muted">（覆盖的档案撤销导入时无法还原，只能用导入前备份恢复）</span>
                </span>
              </el-form-item>
            </el-form>
          </div>
        </div>
      </section>

      <!-- 3/4. 结果 -->
      <section v-else-if="step >= 2 && result" class="acd-body">
        <el-alert type="success" :closable="false" show-icon
          :title="`导入完成：出入库单 ${sum(result.stats.documents.docs)} 张、订单 ${sum(result.stats.documents.orders)} 张${financeText(result.stats)}`"
          :description="result.backupFile ? `导入前已自动备份本账套：${result.backupFile}` : ''" />
        <AcdReport :stats="result.stats" :report="result.report" :issues="result.issues" />
      </section>

      <footer class="acd-footer">
        <template v-if="step === 1">
          <el-button @click="reset">重新选择文件</el-button>
          <el-button v-permission="'scm:import'" type="primary" :loading="busy" :disabled="!!preview?.blockers.length" @click="doImport">
            开始导入
          </el-button>
        </template>
        <template v-else-if="step >= 2">
          <el-button @click="router.push('/scm/stock')">查看库存</el-button>
          <el-button @click="router.push('/scm/docs')">查看单据</el-button>
          <el-button @click="tab = 'history'">导入历史</el-button>
        </template>
      </footer>
    </template>

    <!-- ═══ 导入历史 ═══ -->
    <section v-else class="acd-body">
      <el-table v-loading="loadingBatches" :data="batches" size="small" border stripe highlight-current-row @current-change="openBatch">
        <el-table-column label="导入时间" prop="created_at" width="160" />
        <el-table-column label="文件" prop="file_name" min-width="220" show-overflow-tooltip />
        <el-table-column label="单位" prop="company_name" min-width="180" show-overflow-tooltip />
        <el-table-column label="单据 / 订单" width="110" align="right">
          <template #default="{ row }">{{ sum(row.stats?.documents.docs) }} / {{ sum(row.stats?.documents.orders) }}</template>
        </el-table-column>
        <el-table-column label="操作人" prop="operator" width="100" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'done'" type="success" size="small">生效</el-tag>
            <el-tag v-else-if="row.status === 'reverted'" type="info" size="small">已撤销</el-tag>
            <el-tag v-else type="warning" size="small">未完成</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="导入前备份" prop="backup_file" min-width="200" show-overflow-tooltip />
      </el-table>

      <template v-if="current">
        <div class="acd-batch-bar">
          <span>批次：{{ current.file_name }}（{{ current.created_at }}）</span>
          <el-tag v-if="current.status === 'reverted'" type="info" size="small">已于 {{ current.reverted_at }} 撤销</el-tag>
          <el-tooltip v-if="current.status === 'done'" :content="current.revert_blocker || '清空本账套进销存业务数据并删除本批新建档案（执行前自动备份）'" placement="top">
            <span>
              <el-button v-permission="'scm:param'" type="danger" plain size="small" :disabled="!!current.revert_blocker" :loading="busy" @click="doRevert">
                撤销本次导入
              </el-button>
            </span>
          </el-tooltip>
        </div>
        <AcdReport v-if="current.stats && current.report" :stats="current.stats" :report="current.report" :issues="current.report.issues || []" />
      </template>
      <el-empty v-else-if="batches.length" description="点击上方批次查看核对报告" :image-size="60" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus'
import { ArrowLeft, Loading, UploadFilled } from '@element-plus/icons-vue'
import { scmAcdImportApi, type AcdImportBatch, type AcdPreview, type AcdImportStats, type AcdVerifyReport, type AcdIssue } from '@/api/scmAcdImport'
import { typeName } from '@/utils/scmDoc'
import { formatAmount } from '@/utils/format'
import AcdReport from '@/components/scm/AcdImportReport.vue'

const router = useRouter()
const tab = ref<'import' | 'history'>('import')
const step = ref(0)
const busy = ref(false)
const file = ref<File | null>(null)
const fileName = ref('')
const preview = ref<AcdPreview | null>(null)
const conflict = ref<'skip' | 'overwrite'>('skip')
const result = ref<{ batchId: string; stats: AcdImportStats; report: AcdVerifyReport; issues: AcdIssue[]; backupFile: string | null } | null>(null)

const batches = ref<AcdImportBatch[]>([])
const loadingBatches = ref(false)
const current = ref<AcdImportBatch | null>(null)

const NOTES: Record<string, string> = { '3': '收发类别：成品入库', B: '收发类别：材料领用', C: '收发类别：其他出库' }
const docTypeRows = computed(() => {
  const p = preview.value
  if (!p) return []
  const rows = p.docTypes.map(d => ({ ...d, note: NOTES[d.acd] || '' }))
  for (const o of p.orders) rows.push({ acd: `订单${o.acd}`, label: o.label, target: o.target, count: o.count, lines: 0, note: '' })
  if (p.countDocs) rows.push({ acd: 'PY/PK', label: '盘盈 / 盘亏', target: 'CK', count: p.countDocs, lines: 0, note: '按盘点单号合并' })
  return rows
})
const conflictCount = computed(() => {
  const c = preview.value?.conflicts
  return c ? c.items.length + c.partners.length + c.warehouses.length : 0
})

const sum = (m?: Record<string, number> | null) => Object.values(m || {}).reduce((s, n) => s + n, 0)
const financeText = (st: AcdImportStats) => {
  const f = st.finance
  if (!f) return ''
  return `、付款 ${f.payments.docs} 张、收款 ${f.receipts.docs} 张、发票 ${f.invoices.RS + f.invoices.RP} 张、对账单 ${f.statements.ar + f.statements.ap} 张`
}
const errMsg = (e: any, fallback: string) => e?.response?.data?.message || e?.message || fallback

function goBack() { router.back() }

function reset() {
  step.value = 0; file.value = null; fileName.value = ''; preview.value = null; result.value = null; conflict.value = 'skip'
}

async function onFilePicked(f: UploadFile) {
  if (!f.raw) return
  if (!/\.acd$/i.test(f.name)) return ElMessage.warning('请选择润衡 .acd 备份文件')
  file.value = f.raw
  fileName.value = f.name
  busy.value = true
  try {
    const r = await scmAcdImportApi.preview(f.raw)
    preview.value = r.data
    step.value = 1
  } catch (e: any) {
    ElMessage.error(errMsg(e, '解析失败'))
  } finally { busy.value = false }
}

async function doImport() {
  if (!file.value || !preview.value) return
  const docs = sum(Object.fromEntries(preview.value.docTypes.filter(d => d.target).map(d => [d.acd, d.count])))
  try {
    await ElMessageBox.confirm(
      `将把「${preview.value.meta.company || fileName.value}」的进销存数据导入当前账套：出入库单 ${docs} 张、订单 ${sum(Object.fromEntries(preview.value.orders.map(o => [o.acd, o.count])))} 张。导入前会自动备份本账套，确认继续？`,
      '确认导入', { type: 'warning', confirmButtonText: '开始导入' })
  } catch { return }
  busy.value = true
  step.value = 2
  try {
    const r = await scmAcdImportApi.execute(file.value, { conflict: conflict.value })
    result.value = r.data
    step.value = 3
    ElMessage.success('导入完成，请查看核对报告')
    loadBatches()
  } catch (e: any) {
    step.value = 1
    ElMessage.error(errMsg(e, '导入失败'))
  } finally { busy.value = false }
}

async function loadBatches() {
  loadingBatches.value = true
  try { batches.value = (await scmAcdImportApi.listBatches()).data } catch (e: any) { ElMessage.error(errMsg(e, '加载导入历史失败')) }
  finally { loadingBatches.value = false }
}

async function openBatch(row: AcdImportBatch | null) {
  if (!row) return
  try { current.value = (await scmAcdImportApi.getBatch(row.id)).data } catch (e: any) { ElMessage.error(errMsg(e, '加载批次失败')) }
}

async function doRevert() {
  if (!current.value) return
  try {
    await ElMessageBox.confirm(
      '撤销将清空本账套全部进销存业务数据（单据、库存、往来台账），并删除本次导入新建的物料、往来单位、仓库等档案。执行前会自动备份本账套，确认撤销？',
      '撤销导入', { type: 'warning', confirmButtonText: '确认撤销', confirmButtonClass: 'el-button--danger' })
  } catch { return }
  busy.value = true
  try {
    const r = await scmAcdImportApi.revert(current.value.id)
    ElMessage.success(`已撤销（撤销前备份：${r.data.backup}）`)
    // 撤销后可重新导入：导入页签若还停在上次的核对报告（没有选择文件入口），回到选择文件
    if (step.value >= 2) reset()
    await loadBatches()
    const again = batches.value.find(b => b.id === current.value?.id)
    if (again) await openBatch(again)
  } catch (e: any) {
    ElMessage.error(errMsg(e, '撤销失败'))
  } finally { busy.value = false }
}

watch(tab, t => { if (t === 'history') loadBatches() })
onMounted(loadBatches)
// keep-alive 复用：上次已导入完成（停在核对报告）时再次进入回到选择文件，报告可在「导入历史」查看；
// 同时刷新导入历史（撤销 / 在别处导入后条数与状态要跟上）
let firstActivate = true
onActivated(() => {
  if (firstActivate) { firstActivate = false; return }
  if (busy.value) return
  if (step.value >= 3) { reset(); tab.value = 'import' }
  loadBatches()
})
</script>

<style scoped>
.acd-page { display: flex; flex-direction: column; gap: var(--block-gap); padding: var(--page-pad); min-height: 0; }
.acd-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.acd-header__left { display: flex; align-items: center; gap: 8px; }
.acd-header__left h3 { margin: 0; font-size: 16px; }
.acd-header__sep { color: var(--el-text-color-placeholder); }
.acd-steps { margin: 0; }
.acd-upload { max-width: 760px; }
.acd-tip p { margin: 4px 0; line-height: 1.6; }
.acd-busy { margin-top: 12px; color: var(--el-text-color-secondary); display: flex; align-items: center; gap: 6px; }
.acd-body { display: flex; flex-direction: column; gap: 12px; }
.acd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 12px; }
.acd-card { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 12px; background: var(--el-bg-color); }
.acd-card__title { font-weight: 600; margin-bottom: 8px; }
.acd-muted { color: var(--el-text-color-secondary); font-size: 12px; }
.acd-footer { display: flex; gap: 12px; justify-content: flex-end; }
.acd-batch-bar { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
</style>
