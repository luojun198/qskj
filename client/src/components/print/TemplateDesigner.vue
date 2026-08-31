<template>
  <div class="template-designer">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-form :inline="true" size="small">
          <el-form-item label="模版名称">
            <el-input v-model="template.name" placeholder="请输入模版名称" style="width: 200px" />
          </el-form-item>
          <el-form-item label="纸张规格">
            <el-select
              v-model="template.paper_size"
              style="width: 120px"
              @change="handlePaperSizeChange"
            >
              <el-option label="自定义" value="custom" />
              <el-option label="A4" value="a4" />
              <el-option label="A5" value="a5" />
            </el-select>
          </el-form-item>
          <el-form-item label="宽度(mm)">
            <el-input-number
              v-model="template.paper_width"
              :min="100"
              :max="500"
              :disabled="template.paper_size !== 'custom'"
            />
          </el-form-item>
          <el-form-item label="高度(mm)">
            <el-input-number
              v-model="template.paper_height"
              :min="100"
              :max="500"
              :disabled="template.paper_size !== 'custom'"
            />
          </el-form-item>
          <el-form-item label="上边距">
            <el-input-number
              v-model="template.margin_top"
              :min="0"
              :max="50"
              :step="1"
              :precision="1"
              style="width: 90px"
            />
          </el-form-item>
          <el-form-item label="下边距">
            <el-input-number
              v-model="template.margin_bottom"
              :min="0"
              :max="50"
              :step="1"
              :precision="1"
              style="width: 90px"
            />
          </el-form-item>
          <el-form-item label="左边距">
            <el-input-number
              v-model="template.margin_left"
              :min="0"
              :max="50"
              :step="1"
              :precision="1"
              style="width: 90px"
            />
          </el-form-item>
          <el-form-item label="右边距">
            <el-input-number
              v-model="template.margin_right"
              :min="0"
              :max="50"
              :step="1"
              :precision="1"
              style="width: 90px"
            />
          </el-form-item>
        </el-form>
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="handleSave">保存模版</el-button>
        <el-button @click="handlePreview">预览</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>
    </div>

    <div class="designer-content">
      <!-- 左侧元素面板 -->
      <div class="element-panel">
        <div class="panel-title">元素库</div>

        <!-- 基础元素 -->
        <div class="element-group">
          <div class="group-title">基础元素</div>
          <div class="element-list">
            <div
              v-for="item in basicElements"
              :key="item.type"
              class="element-item"
              draggable="true"
              @dragstart="handleDragStart($event, item.type)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </div>
          </div>
        </div>

        <!-- 凭证信息 -->
        <div class="element-group">
          <div class="group-title">凭证信息</div>
          <div class="element-list">
            <div
              v-for="item in voucherElements"
              :key="item.type"
              class="element-item"
              draggable="true"
              @dragstart="handleDragStart($event, item.type)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </div>
          </div>
        </div>

        <!-- 分录表格 -->
        <div class="element-group">
          <div class="group-title">分录表格</div>
          <div class="element-list">
            <div
              v-for="item in tableElements"
              :key="item.type"
              class="element-item"
              draggable="true"
              @dragstart="handleDragStart($event, item.type)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </div>
          </div>
        </div>

        <!-- 合计信息 -->
        <div class="element-group">
          <div class="group-title">合计信息</div>
          <div class="element-list">
            <div
              v-for="item in totalElements"
              :key="item.type"
              class="element-item"
              draggable="true"
              @dragstart="handleDragStart($event, item.type)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </div>
          </div>
        </div>

        <!-- 签名栏 -->
        <div class="element-group">
          <div class="group-title">签名栏</div>
          <div class="element-list">
            <div
              v-for="item in signatureElements"
              :key="item.type"
              class="element-item"
              draggable="true"
              @dragstart="handleDragStart($event, item.type)"
            >
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 中间画布区域 -->
      <div class="canvas-container">
        <div class="canvas-wrapper">
          <div ref="canvasRef" class="canvas" :style="canvasOuterStyle">
            <!-- 内容区容器：元素在此内部定位 -->
            <div
              ref="contentRef"
              class="canvas-content"
              :style="canvasContentStyle"
              @drop="handleDrop"
              @dragover.prevent
              @mousedown.self="handleCanvasMouseDown"
            >
              <div v-if="selBoxVisible" class="selection-box" :style="selectionBoxStyle" />
              <!-- 渲染所有元素 -->
              <vue-draggable-resizable
                v-for="element in elements"
                :key="element.id"
                :x="mm2px(element.x)"
                :y="mm2px(element.y)"
                :w="mm2px(element.width)"
                :h="mm2px(element.height)"
                :parent="true"
                :grid="[mm2px(0.5), mm2px(0.5)]"
                :class="{ 'vdr-selected': isSelected(element) }"
                @dragging="(left: number, top: number) => onDrag(element, left, top)"
                @resizing="
                  (left: number, top: number, width: number, height: number) =>
                    onResize(element, left, top, width, height)
                "
                @activated="selectElement(element)"
                @deactivated="deselectElement"
              >
                <div
                  class="element-content"
                  :style="{
                    fontSize: element.fontSize * pxPerPt + 'px',
                    fontWeight: element.fontWeight,
                    textAlign: element.align,
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                  }"
                  @click.stop="handleElementClick(element, $event)"
                >
                  {{ getElementPreviewText(element) }}
                </div>
              </vue-draggable-resizable>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧属性面板 -->
      <div class="property-panel">
        <div class="panel-title">属性设置</div>

        <div v-if="selectedElements.length > 1" class="property-form">
          <el-form label-width="80px" size="small">
            <el-form-item label="已选元素">
              <span class="selected-count">{{ selectedElements.length }} 个元素</span>
            </el-form-item>
            <el-form-item label="对齐方式">
              <div class="align-tools">
                <div class="align-row">
                  <el-button size="small" @click="alignLeft">左对齐</el-button>
                  <el-button size="small" @click="alignCenterH">水平居中</el-button>
                  <el-button size="small" @click="alignRight">右对齐</el-button>
                </div>
                <div class="align-row">
                  <el-button size="small" @click="alignTop">上对齐</el-button>
                  <el-button size="small" @click="alignMiddleV">垂直居中</el-button>
                  <el-button size="small" @click="alignBottom">下对齐</el-button>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="尺寸调整">
              <div class="align-row">
                <el-button size="small" @click="equalWidth">等宽</el-button>
                <el-button size="small" @click="equalHeight">等高</el-button>
              </div>
            </el-form-item>
            <el-form-item label="移动步长">
              <el-input-number
                v-model="moveStep"
                :min="0.5"
                :max="20"
                :step="0.5"
                :precision="1"
                size="small"
                style="width: 100px"
              />
              <span style="margin-left: 8px; font-size: 12px; color: #909399">mm</span>
            </el-form-item>
            <el-form-item>
              <el-button type="danger" size="small" @click="handleDeleteElement"
                >删除元素 ({{ selectedElements.length }})</el-button
              >
            </el-form-item>
          </el-form>
        </div>

        <div v-else-if="selectedElement" class="property-form">
          <div class="element-type-title">{{ getElementTypeLabel(selectedElement.type) }}</div>
          <!-- 基础属性 -->
          <el-form label-width="80px" size="small">
            <el-form-item label="X 坐标">
              <el-input-number v-model="selectedElement.x" :min="0" :step="1" :precision="1" />
              <span class="unit-hint">mm</span>
            </el-form-item>

            <el-form-item label="Y 坐标">
              <el-input-number v-model="selectedElement.y" :min="0" :step="1" :precision="1" />
              <span class="unit-hint">mm</span>
            </el-form-item>

            <el-form-item label="宽度">
              <el-input-number v-model="selectedElement.width" :min="5" :step="1" :precision="1" />
              <span class="unit-hint">mm</span>
            </el-form-item>

            <el-form-item label="高度">
              <el-input-number v-model="selectedElement.height" :min="5" :step="1" :precision="1" />
              <span class="unit-hint">mm</span>
            </el-form-item>

            <el-form-item label="字体大小">
              <el-input-number v-model="selectedElement.fontSize" :min="6" :max="48" :step="1" />
              <span class="unit-hint">pt</span>
            </el-form-item>

            <el-form-item label="字体粗细">
              <el-select v-model="selectedElement.fontWeight">
                <el-option label="正常" value="normal" />
                <el-option label="加粗" value="bold" />
              </el-select>
            </el-form-item>

            <el-form-item label="对齐方式">
              <el-select v-model="selectedElement.align">
                <el-option label="左对齐" value="left" />
                <el-option label="居中" value="center" />
                <el-option label="右对齐" value="right" />
              </el-select>
            </el-form-item>

            <!-- 自定义文本 -->
            <el-form-item
              v-if="selectedElement.type === 'text' || selectedElement.type === 'title'"
              label="文本内容"
            >
              <el-input v-model="selectedElement.text" type="textarea" :rows="3" />
            </el-form-item>

            <!-- 日期格式 -->
            <el-form-item v-if="selectedElement.type === 'date'" label="日期格式">
              <el-select v-model="selectedElement.dateFormat">
                <el-option label="YYYY-MM-DD" value="YYYY-MM-DD" />
                <el-option label="YYYY年MM月DD日" value="YYYY年MM月DD日" />
                <el-option label="MM/DD/YYYY" value="MM/DD/YYYY" />
              </el-select>
            </el-form-item>

            <!-- 金额格式 -->
            <el-form-item
              v-if="
                selectedElement.type === 'total_debit' || selectedElement.type === 'total_credit'
              "
              label="金额格式"
            >
              <el-select v-model="selectedElement.numberFormat">
                <el-option label="普通" value="plain" />
                <el-option label="千分位" value="thousand" />
                <el-option label="货币符号" value="currency" />
              </el-select>
            </el-form-item>

            <!-- 表格配置 -->
            <template v-if="selectedElement.type === 'table'">
              <el-form-item label="边框宽度">
                <el-input-number v-model="selectedElement.borderWidth" :min="0" :max="5" />
              </el-form-item>

              <el-form-item label="显示表头">
                <el-switch v-model="selectedElement.showHeader" />
              </el-form-item>

              <el-form-item label="行高">
                <el-input-number
                  v-model="selectedElement.rowHeight"
                  :min="4"
                  :max="25"
                  :step="1"
                  :precision="1"
                />
                <span class="unit-hint">mm</span>
              </el-form-item>

              <el-form-item label="打印行数">
                <el-input-number v-model="selectedElement.printRows" :min="3" :max="20" :step="1" />
                <span class="unit-hint">含合计行</span>
              </el-form-item>

              <el-form-item label="表格列">
                <el-alert type="info" :closable="false" style="margin-bottom: 12px">
                  <template #default>
                    <span style="font-size: 12px"
                      >列头永远居中显示，垂直对齐和内边距设置仅对明细行生效</span
                    >
                  </template>
                </el-alert>
                <div class="table-columns">
                  <div
                    v-for="(col, index) in selectedElement.columns"
                    :key="index"
                    class="column-item"
                  >
                    <div class="column-main-row">
                      <el-checkbox v-model="col.visible">{{ col.label }}</el-checkbox>
                      <el-input
                        v-model="col.width"
                        size="small"
                        style="width: 80px; margin-left: 10px"
                        placeholder="宽度"
                      />
                      <el-select
                        v-model="col.align"
                        size="small"
                        style="width: 90px; margin-left: 10px"
                        placeholder="水平对齐"
                      >
                        <el-option label="左" value="left" />
                        <el-option label="中" value="center" />
                        <el-option label="右" value="right" />
                      </el-select>
                      <el-select
                        v-model="col.verticalAlign"
                        size="small"
                        style="width: 90px; margin-left: 10px"
                        placeholder="垂直对齐"
                      >
                        <el-option label="上" value="top" />
                        <el-option label="中" value="middle" />
                        <el-option label="下" value="bottom" />
                      </el-select>
                      <el-button
                        size="small"
                        text
                        style="margin-left: 10px"
                        @click="toggleColumnPadding(index)"
                      >
                        内边距
                      </el-button>
                      <el-button
                        type="danger"
                        size="small"
                        text
                        style="margin-left: 10px"
                        @click="removeColumn(index)"
                      >
                        删除
                      </el-button>
                    </div>

                    <!-- 内边距详细设置（可折叠） -->
                    <div v-if="(col as any).showPaddingSettings" class="column-padding-settings">
                      <el-form label-width="40px" size="small">
                        <el-form-item label="上">
                          <el-input-number
                            v-model="col.paddingTop"
                            :min="0"
                            :max="10"
                            :step="0.5"
                            :precision="1"
                            size="small"
                            style="width: 100px"
                          />
                          <span class="unit-hint">mm</span>
                        </el-form-item>
                        <el-form-item label="下">
                          <el-input-number
                            v-model="col.paddingBottom"
                            :min="0"
                            :max="10"
                            :step="0.5"
                            :precision="1"
                            size="small"
                            style="width: 100px"
                          />
                          <span class="unit-hint">mm</span>
                        </el-form-item>
                        <el-form-item label="左">
                          <el-input-number
                            v-model="col.paddingLeft"
                            :min="0"
                            :max="10"
                            :step="0.5"
                            :precision="1"
                            size="small"
                            style="width: 100px"
                          />
                          <span class="unit-hint">mm</span>
                        </el-form-item>
                        <el-form-item label="右">
                          <el-input-number
                            v-model="col.paddingRight"
                            :min="0"
                            :max="10"
                            :step="0.5"
                            :precision="1"
                            size="small"
                            style="width: 100px"
                          />
                          <span class="unit-hint">mm</span>
                        </el-form-item>
                      </el-form>
                    </div>
                  </div>
                  <el-select
                    v-model="newColumnField"
                    placeholder="添加列"
                    size="small"
                    style="width: 100%; margin-top: 10px"
                    @change="addColumn"
                  >
                    <el-option
                      v-for="col in availableColumnsToAdd"
                      :key="col.field"
                      :label="col.label"
                      :value="col.field"
                    />
                  </el-select>
                </div>
              </el-form-item>
            </template>

            <el-form-item>
              <el-button type="danger" size="small" @click="handleDeleteElement"
                >删除元素</el-button
              >
            </el-form-item>
          </el-form>
        </div>

        <div v-else class="no-selection">
          <el-empty description="请选择一个元素" />
        </div>
      </div>
    </div>

    <!-- 预览对话框 -->
    <el-dialog v-model="previewVisible" title="打印预览" width="90%" :close-on-click-modal="false">
      <PrintPreview
        v-if="previewVisible"
        :template="currentTemplate"
        :voucher-data="mockVouchers[0]"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import VueDraggableResizable from 'vue-draggable-resizable'
