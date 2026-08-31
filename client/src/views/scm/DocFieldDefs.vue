<template>
  <div class="page doc-field-defs-page">
    <!-- 顶部导航 -->
    <div class="dfd-header">
      <div class="dfd-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="dfd-header__sep">/</span>
        <span class="dfd-header__title">单据自定义字段</span>
      </div>
      <div v-if="canConfig" class="dfd-header__right">
        <el-button size="small" :disabled="!currentType" @click="openCopy">复制到其他单据类型</el-button>
        <el-button type="primary" size="small" :loading="saving" :disabled="!currentType" @click="handleSave">保存</el-button>
      </div>
    </div>

    <div class="dfd-body">
      <el-alert v-if="!canConfig" type="warning" :closable="false" show-icon
        title="无配置权限"
        description="配置单据自定义字段需要「供应链参数」权限，请联系管理员开通。" />

      <template v-else>
        <div class="dfd-toolbar">
          <span class="dfd-label">单据类型</span>
          <el-select v-model="currentType" filterable placeholder="请选择单据类型" style="width:260px" size="small" @change="loadDefs">
            <el-option v-for="t in types" :key="t.code" :label="configuredTypes.has(t.code) ? `${t.name}（${t.code}）  ● 已配置` : `${t.name}（${t.code}）`" :value="t.code" />
          </el-select>
          <span class="dfd-tip">表头字段显示在录入页顶部；表体字段显示为明细表自定义列（按行录入）；表尾字段显示在明细表下方。「显示」关掉则该字段不在录入页渲染（定义与历史值保留）。</span>
        </div>

        <!-- 已配置概览：打开即可看到各单据已配的自定义字段，点击行进入编辑 -->
        <div class="dfd-overview">
          <div class="dfd-overview__hd">已配置自定义字段的单据</div>
          <el-table v-if="overviewGroups.length" :data="overviewGroups" border size="small" style="width:100%"
                    class="dfd-overview__table" :row-class-name="ovRowClass" @row-click="(row:any) => selectType(row.doc_type)">
            <el-table-column label="单据类型" min-width="170">
              <template #default="{ row }">{{ row.name }}（{{ row.doc_type }}）</template>
            </el-table-column>
            <el-table-column label="字段数" width="80" align="center" prop="count" />
            <el-table-column label="表头字段" min-width="180">
              <template #default="{ row }">{{ row.header.length ? row.header.join('、') : '—' }}</template>
            </el-table-column>
            <el-table-column label="表体字段" min-width="180">
              <template #default="{ row }">{{ row.body.length ? row.body.join('、') : '—' }}</template>
            </el-table-column>
            <el-table-column label="表尾字段" min-width="180">
              <template #default="{ row }">{{ row.footer.length ? row.footer.join('、') : '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click.stop="selectType(row.doc_type)">编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="dfd-overview__empty">尚未为任何单据配置自定义字段。请在上方选择单据类型后新增。</div>
        </div>

        <template v-if="currentType">
          <div v-for="sec in sectionsMeta" :key="sec.pos" class="dfd-section">
            <div class="dfd-section__hd">
              <span class="dfd-section__title">{{ sec.title }}</span>
              <el-button size="small" @click="addField(sec.pos)"><el-icon><Plus /></el-icon>添加字段</el-button>
            </div>
            <el-table :data="rowsOf(sec.pos)" border size="small" style="width:100%">
              <el-table-column label="排序" width="86" align="center">
                <template #default="{ $index }">
                  <el-button link size="small" :disabled="$index === 0" @click="move(sec.pos, $index, -1)">↑</el-button>
                  <el-button link size="small" :disabled="$index === rowsOf(sec.pos).length - 1" @click="move(sec.pos, $index, 1)">↓</el-button>
                </template>
              </el-table-column>
              <el-table-column label="字段名称" min-width="150">
                <template #default="{ row }"><el-input v-model="row.field_name" size="small" placeholder="如：合同附件号" /></template>
              </el-table-column>
              <el-table-column label="字段键" width="180">
                <template #default="{ row }">
                  <el-input v-model="row.field_key" size="small" :disabled="row._persisted" placeholder="字母数字下划线">
                    <template v-if="row._persisted" #suffix>
                      <el-tooltip content="已保存字段的键不可修改（避免历史数据脱钩），如需更换请删除后新建" placement="top">
                        <el-icon><Lock /></el-icon>
                      </el-tooltip>
                    </template>
                  </el-input>
                </template>
              </el-table-column>
              <el-table-column label="类型" width="120">
                <template #default="{ row }">
                  <el-select v-model="row.field_type" size="small" style="width:100%">
                    <el-option label="文本" value="text" />
                    <el-option label="数字" value="number" />
                    <el-option label="日期" value="date" />
                    <el-option label="下拉" value="select" />
                    <el-option label="多行文本" value="textarea" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="下拉选项（逗号或换行分隔）" min-width="200">
                <template #default="{ row }">
                  <el-input v-if="row.field_type === 'select'" v-model="row.options_text" size="small" placeholder="如：甲,乙,丙" />
                  <span v-else class="dfd-muted">—</span>
                </template>
              </el-table-column>
              <el-table-column label="显示" width="72" align="center">
                <template #header>
                  <el-tooltip content="关闭后录入页不显示该字段，但定义与历史值保留（不同于删除）" placement="top">
                    <span>显示 <el-icon class="dfd-hint-icon"><InfoFilled /></el-icon></span>
                  </el-tooltip>
                </template>
                <template #default="{ row }">
                  <el-switch v-model="row.is_visible" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="64" align="center">
                <template #default="{ $index }">
                  <el-button link type="danger" size="small" @click="removeField(sec.pos, $index)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div v-if="!rowsOf(sec.pos).length" class="dfd-empty">暂无{{ sec.title }}，点击「添加字段」新增</div>
          </div>
        </template>
        <el-empty v-else description="请先选择单据类型" />
      </template>
    </div>

    <!-- 复制到其他单据类型 -->
    <el-dialog v-model="copyVisible" title="复制字段到其他单据类型" width="440px">
      <p class="dfd-copy-tip">将当前「{{ typeName(currentType) }}」的表头/表体/表尾字段配置（含显示开关），<b>覆盖保存</b>到所选单据类型。</p>
      <el-select v-model="copyTargets" multiple filterable placeholder="选择目标单据类型" style="width:100%">
        <el-option v-for="t in types.filter(x => x.code !== currentType)" :key="t.code" :label="`${t.name}（${t.code}）`" :value="t.code" />
      </el-select>
      <template #footer>
        <el-button @click="copyVisible = false">取消</el-button>
        <el-button type="primary" :loading="copying" :disabled="!copyTargets.length" @click="doCopy">复制</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Plus, Lock, InfoFilled } from '@element-plus/icons-vue'
