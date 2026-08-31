<template>
  <div class="page cs-page">
    <!-- 顶部导航 -->
    <div class="cs-header">
      <div class="cs-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="cs-header__sep">/</span>
        <span class="cs-header__title">列方案设置</span>
        <el-tag size="small" type="info" effect="plain" style="margin-left:8px">为不同用户分配单据列显示方案</el-tag>
      </div>
      <div class="cs-header__right">
        <el-button type="primary" :disabled="!docType" @click="openCreate">
          <el-icon><Plus /></el-icon>新建方案
        </el-button>
      </div>
    </div>

    <div class="cs-body">
      <!-- 筛选条件 -->
      <div class="cs-toolbar">
        <el-radio-group v-model="target" size="small" @change="onScopeChange">
          <el-radio-button value="line">单据明细表</el-radio-button>
          <el-radio-button value="header">单据表头</el-radio-button>
          <el-radio-button value="footer">单据表尾</el-radio-button>
          <el-radio-button value="list">单据列表</el-radio-button>
        </el-radio-group>
        <el-select v-model="docType" placeholder="选择单据类型" size="small" filterable style="width:220px" @change="onDocTypeChange">
          <el-option v-for="t in docTypes" :key="t.code" :label="`${t.name}（${t.code}）`" :value="t.code" />
        </el-select>
        <span class="cs-toolbar__hint">{{ scopeHint }}</span>
      </div>

      <!-- 方案列表 -->
      <el-table v-loading="loading" :data="schemes" border size="small" class="cs-table" empty-text="该范围暂无方案，点右上角「新建方案」">
        <el-table-column label="方案名称" prop="name" min-width="160" show-overflow-tooltip />
        <el-table-column label="隐藏的列" min-width="260">
          <template #default="{ row }">
            <template v-if="row.hidden_cols.length">
              <el-tag v-for="k in row.hidden_cols" :key="k" size="small" type="info" effect="plain" class="cs-tag">{{ labelOf(k) }}</el-tag>
            </template>
            <span v-else class="cs-muted">不隐藏任何列（全显示）</span>
          </template>
        </el-table-column>
        <el-table-column label="已分配用户" min-width="180">
          <template #default="{ row }">
            <template v-if="row.user_ids.length">
              <el-tag v-for="uid in row.user_ids" :key="uid" size="small" class="cs-tag">{{ userName(uid) }}</el-tag>
            </template>
            <span v-else class="cs-muted">未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 编辑面板（内联，避免弹窗） -->
      <div v-if="editing" class="cs-edit">
        <div class="cs-edit__hd">
          <span>{{ editing.id ? '编辑方案' : '新建方案' }}</span>
          <el-tag size="small" type="info" effect="plain">{{ scopeLabel }}</el-tag>
        </div>
        <el-form label-width="90px" class="cs-edit__body">
          <el-form-item label="方案名称" required>
            <el-input v-model="editing.name" size="small" placeholder="如：销售报价-精简版" style="max-width:320px" />
          </el-form-item>
          <el-form-item :label="isFieldScope ? '隐藏的字段' : '隐藏的列'">
            <el-checkbox-group v-model="editing.hidden_cols">
              <el-checkbox v-for="c in optCols" :key="c.key" :value="c.key" size="small">{{ c.label }}</el-checkbox>
            </el-checkbox-group>
            <div v-if="!optCols.length" class="cs-muted cs-edit__tip">该范围暂无可隐藏的{{ isFieldScope ? '字段' : '列' }}（表尾需先在「单据自定义字段」配置表尾字段）。</div>
            <div class="cs-muted cs-edit__tip">{{ hideTip }}</div>
          </el-form-item>
          <el-form-item label="分配用户">
            <el-select v-model="editing.user_ids" multiple filterable size="small" placeholder="选择应用此方案的用户" style="max-width:480px">
              <el-option v-for="u in users" :key="u.id" :label="u.nickname ? `${u.nickname}（${u.username}）` : u.username" :value="u.id" />
            </el-select>
            <div class="cs-muted cs-edit__tip">一个用户在同一「范围+单据类型」下只能属于一个方案，重复分配会自动从旧方案移出。</div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="small" :loading="saving" @click="save">保存</el-button>
            <el-button size="small" @click="editing = null">取消</el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import { scmApi, type ColScheme, type ColSchemeUser, type ScmDocType, type ScmDocFieldDef } from '@/api/scm'
import { optColsFor, HEADER_OPT_COLS, type ColMeta } from '@/config/scmColumns'

const router = useRouter()
type Target = 'line' | 'list' | 'header' | 'footer'
const target = ref<Target>('line')
const docType = ref('')
const docTypes = ref<ScmDocType[]>([])
const schemes = ref<ColScheme[]>([])
const users = ref<ColSchemeUser[]>([])
const customFields = ref<ScmDocFieldDef[]>([])  // 表头/表尾范围下，当前单据类型的自定义字段
const loading = ref(false)
const saving = ref(false)

interface EditState { id: string | null; name: string; hidden_cols: string[]; user_ids: string[] }
const editing = ref<EditState | null>(null)

/** 是否「字段范围」（表头/表尾，可隐藏自定义字段）；line/list 为「列范围」 */
const isFieldScope = computed(() => target.value === 'header' || target.value === 'footer')
const parseCfg = (s?: string): string[] => { try { return s ? JSON.parse(s) : [] } catch { return [] } }