import 'vue-draggable-resizable/style.css'
import PrintPreview from './PrintPreview.vue'
import type { PrintTemplate, FieldElement, FieldElementType, TableColumn } from '@/types/print'
import type { VoucherPrintData } from '@/types/print'
import { useUserStore } from '@/stores/user'
import request from '@/api/request'
import { normalizePrintTemplateElements } from '@/utils/printTemplate'

// 图标组件
import {
  Document,
  Edit,
  Tickets,
  Calendar,
  Files,
  Paperclip,
  Grid,
  Plus,
  User,
  OfficeBuilding,
} from '@element-plus/icons-vue'

const props = defineProps<{
  templateId?: string
}>()

const emit = defineEmits<{
  save: []
  cancel: []
}>()

const userStore = useUserStore()

// 当前模版数据
const template = ref<PrintTemplate>({
  id: '',
  account_set_id: userStore.accountSetId || '',
  name: '新建模版',
  paper_size: 'custom',
  paper_width: 220,
  paper_height: 140,
  margin_top: 10,
  margin_bottom: 10,
  margin_left: 10,
  margin_right: 10,
  elements: [],
  is_default: false,
  created_at: '',
  updated_at: '',
})

// 画布引用（外层纸张容器）
const canvasRef = ref<HTMLElement>()
// 内容区引用
const contentRef = ref<HTMLElement>()

