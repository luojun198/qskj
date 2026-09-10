<template>
  <div class="style-toolbar">
    <button type="button" class="style-toolbar__toggle" @click="expanded = !expanded">
      <el-icon :class="{ 'is-expanded': expanded }"><ArrowDown /></el-icon>
      格式工具
    </button>

    <div v-show="expanded" class="style-toolbar__body">
      <!-- 字体 -->
      <div class="style-group">
        <span class="style-group__label">字体</span>
        <el-select
          :model-value="style.fontFamily"
          size="small"
          style="width: 108px"
          :disabled="disabled"
          @change="(v: string) => apply({ fontFamily: v })"
        >
          <el-option
            v-for="item in FONT_FAMILY_OPTIONS"
            :key="item.token"
            :label="item.label"
            :value="item.token"
          />
        </el-select>
        <!-- filterable + allow-create：列表之外的字号可以直接敲进去 -->
        <el-select
          :model-value="style.fontSize || 13"
          size="small"
          style="width: 86px"
          filterable
          allow-create
          default-first-option
          :disabled="disabled"
          @change="handleFontSize"
        >
          <el-option v-for="size in FONT_SIZE_OPTIONS" :key="size" :label="size" :value="size" />
        </el-select>
        <el-button-group size="small">
          <el-button :disabled="disabled" @click="adjustFontSize(-1)">A-</el-button>
          <el-button :disabled="disabled" @click="adjustFontSize(1)">A+</el-button>
          <el-button
            :disabled="disabled"
            :type="style.bold ? 'primary' : undefined"
            @click="apply({ bold: !style.bold })"
          >
            <strong>B</strong>
          </el-button>
          <el-button
            :disabled="disabled"
            :type="style.underline ? 'primary' : undefined"
            @click="apply({ underline: !style.underline })"
          >
            <u>U</u>
          </el-button>
        </el-button-group>
      </div>

      <!-- 对齐 -->
      <div class="style-group">
        <span class="style-group__label">对齐</span>
        <el-button-group size="small">
          <el-button
            v-for="item in H_ALIGNS"
            :key="item.value"
            :disabled="disabled"
            :type="style.textAlign === item.value ? 'primary' : undefined"
            @click="apply({ textAlign: item.value })"
          >{{ item.label }}</el-button>
        </el-button-group>
        <el-button-group size="small">
          <el-button
            v-for="item in V_ALIGNS"
            :key="item.value"
            :disabled="disabled"
            :type="style.verticalAlign === item.value ? 'primary' : undefined"
            @click="apply({ verticalAlign: item.value })"
          >{{ item.label }}</el-button>
        </el-button-group>
      </div>

      <!-- 颜色 -->
      <div class="style-group">
        <span class="style-group__label">颜色</span>
        <el-tooltip content="文字颜色" placement="top">
          <el-color-picker
            :model-value="toHex(style.textColor)"
            size="small"
            :disabled="disabled"
            @change="(v: string | null) => apply({ textColor: v || '' })"
          />
        </el-tooltip>
        <el-tooltip content="单元格底色" placement="top">
          <el-color-picker
            :model-value="toHex(style.bgColor)"
            size="small"
            :disabled="disabled"
            @change="(v: string | null) => apply({ bgColor: v || '' })"
          />
        </el-tooltip>
        <el-button size="small" :disabled="disabled" @click="apply({ textColor: '', bgColor: '' })">
          清除
        </el-button>
      </div>

      <!-- 边框 -->
      <div class="style-group">
        <span class="style-group__label">边框</span>
        <el-select
          :model-value="style.borderStyle"
          size="small"
          style="width: 106px"
          :disabled="disabled"
          @change="(v: string) => apply({ borderStyle: v })"
        >
          <el-option
            v-for="item in BORDER_STYLE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-tooltip content="边框颜色" placement="top">
          <el-color-picker
            :model-value="toHex(style.borderColor)"
            size="small"
            :disabled="disabled"
            @change="(v: string | null) => apply({ borderColor: v || '' })"
          />
        </el-tooltip>
        <el-select
          :model-value="style.borderWidth || 1"
          size="small"
          style="width: 72px"
          :disabled="disabled"
          @change="(v: number) => apply({ borderWidth: v })"
        >
          <el-option v-for="w in [1, 2, 3]" :key="w" :label="`${w}px`" :value="w" />
        </el-select>
      </div>

      <!-- 数字格式 -->
      <div class="style-group">
        <span class="style-group__label">数字</span>
        <el-select
          :model-value="numberFormat"
          size="small"
          style="width: 108px"
          :disabled="disabled"
          @change="(v: string) => emit('format', v)"
        >
          <el-option
            v-for="item in NUMBER_FORMAT_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'

import {
  BORDER_STYLE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  NUMBER_FORMAT_OPTIONS,
  type CellStyle,
} from '@/composables/useReportCellStyle'

const STORAGE_KEY = 'cw-standard-report-style-tools-expanded'

const props = defineProps<{
  style: CellStyle
  numberFormat: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  apply: [patch: Partial<CellStyle>]
  format: [formatText: string]
  'adjust-font-size': [delta: number]
}>()

const expanded = ref(localStorage.getItem(STORAGE_KEY) !== 'false')
watch(expanded, value => localStorage.setItem(STORAGE_KEY, String(value)))

const H_ALIGNS = [
  { value: 'left' as const, label: '左' },
  { value: 'center' as const, label: '中' },
  { value: 'right' as const, label: '右' },
]
const V_ALIGNS = [
  { value: 'top' as const, label: '上' },
  { value: 'middle' as const, label: '中' },
  { value: 'bottom' as const, label: '下' },
]

/** style_key 里存的是不带 # 的六位色值，色板要的是 #RRGGBB */
function toHex(value: string) {
  return value ? `#${value}` : null
}

function apply(patch: Partial<CellStyle>) {
  if (props.disabled) return
  emit('apply', patch)
}

/** allow-create 会把输入的内容当字符串传回来，这里统一成数字并做范围保护 */
function handleFontSize(value: number | string) {
  if (props.disabled) return
  const size = Math.round(Number(value))
  if (!Number.isFinite(size) || size < 6 || size > 200) return
  emit('apply', { fontSize: size })
}

function adjustFontSize(delta: number) {
  if (props.disabled) return
  emit('adjust-font-size', delta)
}
</script>

<style scoped>
.style-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.style-toolbar__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  font-size: var(--cw-text-base);
  cursor: pointer;
}

.style-toolbar__toggle .el-icon {
  transition: transform 0.2s ease;
}

.style-toolbar__toggle .el-icon.is-expanded {
  transform: rotate(180deg);
}

.style-toolbar__body {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.style-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.style-group__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
</style>
