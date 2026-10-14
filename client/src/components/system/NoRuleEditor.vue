<template>
  <div class="nre">
    <div class="nre__bar">
      <span class="nre__bar-label">添加段：</span>
      <el-button size="small" @click="add('text', { text: '-' })">+ 分隔符 -</el-button>
      <el-button size="small" @click="add('text', { text: '' })">+ 固定文字</el-button>
      <el-button size="small" @click="add('year4')">+ 年(4位)</el-button>
      <el-button size="small" @click="add('year2')">+ 年(2位)</el-button>
      <el-button size="small" @click="add('month')">+ 月</el-button>
      <el-button size="small" @click="add('day')">+ 日</el-button>
      <el-button v-if="showCode" size="small" @click="add('code')">+ 单据类型代码</el-button>
      <el-button size="small" type="primary" plain :disabled="hasSeq" @click="add('seq', { len: 3 })">+ 流水号</el-button>
      <el-dropdown v-if="fields.length" trigger="click" @command="(k: string) => add('field', { field: k, len: 0 })">
        <el-button size="small">+ 业务字段<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="f in fields" :key="f.key" :command="f.key">{{ f.label }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="applyPreset">
        <el-button size="small" link type="primary">快速模板<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="p in presets" :key="p.name" :command="p.tpl">{{ p.name }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="nre__segs" :class="{ 'nre__segs--empty': !segs.length }">
      <span v-if="!segs.length" class="nre__empty">还没有任何段，点上方按钮添加；拖动方块可调整顺序</span>
      <div
        v-for="(s, i) in segs" :key="s.id"
        class="nre__seg" :class="[`nre__seg--${s.type}`, { 'nre__seg--over': overIdx === i }]"
        draggable="true"
        @dragstart="onDragStart(i, $event)" @dragover.prevent="overIdx = i"
        @dragleave="overIdx = -1" @drop.prevent="onDrop(i)" @dragend="overIdx = -1"
      >
        <span class="nre__grip" title="拖动排序">⋮⋮</span>
        <template v-if="s.type === 'text'">
          <el-input v-model="s.text" size="small" class="nre__text" placeholder="文字" @input="emitChange" />
        </template>
        <template v-else-if="s.type === 'seq'">
          <span class="nre__name">流水号</span>
          <el-input-number v-model="s.len" :min="1" :max="10" :controls="false" size="small" class="nre__num" @change="emitChange" />
          <span class="nre__unit">位</span>
        </template>
        <template v-else-if="s.type === 'field'">
          <el-select v-model="s.field" size="small" class="nre__field" placeholder="选字段" @change="emitChange">
            <el-option v-for="f in fields" :key="f.key" :label="f.label" :value="f.key" />
          </el-select>
          <span class="nre__unit">取前</span>
          <el-input-number v-model="s.len" :min="0" :max="20" :controls="false" size="small" class="nre__num" @change="emitChange" />
          <span class="nre__unit">位</span>
        </template>
        <template v-else>
          <span class="nre__name">{{ SEG_LABEL[s.type] }}</span>
        </template>
        <span class="nre__ops">
          <el-button link size="small" :disabled="i === 0" title="前移" @click="move(i, -1)">←</el-button>
          <el-button link size="small" :disabled="i === segs.length - 1" title="后移" @click="move(i, 1)">→</el-button>
          <el-button link size="small" type="danger" title="删除" @click="remove(i)">✕</el-button>
        </span>
      </div>
    </div>

    <div class="nre__preview">
      <span>示例：</span><b class="nre__sample">{{ sample || '（空）' }}</b>
      <span class="nre__hint">{{ resetHint(segs) }}</span>
      <span v-if="fieldSegCount" class="nre__hint">业务字段为空时该段省略</span>
      <span v-if="errMsg" class="nre__err">{{ errMsg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { newSeg, parseTpl, renderPreview, resetHint, serializeTpl, validateSegs, SEG_LABEL, type NoSeg, type NoSegType } from '@/utils/noRule'

const props = withDefaults(defineProps<{
  modelValue: string
  /** 可选业务字段；为空则不显示「业务字段」入口 */
  fields?: Array<{ key: string; label: string }>
  /** 「单据类型代码」段的示例值；传 null 则不提供该段 */
  codeLabel?: string | null
  /** 快速模板 */
  presets?: Array<{ name: string; tpl: string }>
}>(), { fields: () => [], codeLabel: 'PO', presets: () => [] })
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const segs = ref<NoSeg[]>(parseTpl(props.modelValue))
const showCode = computed(() => props.codeLabel !== null)
const hasSeq = computed(() => segs.value.some(s => s.type === 'seq'))
const fieldSegCount = computed(() => segs.value.filter(s => s.type === 'field').length)
const errMsg = computed(() => validateSegs(segs.value))
const FIELD_SAMPLES: Record<string, string> = {
  partner_code: 'GYS0001', warehouse_code: 'CK01', dept_code: 'D01', biz_person: '张三',
  category_code: '01', subcategory_code: '0101', item_type: '0',
}
const sample = computed(() => renderPreview(segs.value, { code: props.codeLabel ?? '', fieldSamples: FIELD_SAMPLES }))

// 外部值变化（如保存后回读、恢复默认）时重建分段；自身 emit 引起的变化不重建，避免丢失焦点
watch(() => props.modelValue, v => {
  if (v !== serializeTpl(segs.value)) segs.value = parseTpl(v)
})

function emitChange() { emit('update:modelValue', serializeTpl(segs.value)) }
function add(type: NoSegType, extra: Partial<NoSeg> = {}) {
  segs.value.push(newSeg(type, extra))
  emitChange()
}
function remove(i: number) { segs.value.splice(i, 1); emitChange() }
function move(i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= segs.value.length) return
  const [x] = segs.value.splice(i, 1)
  segs.value.splice(j, 0, x)
  emitChange()
}
function applyPreset(tpl: string) { segs.value = parseTpl(tpl); emitChange() }

let dragFrom = -1
const overIdx = ref(-1)
function onDragStart(i: number, e: DragEvent) {
  dragFrom = i
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }
}
function onDrop(i: number) {
  overIdx.value = -1
  if (dragFrom < 0 || dragFrom === i) return
  const [x] = segs.value.splice(dragFrom, 1)
  segs.value.splice(i, 0, x)
  dragFrom = -1
  emitChange()
}
</script>

<style scoped>
.nre { display: flex; flex-direction: column; gap: 8px; padding: 6px 4px; }
.nre__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nre__bar-label { font-size: 12px; color: var(--el-text-color-secondary); }
.nre__segs {
  display: flex; flex-wrap: wrap; gap: 6px; min-height: 40px; padding: 6px;
  border: 1px dashed var(--el-border-color); border-radius: 6px; background: var(--el-fill-color-extra-light);
}
.nre__empty { font-size: 12px; color: var(--el-text-color-placeholder); line-height: 28px; }
.nre__seg {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 2px;
  border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--el-bg-color); cursor: grab;
}
.nre__seg--over { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px var(--el-color-primary-light-7); }
.nre__seg--seq { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.nre__seg--field { border-color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.nre__seg--text { border-style: dashed; }
.nre__grip { color: var(--el-text-color-placeholder); font-size: 12px; padding: 0 2px; user-select: none; }
.nre__name { font-size: 12px; padding: 0 2px; white-space: nowrap; }
.nre__unit { font-size: 12px; color: var(--el-text-color-secondary); }
.nre__text { width: 86px; }
.nre__num { width: 46px; }
.nre__field { width: 110px; }
.nre__ops { display: inline-flex; margin-left: 2px; }
.nre__ops .el-button { padding: 0 2px; margin: 0; }
.nre__preview { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 12px; }
.nre__sample { font-family: Consolas, monospace; font-size: 14px; color: var(--el-color-primary); }
.nre__hint { color: var(--el-text-color-secondary); }
.nre__err { color: var(--el-color-danger); }
</style>