// mm → px 动态换算（根据实际屏幕 DPI 计算，与浏览器 CSS mm 单位一致）
let mmPerPx = 3.7795275591
let pxPerPt = 1.333 // pt → px 换算（屏幕 DPI / 72）

function calibrateMmPerPx() {
  if (!document.body) return
  const testEl = document.createElement('div')
  testEl.style.cssText =
    'width:100mm;position:fixed;visibility:hidden;pointer-events:none;font-size:72pt'
  document.body.appendChild(testEl)
  const pxWidth = testEl.offsetWidth
  const ptHeight = parseFloat(getComputedStyle(testEl).fontSize) || 96
  document.body.removeChild(testEl)
  if (pxWidth > 0) {
    mmPerPx = pxWidth / 100
    pxPerPt = ptHeight / 72
  }
}

function mm2px(mm: number): number {
  return mm * mmPerPx
}
function px2mm(px: number): number {
  return px / mmPerPx
}

// 获取鼠标在内容区的坐标，返回 mm
function getCanvasOffsetMm(e: MouseEvent): { x: number; y: number } {
  const target = contentRef.value || canvasRef.value
  if (!target) return { x: 0, y: 0 }
  const rect = target.getBoundingClientRect()
  return {
    x: px2mm(e.clientX - rect.left),
    y: px2mm(e.clientY - rect.top),
  }
}

