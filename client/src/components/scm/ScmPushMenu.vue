<template>
  <el-tag v-if="loaded && !hasAction" :type="allCompleted ? 'success' : 'info'" size="small" effect="plain" :title="statusReason">
    {{ allCompleted ? '下推已完成' : '暂无可下推' }}
  </el-tag>
  <el-dropdown v-else trigger="click" placement="bottom-end" @visible-change="onVisible" @command="onCommand">
    <el-button v-if="compact" link type="success" size="small" title="选择下推目标" class="push-menu-compact">
      推<el-icon><ArrowDown /></el-icon>
    </el-button>
    <el-button v-else type="success" size="small" plain :loading="loading">
      下推<el-icon class="el-icon--right"><ArrowDown /></el-icon>
    </el-button>
    <template #dropdown>
      <div class="push-menu-panel">
        <div class="push-menu-title">选择下推目标</div>
        <div v-if="loading" class="push-menu-empty">正在计算剩余可下推数量…</div>
        <div v-else-if="loadError" class="push-menu-empty push-menu-error" @click="load">{{ loadError }}，点击重试</div>
        <el-dropdown-menu v-else>
          <el-dropdown-item
            v-for="item in options"
            :key="item.action"
            :command="item.action"
            :disabled="isDisabled(item)"
            class="push-menu-item"
          >
            <div class="push-menu-item__body">
              <div class="push-menu-item__main">
                <span>{{ item.label }}</span>
                <el-tag :type="statusType(item)" size="small" effect="plain">{{ statusText(item) }}</el-tag>
              </div>
              <div v-if="item.reason || item.remaining_qty > 0" class="push-menu-item__sub">
                <span v-if="item.remaining_qty > 0">剩余 {{ num(item.remaining_qty) }} / {{ item.remaining_lines }} 行</span>
                <span v-if="item.reason">{{ item.reason }}</span>
              </div>
            </div>
          </el-dropdown-item>
        </el-dropdown-menu>
      </div>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { scmApi, type MrpSourceKind, type ScmPushAction, type ScmPushOption } from '@/api/scm'
import { scmDownstreamDocRoute, scmDownstreamMrpRoute, scmSalesDispatchDraftRoute } from '@/utils/scmDocNavigation'

const props = withDefaults(defineProps<{
  sourceKind: MrpSourceKind
  sourceId: string
  compact?: boolean
  autoLoad?: boolean
  localActions?: ScmPushAction[]
}>(), {
  compact: false,
  autoLoad: true,
  localActions: () => [],
})
const emit = defineEmits<{
  (e: 'action', option: ScmPushOption): void
  (e: 'changed'): void
  (e: 'loaded', options: ScmPushOption[]): void
}>()
const router = useRouter()
const loading = ref(false)
const loaded = ref(false)
const loadError = ref('')
const options = ref<ScmPushOption[]>([])

const hasAction = computed(() => options.value.some(item => !!item.existing_doc || item.status === 'available' || item.status === 'partial'))
const allCompleted = computed(() => options.value.length > 0 && options.value.every(item => item.status === 'completed'))
const statusReason = computed(() => [...new Set(options.value.map(item => item.reason).filter(Boolean))].join('；'))

function num(value: number) {
  const n = Number(value) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}
function isDisabled(item: ScmPushOption) {
  return !item.existing_doc && (item.status === 'completed' || item.status === 'unavailable' || item.status === 'blocked_draft')
}
function statusText(item: ScmPushOption) {
  if (item.existing_doc) return item.existing_doc.status === 'draft' ? '已有草稿' : '已关联'
  return ({ available: '可生成', partial: '可继续', blocked_draft: '草稿阻塞', completed: '已完成', unavailable: '不可用' } as const)[item.status]
}
function statusType(item: ScmPushOption): 'success' | 'warning' | 'info' | 'danger' {
  if (item.existing_doc) return item.existing_doc.status === 'draft' ? 'warning' : 'success'
  if (item.status === 'available') return 'success'
  if (item.status === 'partial' || item.status === 'blocked_draft') return 'warning'
  return 'info'
}

async function load() {
  if (!props.sourceId || loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await scmApi.getPushOptions({ source_kind: props.sourceKind, source_id: props.sourceId })
    options.value = res.data.actions || []
    loaded.value = true
    emit('loaded', options.value)
  } catch (error: any) {
    loadError.value = error?.response?.data?.message || error?.message || '状态加载失败'
  } finally {
    loading.value = false
  }
}
function onVisible(visible: boolean) {
  if (visible) load()
}
function openExisting(item: ScmPushOption) {
  const doc = item.existing_doc!
  if (doc.doc_type === 'MRP') {
    router.push(scmDownstreamMrpRoute(doc.id, doc.status))
  } else {
    router.push(scmDownstreamDocRoute(doc.id, doc.status))
  }
}
async function runIssue(item: ScmPushOption) {
  try {
    await ElMessageBox.confirm(`确认${item.label}？系统将按当前剩余需求生成草稿单据。`, '下推确认', { type: 'info' })
  } catch { return }
  try {
    const res = await scmApi.genPlanIssue(props.sourceId)
    ElMessage.success(`已生成 ${res.data.doc_no}`)
    emit('changed')
    router.push(scmDownstreamDocRoute(res.data.id, 'draft'))
  } catch {
    await load()
  }
}
async function runFinish(item: ScmPushOption) {
  try {
    await ElMessageBox.confirm(`确认${item.label}？系统将按各成品剩余计划数量生成草稿单据。`, '下推确认', { type: 'info' })
  } catch { return }
  try {
    const res = await scmApi.genPlanFinish(props.sourceId, {})
    ElMessage.success(`已生成 ${res.data.doc_no}`)
    emit('changed')
    router.push(scmDownstreamDocRoute(res.data.id, 'draft'))
  } catch {
    await load()
  }
}
async function onCommand(action: ScmPushAction) {
  const item = options.value.find(option => option.action === action)
  if (!item || isDisabled(item)) return
  if (item.existing_doc) return openExisting(item)
  if (props.localActions.includes(action)) {
    emit('action', item)
    return
  }
  if (action === 'sales_dispatch') {
    router.push(scmSalesDispatchDraftRoute(props.sourceId))
  } else if (action === 'mrp') {
    router.push({ name: 'ScmMrpNew', query: { source_kind: props.sourceKind, source_id: props.sourceId } })
  } else if (action === 'issue') {
    await runIssue(item)
  } else if (action === 'finish') {
    await runFinish(item)
  }
}

watch(() => [props.sourceKind, props.sourceId], () => {
  loaded.value = false
  options.value = []
  if (props.autoLoad) load()
})
onMounted(() => { if (props.autoLoad) load() })

defineExpose({ reload: load })
</script>

<style scoped>
.push-menu-compact { margin: 0 !important; padding: 0 2px !important; min-width: auto; font-size: 13px; }
.push-menu-panel { width: 300px; padding: 4px 0; }
.push-menu-title { padding: 6px 14px 8px; color: var(--el-text-color-secondary); font-size: 12px; border-bottom: 1px solid var(--el-border-color-lighter); }
.push-menu-empty { padding: 14px; color: var(--el-text-color-secondary); font-size: 13px; text-align: center; }
.push-menu-error { color: var(--el-color-danger); cursor: pointer; }
.push-menu-item { height: auto !important; line-height: 1.4 !important; padding: 8px 14px !important; }
.push-menu-item__body { width: 100%; min-width: 0; }
.push-menu-item__main { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.push-menu-item__sub { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; color: var(--el-text-color-secondary); font-size: 12px; white-space: normal; }
</style>