import { scmApi, type ScmDocType, type ScmDocFieldDef } from '@/api/scm'
import { hasPermission } from '@/utils/permission'

interface FieldDefEdit { field_key: string; field_name: string; field_type: string; options_text: string; is_visible: boolean; _persisted: boolean }
type FieldPos = 'header' | 'body' | 'footer'

const router = useRouter()
const canConfig = computed(() => hasPermission('scm:param'))

const types = ref<ScmDocType[]>([])
const currentType = ref('')
const headerEdit = ref<FieldDefEdit[]>([])
const bodyEdit = ref<FieldDefEdit[]>([])
const footerEdit = ref<FieldDefEdit[]>([])
const saving = ref(false)

const sectionsMeta = [
  { pos: 'header' as const, title: '表头字段' },
  { pos: 'body' as const, title: '表体字段（明细行）' },
  { pos: 'footer' as const, title: '表尾字段' },
]
function rowsOf(pos: string): FieldDefEdit[] {
  return pos === 'footer' ? footerEdit.value : pos === 'body' ? bodyEdit.value : headerEdit.value
}
const typeName = (c: string) => types.value.find(t => t.code === c)?.name || c

// ── 已配置概览（跨单据类型汇总，打开即展示）──
const overview = ref<ScmDocFieldDef[]>([])
const configuredTypes = computed(() => new Set(overview.value.map(f => f.doc_type)))
const overviewGroups = computed(() => {
  const byType = new Map<string, { doc_type: string; name: string; header: string[]; body: string[]; footer: string[]; count: number }>()
  for (const f of overview.value) {
    const code = f.doc_type || ''
    let g = byType.get(code)
    if (!g) { g = { doc_type: code, name: typeName(code), header: [], body: [], footer: [], count: 0 }; byType.set(code, g) }
    const label = f.is_visible === 0 ? `${f.field_name}（隐藏）` : f.field_name
    ;(f.position === 'footer' ? g.footer : f.position === 'body' ? g.body : g.header).push(label)
    g.count++
  }
  return [...byType.values()]
})
async function loadOverview() {
  try { const r = await scmApi.getAllDocFieldDefs(); if (r.code === 0) overview.value = r.data as ScmDocFieldDef[] } catch { overview.value = [] }
}
function selectType(code: string) { currentType.value = code; loadDefs() }
function ovRowClass({ row }: { row: { doc_type: string } }) { return row.doc_type === currentType.value ? 'dfd-ov-row-active' : '' }