// 元素列表
const elements = ref<FieldElement[]>([])

// 选中的元素（支持多选）
const selectedElements = ref<FieldElement[]>([])

// 兼容旧单选逻辑（属性面板等场景只需要第一个）
const selectedElement = computed<FieldElement | null>(() =>
  selectedElements.value.length === 1 ? selectedElements.value[0] : null
)

// 移动步长
const moveStep = ref(1)

// 撤回/重做栈
const undoStack = ref<string[]>([])
const undoIndex = ref(-1)

function pushUndo() {
  undoStack.value = undoStack.value.slice(0, undoIndex.value + 1)
  const snapshot = JSON.stringify(elements.value)
  if (undoStack.value.length > 0 && undoStack.value[undoIndex.value] === snapshot) return
  undoStack.value.push(snapshot)
  undoIndex.value = undoStack.value.length - 1
  if (undoStack.value.length > 80) {
    undoStack.value.shift()
    undoIndex.value--
  }
}

function undo() {
  if (undoIndex.value <= 0) {
    ElMessage.info('没有可撤销的操作')
    return
  }
  undoIndex.value--
  elements.value = JSON.parse(undoStack.value[undoIndex.value])
  selectedElements.value = []
  ElMessage.success('已撤销')
}

function redo() {
  if (undoIndex.value >= undoStack.value.length - 1) {
    ElMessage.info('没有可恢复的操作')
    return
  }
  undoIndex.value++
  elements.value = JSON.parse(undoStack.value[undoIndex.value])
  selectedElements.value = []
  ElMessage.success('已恢复')
}

// 框选状态（mm 单位）
const selBoxVisible = ref(false)
const selBoxX = ref(0)
const selBoxY = ref(0)
const selBoxW = ref(0)
const selBoxH = ref(0)
let selStartX = 0
let selStartY = 0

const selectionBoxStyle = computed(() => {
  return {
    left: `${mm2px(selBoxX.value)}px`,
    top: `${mm2px(selBoxY.value)}px`,
    width: `${mm2px(selBoxW.value)}px`,
    height: `${mm2px(selBoxH.value)}px`,
  }
})

// 判断元素是否被选中
function isSelected(element: FieldElement): boolean {
  return selectedElements.value.some(e => e.id === element.id)
}

// 预览对话框
const previewVisible = ref(false)

// 辅助核算类别列表
const auxCategories = ref<Array<{ code: string; name: string }>>([])

// 可用的表格列选项（包含基础列和辅助项目列）
const availableColumns = computed(() => {
  const baseColumns = [
    { field: 'summary', label: '摘要' },
    { field: 'account_code', label: '科目代码' },
    { field: 'account_name', label: '科目名称' },
    { field: 'debit', label: '借方' },
    { field: 'credit', label: '贷方' },
  ]

  const auxColumns = auxCategories.value.map(cat => ({
    field: `aux_${cat.code}`,
    label: cat.name,
  }))

  return [...baseColumns, ...auxColumns]
})

// 可添加的列选项（排除已添加的列）
const availableColumnsToAdd = computed(() => {
  if (!selectedElement.value || selectedElement.value.type !== 'table') {
    return []
  }
  const existingFields = selectedElement.value.columns?.map(c => c.field) || []
  return availableColumns.value.filter(col => !existingFields.includes(col.field))
})

// 新列字段（用于下拉选择）
const newColumnField = ref<string>('')

// 元素库定义
const basicElements = [
  { type: 'title' as FieldElementType, label: '标题', icon: Document },
  { type: 'text' as FieldElementType, label: '自定义文本', icon: Edit },
]

const voucherElements = [
  { type: 'account_set_name' as FieldElementType, label: '账套名称', icon: Files },
  { type: 'unit_name' as FieldElementType, label: '单位名称', icon: OfficeBuilding },
  { type: 'voucher_no' as FieldElementType, label: '凭证字号', icon: Tickets },
  { type: 'date' as FieldElementType, label: '日期', icon: Calendar },
  { type: 'voucher_type' as FieldElementType, label: '凭证类型', icon: Files },
  { type: 'attachments' as FieldElementType, label: '附件张数', icon: Paperclip },
]

const tableElements = [{ type: 'table' as FieldElementType, label: '分录表格', icon: Grid }]

const totalElements = [
  { type: 'total_label' as FieldElementType, label: '合计标签', icon: Document },
  { type: 'total_debit' as FieldElementType, label: '借方合计', icon: Plus },
  { type: 'total_credit' as FieldElementType, label: '贷方合计', icon: Plus },
]

