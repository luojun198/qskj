<template>
  <el-dialog
    v-model="visible"
    title="选择 BOM"
    fullscreen
    :close-on-click-modal="false"
    destroy-on-close
    class="bom-picker-dialog"
  >
    <!-- 顶部工具栏 -->
    <div class="bp-toolbar">
      <el-input v-model="keyword" placeholder="搜索 编码 / 名称 / 成品" clearable style="width: 280px" size="small">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-checkbox v-if="itemCode" v-model="onlyProduct" size="small">仅看本成品（{{ itemCode }}）</el-checkbox>
      <span class="bp-hint">上方选 BOM、下方看明细；双击行直接选定</span>
    </div>
    <el-alert
      v-if="!loading && loadError"
      :title="loadError"
      type="error"
      show-icon
      :closable="false"
      style="margin-bottom:8px"
    />
    <el-alert
      v-else-if="!loading && itemCode && onlyProduct && !filtered.length && list.length"
      :title="`成品 ${itemCode} 尚未维护 BOM；取消勾选「仅看本成品」可查看全部 ${list.length} 张 BOM`"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom:8px"
    />

    <!-- 上下两层：上=BOM 列表，下=所选 BOM 明细；中间可拖动分隔条 -->
    <div ref="bodyRef" class="bp-body">
      <!-- 上层：BOM 列表 -->
      <div class="bp-pane bp-pane--list" :style="{ height: topH ? topH + 'px' : '36%', flexShrink: 0 }">
        <div class="bp-pane__hd">BOM 列表（共 {{ filtered.length }} 张）</div>
        <el-table
          v-loading="loading"
          :data="filtered"
          border
          size="small"
          height="100%"
          highlight-current-row
          class="bp-table"
          @row-click="onRowClick"
          @row-dblclick="onRowDblClick"
        >
          <el-table-column label="编码" prop="code" width="140" sortable />
          <el-table-column label="BOM名称" prop="name" min-width="150" show-overflow-tooltip />
          <el-table-column label="成品编号" prop="item_code" width="120" />
          <el-table-column label="成品名称" prop="item_name" min-width="160" show-overflow-tooltip />
          <el-table-column label="规格" prop="spec" width="130" show-overflow-tooltip />
          <el-table-column label="状态" prop="status" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small" effect="plain">{{ row.status === 'active' ? '启用' : (row.status || '') }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 可拖动分隔条：上下拖动调整两层高度 -->
      <div class="bp-splitter" title="拖动调整上下高度" @mousedown="startDrag"><span class="bp-splitter__grip"></span></div>

      <!-- 下层：所选 BOM 明细 -->
      <div class="bp-pane bp-pane--detail">
        <div class="bp-pane__hd">
          BOM 明细
          <span v-if="selected" class="bp-pane__sub">{{ selected.code }} {{ selected.item_code }}（{{ detailLines.length }} 项）</span>
          <span v-else class="bp-pane__sub">点击上方某张 BOM 查看其组件用料</span>
        </div>
        <el-table v-loading="detailLoading" :data="detailLines" border size="small" height="100%" class="bp-table">
          <el-table-column type="index" label="序号" width="48" align="center" />
          <el-table-column label="物料编号" prop="item_code" width="130" />
          <el-table-column label="名称" prop="item_name" min-width="170" show-overflow-tooltip />
          <el-table-column label="规格" prop="spec" min-width="130" show-overflow-tooltip />
          <el-table-column label="单位用量" prop="qty" width="110" align="right" />
          <el-table-column label="单位" prop="unit" width="90" />
          <el-table-column label="损耗率%" prop="scrap_rate" width="100" align="right" />
          <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip />
        </el-table>
      </div>
    </div>

    <template #footer>
      <span class="bp-footer-info">
        <template v-if="selected">已选：<b>{{ selected.code }} {{ selected.item_code }}</b></template>
        <span v-else class="bp-footer-placeholder">尚未选择</span>
      </span>
      <el-button size="small" @click="visible = false">取消</el-button>
      <el-button type="primary" size="small" :disabled="!selected" @click="confirm">确认选择</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { matchProductBoms } from '@/utils/productionPlanBom'

const props = defineProps<{ modelValue: boolean; itemCode?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'confirm', bom: any): void }>()

// 支持父页面按需挂载：组件首次创建时 modelValue 可能已经为 true。
const visible = ref(props.modelValue)
watch(() => props.modelValue, v => { visible.value = v })
watch(visible, v => {
  emit('update:modelValue', v)
  if (v) void onOpen()
})

