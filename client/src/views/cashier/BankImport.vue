<template>
  <div class="page page-bank-import">
    <header class="import-header">
      <div class="import-header__left">
        <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
        <h3>对账单导入</h3>
        <span class="import-header__hint">把任意格式的银行流水 Excel / CSV 生成为出纳日记账：选择工作表与表头行，再把文件列对应到本地字段</span>
      </div>
      <div class="import-header__right">
        <span class="label">银行科目</span>
        <el-select v-model="accountCode" filterable placeholder="选择银行科目" style="width:240px" @change="onAccountChange">
          <el-option v-for="a in bankAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-select>
        <!-- FIX-260：外币银行科目——对账单金额按原币导入 -->
        <el-tag v-if="accountCurrency" type="warning" effect="plain" :title="`本科目为 ${accountCurrency} 外币科目，导入金额按 ${accountCurrency} 原币处理`">{{ accountCurrency }} 原币</el-tag>
      </div>
    </header>

    <!-- 上传区 -->
    <section v-if="!previewId" class="upload-area">
      <el-upload
        ref="uploadRef"
        drag
        :show-file-list="false"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls,.csv"
        :on-change="handleFileChange"
        :disabled="uploading"
      >
        <el-icon :size="44"><UploadFilled /></el-icon>
        <div class="upload-text">将银行流水 Excel / CSV 拖到此处，或<em>点击选择</em></div>
        <div class="upload-sub">不限模板；导入后生成出纳日记账（已录入的相同流水按「疑似重复」跳过）。同一科目的映射会被记住，下次按表头名自动回填</div>
      </el-upload>
    </section>

    <template v-else>
      <!-- 文件 / 工作表 / 表头行 / 金额模式 -->
      <el-form inline class="import-options" size="default">
        <el-form-item label="文件">
          <span class="file-name">{{ fileName }}</span>
          <el-button link type="primary" size="small" @click="resetFile">重新选择</el-button>
        </el-form-item>
        <el-form-item label="工作表">
          <el-select v-model="sheetName" style="width:180px" @change="onSheetChange">
            <el-option v-for="s in sheets" :key="s.name" :label="`${s.name}（${s.total_rows} 行）`" :value="s.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="表头行">
          <el-select v-model="headerRow" style="width:150px" @change="onHeaderRowChange">
            <el-option label="无表头" :value="-1" />
            <el-option v-for="(_, i) in sampleRows" :key="i" :label="`第 ${i + 1} 行`" :value="i" />
          </el-select>
          <span class="tip">也可在右侧预览里点行首选择</span>
        </el-form-item>
        <el-form-item label="数据起始行">
          <el-input-number v-model="dataStartRow" :min="0" :max="Math.max(0, totalRows - 1)" :controls="false" style="width:80px" />
          <span class="tip">（第 {{ dataStartRow + 1 }} 行起，共约 {{ Math.max(0, totalRows - dataStartRow) }} 行）</span>
        </el-form-item>
        <el-form-item label="金额列">
          <el-radio-group v-model="amountMode" size="small">
            <el-radio-button value="dc">借方 / 贷方两列</el-radio-button>
            <el-radio-button value="single">一列金额 + 方向</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <!-- 映射方案：命名保存，账套内所有银行科目共用 -->
        <el-form-item label="映射方案">
          <el-select v-model="schemeId" clearable filterable placeholder="不使用（按科目上次映射）" style="width:220px"
            @change="onSchemeChange">
            <el-option v-for="s in schemes" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <el-button type="primary" plain size="small" :icon="FolderAdd" class="scheme-btn" @click="saveScheme">
            {{ activeScheme ? '更新 / 另存方案' : '保存为方案' }}
          </el-button>
          <el-button v-if="activeScheme" link type="danger" size="small" @click="removeScheme">删除</el-button>
        </el-form-item>
        <!-- FIX-262：同科目已有「同日期 + 同金额（票据号都有时也相同）」的日记账视为疑似重复 -->
        <el-form-item label="疑似重复">
          <el-switch v-model="skipDuplicates" active-text="跳过" inactive-text="也导入" inline-prompt />
          <span class="tip">已录入过的同一笔流水不再重复生成</span>
        </el-form-item>
      </el-form>

      <el-alert v-if="profileLoaded" type="success" :closable="false" show-icon class="profile-alert"
        :title="activeScheme
          ? `已套用映射方案「${activeScheme.name}」（按表头名匹配），请核对后导入`
          : '已按该科目上次保存的映射自动回填（优先按表头名匹配），请核对后导入'" />

      <div class="work-area">
        <!-- 列映射 -->
        <section class="mapping-panel">
          <div class="panel-title">列映射（本地字段 ← 文件列）</div>
          <div v-if="pendingFields.length" class="pending-bar">
            <el-icon :size="16"><WarningFilled /></el-icon>
            <span class="pending-bar__text"><b>{{ pendingFields.length }}</b> 项智能匹配待确认，请核对橙色行</span>
            <el-button type="warning" size="small" :icon="Check" @click="confirmAll">全部确认</el-button>
          </div>
          <table class="mapping-table">
            <thead><tr><th style="width:120px">本地字段</th><th>文件列</th></tr></thead>
            <tbody>
              <tr v-for="f in visibleFields" :key="f.key" :class="{ 'is-smart': isSmart(f.key) }">
                <td>
                  <span :class="{ required: f.required }">{{ f.label }}</span>
                  <el-tag v-if="isSmart(f.key)" type="warning" size="small" effect="light" class="smart-tag"
                    title="按表头字面相近自动匹配，请核对">智能匹配</el-tag>
                  <div v-if="f.hint" class="field-hint">{{ f.hint }}</div>
                </td>
                <td>
                  <div class="map-cell">
                    <el-select v-model="mapping[f.key]" clearable filterable placeholder="不导入" size="small"
                      class="map-select" @change="markManual(f.key)">
                      <el-option v-for="i in colCount" :key="i - 1" :label="colOptionLabel(i - 1)" :value="i - 1" />
                    </el-select>
                    <el-button v-if="isSmart(f.key)" type="warning" plain size="small" :icon="Check"
                      title="确认该匹配" @click="markManual(f.key)">确认</el-button>
                  </div>
                  <template v-if="f.key === 'direction' && mapping.direction !== undefined">
                    <div class="dir-flags">
                      <span class="tip">以下值视为收入（其余为支出）：</span>
                      <el-select v-model="inFlags" multiple filterable allow-create default-first-option
                        size="small" style="width:100%" placeholder="输入或选择标志值">
                        <el-option v-for="v in directionCandidates" :key="v" :label="v" :value="v" />
                      </el-select>
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 原始预览 -->
        <section class="raw-panel">
          <div class="panel-title">文件预览（前 {{ sampleRows.length }} 行；点行首「设为表头」；蓝底为已确认映射，橙底为智能匹配待确认）</div>
          <div class="preview-table">
            <table>
              <thead>
                <tr>
                  <th class="row-no">#</th>
                  <th v-for="i in colCount" :key="i - 1" :class="{ mapped: isMapped(i - 1), smart: isSmartCol(i - 1) }">
                    {{ colLabel(i - 1) }}
                    <span v-if="fieldOfCol(i - 1)" class="col-tag">{{ fieldOfCol(i - 1) }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in sampleRows" :key="ri"
                  :class="{ 'is-header': ri === headerRow, 'is-skipped': ri < dataStartRow && ri !== headerRow }">
                  <td class="row-no" @click="setHeaderRow(ri)" :title="ri === headerRow ? '当前表头行' : '设为表头'">
                    <el-radio :model-value="headerRow" :value="ri" size="small" @change="setHeaderRow(ri)">{{ ri + 1 }}</el-radio>
                  </td>
                  <td v-for="i in colCount" :key="i - 1" :class="{ mapped: isMapped(i - 1), smart: isSmartCol(i - 1) }">{{ cellText(row[i - 1]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- 解析预览 -->
      <section class="parsed-panel">
        <div class="panel-title">解析结果预览（按当前映射，前 {{ parsedPreview.length }} 个数据行）</div>
        <el-table :data="parsedPreview" size="small" border max-height="220" empty-text="没有可预览的数据行，请检查数据起始行与列映射">
          <el-table-column label="日期" prop="biz_date" width="110" />
          <el-table-column label="摘要" prop="summary" min-width="160" show-overflow-tooltip />
          <el-table-column label="对方户名" prop="counter_name" min-width="120" show-overflow-tooltip />
          <el-table-column label="借方（收入）" width="120" align="right">
            <template #default="{ row }"><span v-if="row.debit" class="dc">{{ money(row.debit) }}</span></template>
          </el-table-column>
          <el-table-column label="贷方（支出）" width="120" align="right">
            <template #default="{ row }"><span v-if="row.credit" class="cr">{{ money(row.credit) }}</span></template>
          </el-table-column>
          <el-table-column label="余额" width="120" align="right">
            <template #default="{ row }">{{ row.balance == null ? '' : money(row.balance) }}</template>
          </el-table-column>
        </el-table>
      </section>

      <footer class="import-footer">
        <span class="footer-tip">生成到「{{ accountLabel }}」的出纳日记账，日期落在已结账月份的行会被拒绝并列出</span>
        <div>
          <el-button @click="resetFile">重新选文件</el-button>
          <el-button type="primary" :loading="importing" :disabled="!accountCode" @click="handleImport">生成日记账</el-button>
        </div>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Check, FolderAdd, UploadFilled, WarningFilled } from '@element-plus/icons-vue'
import { cashierApi, type ImportProfile, type ImportScheme, type StatementUploadResult } from '@/api/cashier'
import {
  FIELD_DEFS, DEFAULT_IN_FLAGS, colLabel, guessHeaderRow, smartMapByHeader, inferAmountMode,
  applyProfile, schemeFitScore, convertRow, normExcelDate, isTotalRowText, isIsoDate,
  type AmountMode, type MatchSource, type StatementField, type StatementMapping,
} from '@/utils/bankStatementImport'

const route = useRoute()
const router = useRouter()

const accounts = ref<{ code: string; name: string; is_cash: number; is_bank: number; is_foreign?: number; currency_code?: string | null }[]>([])
/** FIX-260：当前科目为外币科目时的币种 */
const accountCurrency = computed(() => {
  const a = accounts.value.find(x => x.code === accountCode.value)
  const code = a && Number(a.is_foreign || 0) === 1 && a.currency_code ? String(a.currency_code).toUpperCase() : ''
  return code && code !== 'CNY' && code !== 'RMB' ? code : ''
})
const bankAccounts = computed(() => accounts.value.filter(a => a.is_bank && !a.is_cash))
const accountCode = ref((route.query.account as string) || '')
const accountLabel = computed(() => {
  const a = accounts.value.find(x => x.code === accountCode.value)
  return a ? `${a.code} ${a.name}` : accountCode.value || '未选择科目'
})

const uploadRef = ref()
const uploading = ref(false)
const importing = ref(false)
const previewId = ref('')
const fileName = ref('')
const sheets = ref<StatementUploadResult['sheets']>([])
const sheetName = ref('')
const profiles = ref<Record<string, ImportProfile>>({})
const profileLoaded = ref(false)
/** 命名映射方案；选中后优先于该科目上次的映射 */
const schemes = ref<ImportScheme[]>([])
const schemeId = ref('')
const activeScheme = computed(() => schemes.value.find(s => s.id === schemeId.value))
const activeProfile = computed<ImportProfile | undefined>(() => activeScheme.value || profiles.value[accountCode.value])

const headerRow = ref(-1)
const dataStartRow = ref(0)
const amountMode = ref<AmountMode>('dc')
const mapping = ref<StatementMapping>({})
/** FIX-262：跳过疑似重复（默认开） */
const skipDuplicates = ref(true)
/** 每个字段映射的来源；smart 表示智能匹配、尚未人工确认 */
const mapSource = ref<Partial<Record<StatementField, MatchSource>>>({})
const inFlags = ref<string[]>([...DEFAULT_IN_FLAGS])

const currentSheet = computed(() => sheets.value.find(s => s.name === sheetName.value))
const sampleRows = computed<any[][]>(() => currentSheet.value?.sample_rows ?? [])
const totalRows = computed(() => currentSheet.value?.total_rows ?? 0)
const colCount = computed(() => sampleRows.value.reduce((n, r) => Math.max(n, r?.length ?? 0), 0))
const headerLabels = computed<string[]>(() => {
  if (headerRow.value < 0) return []
  const row = sampleRows.value[headerRow.value] || []
  return Array.from({ length: colCount.value }, (_, i) => String(row[i] ?? '').trim())
})

const visibleFields = computed(() => FIELD_DEFS.filter(f => !f.mode || f.mode === amountMode.value))

const isMapped = (i: number) =>
  visibleFields.value.some(f => mapping.value[f.key] === i)
const fieldOfCol = (i: number) => visibleFields.value.find(f => mapping.value[f.key] === i)?.label || ''

const isSmart = (key: StatementField) => mapSource.value[key] === 'smart' && mapping.value[key] !== undefined
const isSmartCol = (i: number) => visibleFields.value.some(f => mapping.value[f.key] === i && isSmart(f.key))
/** 当前金额模式下仍待确认的智能匹配字段 */
const pendingFields = computed(() => visibleFields.value.filter(f => isSmart(f.key)))

/** 手动改选 / 清空 / 点「确认」都视为人工确认 */
function markManual(key: StatementField) {
  mapSource.value = { ...mapSource.value, [key]: 'manual' }
}
function confirmAll() {
  const next = { ...mapSource.value }
  for (const f of pendingFields.value) next[f.key] = 'manual'
  mapSource.value = next
}

function cellText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return normExcelDate(v)
  return String(v)
}

function colOptionLabel(i: number): string {
  const head = headerLabels.value[i]
  const sample = cellText(sampleRows.value[dataStartRow.value]?.[i])
  const desc = head || (sample ? `如：${sample}` : '')
  return desc ? `${colLabel(i)} · ${desc}` : colLabel(i)
}

/** 方向列在样例数据行里出现过的去重值，作为「收入标志」候选 */
const directionCandidates = computed(() => {
  const col = mapping.value.direction
  if (col === undefined) return []
  const set = new Set<string>()
  sampleRows.value.forEach((row, ri) => {
    if (ri < dataStartRow.value || ri === headerRow.value) return
    const v = String(row[col] ?? '').trim()
    if (v) set.add(v)
  })
  return [...set]
})

const parsedPreview = computed(() => {
  const out: ReturnType<typeof convertRow>[] = []
  for (let i = dataStartRow.value; i < sampleRows.value.length && out.length < 8; i++) {
    if (i === headerRow.value) continue
    const row = sampleRows.value[i]
    if (mapping.value.biz_date === undefined) break
    const rec = convertRow(row, mapping.value, amountMode.value, inFlags.value)
    if (!rec.biz_date || isTotalRowText(rec.biz_date)) continue
    if (!isIsoDate(rec.biz_date)) rec.biz_date = `${rec.biz_date}（无法识别）`
    out.push(rec)
  }
  return out
})

const money = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** FIX-262：对账单导入生成的是出纳日记账，完成 / 返回都回到出纳录单 */
function goBack() {
  router.push({ path: '/cashier/journal', query: accountCode.value ? { account_code: accountCode.value } : {} })
}

function resetFile() {
  previewId.value = ''
  fileName.value = ''
  sheets.value = []
  sheetName.value = ''
  headerRow.value = -1
  dataStartRow.value = 0
  mapping.value = {}
  mapSource.value = {}
  schemeId.value = ''
  profileLoaded.value = false
  uploadRef.value?.clearFiles?.()
}

function onAccountChange() {
  if (previewId.value) applyDetection()
}

async function handleFileChange(file: any) {
  if (!accountCode.value) {
    uploadRef.value?.clearFiles?.()
    return ElMessage.warning('请先选择银行科目')
  }
  const raw: File | undefined = file.raw
  if (!raw) return
  uploading.value = true
  try {
    const res = await cashierApi.uploadStatement(raw)
    if (res.code !== 0) return
    previewId.value = res.data.preview_id
    fileName.value = res.data.filename
    sheets.value = res.data.sheets
    // 默认选行数最多的工作表（说明页通常很短）
    const best = [...sheets.value].sort((a, b) => b.total_rows - a.total_rows)[0]
    sheetName.value = best?.name || sheets.value[0]?.name || ''
    const [pr, sr] = await Promise.all([cashierApi.getImportProfiles(), cashierApi.getImportSchemes()])
    if (pr.code === 0) profiles.value = pr.data
    if (sr.code === 0) schemes.value = sr.data
    autoPickScheme()
    const saved = activeProfile.value
    if (saved?.sheet_name && sheets.value.some(s => s.name === saved.sheet_name)) sheetName.value = saved.sheet_name
    applyDetection()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '文件上传失败')
    uploadRef.value?.clearFiles?.()
  } finally {
    uploading.value = false
  }
}

function onSheetChange() {
  applyDetection()
}

/**
 * 上传后自动选方案：该科目上次的映射与文件表头完全吻合时沿用它（不选方案）；
 * 否则挑一个所有已映射字段都能按表头名对上、命中字段最多的方案。
 */
function autoPickScheme() {
  schemeId.value = ''
  const rows = sampleRows.value
  const guessed = guessHeaderRow(rows)
  const fit = (p: ImportProfile) => {
    const hr = guessed >= 0 ? guessed : p.header_row ?? -1
    return hr >= 0 && hr < rows.length ? schemeFitScore(p, rows[hr]) : 0
  }
  const own = profiles.value[accountCode.value]
  if (own && fit(own) > 0) return
  let best = 0
  for (const s of schemes.value) {
    const score = fit(s)
    if (score > best) { best = score; schemeId.value = s.id }
  }
}

/** 手动切换方案：切到方案保存的工作表，再按方案回填；清空则回到科目上次的映射 */
function onSchemeChange() {
  const s = activeScheme.value
  if (s?.sheet_name && s.sheet_name !== sheetName.value && sheets.value.some(x => x.name === s.sheet_name)) {
    sheetName.value = s.sheet_name
  }
  applyDetection()
}

/** 当前界面上的导入配置（只含当前金额模式用到的字段），导入与保存方案共用 */
function currentConfig(): ImportProfile & { mapping: StatementMapping } {
  const m = stripUndefined(mapping.value)
  const submitMapping: StatementMapping = {}
  for (const f of visibleFields.value) if (m[f.key] !== undefined) submitMapping[f.key] = m[f.key]
  return {
    sheet_name: sheetName.value,
    header_row: headerRow.value,
    data_start_row: dataStartRow.value,
    amount_mode: amountMode.value,
    mapping: submitMapping,
    direction_in_values: amountMode.value === 'single' && submitMapping.direction !== undefined ? inFlags.value : [],
    header_labels: headerLabels.value,
  }
}

/** 必填列校验，返回提示文案；通过返回空串 */
function mappingError(m: StatementMapping): string {
  if (m.biz_date === undefined) return '请选择「交易日期」对应的文件列'
  if (amountMode.value === 'dc' && m.debit === undefined && m.credit === undefined) return '借方、贷方至少选择一列'
  if (amountMode.value === 'single' && m.amount === undefined) return '请选择「交易金额」对应的文件列'
  return ''
}

async function reloadSchemes() {
  const r = await cashierApi.getImportSchemes()
  if (r.code === 0) schemes.value = r.data
}

/** 把当前映射保存为命名方案：同名覆盖（先确认），改名即另存 */
async function saveScheme() {
  const cfg = currentConfig()
  const err = mappingError(cfg.mapping)
  if (err) return ElMessage.warning(err)
  const pendingNote = pendingFields.value.length ? `（${pendingFields.value.length} 项智能匹配将一并视为已确认）` : ''
  let name: string
  try {
    const r = await ElMessageBox.prompt(
      `方案在本账套所有银行科目间共用，下次上传同格式文件会自动套用${pendingNote}`, '保存映射方案', {
        inputValue: activeScheme.value?.name || fileName.value.replace(/\.[^.]+$/, '').slice(0, 40),
        inputPlaceholder: '如：工商银行流水',
        inputValidator: (v: string) => (v.trim() && v.trim().length <= 40) || '请填写 1~40 个字的方案名称',
        confirmButtonText: '保存', cancelButtonText: '取消',
      })
    name = String(r.value).trim()
  } catch { return }
  const sameName = schemes.value.find(s => s.name === name)
  if (sameName && sameName.id !== activeScheme.value?.id) {
    try {
      await ElMessageBox.confirm(`已有方案「${name}」，要用当前映射覆盖它吗？`, '覆盖方案', { type: 'warning' })
    } catch { return }
  }
  // 名称没变 → 更新当前方案；改了名 → 另存（同名则由服务端按名覆盖）
  const id = activeScheme.value && activeScheme.value.name === name ? activeScheme.value.id : undefined
  const res = await cashierApi.saveImportScheme({ ...cfg, id, name })
  if (res.code !== 0) return
  confirmAll()
  await reloadSchemes()
  schemeId.value = res.data.id
  ElMessage.success(`已保存映射方案「${name}」`)
}

async function removeScheme() {
  const s = activeScheme.value
  if (!s) return
  try {
    await ElMessageBox.confirm(`删除映射方案「${s.name}」？当前页面上的映射不受影响。`, '删除方案', { type: 'warning' })
  } catch { return }
  const res = await cashierApi.deleteImportScheme(s.id)
  if (res.code !== 0) return
  schemeId.value = ''
  profileLoaded.value = false
  await reloadSchemes()
  ElMessage.success('已删除')
}

/** 自动识别表头行，再按表头做列映射；有选中方案 / 该科目已保存的映射时优先按表头名回填 */
function applyDetection() {
  const rows = sampleRows.value
  const saved = activeProfile.value
  let hr = guessHeaderRow(rows)
  if (hr < 0 && saved && typeof saved.header_row === 'number' && saved.header_row < rows.length) hr = saved.header_row
  headerRow.value = hr
  dataStartRow.value = hr >= 0 ? hr + 1 : (saved?.data_start_row ?? saved?.skip_rows ?? 0)
  remapForHeader()
}

/** 按当前表头行重算列映射：已保存映射（按表头名定位）为主，智能匹配补齐（标记为待确认） */
function remapForHeader() {
  const saved = activeProfile.value
  const headerCells = headerRow.value >= 0 ? sampleRows.value[headerRow.value] : null
  const { mapping: auto, sources } = headerCells ? smartMapByHeader(headerCells) : { mapping: {}, sources: {} }
  if (saved?.mapping) {
    const fromProfile = applyProfile(saved, headerCells, colCount.value)
    // 已保存方案占用的列不再给其他字段做智能匹配
    const taken = new Set(Object.values(fromProfile))
    const merged: StatementMapping = {}
    const src: Partial<Record<StatementField, MatchSource>> = {}
    for (const [k, v] of Object.entries(auto) as [StatementField, number][]) {
      if (taken.has(v)) continue
      merged[k] = v
      src[k] = sources[k]
    }
    for (const k of Object.keys(fromProfile) as StatementField[]) {
      merged[k] = fromProfile[k]
      src[k] = 'profile'
    }
    mapping.value = merged
    mapSource.value = src
    // 已保存的金额模式只有在其金额列也回填成功时才沿用，否则按本次识别结果判断
    const profileAmountOk = saved.amount_mode === 'single'
      ? fromProfile.amount !== undefined
      : fromProfile.debit !== undefined || fromProfile.credit !== undefined
    amountMode.value = saved.amount_mode && profileAmountOk ? saved.amount_mode : inferAmountMode(mapping.value)
    inFlags.value = saved.direction_in_values?.length ? [...saved.direction_in_values] : [...DEFAULT_IN_FLAGS]
    profileLoaded.value = Object.keys(fromProfile).length > 0
  } else {
    mapping.value = auto
    mapSource.value = { ...sources }
    amountMode.value = inferAmountMode(auto)
    inFlags.value = [...DEFAULT_IN_FLAGS]
    profileLoaded.value = false
  }
}

function setHeaderRow(ri: number) {
  if (headerRow.value === ri) return
  headerRow.value = ri
  onHeaderRowChange()
}

/** 表头行变化：数据起始行跟随，并按新表头重新识别列映射 */
function onHeaderRowChange() {
  if (headerRow.value >= 0 && dataStartRow.value <= headerRow.value) dataStartRow.value = headerRow.value + 1
  remapForHeader()
}

function stripUndefined(m: StatementMapping): StatementMapping {
  const out: StatementMapping = {}
  for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== null) out[k as StatementField] = v as number
  return out
}