const signatureElements = [
  { type: 'signature_maker' as FieldElementType, label: '制单', icon: User },
  { type: 'signature_auditor' as FieldElementType, label: '审核', icon: User },
  { type: 'signature_poster' as FieldElementType, label: '记账', icon: User },
  { type: 'signature_supervisor' as FieldElementType, label: '主管', icon: User },
]

// 画布外层样式（纸张尺寸，padding 显示页边距区域）
const canvasOuterStyle = computed(() => ({
  width: `${template.value.paper_width}mm`,
  height: `${template.value.paper_height}mm`,
  padding: `${template.value.margin_top}mm ${template.value.margin_right}mm ${template.value.margin_bottom}mm ${template.value.margin_left}mm`,
  boxSizing: 'border-box' as const,
}))

// 画布内容区样式（元素实际放置区域）
const canvasContentStyle = computed(() => ({
  width: '100%',
  height: '100%',
  position: 'relative' as const,
}))

// 当前模版（用于预览）
const currentTemplate = computed<PrintTemplate>(() => ({
  ...template.value,
  elements: elements.value,
}))

// 模拟凭证数据
const mockVouchers = ref<VoucherPrintData[]>([
  {
    id: '1',
    voucher_no: 'JZ-2026-001',
    date: '2026-04-28',
    voucher_type: '记账凭证',
    attachments: 2,
    account_set_name: '示例账套',
    entries: [
      {
        summary: '购买办公用品',
        account_code: '6602',
        account_name: '办公费',
        debit: 1000,
        credit: 0,
      },
      {
        summary: '银行存款',
        account_code: '1002',
        account_name: '银行存款',
        debit: 0,
        credit: 1000,
      },
    ],
    total_debit: 1000,
    total_credit: 1000,
    created_by: '张三',
    created_at: '2026-04-28 10:00:00',
    auditor: '李四',
    audit_time: '2026-04-28 11:00:00',
  },
])

// 初始化
onMounted(() => {
  calibrateMmPerPx()
  loadAuxCategories()
  loadTemplate()
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})

// 加载辅助核算类别
async function loadAuxCategories() {
  try {
    const response = await request.get<{ code: string; name: string }[]>('/base/aux-categories')
    auxCategories.value = response.data
  } catch (error: any) {
    console.error('加载辅助核算类别失败:', error)
    auxCategories.value = []
  }
}

// 加载模版
async function loadTemplate() {
  if (props.templateId) {
    // 编辑模式：从 API 加载
    try {
      const response = await request.get<PrintTemplate>(`/base/print-templates/${props.templateId}`)
      template.value = response.data

      const normalized = normalizePrintTemplateElements(
        template.value.elements,
        template.value.paper_width,
        template.value.paper_height
      )
      if (normalized.length > 0) {
        elements.value = JSON.parse(JSON.stringify(normalized))
        pushUndo()
      } else {
        generatePresetLayout()
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '加载模版失败')
      generatePresetLayout()
    }
  } else {
    // 新建模式：生成预设布局
    generatePresetLayout()
  }
}

// 生成预设布局
function generatePresetLayout() {
  // 内容区 200mm x 120mm（220-10-10, 140-10-10）
  const cw = 200 // 内容区宽度
  const presetElements: FieldElement[] = []

  // 标题
  presetElements.push(
    createFieldElement('title', 50, 2, 100, 10, {
      text: '记账凭证',
      fontSize: 16,
      fontWeight: 'bold',
      align: 'center',
    })
  )

  // 账套名称
  presetElements.push(
    createFieldElement('account_set_name', 60, 12, 80, 6, {
      fontSize: 9,
      align: 'center',
    })
  )

  // 凭证字号 / 日期
  presetElements.push(
    createFieldElement('voucher_no', 0, 20, 50, 6, {
      fontSize: 9,
      align: 'left',
    })
  )
  presetElements.push(
    createFieldElement('date', 150, 20, 50, 6, {
      fontSize: 9,
      align: 'right',
      dateFormat: 'YYYY-MM-DD',
    })
  )

  // 分录表格（6行含合计，行高 6mm，表头 6mm → 6+6*6=42mm）
  presetElements.push(
    createFieldElement('table', 0, 28, cw, 50, {
      fontSize: 9,
      borderWidth: 1,
      showHeader: true,
      rowHeight: 6,
      printRows: 6,
      numberFormat: 'thousand',
      columns: [
        {
          field: 'summary',
          label: '摘要',
          width: '30%',
          align: 'left',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'account_code',
          label: '科目代码',
          width: '12%',
          align: 'center',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'account_name',
          label: '科目名称',
          width: '23%',
          align: 'left',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'debit',
          label: '借方金额',
          width: '17.5%',
          align: 'right',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'credit',
          label: '贷方金额',
          width: '17.5%',
          align: 'right',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
      ],
    })
  )

  // 签名栏（四列均匀分布）
  const sigY = 82
  presetElements.push(
    createFieldElement('signature_maker', 0, sigY, 45, 6, { fontSize: 9, align: 'center' })
  )
  presetElements.push(
    createFieldElement('signature_auditor', 50, sigY, 45, 6, { fontSize: 9, align: 'center' })
  )
  presetElements.push(
    createFieldElement('signature_poster', 100, sigY, 45, 6, { fontSize: 9, align: 'center' })
  )
  presetElements.push(
    createFieldElement('signature_supervisor', 150, sigY, 45, 6, { fontSize: 9, align: 'center' })
  )

  elements.value = presetElements
  pushUndo()
}

// 创建字段元素
function createFieldElement(
  type: FieldElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<FieldElement> = {}
): FieldElement {
  return {
    id: `${type}_${Date.now()}_${Math.random()}`,
    type,
    x,
    y,
    width,
    height,
    fontSize: 12,
    fontWeight: 'normal',
    align: 'left',
    ...options,
  }
}

// 拖拽开始
function handleDragStart(event: DragEvent, type: FieldElementType) {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('elementType', type)
  }
}