/** 当前范围可隐藏项：line/list 用静态列；header=标准表头字段(按类型配置)+表头自定义字段；footer=表尾自定义字段 */
const optCols = computed<ColMeta[]>(() => {
  if (target.value === 'line' || target.value === 'list') return optColsFor(target.value)
  if (target.value === 'header') {
    const t = docTypes.value.find(d => d.code === docType.value)
    const cfg = new Set<string>([...parseCfg(t?.header_fields), 'operator', 'remark', 'tax_rate'])
    const std = HEADER_OPT_COLS.filter(c => cfg.has(c.key))
    const custom = customFields.value.filter(f => f.position === 'header').map(f => ({ key: f.field_key, label: f.field_name }))
    return [...std, ...custom]
  }
  // footer：仅自定义字段
  return customFields.value.filter(f => f.position === 'footer').map(f => ({ key: f.field_key, label: f.field_name }))
})

const SCOPE_NAMES: Record<Target, string> = { line: '明细表', header: '单据表头', footer: '单据表尾', list: '单据列表' }
const scopeHint = computed(() =>
  isFieldScope.value
    ? '先选「范围 + 单据类型」，再建方案勾选要隐藏的字段并分配；表头含标准字段与自定义字段，表尾为自定义字段。'
    : '先选「应用范围 + 单据类型」，再为该范围创建并分配方案')
const hideTip = computed(() =>
  isFieldScope.value
    ? '勾选的字段将对被分配用户隐藏；隐藏≠删除（字段值仍随单据保存）。隐藏必填字段可能导致无法录入，请谨慎。'
    : '勾选的列将对被分配用户隐藏；未勾选的正常显示。核心列（物料/数量/金额等）始终显示，不在此。')
const scopeLabel = computed(() => {
  const t = docTypes.value.find(d => d.code === docType.value)
  return `${SCOPE_NAMES[target.value]} · ${t ? t.name : docType.value}`
})

function labelOf(key: string): string {
  return optCols.value.find(c => c.key === key)?.label || key
}
function userName(id: string): string {
  const u = users.value.find(x => x.id === id)
  return u ? (u.nickname || u.username) : id
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/scm/docs')
}

async function onScopeChange() {
  editing.value = null
  await loadCustomFields()
  await loadSchemes()
}
async function onDocTypeChange() {
  editing.value = null
  await loadCustomFields()
  await loadSchemes()
}

/** 表头/表尾范围下，加载当前单据类型的自定义字段（仅 is_visible≠0，已全局隐藏的不必再进方案）。 */
async function loadCustomFields() {
  if (!isFieldScope.value || !docType.value) { customFields.value = []; return }
  try {
    const res = await scmApi.getDocFieldDefs(docType.value)
    customFields.value = res.code === 0 ? (res.data as ScmDocFieldDef[]).filter(f => f.is_visible !== 0) : []
  } catch { customFields.value = [] }
}

async function loadSchemes() {
  if (!docType.value) { schemes.value = []; return }
  loading.value = true
  try {
    const res = await scmApi.getColSchemes({ target: target.value, doc_type: docType.value })
    if (res.code === 0) schemes.value = res.data
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = { id: null, name: '', hidden_cols: [], user_ids: [] }
}
function openEdit(row: ColScheme) {
  editing.value = { id: row.id, name: row.name, hidden_cols: [...row.hidden_cols], user_ids: [...row.user_ids] }
}

async function save() {
  const e = editing.value
  if (!e) return
  if (!e.name.trim()) { ElMessage.warning('请填写方案名称'); return }
  saving.value = true
  try {
    let schemeId = e.id
    if (schemeId) {
      await scmApi.updateColScheme(schemeId, { name: e.name.trim(), hidden_cols: e.hidden_cols })
    } else {
      const res = await scmApi.createColScheme({ target: target.value, doc_type: docType.value, name: e.name.trim(), hidden_cols: e.hidden_cols })
      schemeId = (res.data as any).id
    }
    if (schemeId) await scmApi.assignColScheme(schemeId, e.user_ids)
    ElMessage.success('保存成功')
    editing.value = null
    await loadSchemes()
  } finally {
    saving.value = false
  }
}

async function remove(row: ColScheme) {
  try {
    await ElMessageBox.confirm(`确认删除方案「${row.name}」？已分配用户将恢复为默认全列显示。`, '删除确认', { type: 'warning' })
  } catch { return }
  const res = await scmApi.deleteColScheme(row.id)
  if (res.code === 0) {
    ElMessage.success('已删除')
    if (editing.value?.id === row.id) editing.value = null
    await loadSchemes()
  }
}

onMounted(async () => {
  const [tRes, uRes] = await Promise.all([
    scmApi.getDocTypes().catch(() => ({ code: -1, data: [] as ScmDocType[] })),
    scmApi.getColSchemeUsers().catch(() => ({ code: -1, data: [] as ColSchemeUser[] })),
  ])
  if (tRes.code === 0) docTypes.value = tRes.data
  if (uRes.code === 0) users.value = uRes.data
})
</script>

<style scoped>
.cs-page { display: flex; flex-direction: column; height: 100%; }
.cs-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light); background: var(--el-bg-color);
}
.cs-header__left { display: flex; align-items: center; }
.cs-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.cs-header__title { font-weight: 600; font-size: 15px; }
.cs-body { flex: 1; overflow: auto; padding: 14px 16px; }
.cs-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.cs-toolbar__hint { font-size: 12px; color: var(--el-text-color-placeholder); }
.cs-table { width: 100%; }
.cs-tag { margin: 2px 4px 2px 0; }
.cs-muted { color: var(--el-text-color-placeholder); font-size: 12px; }
.cs-edit {
  margin-top: 16px; border: 1px solid var(--el-border-color-light); border-radius: var(--radius-md);
  background: var(--el-fill-color-lighter);
}
.cs-edit__hd {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter); font-weight: 600;
}
.cs-edit__body { padding: 14px; }
.cs-edit__tip { margin-top: 4px; line-height: 1.5; }
</style>
