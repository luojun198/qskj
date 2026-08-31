<template>
  <div class="report-design-toolbar">
    <div class="report-toolbar-row report-design-toolbar__primary">
      <el-select
        v-model="selectedCodeModel"
        placeholder="请选择报表模板"
        style="width: 220px"
        @change="actions.handleTemplateChange()"
      >
        <el-option
          v-for="item in templates"
          :key="item.code"
          :label="`${item.name} (${item.code})`"
          :value="item.code"
        />
      </el-select>
      <el-select v-model="yearModel" size="small" style="width: 108px">
        <el-option v-for="year in years" :key="year" :label="`${year}年`" :value="year" />
      </el-select>
      <el-select v-model="periodModel" size="small" style="width: 88px">
        <el-option v-for="period in 12" :key="period" :label="`${period}月`" :value="period" />
      </el-select>
      <el-switch
        v-if="selectedCodeModel"
        v-model="isEnabledModel"
        inline-prompt
        active-text="启用"
        inactive-text="停用"
        :loading="enabledSwitching"
        @change="actions.handleEnabledChange"
      />
      <el-switch v-model="showExecutionResult" inline-prompt active-text="结果" inactive-text="公式" />
      <el-switch v-model="showZeroValue" inline-prompt active-text="显示0值" inactive-text="隐藏0值" />
      <el-button size="small" :loading="loading" @click="actions.fetchTemplateDetail">刷新</el-button>
      <el-button type="primary" size="small" :loading="saving" @click="actions.saveTemplateChanges">
        保存模板
      </el-button>
      <el-button type="success" size="small" :loading="executing" @click="actions.handleGenerateReport">
        生成报表
      </el-button>
      <el-button v-if="selectedCodeModel" size="small" @click="actions.handleExport">导出 Excel</el-button>
      <el-dropdown trigger="click" @command="handleTemplateCommand">
        <el-button size="small">
          模板管理
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="create">新增报表</el-dropdown-item>
            <el-dropdown-item command="import">导入 Excel</el-dropdown-item>
            <el-dropdown-item v-if="templates.length > 0" command="sort" divided>
              导航顺序
            </el-dropdown-item>
            <el-dropdown-item v-if="selectedCodeModel" command="edit-name">修改名称</el-dropdown-item>
            <el-dropdown-item v-if="selectedCodeModel" command="edit-meta">修改编码</el-dropdown-item>
            <el-dropdown-item v-if="selectedCodeModel" command="delete" divided>
              <span class="report-design-toolbar__danger">删除模板</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="formula-edit-row">
      <span class="formula-label">单元格 {{ selectedPositionLabel || '-' }}</span>
      <el-input
        v-model="topEditorValueModel"
        type="textarea"
        :rows="1"
        resize="none"
        :autosize="{ minRows: 1, maxRows: 3 }"
        class="formula-editor-input"
        :placeholder="selectedPosition ? '请输入公式或文本' : '请先选择单元格'"
        :disabled="!selectedPosition"
        @keydown.enter.exact.prevent="actions.applyTopEditorEdit"
      />
      <el-button type="primary" size="small" :disabled="!selectedPosition" @click="actions.applyTopEditorEdit">
        应用
      </el-button>
    </div>

    <div class="report-design-toolbar__tools">
      <button type="button" class="report-design-toolbar__toggle" @click="toggleDesignTools">
        <span>{{ designToolsExpanded ? '收起设计工具' : '展开设计工具' }}</span>
        <el-icon :class="{ 'is-expanded': designToolsExpanded }"><ArrowDown /></el-icon>
      </button>
      <div v-show="designToolsExpanded" class="toolbar-row">
        <div class="toolbar-group">
          <span class="toolbar-group-label">对齐</span>
          <el-button-group size="small">
            <el-button @click="actions.applyAlignmentToSelection('left')">左</el-button>
            <el-button @click="actions.applyAlignmentToSelection('center')">中</el-button>
            <el-button @click="actions.applyAlignmentToSelection('right')">右</el-button>
            <el-button @click="actions.applyVerticalAlignToSelection('top')">上</el-button>
            <el-button @click="actions.applyVerticalAlignToSelection('middle')">中</el-button>
            <el-button @click="actions.applyVerticalAlignToSelection('bottom')">下</el-button>
          </el-button-group>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-group-label">字体</span>
          <el-button-group size="small">
            <el-dropdown trigger="click" @command="(cmd: string) => actions.applyFontFamilyToSelection(cmd)">
              <el-button>
                字体
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="">默认</el-dropdown-item>
                  <el-dropdown-item command="SimSun">宋体</el-dropdown-item>
                  <el-dropdown-item command="KaiTi">楷体</el-dropdown-item>
                  <el-dropdown-item command="SimHei">黑体</el-dropdown-item>
                  <el-dropdown-item command="FangSong">仿宋</el-dropdown-item>
                  <el-dropdown-item command="Microsoft YaHei">微软雅黑</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-dropdown trigger="click" @command="(cmd: number) => actions.applyFontSizeToSelection(cmd)">
              <el-button>
                字号
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="12">12</el-dropdown-item>
                  <el-dropdown-item :command="13">13 (默认)</el-dropdown-item>
                  <el-dropdown-item :command="14">14</el-dropdown-item>
                  <el-dropdown-item :command="16">16</el-dropdown-item>
                  <el-dropdown-item :command="18">18</el-dropdown-item>
                  <el-dropdown-item :command="22">22</el-dropdown-item>
                  <el-dropdown-item :command="28">28</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button @click="actions.adjustFontSizeToSelection(-1)">A-</el-button>
            <el-button @click="actions.adjustFontSizeToSelection(1)">A+</el-button>
            <el-button @click="actions.toggleBoldToSelection"><strong>B</strong></el-button>
            <el-button @click="actions.toggleUnderlineToSelection"><u>U</u></el-button>
          </el-button-group>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-group-label">边框</span>
          <el-button-group size="small">
            <el-dropdown trigger="click" @command="(cmd: string) => actions.applyBorderToSelection(cmd)">
              <el-button :disabled="!hasStyleSelection">
                边框
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="all">全边框</el-dropdown-item>
                  <el-dropdown-item command="outer">外边框</el-dropdown-item>
                  <el-dropdown-item command="none">无边框</el-dropdown-item>
                  <el-dropdown-item command="bottom">下边框</el-dropdown-item>
                  <el-dropdown-item command="top">上边框</el-dropdown-item>
                  <el-dropdown-item command="left">左边框</el-dropdown-item>
                  <el-dropdown-item command="right">右边框</el-dropdown-item>
                  <el-dropdown-item command="header">标题线</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-dropdown trigger="click" @command="(cmd: string) => actions.applyBorderColorToSelection(cmd)">
              <el-button>
                颜色
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="">默认</el-dropdown-item>
                  <el-dropdown-item command="303030">黑色</el-dropdown-item>
                  <el-dropdown-item command="909399">灰色</el-dropdown-item>
                  <el-dropdown-item command="409eff">蓝色</el-dropdown-item>
                  <el-dropdown-item command="67c23a">绿色</el-dropdown-item>
                  <el-dropdown-item command="e6a23c">橙色</el-dropdown-item>
                  <el-dropdown-item command="f56c6c">红色</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-dropdown trigger="click" @command="(cmd: string) => actions.applyBorderWidthToSelection(cmd)">
              <el-button>
                粗细
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="">默认(1px)</el-dropdown-item>
                  <el-dropdown-item command="2">2px</el-dropdown-item>
                  <el-dropdown-item command="3">3px</el-dropdown-item>
                  <el-dropdown-item command="4">4px</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </el-button-group>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-group-label">格式</span>
          <el-button-group size="small">
            <el-dropdown trigger="click" @command="(cmd: string) => actions.applyFormatToSelection(cmd)">
              <el-button>
                数字格式
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="">默认</el-dropdown-item>
                  <el-dropdown-item command="integer">整数</el-dropdown-item>
                  <el-dropdown-item command="2decimal">两位小数</el-dropdown-item>
                  <el-dropdown-item command="4decimal">四位小数</el-dropdown-item>
                  <el-dropdown-item command="percent">百分比</el-dropdown-item>
                  <el-dropdown-item command="thousands">千分位</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </el-button-group>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-group-label">行列</span>
          <el-button-group size="small">
            <el-button :disabled="!selectedPosition" @click="actions.insertRow">插行</el-button>
            <el-button :disabled="!selectedPosition" @click="actions.deleteRow">删行</el-button>
            <el-button :disabled="!selectedPosition" @click="actions.insertCol">插列</el-button>
            <el-button :disabled="!selectedPosition" @click="actions.deleteCol">删列</el-button>
          </el-button-group>
        </div>
        <div class="toolbar-group">
          <span class="toolbar-group-label">合并</span>
          <el-button-group size="small">
            <el-button :disabled="!canMergeSelection" @click="actions.mergeSelection">合并</el-button>
            <el-button :disabled="!canUnmergeSelection" @click="actions.unmergeSelection">取消</el-button>
          </el-button-group>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'