async function handleImport() {
  const err = mappingError(stripUndefined(mapping.value))
  if (err) return ElMessage.warning(err)
  if (pendingFields.value.length) {
    try {
      await ElMessageBox.confirm(
        `以下字段为智能匹配，尚未人工确认：${pendingFields.value.map(f => `「${f.label}」`).join('、')}。确认无误并继续导入吗？`,
        '智能匹配待确认', { type: 'warning', confirmButtonText: '确认并导入', cancelButtonText: '返回核对' })
    } catch { return }
    confirmAll()
  }
  if (!parsedPreview.value.length) {
    try {
      await ElMessageBox.confirm('按当前映射在预览行里没有解析出任何有效记录，仍要导入吗？', '提示', { type: 'warning' })
    } catch { return }
  }
  importing.value = true
  try {
    const cfg = currentConfig()
    const payload = {
      ...cfg,
      preview_id: previewId.value,
      account_code: accountCode.value,
      sheet_name: sheetName.value,
      header_row: headerRow.value,
      data_start_row: dataStartRow.value,
      amount_mode: amountMode.value,
      direction_in_values: cfg.direction_in_values || [],
      header_labels: headerLabels.value,
      skip_duplicates: skipDuplicates.value,
    }
    // 先试算：告诉用户将生成几条、跳过几条疑似重复、几条有错，确认后再写入
    const dry = await cashierApi.confirmImport({ ...payload, dry_run: true })
    if (dry.code !== 0) return
    const d = dry.data
    if (!d.inserted) {
      await ElMessageBox.alert(
        `没有可生成的日记账：共 ${d.total} 行${d.skipped.length ? `，疑似重复 ${d.skipped.length} 行` : ''}${d.errors.length ? `，错误 ${d.errors.length} 行` : ''}。`,
        '对账单导入', { type: 'warning' }).catch(() => {})
      return
    }
    const esc = (t: unknown) => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
    const dupLines = d.skipped.slice(0, 6).map(x =>
      `第 ${x.row} 行 ${x.biz_date} ${x.debit ? `收 ${money(x.debit)}` : `支 ${money(x.credit)}`} ${esc(x.summary)}`).join('<br>')
    const errLines = d.errors.slice(0, 6).map(x => `第 ${x.row} 行：${esc(x.message)}`).join('<br>')
    try {
      await ElMessageBox.confirm(
        `将生成 <b>${d.inserted}</b> 条出纳日记账。`
        + (d.skipped.length ? `<br><br>跳过疑似重复 ${d.skipped.length} 条：<br>${dupLines}${d.skipped.length > 6 ? '<br>…' : ''}` : '')
        + (d.errors.length ? `<br><br>有错误、不导入 ${d.errors.length} 条：<br>${errLines}${d.errors.length > 6 ? '<br>…' : ''}` : ''),
        '确认生成日记账', { type: 'info', dangerouslyUseHTMLString: true, confirmButtonText: '生成', cancelButtonText: '返回核对' })
    } catch { return }

    const res = await cashierApi.confirmImport(payload)
    if (res.code !== 0) return
    const { inserted, skipped, errors } = res.data
    ElMessage.success(`已生成 ${inserted} 条出纳日记账${skipped.length ? `，跳过疑似重复 ${skipped.length} 条` : ''}${errors.length ? `，错误 ${errors.length} 条` : ''}`)
    goBack()
    // 本页被 keep-alive 缓存：清空已导入的文件，下次进入回到上传区（旧 preview_id 已用过）
    resetFile()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

// 切换金额模式时，另一模式的字段保留在 mapping 里但不提交；方向标志候选变化时预勾常见值
watch(directionCandidates, cands => {
  if (!cands.length) return
  const hit = cands.filter(c => DEFAULT_IN_FLAGS.includes(c))
  if (hit.length && !inFlags.value.some(v => cands.includes(v))) inFlags.value = hit
})

// keep-alive 复用：从出纳录单带另一个科目进来时（且没有正在处理的文件），切到该科目
let mounted = false
onActivated(() => {
  if (!mounted || previewId.value) return
  const q = route.query.account as string | undefined
  if (q && bankAccounts.value.some(a => a.code === q)) accountCode.value = q
})

onMounted(async () => {
  mounted = true
  const res = await cashierApi.getAccounts()
  if (res.code === 0) accounts.value = res.data
  if (!accountCode.value || !bankAccounts.value.some(a => a.code === accountCode.value)) {
    accountCode.value = bankAccounts.value[0]?.code || ''
  }
})
</script>

<style scoped>
.page-bank-import {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--page-pad);
  gap: 10px;
  overflow: auto;
}
.import-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.import-header__left { display: flex; align-items: center; gap: 12px; }
.import-header__left h3 { margin: 0; font-size: var(--cw-text-lg); font-weight: 600; }
.import-header__hint { font-size: 12px; color: var(--el-text-color-secondary); }
.import-header__right { display: flex; align-items: center; gap: 8px; }
.import-header__right .label { font-size: var(--cw-text-base); color: var(--el-text-color-regular); }

.upload-area { flex: 1; display: flex; align-items: center; justify-content: center; }
.upload-area :deep(.el-upload-dragger) { width: 560px; padding: 48px 24px; }
.upload-text { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-top: 8px; }
.upload-sub { font-size: 12px; color: var(--el-text-color-placeholder); margin-top: 6px; }

.import-options {
  flex-shrink: 0;
  padding: 6px 12px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}
.import-options :deep(.el-form-item) { margin-bottom: 6px; }
.file-name { font-weight: 600; margin-right: 6px; }
.tip { font-size: 12px; color: var(--el-text-color-secondary); margin-left: 6px; }
.profile-alert { flex-shrink: 0; }

.work-area { display: flex; gap: 12px; min-height: 300px; flex-shrink: 0; }
.mapping-panel { width: 360px; flex-shrink: 0; }
.raw-panel { flex: 1; min-width: 0; }
.panel-title { font-size: var(--cw-text-base); font-weight: 600; margin-bottom: 6px; }

.mapping-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mapping-table th, .mapping-table td { border: 1px solid var(--el-border-color-lighter); padding: 4px 8px; vertical-align: top; }
.mapping-table th { background: var(--el-fill-color-light); text-align: left; }
.mapping-table .required::before { content: '*'; color: var(--el-color-danger); margin-right: 2px; }
.field-hint { font-size: 11px; color: var(--el-text-color-placeholder); margin-top: 2px; }
.dir-flags { margin-top: 4px; }
.scheme-btn { margin-left: 8px; }
.pending-bar {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 6px; padding: 6px 8px;
  border: 1px solid var(--el-color-warning-light-5); border-left: 3px solid var(--el-color-warning);
  border-radius: 4px; background: var(--el-color-warning-light-8);
  color: var(--el-color-warning-dark-2); font-size: 12px;
}
.pending-bar__text { flex: 1; }
.pending-bar__text b { font-size: 14px; }
.mapping-table tr.is-smart td { background: var(--el-color-warning-light-9); }
.smart-tag { margin-left: 4px; }
.map-cell { display: flex; gap: 4px; }
.map-select { flex: 1; min-width: 0; }

.preview-table { overflow: auto; max-height: 420px; border: 1px solid var(--el-border-color); border-radius: 4px; }
.preview-table table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
.preview-table th, .preview-table td { border: 1px solid var(--el-border-color-lighter); padding: 2px 8px; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.preview-table th { background: var(--el-fill-color-light); position: sticky; top: 0; z-index: 1; }
.preview-table th.mapped, .preview-table td.mapped { background: #ecf5ff; }
.preview-table th .col-tag { margin-left: 4px; padding: 0 4px; border-radius: 3px; background: var(--el-color-primary); color: #fff; font-weight: 400; font-size: 11px; }
.preview-table th.smart, .preview-table td.smart { background: var(--el-color-warning-light-9); }
.preview-table th.smart .col-tag { background: var(--el-color-warning); }
.preview-table .row-no { cursor: pointer; background: var(--el-fill-color-light); text-align: center; padding: 0 4px; }
.preview-table .row-no :deep(.el-radio) { margin-right: 0; height: 22px; }
.preview-table .row-no :deep(.el-radio__label) { padding-left: 4px; font-size: 12px; }
.preview-table tr.is-header td { background: #fdf6ec; font-weight: 600; }
.preview-table tr.is-skipped td { color: var(--el-text-color-placeholder); }

.parsed-panel { flex-shrink: 0; }
.dc { color: var(--el-color-success); }
.cr { color: var(--el-color-danger); }

.import-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 8px; border-top: 1px solid var(--el-border-color-lighter); flex-shrink: 0;
}
.footer-tip { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
