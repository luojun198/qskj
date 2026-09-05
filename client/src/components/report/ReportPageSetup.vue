<template>
  <el-popover placement="bottom-end" :width="330" trigger="click">
    <template #reference>
      <el-button size="small" icon="Setting">页面设置</el-button>
    </template>

    <div class="page-setup">
      <div class="page-setup__row">
        <span class="page-setup__label">纸张</span>
        <el-select v-model="paperSize" size="small" style="width: 110px">
          <el-option v-for="item in PAPER_SIZES" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-radio-group v-model="orientation" size="small">
          <el-radio-button value="portrait">纵向</el-radio-button>
          <el-radio-button value="landscape">横向</el-radio-button>
        </el-radio-group>
      </div>

      <div class="page-setup__row">
        <span class="page-setup__label">缩放</span>
        <el-input-number
          v-model="scalePercent"
          size="small"
          :min="20"
          :max="200"
          :step="5"
          controls-position="right"
          style="width: 104px"
          @change="markManual"
        />
        <span class="page-setup__unit">%</span>
        <el-button size="small" text type="primary" @click="applyAutoScale">自动适配</el-button>
      </div>

      <div class="page-setup__hint" :class="{ 'is-manual': manualScale }">
        {{ scaleHint }}
      </div>

      <div class="page-setup__row page-setup__row--margins">
        <span class="page-setup__label">页边距</span>
        <div class="margin-grid">
          <label v-for="item in MARGIN_FIELDS" :key="item.key" class="margin-item">
            <span>{{ item.label }}</span>
            <el-input-number
              v-model="margins[item.key]"
              size="small"
              :min="0"
              :max="50"
              :step="1"
              controls-position="right"
              style="width: 92px"
            />
          </label>
        </div>
      </div>

      <div class="page-setup__tip">设置按当前报表保存，下次打印沿用。</div>

      <div class="page-setup__actions">
        <el-button size="small" @click="reset">恢复默认</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { PAPER_SIZES, computeAutoFitScale } from '@/utils/standardReportExport'

export type ReportPageSetupValue = {
  paperSize: string
  orientation: 'portrait' | 'landscape'
  /** 缩放倍率，1 = 100% */
  scale: number
  /** 四向页边距，毫米 */
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
}

/** 纸张尺寸（mm，纵向） */

const MARGIN_FIELDS = [
  { key: 'marginTop', label: '上' },
  { key: 'marginBottom', label: '下' },
  { key: 'marginLeft', label: '左' },
  { key: 'marginRight', label: '右' },
] as const


const DEFAULTS: ReportPageSetupValue = {
  paperSize: 'A4',
  orientation: 'portrait',
  scale: 1,
  marginTop: 8,
  marginBottom: 8,
  marginLeft: 8,
  marginRight: 8,
}

const props = defineProps<{
  modelValue: ReportPageSetupValue
  /** 报表内容的实际像素尺寸，用于自动计算缩放 */
  contentSize: { width: number; height: number }
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ReportPageSetupValue]
  save: [value: ReportPageSetupValue]
}>()

const paperSize = ref(props.modelValue.paperSize || DEFAULTS.paperSize)
const orientation = ref(props.modelValue.orientation || DEFAULTS.orientation)
const scalePercent = ref(Math.round((props.modelValue.scale || 1) * 100))
const margins = reactive({
  marginTop: props.modelValue.marginTop ?? DEFAULTS.marginTop,
  marginBottom: props.modelValue.marginBottom ?? DEFAULTS.marginBottom,
  marginLeft: props.modelValue.marginLeft ?? DEFAULTS.marginLeft,
  marginRight: props.modelValue.marginRight ?? DEFAULTS.marginRight,
})

/** 用户手动调过缩放后，就不再被自动适配覆盖，除非他自己点「自动适配」 */
const manualScale = ref(false)

watch(
  () => props.modelValue,
  value => {
    paperSize.value = value.paperSize || DEFAULTS.paperSize
    orientation.value = value.orientation || DEFAULTS.orientation
    scalePercent.value = Math.round((value.scale || 1) * 100)
    margins.marginTop = value.marginTop ?? DEFAULTS.marginTop
    margins.marginBottom = value.marginBottom ?? DEFAULTS.marginBottom
    margins.marginLeft = value.marginLeft ?? DEFAULTS.marginLeft
    margins.marginRight = value.marginRight ?? DEFAULTS.marginRight
    manualScale.value = false
  },
  { deep: true }
)

/** 与打印路径共用同一个自动适配算法，避免「设置里显示 60%、打印却按 100% 出」 */
const autoScalePercent = computed(() =>
  Math.round(
    computeAutoFitScale({
      paperSize: paperSize.value,
      orientation: orientation.value as 'portrait' | 'landscape',
      margins: {
        top: margins.marginTop,
        bottom: margins.marginBottom,
        left: margins.marginLeft,
        right: margins.marginRight,
      },
      contentSize: props.contentSize,
    }) * 100
  )
)

const scaleHint = computed(() => {
  if (!props.contentSize.width) return '未取到报表尺寸，缩放请手动设置'
  if (manualScale.value) return `已手动设置；自动适配建议 ${autoScalePercent.value}%`
  return `已按纸张自动适配为 ${autoScalePercent.value}%，可手动调整`
})

function markManual() {
  manualScale.value = true
}

function applyAutoScale() {
  scalePercent.value = autoScalePercent.value
  manualScale.value = false
}

// 改纸张、方向、边距都会改变可打印区域，未手动设过缩放时自动重算
watch([paperSize, orientation, () => ({ ...margins })], () => {
  if (!manualScale.value) scalePercent.value = autoScalePercent.value
})

// 首次拿到报表尺寸时也算一次
watch(
  () => props.contentSize,
  () => {
    if (!manualScale.value) scalePercent.value = autoScalePercent.value
  },
  { deep: true, immediate: true }
)

function current(): ReportPageSetupValue {
  return {
    paperSize: paperSize.value,
    orientation: orientation.value,
    scale: (scalePercent.value || 100) / 100,
    marginTop: margins.marginTop ?? DEFAULTS.marginTop,
    marginBottom: margins.marginBottom ?? DEFAULTS.marginBottom,
    marginLeft: margins.marginLeft ?? DEFAULTS.marginLeft,
    marginRight: margins.marginRight ?? DEFAULTS.marginRight,
  }
}

function reset() {
  paperSize.value = DEFAULTS.paperSize
  orientation.value = DEFAULTS.orientation
  margins.marginTop = DEFAULTS.marginTop
  margins.marginBottom = DEFAULTS.marginBottom
  margins.marginLeft = DEFAULTS.marginLeft
  margins.marginRight = DEFAULTS.marginRight
  manualScale.value = false
  scalePercent.value = autoScalePercent.value
}

function save() {
  const value = current()
  emit('update:modelValue', value)
  emit('save', value)
}
</script>

<style scoped>
.page-setup {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.page-setup__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-setup__row--margins {
  align-items: flex-start;
}

.page-setup__label {
  width: 48px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.page-setup__unit {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.page-setup__hint {
  margin-left: 56px;
  font-size: 12px;
  color: var(--el-color-primary);
}

.page-setup__hint.is-manual {
  color: var(--el-text-color-secondary);
}

.margin-grid {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 6px 10px;
}

.margin-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.page-setup__tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.page-setup__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
