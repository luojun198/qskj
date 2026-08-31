<template>
  <div class="report-view-toolbar">
    <div class="report-view-toolbar__main">
      <div class="report-view-toolbar__title">
        <h3>{{ pageTitle }}</h3>
        <p v-if="subtitle" class="report-view-toolbar__subtitle">{{ subtitle }}</p>
      </div>
      <div class="report-toolbar-row">
        <el-select v-model="yearModel" size="small" style="width: 108px">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="periodModel" size="small" style="width: 88px">
          <el-option v-for="p in 12" :key="p" :label="`${p}月`" :value="p" />
        </el-select>
        <el-dropdown trigger="click" @command="handleDisplayCommand">
          <el-button size="small">
            显示
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="toggle-result">
                {{ showExecutionResult ? '✓ ' : '' }}显示计算结果
              </el-dropdown-item>
              <el-dropdown-item command="toggle-zero">
                {{ showZeroValue ? '✓ ' : '' }}显示 0 值
              </el-dropdown-item>
              <el-dropdown-item command="toggle-formula" divided>
                {{ !showExecutionResult ? '✓ ' : '' }}显示公式
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button type="success" size="small" :loading="executing" @click="emit('generate')">
          生成报表
        </el-button>
        <el-button size="small" @click="emit('print')">打印</el-button>
        <el-button size="small" :disabled="!canExport" @click="emit('export')">导出 Excel</el-button>
      </div>
    </div>
    <el-alert
      v-if="showCashFlowHint"
      type="info"
      :closable="false"
      show-icon
      class="report-cash-flow-hint"
      title="正式报送以本表为准；可用「科目估算」页核对静态口径与分录差异"
    >
      <template #default>
        <el-button type="primary" link @click="emit('open-cash-flow-compare')">
          打开现金流量表(估算)对比
        </el-button>
      </template>
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown } from '@element-plus/icons-vue'

defineProps<{
  pageTitle: string
  subtitle?: string
  years: number[]
  executing?: boolean
  canExport?: boolean
  showCashFlowHint?: boolean
}>()

const emit = defineEmits<{
  generate: []
  print: []
  export: []
  'open-cash-flow-compare': []
}>()

const yearModel = defineModel<number>('year', { required: true })
const periodModel = defineModel<number>('period', { required: true })
const showExecutionResult = defineModel<boolean>('showExecutionResult', { required: true })
const showZeroValue = defineModel<boolean>('showZeroValue', { required: true })

function handleDisplayCommand(command: string) {
  if (command === 'toggle-result') showExecutionResult.value = true
  if (command === 'toggle-formula') showExecutionResult.value = false
  if (command === 'toggle-zero') showZeroValue.value = !showZeroValue.value
}
</script>
