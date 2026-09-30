<template>
  <span class="hf">
    <span class="hf-label">{{ label }}</span>
    <el-popover v-model:visible="visible" trigger="click" :width="260" placement="bottom" @show="onShow">
      <template #reference>
        <el-icon class="hf-icon" :class="{ 'is-active': active }" @click.stop><Filter /></el-icon>
      </template>

      <div class="hf-body" @click.stop>
        <!-- 文本：包含匹配 -->
        <template v-if="kind === 'text'">
          <el-input v-model="draftText" size="small" clearable :placeholder="`${label}包含…`" @keyup.enter="apply" />
        </template>

        <!-- 选项：本地检索 / 远程检索，多选（或单选） -->
        <template v-else>
          <el-input v-if="kind === 'remote' || (options && options.length > 8)" v-model="keyword" size="small" clearable placeholder="输入关键词检索" @input="onKeyword" />
          <div v-loading="loading" class="hf-list">
            <el-checkbox-group v-if="multiple" v-model="draftList">
              <el-checkbox v-for="o in shown" :key="String(o.value)" :value="o.value" class="hf-item">{{ o.label }}</el-checkbox>
            </el-checkbox-group>
            <el-radio-group v-else v-model="draftSingle" class="hf-radios">
              <el-radio v-for="o in shown" :key="String(o.value)" :value="o.value" class="hf-item">{{ o.label }}</el-radio>
            </el-radio-group>
            <div v-if="!shown.length && !loading" class="hf-empty">无可选项</div>
          </div>
        </template>

        <div class="hf-actions">
          <el-button size="small" link @click="reset">重置</el-button>
          <el-button size="small" type="primary" @click="apply">确定</el-button>
        </div>
      </div>
    </el-popover>
  </span>
</template>

<script setup lang="ts">
/**
 * 表头筛选：点表头的漏斗图标，勾选 / 输入后点「确定」才生效（服务端筛选全部结果，不是只筛当前页）。
 *  - kind=text    文本包含（摘要、票据号、对方单位…）
 *  - kind=options 固定选项（结算方式、对方科目、凭证状态、对账状态…），多选或单选
 *  - kind=remote  选项按关键词远程加载（辅助项目，项目可能很多）
 */
import { computed, ref, watch } from 'vue'
import { Filter } from '@element-plus/icons-vue'

interface Opt { value: string | number; label: string }

const props = withDefaults(defineProps<{
  label: string
  kind: 'text' | 'options' | 'remote'
  modelValue?: string | number | Array<string | number> | undefined
  options?: Opt[]
  /** kind=remote：按关键词取选项（关键词为空时返回默认一页） */
  loader?: (keyword: string) => Promise<Opt[]>
  multiple?: boolean
}>(), { multiple: true, options: () => [] })

const emit = defineEmits<{ 'update:modelValue': [value: any]; change: [] }>()

const visible = ref(false)
const keyword = ref('')
const loading = ref(false)
const remoteOptions = ref<Opt[]>([])
/** 已选项的名称缓存：远程检索结果变化后，已选项仍显示在列表顶部 */
const labelCache = new Map<string | number, string>()

const draftText = ref('')
const draftList = ref<Array<string | number>>([])
const draftSingle = ref<string | number | undefined>(undefined)

const currentList = computed<Array<string | number>>(() =>
  Array.isArray(props.modelValue) ? props.modelValue : (props.modelValue === undefined || props.modelValue === '' ? [] : [props.modelValue as any])
)
const active = computed(() => (props.kind === 'text' ? !!String(props.modelValue ?? '').trim() : currentList.value.length > 0))

const pool = computed<Opt[]>(() => (props.kind === 'remote' ? remoteOptions.value : props.options))
const shown = computed<Opt[]>(() => {
  let list = pool.value
  if (props.kind === 'options' && keyword.value.trim()) {
    const k = keyword.value.trim().toLowerCase()
    list = list.filter(o => String(o.label).toLowerCase().includes(k))
  }
  // 远程：已选项置顶，避免检索后看不到已选
  if (props.kind === 'remote') {
    const have = new Set(list.map(o => o.value))
    const picked = draftList.value.filter(v => !have.has(v)).map(v => ({ value: v, label: labelCache.get(v) || String(v) }))
    list = [...picked, ...list]
  }
  return list
})

function syncDraft() {
  draftText.value = String(props.modelValue ?? '')
  draftList.value = [...currentList.value]
  draftSingle.value = currentList.value[0]
}

let timer: ReturnType<typeof setTimeout> | null = null
async function fetchRemote(kw: string) {
  if (!props.loader) return
  loading.value = true
  try {
    const list = await props.loader(kw)
    list.forEach(o => labelCache.set(o.value, o.label))
    remoteOptions.value = list
  } finally { loading.value = false }
}
function onKeyword() {
  if (props.kind !== 'remote') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void fetchRemote(keyword.value.trim()) }, 300)
}
function onShow() {
  syncDraft()
  keyword.value = ''
  if (props.kind === 'remote') void fetchRemote('')
}

function apply() {
  if (props.kind === 'text') emit('update:modelValue', draftText.value.trim())
  else if (props.multiple) emit('update:modelValue', [...draftList.value])
  else emit('update:modelValue', draftSingle.value)
  visible.value = false
  emit('change')
}
function reset() {
  draftText.value = ''
  draftList.value = []
  draftSingle.value = undefined
  apply()
}

watch(() => props.modelValue, syncDraft, { immediate: true })
</script>

<style scoped>
.hf { display: inline-flex; align-items: center; gap: 4px; }
.hf-icon { cursor: pointer; color: var(--el-text-color-placeholder); font-size: 13px; }
.hf-icon:hover { color: var(--el-color-primary); }
.hf-icon.is-active { color: var(--el-color-primary); }
.hf-body { display: flex; flex-direction: column; gap: 8px; }
.hf-list { max-height: 240px; overflow: auto; min-height: 40px; }
.hf-item { display: flex; margin: 0 0 4px; white-space: normal; height: auto; }
.hf-radios { display: flex; flex-direction: column; align-items: flex-start; }
.hf-empty { color: var(--el-text-color-placeholder); font-size: 12px; text-align: center; padding: 8px 0; }
.hf-actions { display: flex; justify-content: space-between; align-items: center; }
</style>