// 选项文本 ↔ 数组
function parseOpts(text?: string): string[] {
  return String(text || '').split(/[,，\n]+/).map(s => s.trim()).filter(Boolean)
}

async function loadDefs() {
  headerEdit.value = []
  bodyEdit.value = []
  footerEdit.value = []
  if (!currentType.value) return
  try {
    const r = await scmApi.getDocFieldDefs(currentType.value)
    if (r.code === 0) {
      const map = (f: ScmDocFieldDef): FieldDefEdit => ({
        field_key: f.field_key,
        field_name: f.field_name,
        field_type: f.field_type || 'text',
        options_text: (() => { try { const a = f.options_json ? JSON.parse(f.options_json) : []; return Array.isArray(a) ? a.join(',') : '' } catch { return '' } })(),
        is_visible: f.is_visible !== 0,  // 缺省（undefined）视为显示
        _persisted: true,
      })
      const data = r.data as ScmDocFieldDef[]
      headerEdit.value = data.filter(f => f.position === 'header' || (f.position !== 'body' && f.position !== 'footer')).map(map)
      bodyEdit.value = data.filter(f => f.position === 'body').map(map)
      footerEdit.value = data.filter(f => f.position === 'footer').map(map)
    }
  } catch { /* 无字段则空 */ }
}

function genKey(): string {
  const used = new Set([...headerEdit.value, ...bodyEdit.value, ...footerEdit.value].map(f => f.field_key))
  let i = 1
  while (used.has(`field_${i}`)) i++
  return `field_${i}`
}
function addField(pos: string) {
  rowsOf(pos).push({ field_key: genKey(), field_name: '', field_type: 'text', options_text: '', is_visible: true, _persisted: false })
}
function removeField(pos: string, idx: number) { rowsOf(pos).splice(idx, 1) }
function move(pos: string, idx: number, dir: number) {
  const arr = rowsOf(pos)
  const j = idx + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
}