// 放置元素
function handleDrop(event: DragEvent) {
  event.preventDefault()

  const type = event.dataTransfer?.getData('elementType') as FieldElementType
  if (!type) return

  const { x, y } = getCanvasOffsetMm(event)

  const newElement = createFieldElement(
    type,
    Math.round(x * 10) / 10,
    Math.round(y * 10) / 10,
    50,
    10,
    getDefaultElementOptions(type)
  )

  pushUndo()
  elements.value.push(newElement)
  selectedElements.value = [newElement]

  ElMessage.success('元素已添加')
}

// 获取默认元素选项
function getDefaultElementOptions(type: FieldElementType): Partial<FieldElement> {
  const options: Partial<FieldElement> = {}

  switch (type) {
    case 'title':
      options.text = '记账凭证'
      options.fontSize = 18
      options.fontWeight = 'bold'
      options.align = 'center'
      options.width = 100
      options.height = 12
      break
    case 'text':
      options.text = '自定义文本'
      options.fontSize = 10
      break
    case 'date':
      options.dateFormat = 'YYYY-MM-DD'
      options.fontSize = 10
      break
    case 'total_debit':
    case 'total_credit':
      options.numberFormat = 'thousand'
      options.fontSize = 10
      options.align = 'right'
      options.width = 35
      break
    case 'total_label':
      options.text = '合计'
      options.fontSize = 10
      options.fontWeight = 'bold'
      options.align = 'center'
      options.width = 25
      break
    case 'table':
      options.fontSize = 9
      options.borderWidth = 1
      options.showHeader = true
      options.rowHeight = 8
      options.printRows = 6
      options.numberFormat = 'thousand'
      options.width = 170
      options.height = 80
      options.columns = [
        {
          field: 'summary',
          label: '摘要',
          width: '35%',
          align: 'left',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'account_code',
          label: '科目代码',
          width: '12%',
          align: 'center',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'account_name',
          label: '科目名称',
          width: '18%',
          align: 'left',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'debit',
          label: '借方',
          width: '17.5%',
          align: 'right',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
        {
          field: 'credit',
          label: '贷方',
          width: '17.5%',
          align: 'right',
          verticalAlign: 'middle',
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 1,
          paddingRight: 1,
          visible: true,
        },
      ]
      break
    case 'signature_maker':
    case 'signature_auditor':
    case 'signature_poster':
    case 'signature_supervisor':
      options.fontSize = 9
      options.align = 'center'
      options.width = 40
      options.height = 8
      break
  }

  return options
}

// 群组拖拽状态
const groupDrag = ref<{
  initialPositions: Map<string, { x: number; y: number }>
} | null>(null)

// 元素拖拽
function onDrag(element: FieldElement, left: number, top: number) {
  const leftMm = px2mm(left)
  const topMm = px2mm(top)
  if (selectedElements.value.length > 1 && isSelected(element)) {
    if (!groupDrag.value) {
      const posMap = new Map<string, { x: number; y: number }>()
      selectedElements.value.forEach(el => {
        posMap.set(el.id, { x: el.x, y: el.y })
      })
      groupDrag.value = { initialPositions: posMap }
    }
    const init = groupDrag.value.initialPositions.get(element.id)
    if (init) {
      const dx = leftMm - init.x
      const dy = topMm - init.y
      groupDrag.value.initialPositions.forEach((pos, id) => {
        const el = elements.value.find(e => e.id === id)
        if (el) {
          el.x = Math.max(0, Math.round((pos.x + dx) * 10) / 10)
          el.y = Math.max(0, Math.round((pos.y + dy) * 10) / 10)
        }
      })
    }
    return
  }
  element.x = Math.round(leftMm * 10) / 10
  element.y = Math.round(topMm * 10) / 10
}

function onResize(element: FieldElement, left: number, top: number, width: number, height: number) {
  element.x = Math.round(px2mm(left) * 10) / 10
  element.y = Math.round(px2mm(top) * 10) / 10
  element.width = Math.round(px2mm(width) * 10) / 10
  element.height = Math.round(px2mm(height) * 10) / 10
}

// 元素点击（支持 Ctrl 多选）
function handleElementClick(element: FieldElement, event: MouseEvent) {
  const ctrlOrMeta = event.ctrlKey || event.metaKey

  if (ctrlOrMeta) {
    const idx = selectedElements.value.findIndex(e => e.id === element.id)
    if (idx >= 0) {
      selectedElements.value.splice(idx, 1)
    } else {
      selectedElements.value.push(element)
    }
  } else {
    selectedElements.value = [element]
  }
}

// 选中元素（activated 回调）
function selectElement(_element: FieldElement) {
  pushUndo()
}

// 取消选中
function deselectElement() {
  groupDrag.value = null
}

function handleCanvasMouseDown(event: MouseEvent) {
  if (event.button !== 0) return

  const { x, y } = getCanvasOffsetMm(event)
  selStartX = x
  selStartY = y
  selBoxX.value = x
  selBoxY.value = y
  selBoxW.value = 0
  selBoxH.value = 0
  selBoxVisible.value = true

  const onMouseMove = (e: MouseEvent) => {
    const { x: cx, y: cy } = getCanvasOffsetMm(e)
    selBoxX.value = Math.min(selStartX, cx)
    selBoxY.value = Math.min(selStartY, cy)
    selBoxW.value = Math.abs(cx - selStartX)
    selBoxH.value = Math.abs(cy - selStartY)
  }

  const onMouseUp = () => {
    selBoxVisible.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    if (selBoxW.value < 1 && selBoxH.value < 1) {
      selectedElements.value = []
      return
    }
    const bl = selBoxX.value,
      bt = selBoxY.value,
      br = bl + selBoxW.value,
      bb = bt + selBoxH.value
    const inBox = elements.value.filter(el => {
      const er = el.x + el.width,
        eb = el.y + el.height
      return el.x < br && er > bl && el.y < bb && eb > bt
    })
    selectedElements.value = inBox
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 删除元素
function handleDeleteElement() {
  if (selectedElements.value.length === 0) return

  pushUndo()
  const ids = new Set(selectedElements.value.map(e => e.id))
  elements.value = elements.value.filter(e => !ids.has(e.id))
  const count = selectedElements.value.length
  selectedElements.value = []
  ElMessage.success(`已删除 ${count} 个元素`)
}

// 添加表格列
function addColumn() {
  if (!selectedElement.value || selectedElement.value.type !== 'table' || !newColumnField.value) {
    return
  }

  const columnDef = availableColumns.value.find(col => col.field === newColumnField.value)
  if (!columnDef) return

  const newColumn: TableColumn = {
    field: columnDef.field as any,
    label: columnDef.label,
    width: '120',
    align: 'left',
    verticalAlign: 'middle',
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 1,
    paddingRight: 1,
    visible: true,
  }

  // 如果是辅助项目列，添加 auxCategoryCode
  if (columnDef.field.startsWith('aux_')) {
    newColumn.auxCategoryCode = columnDef.field.replace('aux_', '')
  }

  if (!selectedElement.value.columns) {
    selectedElement.value.columns = []
  }

  selectedElement.value.columns.push(newColumn)
  newColumnField.value = ''
  ElMessage.success('列已添加')
}

// 删除表格列
function removeColumn(index: number) {
  if (!selectedElement.value || selectedElement.value.type !== 'table') {
    return
  }

  if (selectedElement.value.columns && selectedElement.value.columns.length > index) {
    selectedElement.value.columns.splice(index, 1)
    ElMessage.success('列已删除')
  }
}

// 切换列的内边距设置显示
function toggleColumnPadding(index: number) {
  if (!selectedElement.value || selectedElement.value.type !== 'table') return
  const col = selectedElement.value.columns?.[index]
  if (col) {
    // 使用 Vue 的响应式方式添加属性
    if (!('showPaddingSettings' in col)) {
      ;(col as any).showPaddingSettings = false
    }
    ;(col as any).showPaddingSettings = !(col as any).showPaddingSettings
  }
}

// 获取元素预览文本
function getElementPreviewText(element: FieldElement): string {
  switch (element.type) {
    case 'title':
    case 'text':
      return element.text || '文本'
    case 'account_set_name':
      return '示例账套'
    case 'unit_name':
      return '示例单位'
    case 'voucher_no':
      return 'JZ-2026-001'
    case 'date':
      return '2026-04-28'
    case 'voucher_type':
      return '记账凭证'
    case 'attachments':
      return '附件 2 张'
    case 'table':
      return `[分录表格 ${element.printRows || 6}行]`
    case 'total_label':
      return element.text || '合计'
    case 'total_debit':
      return '1,000.00'
    case 'total_credit':
      return '1,000.00'
    case 'signature_maker':
      return '制单：张三'
    case 'signature_auditor':
      return '审核：李四'
    case 'signature_poster':
      return '记账：'
    case 'signature_supervisor':
      return '主管：'
    default:
      return ''
  }
}

// 获取元素类型标签
function getElementTypeLabel(type: FieldElementType): string {
  const allElements = [
    ...basicElements,
    ...voucherElements,
    ...tableElements,
    ...totalElements,
    ...signatureElements,
  ]
  return allElements.find(e => e.type === type)?.label || type
}

// 保存模版
async function handleSave() {
  try {
    // 验证所有元素都有必要字段
    for (const el of elements.value) {
      if (el.x == null) el.x = 5
      if (el.y == null) el.y = 5
      if (el.width == null) el.width = 50
      if (el.height == null) el.height = 8
    }

    const data = {
      name: template.value.name,
      paper_size: template.value.paper_size,
      paper_width: template.value.paper_width,
      paper_height: template.value.paper_height,
      margin_top: template.value.margin_top,
      margin_bottom: template.value.margin_bottom,
      margin_left: template.value.margin_left,
      margin_right: template.value.margin_right,
      elements: elements.value,
    }

    if (props.templateId) {
      await request.put(`/base/print-templates/${props.templateId}`, data)
    } else {
      await request.post('/base/print-templates', data)
    }

    ElMessage.success('保存成功')
    emit('save')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  }
}

// 预览
function handlePreview() {
  previewVisible.value = true
}

// 纸张规格变化
function handlePaperSizeChange(size: string) {
  if (size === 'a4') {
    template.value.paper_width = 210
    template.value.paper_height = 297
  } else if (size === 'a5') {
    template.value.paper_width = 148
    template.value.paper_height = 210
  }
  // custom 保持用户自定义值
}

// 重置
function handleReset() {
  loadTemplate()
  selectedElements.value = []
  ElMessage.success('已重置')
}

// 键盘事件处理
function handleKeyDown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement)?.tagName
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

  if ((event.ctrlKey || event.metaKey) && !isInput) {
    if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault()
      if (event.shiftKey) {
        redo()
      } else {
        undo()
      }
      return
    }
    if (event.key === 'y' || event.key === 'Y') {
      event.preventDefault()
      redo()
      return
    }
  }

  if (selectedElements.value.length === 0) return

  // 删除键
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (isInput) return
    event.preventDefault()
    handleDeleteElement()
    return
  }

  // 方向键移动
  if (isInput) return
  const step = moveStep.value
  let dx = 0,
    dy = 0

  switch (event.key) {
    case 'ArrowUp':
      dy = -step
      break
    case 'ArrowDown':
      dy = step
      break
    case 'ArrowLeft':
      dx = -step
      break
    case 'ArrowRight':
      dx = step
      break
    default:
      return
  }

  event.preventDefault()
  selectedElements.value.forEach(el => {
    el.x = Math.max(0, Math.round((el.x + dx) * 10) / 10)
    el.y = Math.max(0, Math.round((el.y + dy) * 10) / 10)
  })
  pushUndo()
}

