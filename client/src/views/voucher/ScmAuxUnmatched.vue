<template>
  <div class="page sau-page">
    <!-- 顶部导航 -->
    <div class="sau-header">
      <div class="sau-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="sau-header__sep">/</span>
        <span class="sau-header__title">辅助核算对应不上</span>
        <el-tag v-if="problems.length" type="warning" size="small" style="margin-left:8px">共 {{ problems.length }} 项</el-tag>
        <el-tag v-if="creatable.length" type="success" effect="plain" size="small" style="margin-left:4px">
          可自动新建 {{ creatable.length }} 项
        </el-tag>
      </div>
      <div class="sau-header__right">
        <el-button v-if="problems.length" @click="gotoScmVoucherSetting(creatable[0] || problems[0])">去设置页手工指定</el-button>
        <el-button v-if="problems.length" :loading="working" @click="handleRecheck">重新检查并生成</el-button>
        <el-button v-if="creatable.length" type="primary" :loading="working" @click="handleAutoCreate">
          自动新建辅助项并重试
        </el-button>
      </div>
    </div>

    <div v-if="!problems.length" class="sau-body sau-body--empty">
      <el-empty description="没有需要处理的未对应项（页面刷新后上下文会丢失，请返回重新生成凭证）">
        <el-button type="primary" @click="goBack">返回</el-button>
      </el-empty>
    </div>

    <div v-else class="sau-body">
      <div class="sau-hint">
        科目挂了辅助核算，但以下资料在总账辅助项目中对应不上，<b>凭证未生成</b>。
        可按进销存资料的编号与名称<b>自动新建</b>总账辅助项目后重试，或到设置页<b>手工指定</b>（含采纳近似建议）。单据未填部门 / 业务员的，可在「直接补填」列选好后补填（已审核单据也可，不影响库存与往来），或点「涉及单据」打开单据修正。<b>修正或指定后返回本页，会自动重新检查并生成凭证。</b>
      </div>
      <el-table :data="problems" size="small" border stripe height="100%" class="sau-table">
        <el-table-column type="index" label="序号" width="54" align="center" />
        <el-table-column label="科目" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">{{ row.accountCode }} {{ row.accountName }}</template>
        </el-table-column>
        <el-table-column label="辅助类别" prop="categoryName" width="110" show-overflow-tooltip />
        <el-table-column label="来源" width="90">
          <template #default="{ row }">{{ row.sourceType ? SOURCE_LABEL[row.sourceType] : '-' }}</template>
        </el-table-column>
        <el-table-column label="单据资料" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ sourceText(row) }}</template>
        </el-table-column>
        <el-table-column label="问题" min-width="230" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag :type="KIND_TYPE[row.kind]" size="small" effect="plain">{{ KIND_LABEL[row.kind] }}</el-tag>
            <span class="sau-desc">{{ describeAuxProblem(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="近似建议" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.suggestions?.length">
              {{ row.suggestions.map((s: any) => `${s.code} ${s.name}`).join('；') }}
            </span>
            <span v-else class="sau-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="涉及单据" min-width="190">
          <template #default="{ row }">
            <template v-if="row.docs?.length">
              <el-button v-for="d in row.docs.slice(0, 3)" :key="d.id" link type="primary" size="small"
                @click="openDoc(d.id)">{{ d.doc_no || '打开单据' }}</el-button>
              <el-tooltip v-if="row.docs.length > 3" placement="top" :content="row.docs.slice(3).map((d: any) => d.doc_no).join('、')">
                <span class="sau-muted">等 {{ row.docs.length }} 张</span>
              </el-tooltip>
            </template>
            <span v-else class="sau-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="hasFillable" label="直接补填" min-width="250">
          <template #default="{ row }">
            <div v-if="canFill(row)" class="sau-fill">
              <el-select v-model="fillValues[fillKey(row)]" filterable clearable size="small" style="flex:1"
                :placeholder="row.sourceType === 'dept' ? '选择部门' : '选择业务员'">
                <el-option v-for="it in fillOptions(row)" :key="it.id" :value="row.sourceType === 'dept' ? it.code : it.name"
                  :label="it.code ? `${it.code} ${it.name}` : it.name" />
              </el-select>
              <el-button size="small" type="primary" :disabled="!fillValues[fillKey(row)]" :loading="filling === fillKey(row)"
                @click="handleFill(row)">补填</el-button>
            </div>
            <span v-else-if="filledKeys.has(fillKey(row))" class="sau-ok">已补填</span>
            <span v-else class="sau-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="hasFailures" label="新建结果" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="failMsg(row)" class="sau-fail">{{ failMsg(row) }}</span>
            <span v-else class="sau-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="gotoScmVoucherSetting(row)">去指定</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { storeToRefs } from 'pinia'
import type { ScmAuxProblem } from '@/api/scmVoucherSetting'
import { scmApi } from '@/api/scm'
import { useScmAuxUnmatchedStore } from '@/stores/scmAuxUnmatched'
import {
  SOURCE_LABEL,
  auxFailKey,
  describeAuxProblem,
  gotoScmVoucherSetting,
  isCreatableAuxProblem,
  openScmDocForFix,
  retryGenerate,
  runAutoCreateAndRetry,
} from '@/utils/scmVoucherAux'

const router = useRouter()
const store = useScmAuxUnmatchedStore()
const { problems, failures } = storeToRefs(store)
const working = ref(false)

const KIND_LABEL: Record<string, string> = {
  unmatched: '找不到', ambiguous: '多个匹配', no_source: '未设来源', empty_source: '单据未填',
}
const KIND_TYPE: Record<string, 'danger' | 'warning' | 'info'> = {
  unmatched: 'danger', ambiguous: 'warning', no_source: 'info', empty_source: 'warning',
}

const creatable = computed(() => problems.value.filter(isCreatableAuxProblem))
const hasFailures = computed(() => Object.keys(failures.value).length > 0)

function sourceText(p: ScmAuxProblem): string {
  if (!p.sourceType) return '-'
  return [p.sourceType !== 'person' ? p.sourceCode : '', p.sourceName].filter(Boolean).join(' ') || '-'
}
function failMsg(p: ScmAuxProblem): string {
  return failures.value[auxFailKey(p)] || ''
}

// ── 单据未填部门 / 业务员：已审核未制证的单据可在本页直接补填（不必反审核） ──
const deptItems = ref<Array<{ id: string; code: string; name: string }>>([])
const personItems = ref<Array<{ id: string; code: string; name: string }>>([])
const fillValues = ref<Record<string, string>>({})
const filledKeys = ref<Set<string>>(new Set())
const filling = ref('')
const fillKey = (p: ScmAuxProblem) => `${p.sourceType}|${p.categoryId}|${(p.docs || []).map(d => d.id).join(',')}`
function canFill(p: ScmAuxProblem): boolean {
  return p.kind === 'empty_source' && (p.sourceType === 'dept' || p.sourceType === 'person')
    && !!p.docs?.length && !filledKeys.value.has(fillKey(p))
}
const hasFillable = computed(() => problems.value.some(p => p.kind === 'empty_source' && (p.sourceType === 'dept' || p.sourceType === 'person')))
const fillOptions = (p: ScmAuxProblem) => (p.sourceType === 'dept' ? deptItems.value : personItems.value)
async function loadFillOptions() {
  try {
    const r = await scmApi.getAuxCategories()
    const cats = r.data || []
    const deptCat = cats.find((c: any) => c.code === 'dept')?.id
    const personCat = cats.find((c: any) => c.code === 'person')?.id
    if (deptCat) deptItems.value = (await scmApi.getAuxItemsByCategory(deptCat)).data || []
    if (personCat) personItems.value = (await scmApi.getAuxItemsByCategory(personCat)).data || []
  } catch { /* 选项加载失败时仍可打开单据修正 */ }
}
async function handleFill(p: ScmAuxProblem) {
  const key = fillKey(p)
  const value = fillValues.value[key]
  if (!value || !p.docs?.length) return
  filling.value = key
  try {
    const body = p.sourceType === 'dept' ? { dept_code: value } : { biz_person: value }
    for (const d of p.docs) await scmApi.updateDocAuxFields(d.id, body)
    filledKeys.value = new Set([...filledKeys.value, key])
    ElMessage.success(`已为 ${p.docs.length} 张单据补填${SOURCE_LABEL[p.sourceType!]}，补完后点「重新检查并生成」`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '补填失败')
  } finally {
    filling.value = ''
  }
}
let fillOptionsLoading: Promise<void> | null = null
const ensureFillOptions = () => {
  if (!hasFillable.value || deptItems.value.length || personItems.value.length || fillOptionsLoading) return
  fillOptionsLoading = loadFillOptions().finally(() => { fillOptionsLoading = null })
}
onMounted(ensureFillOptions)
// 重新检查后问题列表整体替换：补填状态随之清空，仍未解决的行重新可填
watch(problems, () => { filledKeys.value = new Set(); fillValues.value = {}; ensureFillOptions() })

async function openDoc(id: string) {
  try {
    await openScmDocForFix(id)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '打开单据失败')
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/voucher/biz-center')
}

async function run(fn: () => Promise<'done' | 'stay'>, failText: string) {
  if (working.value) return
  working.value = true
  try {
    if (await fn() === 'done') goBack()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || failText)
  } finally {
    working.value = false
  }
}
const handleAutoCreate = () => run(runAutoCreateAndRetry, '自动新建失败')
const handleRecheck = () => run(retryGenerate, '重新检查失败')

// keep-alive：从设置页手工指定后返回本页，自动重新检查并生成凭证（首次挂载也会触发 activated，跳过）
let firstActivated = true
onActivated(() => {
  ensureFillOptions()
  if (firstActivated) { firstActivated = false; return }
  if (problems.value.length && store.retry) void handleRecheck()
})
</script>

<style scoped>
.sau-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.sau-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.sau-header__left { display: flex; align-items: center; }
.sau-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.sau-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.sau-header__right { display: flex; align-items: center; gap: 8px; }
.sau-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px 12px; }
.sau-body--empty { align-items: center; justify-content: center; }
.sau-hint { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-bottom: 10px; line-height: 1.6; }
.sau-table { flex: 1; min-height: 0; }
.sau-desc { margin-left: 6px; }
.sau-muted { color: var(--el-text-color-placeholder); }
.sau-fail { color: var(--el-color-danger); }
.sau-ok { color: var(--el-color-success); }
.sau-fill { display: flex; gap: 4px; align-items: center; }
</style>