// 校验 + 组装 fields 载荷（表头/表体/表尾共用 field_key 命名空间）
function buildFields(): ScmDocFieldDef[] | null {
  const all = [
    ...headerEdit.value.map(f => ({ f, position: 'header' as const })),
    ...bodyEdit.value.map(f => ({ f, position: 'body' as const })),
    ...footerEdit.value.map(f => ({ f, position: 'footer' as const })),
  ]
  for (const { f } of all) {
    if (!f.field_name.trim()) { ElMessage.warning('字段名称不能为空'); return null }
    if (!f.field_key.trim()) { ElMessage.warning('字段键不能为空'); return null }
    if (!/^[a-zA-Z0-9_]+$/.test(f.field_key.trim())) { ElMessage.warning(`字段键「${f.field_key}」只能含字母、数字、下划线`); return null }
    if (f.field_type === 'select' && !parseOpts(f.options_text).length) { ElMessage.warning(`下拉字段「${f.field_name}」需填写选项`); return null }
  }
  const keys = all.map(({ f }) => f.field_key.trim())
  if (new Set(keys).size !== keys.length) { ElMessage.warning('字段键不能重复（表头、表体、表尾共用命名空间）'); return null }

  const build = (f: FieldDefEdit, position: FieldPos, i: number): ScmDocFieldDef => ({
    position,
    field_key: f.field_key.trim(),
    field_name: f.field_name.trim(),
    field_type: f.field_type as ScmDocFieldDef['field_type'],
    options_json: f.field_type === 'select' ? JSON.stringify(parseOpts(f.options_text)) : undefined,
    sort_order: i,
    is_visible: f.is_visible ? 1 : 0,
  })
  return [
    ...headerEdit.value.map((f, i) => build(f, 'header', i)),
    ...bodyEdit.value.map((f, i) => build(f, 'body', i)),
    ...footerEdit.value.map((f, i) => build(f, 'footer', i)),
  ]
}

async function handleSave() {
  const fields = buildFields()
  if (!fields) return
  saving.value = true
  try {
    const r = await scmApi.saveDocFieldDefs(currentType.value, fields)
    if (r.code === 0) { ElMessage.success('字段配置已保存'); await loadDefs(); await loadOverview() }
    else ElMessage.error(r.message || '保存失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '保存失败')
  } finally { saving.value = false }
}

// ── 复制到其他单据类型 ──
const copyVisible = ref(false)
const copyTargets = ref<string[]>([])
const copying = ref(false)
function openCopy() { copyTargets.value = []; copyVisible.value = true }
async function doCopy() {
  const fields = buildFields()
  if (!fields) return
  copying.value = true
  try {
    for (const target of copyTargets.value) {
      await scmApi.saveDocFieldDefs(target, fields)
    }
    ElMessage.success(`已复制到 ${copyTargets.value.length} 个单据类型`)
    copyVisible.value = false
    await loadOverview()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '复制失败')
  } finally { copying.value = false }
}

function goBack() { router.back() }

onMounted(async () => {
  const r = await scmApi.getDocTypes()
  if (r.code === 0) types.value = r.data
  await loadOverview()
})
</script>

<style scoped>
.doc-field-defs-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.dfd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0;
}
.dfd-header__left { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.dfd-header__sep { color: var(--el-text-color-placeholder); }
.dfd-header__title { font-weight: 600; color: var(--el-text-color-primary); }
.dfd-header__right { display: flex; gap: 8px; }
.dfd-body { flex: 1; overflow: auto; padding: 14px 16px; }
.dfd-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.dfd-overview { margin-bottom: 18px; padding: 10px 12px; background: var(--el-fill-color-light); border: 1px solid var(--el-border-color-lighter); border-radius: var(--radius-sm, 4px); }
.dfd-overview__hd { font-weight: 600; font-size: 13px; color: var(--el-text-color-primary); margin-bottom: 8px; }
.dfd-overview__empty { font-size: 13px; color: var(--el-text-color-placeholder); }
.dfd-overview__table { cursor: pointer; }
.dfd-overview__table :deep(.dfd-ov-row-active) { background: var(--el-color-primary-light-9); }
.dfd-overview__table :deep(.dfd-ov-row-active td) { font-weight: 600; }
.dfd-label { font-size: 13px; color: var(--el-text-color-regular); }
.dfd-tip { font-size: 12px; color: var(--el-text-color-secondary); }
.dfd-section { margin-bottom: 18px; }
.dfd-section__hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.dfd-section__title { font-weight: 600; font-size: 14px; color: var(--el-text-color-primary); }
.dfd-empty { color: var(--el-text-color-placeholder); font-size: 13px; padding: 10px 0; text-align: center; }
.dfd-muted { color: var(--el-text-color-placeholder); }
.dfd-hint-icon { font-size: 12px; vertical-align: -1px; color: var(--el-text-color-placeholder); }
.dfd-copy-tip { font-size: 13px; color: var(--el-text-color-regular); margin: 0 0 12px; }
</style>