// 对齐函数
function alignLeft() {
  pushUndo()
  const minX = Math.min(...selectedElements.value.map(e => e.x))
  selectedElements.value.forEach(e => (e.x = minX))
  ElMessage.success('左对齐')
}

function alignRight() {
  pushUndo()
  const maxR = Math.max(...selectedElements.value.map(e => e.x + e.width))
  selectedElements.value.forEach(e => (e.x = maxR - e.width))
  ElMessage.success('右对齐')
}

function alignCenterH() {
  pushUndo()
  const minX = Math.min(...selectedElements.value.map(e => e.x))
  const maxR = Math.max(...selectedElements.value.map(e => e.x + e.width))
  const center = (minX + maxR) / 2
  selectedElements.value.forEach(e => (e.x = Math.round(center - e.width / 2)))
  ElMessage.success('水平居中')
}

function alignTop() {
  pushUndo()
  const minY = Math.min(...selectedElements.value.map(e => e.y))
  selectedElements.value.forEach(e => (e.y = minY))
  ElMessage.success('上对齐')
}

function alignBottom() {
  pushUndo()
  const maxB = Math.max(...selectedElements.value.map(e => e.y + e.height))
  selectedElements.value.forEach(e => (e.y = maxB - e.height))
  ElMessage.success('下对齐')
}

