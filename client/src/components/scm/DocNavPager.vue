<template>
  <div class="doc-nav-pager" :class="{ 'is-loading': loading || navigating }">
    <el-button size="small" :disabled="navDisabled || !pager.canPrevious" title="首单" @click="go(0)">
      <el-icon><DArrowLeft /></el-icon><span>首单</span>
    </el-button>
    <el-button size="small" :disabled="navDisabled || !pager.canPrevious" title="上单" @click="go(pager.index - 1)">
      <el-icon><ArrowLeft /></el-icon><span>上单</span>
    </el-button>
    <span class="doc-nav-pager__pos">
      {{ loading ? '加载中' : `第 ${pager.index >= 0 ? pager.index + 1 : '—'} / ${pager.total} 单` }}
    </span>
    <el-button size="small" :disabled="navDisabled || !pager.canNext" title="下单" @click="go(pager.index + 1)">
      <span>下单</span><el-icon><ArrowRight /></el-icon>
    </el-button>
    <el-button size="small" :disabled="navDisabled || !pager.canNext" title="尾单" @click="go(pager.total - 1)">
      <span>尾单</span><el-icon><DArrowRight /></el-icon>
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { DArrowLeft, ArrowLeft, ArrowRight, DArrowRight } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { useTabsStore } from '@/stores/tabs'
import { useUserStore } from '@/stores/user'
import { getViewKey } from '@/utils/viewKey'
import {
  getScmDocPagerState,
  scmDocNavContextToDetailQuery,
  scmDocNavContextToIdsParams,
  type ScmDocNavContext,
} from '@/utils/scmDocNavigation'

const props = withDefaults(defineProps<{
  docId: string
  docType?: string
  mode?: 'view' | 'edit'
  navContext?: ScmDocNavContext
  beforeNavigate?: () => boolean | Promise<boolean>
}>(), { mode: 'view' })

const router = useRouter()
const tabsStore = useTabsStore()
const userStore = useUserStore()
const ids = ref<string[]>([])
const loading = ref(false)
const navigating = ref(false)
const loadError = ref(false)
let requestSeq = 0

const pager = computed(() => getScmDocPagerState(ids.value, props.docId))
const navDisabled = computed(() => loading.value || navigating.value || loadError.value)
const contextKey = computed(() => JSON.stringify(props.navContext || {}))

function hasScopedFilters(context?: ScmDocNavContext): boolean {
  return !!(context?.warehouse_code || context?.partner_code || context?.status || context?.start_date || context?.end_date || context?.payment_mode)
}

async function fetchIds(context?: ScmDocNavContext): Promise<string[]> {
  const response = await scmApi.getDocIds(scmDocNavContextToIdsParams(props.docType || '', context))
  return response.code === 0 ? (response.data || []) : []
}

async function loadIds() {
  if (!props.docType) {
    ids.value = []
    return
  }
  const seq = ++requestSeq
  loading.value = true
  loadError.value = false
  try {
    let nextIds = await fetchIds(props.navContext)
    // 单据状态或筛选条件已变化导致当前记录不在集合时，退回同类型全部记录，保证导航仍可使用。
    if (!nextIds.includes(props.docId) && hasScopedFilters(props.navContext)) nextIds = await fetchIds(undefined)
    if (seq === requestSeq) ids.value = nextIds
  } catch {
    if (seq === requestSeq) {
      loadError.value = true
      ElMessage.error('快捷切换单据加载失败，请稍后重试')
    }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch([() => props.docType, contextKey], loadIds, { immediate: true })
onActivated(loadIds)

async function go(index: number) {
  if (navDisabled.value || index < 0 || index >= ids.value.length) return
  const id = ids.value[index]
  if (!id || id === props.docId) return
  if (props.beforeNavigate && !(await props.beforeNavigate())) return

  const routeName = props.mode === 'edit' ? 'ScmDocEdit' : 'ScmDocView'
  const target = router.resolve({
    name: routeName,
    params: { id },
    query: scmDocNavContextToDetailQuery(props.navContext),
  })
  const accountKey = userStore.accountSetId || 'no-account-set'
  const targetIdentity = getViewKey(target.fullPath, accountKey, routeName)
  const sourceKey = tabsStore.activeKey
  navigating.value = true
  try {
    await router.push(target)
    tabsStore.finishTabReplacement(sourceKey, targetIdentity)
  } finally {
    navigating.value = false
  }
}
</script>

<style scoped>
.doc-nav-pager { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.doc-nav-pager__pos { min-width: 76px; padding: 0 4px; text-align: center; font-size: 12px; color: var(--el-text-color-secondary); }
.doc-nav-pager :deep(.el-button) { margin-left: 0; }
.doc-nav-pager :deep(.el-button > span) { gap: 2px; }
.doc-nav-pager.is-loading { opacity: .82; }
</style>