const DESIGN_TOOLS_KEY = 'cw-report-design-tools-expanded'

defineProps<{
  templates: Array<{ code: string; name: string }>
  years: number[]
  loading?: boolean
  saving?: boolean
  executing?: boolean
  enabledSwitching?: boolean
  selectedPositionLabel?: string
  selectedPosition?: { rowIndex: number; colIndex: number } | null
  hasStyleSelection?: boolean
  canMergeSelection?: boolean
  canUnmergeSelection?: boolean
  actions: Record<string, (...args: any[]) => void>
}>()

const selectedCodeModel = defineModel<string>('selectedCode', { required: true })
const yearModel = defineModel<number>('year', { required: true })
const periodModel = defineModel<number>('period', { required: true })
const isEnabledModel = defineModel<boolean>('isEnabled', { required: true })
const showExecutionResult = defineModel<boolean>('showExecutionResult', { required: true })
const showZeroValue = defineModel<boolean>('showZeroValue', { required: true })
const topEditorValueModel = defineModel<string>('topEditorValue', { required: true })

const emit = defineEmits<{
  'template-command': [command: string]
}>()

const designToolsExpanded = ref(localStorage.getItem(DESIGN_TOOLS_KEY) !== 'false')

watch(designToolsExpanded, value => {
  localStorage.setItem(DESIGN_TOOLS_KEY, String(value))
})

function toggleDesignTools() {
  designToolsExpanded.value = !designToolsExpanded.value
}

function handleTemplateCommand(command: string) {
  emit('template-command', command)
}
</script>

<style scoped>
.report-design-toolbar__danger {
  color: var(--el-color-danger);
}

.report-design-toolbar__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 13px;
  cursor: pointer;
}

.report-design-toolbar__toggle .el-icon {
  transition: transform 0.2s ease;
}

.report-design-toolbar__toggle .el-icon.is-expanded {
  transform: rotate(180deg);
}
</style>