function alignMiddleV() {
  pushUndo()
  const minY = Math.min(...selectedElements.value.map(e => e.y))
  const maxB = Math.max(...selectedElements.value.map(e => e.y + e.height))
  const center = (minY + maxB) / 2
  selectedElements.value.forEach(e => (e.y = Math.round(center - e.height / 2)))
  ElMessage.success('垂直居中')
}

function equalWidth() {
  pushUndo()
  const refWidth = selectedElements.value[0]?.width
  if (!refWidth) return
  selectedElements.value.forEach(e => (e.width = refWidth))
  ElMessage.success('等宽')
}

function equalHeight() {
  pushUndo()
  const refHeight = selectedElements.value[0]?.height
  if (!refHeight) return
  selectedElements.value.forEach(e => (e.height = refHeight))
  ElMessage.success('等高')
}
</script>

<style scoped>
.template-designer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  padding: 16px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toolbar-left {
  flex: 1;
}

.toolbar-right {
  display: flex;
  gap: 12px;
}

.designer-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.element-panel {
  width: 240px;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  overflow-y: auto;
  padding: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: bold;
  margin-bottom: 16px;
  color: #303133;
}

.element-group {
  margin-bottom: 24px;
}

.group-title {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e4e7ed;
}

.element-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.element-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  cursor: move;
  transition: all 0.2s;
}

.element-item:hover {
  background: #e4e7ed;
}

.element-item .el-icon {
  font-size: 16px;
  color: #409eff;
}

.element-item span {
  font-size: 13px;
  color: #606266;
}

.canvas-container {
  flex: 1;
  background: #f0f2f5;
  overflow: auto;
  padding: 40px;
}

.canvas-wrapper {
  display: inline-block;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.canvas {
  background: #fff;
  box-sizing: border-box;
  overflow: visible;
}

.canvas-content {
  position: relative;
  width: 100%;
  height: 100%;
}

:deep(.vdr) {
  overflow: visible;
}

.element-content {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  box-sizing: border-box;
  word-break: break-all;
}

.property-panel {
  width: 320px;
  background: #fff;
  border-left: 1px solid #e4e7ed;
  overflow-y: auto;
  padding: 16px;
}

.property-panel .el-form-item {
  margin-bottom: 16px;
}

.no-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
}

.element-type-title {
  font-size: 15px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e4e7ed;
}

.table-columns {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.column-item {
  display: flex;
  flex-direction: column;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
}

.column-main-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.column-padding-settings {
  margin-top: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
}

.column-padding-settings .el-form-item {
  margin-bottom: 8px;
}

:deep(.vdr-selected) {
  outline: 2px solid #409eff !important;
  outline-offset: 1px;
}

:deep(.vdr-selected .handle) {
  background: #409eff !important;
  border-color: #409eff !important;
}

.selected-count {
  font-size: 13px;
  color: #409eff;
  font-weight: 500;
}

.align-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.align-row {
  display: flex;
  gap: 6px;
}

.align-row .el-button {
  flex: 1;
  padding: 5px 0;
  font-size: 12px;
}

.selection-box {
  position: absolute;
  border: 1px dashed #409eff;
  background: rgba(64, 158, 255, 0.1);
  pointer-events: none;
  z-index: 1000;
}

.unit-hint {
  margin-left: 6px;
  font-size: 12px;
  color: #909399;
}
</style>