const loading = ref(false)
const loadError = ref('')
// 默认只看本成品；无匹配时用户可取消勾选看全部，避免弹窗一片空白无从下手
const onlyProduct = ref(true)
const list = ref<any[]>([])
const keyword = ref('')
const selected = ref<any>(null)
const detailLines = ref<any[]>([])
const detailLoading = ref(false)

// 上下两层高度：上层受控像素高（默认约 36%，下层吃剩余），支持拖动分隔条调整
const bodyRef = ref<HTMLElement | null>(null)
const topH = ref(0)
function startDrag(e: MouseEvent) {
  e.preventDefault()
  const onMove = (ev: MouseEvent) => {
    const rect = bodyRef.value?.getBoundingClientRect()
    if (!rect) return
    topH.value = Math.min(Math.max(ev.clientY - rect.top, 120), rect.height - 160)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
  }
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
onBeforeUnmount(() => { document.body.style.userSelect = '' })

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const base = props.itemCode && onlyProduct.value ? matchProductBoms(list.value, props.itemCode) : list.value
  if (!kw) return base
  return base.filter((b: any) =>
    [b.code, b.name, b.item_code, b.item_name, b.spec].some(v => String(v || '').toLowerCase().includes(kw)))
})

async function onOpen() {
  keyword.value = ''
  loadError.value = ''
  onlyProduct.value = true
  selected.value = null
  detailLines.value = []
  topH.value = 0
  loading.value = true
  try {
    const r = await scmApi.getBoms()
    if (r.code === 0 && Array.isArray(r.data)) list.value = r.data
    else { list.value = []; loadError.value = r.message || 'BOM 列表加载失败，请检查权限或稍后重试' }
  } catch (e: any) {
    list.value = []
    loadError.value = e?.message || 'BOM 列表加载失败，请检查权限或稍后重试'
  } finally { loading.value = false }
  // 量取容器高度设默认上层约 36%（下层更高）
  await nextTick()
  const rect = bodyRef.value?.getBoundingClientRect()
  if (rect && rect.height > 0) topH.value = Math.round(rect.height * 0.36)
}

onMounted(() => { if (visible.value) void onOpen() })

// 单击某 BOM：下层展示其明细
async function onRowClick(row: any) {
  selected.value = row
  detailLoading.value = true
  try {
    const r = await scmApi.getBom(row.id)
    detailLines.value = (r.code === 0 && Array.isArray(r.data?.lines)) ? r.data.lines : []
  } finally { detailLoading.value = false }
}

function onRowDblClick(row: any) { selected.value = row; confirm() }
function confirm() {
  if (!selected.value) return
  emit('confirm', selected.value)
  visible.value = false
}
</script>

<style>
/* fullscreen 对话框纵向 flex 布局，内部两层各自滚动 */
.bom-picker-dialog.el-dialog.is-fullscreen { display: flex; flex-direction: column; overflow: hidden !important; }
.bom-picker-dialog .el-dialog__header { flex-shrink: 0; }
.bom-picker-dialog .el-dialog__body { padding: 0 !important; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden !important; }
.bom-picker-dialog .el-dialog__footer { flex-shrink: 0; display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--el-border-color-light); padding-top: 12px; }
</style>

<style scoped>
.bp-toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light); flex-shrink: 0; }
.bp-hint { font-size: 12px; color: var(--el-text-color-placeholder); }
.bp-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.bp-pane { display: flex; flex-direction: column; min-height: 0; padding: 8px 16px; }
.bp-pane--list { /* 高度由内联 topH 受控 */ }
.bp-pane--detail { flex: 1; min-height: 0; background: var(--el-fill-color-blank); }
/* 可拖动分隔条 */
.bp-splitter {
  flex-shrink: 0; height: 8px; cursor: row-resize;
  display: flex; align-items: center; justify-content: center;
  background: var(--el-fill-color); border-top: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter);
}
.bp-splitter:hover { background: var(--el-color-primary-light-8); }
.bp-splitter__grip { width: 40px; height: 3px; border-radius: 2px; background: var(--el-border-color-darker); }
.bp-pane__hd { font-size: 13px; font-weight: 600; margin-bottom: 6px; flex-shrink: 0; }
.bp-pane__sub { font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); margin-left: 8px; }
.bp-table { flex: 1; }
.bp-table :deep(.el-table__row) { cursor: pointer; }
.bp-footer-info { margin-right: auto; font-size: 13px; color: var(--el-text-color-regular); }
.bp-footer-info b { color: var(--el-color-primary); }
.bp-footer-placeholder { color: var(--el-text-color-placeholder); }
</style>
