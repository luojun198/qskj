<template>
  <div v-if="grid.templateData.value" class="editor-layout">
    <div class="grid-panel">
      <el-tabs
        v-model="grid.activeSheetName.value"
        class="sheet-tabs sheet-tabs-no-header"
        @tab-change="grid.handleSheetChange"
        @edit="grid.handleSheetEdit"
      >
        <el-tab-pane
          v-for="sheet in grid.templateData.value.sheets"
          :key="sheet.id"
          :label="sheet.sheet_name"
          :name="sheet.id"
          :closable="grid.templateData.value.sheets.length > 1 && !grid.isDirectReportMode.value"
        >
          <div
            :class="[
              'sheet-grid-wrap',
              { 'sheet-grid-readonly': grid.isDirectReportMode.value },
            ]"
            @paste="grid.handleGridPaste"
          >
            <div
              :class="[
                'sheet-grid',
                { 'sheet-grid-balance': grid.isBalanceTemplate.value },
              ]"
              :style="{
                width: `${grid.getSheetGridWidth(sheet.id, sheet.metrics.colCount)}px`,
                gridTemplateColumns: grid.getGridTemplateColumns(
                  sheet.id,
                  sheet.metrics.colCount
                ),
                gridTemplateRows: grid.getGridTemplateRows(
                  sheet.id,
                  sheet.metrics.rowCount
                ),
              }"
            >
              <template v-if="grid.showGridHeaders.value">
                <button
                  type="button"
                  class="row-index row-index-header select-all-corner"
                  :class="{ active: grid.bulkSelectionMode.value === 'all' }"
                  style="grid-row: 1; grid-column: 1"
                  aria-label="全选后批量调整列宽或行高"
                  @click="grid.toggleSelectAll"
                >
                  <span class="select-all-corner-mark"></span>
                </button>
                <div
                  v-for="colIndex in Math.max(sheet.metrics.colCount, 1)"
                  :key="`header-${sheet.id}-${colIndex - 1}`"
                  class="column-header-cell"
                  :class="{
                    active:
                      grid.bulkSelectionMode.value === 'column' &&
                      grid.selectedColIndex.value === colIndex - 1,
                  }"
                  :style="{ gridRow: 1, gridColumn: colIndex + 1 }"
                  @click="grid.selectColumn(colIndex - 1)"
                >
                  <div class="column-header-content">
                    <span>{{ grid.toColumnName(colIndex - 1) }}</span>
                    <button
                      type="button"
                      class="column-resize-handle"
                      :aria-label="`调整第 ${colIndex} 列宽度`"
                      @dblclick.stop="grid.autoFitColumn(sheet.id, colIndex - 1)"
                      @mousedown.prevent="
                        grid.startColumnResize(sheet.id, colIndex - 1, $event)
                      "
                    />
                  </div>
                </div>
              </template>
              <template v-if="grid.showGridHeaders.value">
                <div
                  v-for="rowIndex in Math.max(sheet.metrics.rowCount, 1)"
                  :key="`row-index-${sheet.id}-${rowIndex - 1}`"
                  class="row-index"
                  :class="{
                    active:
                      grid.bulkSelectionMode.value === 'row' &&
                      grid.selectedRowIndex.value === rowIndex - 1,
                  }"
                  :style="{
                    gridRow: grid.getCellGridRow(rowIndex - 1, 1),
                    gridColumn: 1,
                  }"
                  @click="grid.selectRow(rowIndex - 1)"
                >
                  <div class="row-index-content">
                    <span>{{ rowIndex }}</span>
                    <button
                      type="button"
                      class="row-resize-handle"
                      :aria-label="`调整第 ${rowIndex} 行高度`"
                      @dblclick.stop="grid.autoFitRow(sheet.id, rowIndex - 1)"
                      @mousedown.prevent="
                        grid.startRowResize(sheet.id, rowIndex - 1, $event)
                      "
                    />
                  </div>
                </div>
              </template>
              <div
                v-for="cell in grid.buildSheetVisibleCells(sheet)"
                :key="`${cell.rowIndex}-${cell.colIndex}`"
                :style="{
                  textAlign: cell.textAlign as 'left' | 'center' | 'right',
                  verticalAlign:
                    cell.verticalAlign !== 'top'
                      ? (cell.verticalAlign as 'middle' | 'bottom')
                      : undefined,
                  gridColumn: grid.getCellGridColumn(cell),
                  gridRow: grid.getCellGridRow(cell.rowIndex, cell.rowSpan),
                  fontSize: cell.fontSize !== 13 ? `${cell.fontSize}px` : undefined,
                  fontWeight: cell.bold ? 700 : undefined,
                  textDecoration: cell.underline ? 'underline' : undefined,
                  fontFamily: cell.fontFamily || undefined,
                  borderColor: cell.borderColor ? `#${cell.borderColor}` : undefined,
                  borderWidth: cell.borderWidth ? `${cell.borderWidth}px` : undefined,
                  color: cell.textColor ? `#${cell.textColor}` : undefined,
                  backgroundColor: cell.bgColor ? `#${cell.bgColor}` : undefined,
                  ...(cell.borderStyleCss || {}),
                }"
                :class="[
                  'cell',
                  `cell-${cell.cell_type}`,
                  `cell-border-${cell.borderStyle}`,
                  {
                    empty: !cell.displayValue,
                    selected: cell.isSelected,
                    editing: cell.isEditing,
                    error: cell.executionStatus === 'error',
                    'bulk-selected': grid.isCellStructureSelected(
                      cell.rowIndex,
                      cell.colIndex
                    ),
                    merged: cell.colSpan > 1 || cell.rowSpan > 1,
                  },
                ]"
                :title="cell.tooltip"
                @click="grid.selectGridCell(cell, $event)"
                @mousedown.prevent="grid.startDragSelection(cell, $event)"
              >
                <template v-if="cell.isEditing">
                  <textarea
                    :ref="el => grid.setActiveEditorRef(el as Element | null)"
                    :value="cell.editorValue"
                    class="cell-editor-input"
                    @click.stop
                    @input="grid.handleInlineInput(cell, $event)"
                    @keydown.enter.exact.prevent="grid.applyInlineEdit(cell)"
                    @keydown.esc.stop.prevent="grid.cancelInlineEdit()"
                    @blur="grid.applyInlineEdit(cell)"
                  />
                </template>
                <div v-else class="cell-content">{{ cell.displayValue || ' ' }}</div>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { REPORT_GRID_KEY } from './reportGridContext'

const grid = inject(REPORT_GRID_KEY)
if (!grid) {
  throw new Error('ReportSheetGrid requires report grid context')
}
</script>
<style scoped>
/*
 * 网格布局。
 *
 * 这些类此前在整个项目里都没有定义过：report.styles.css 只提供颜色与边框等皮肤，
 * 组件模板也只在行内设了 grid-template-columns/rows —— 缺了 display:grid，
 * 浏览器会忽略那些 grid 属性，行列头与单元格便全部按 block 竖着堆叠。
 *
 * 这里只补布局，不碰颜色和边框：scoped 选择器（.cell[data-v-x]）特异性高于
 * report.styles.css 的全局 .cell，写了颜色反而会把主题盖掉。
 */
.editor-layout {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.grid-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.grid-panel :deep(.el-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.grid-panel :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}

.grid-panel :deep(.el-tab-pane) {
  height: 100%;
}

/* 单表时不需要页签头 */
.sheet-tabs-no-header :deep(.el-tabs__header) {
  display: none;
}

.sheet-grid {
  display: grid;
  position: relative;
}

/* 滚动时行列头保持可见 */
.column-header-cell,
.row-index {
  position: sticky;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  user-select: none;
}

.column-header-cell {
  top: 0;
  z-index: 2;
}

.row-index {
  left: 0;
  z-index: 2;
}

.select-all-corner {
  top: 0;
  left: 0;
  z-index: 3;
  padding: 0;
  cursor: pointer;
}

.column-header-content,
.row-index-content {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* 拖拽把手：贴在行列头边界上 */
.column-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  cursor: col-resize;
}

.row-resize-handle {
  position: absolute;
  left: 0;
  bottom: -3px;
  width: 100%;
  height: 6px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: row-resize;
}

.cell {
  position: relative;
  display: flex;
  /* 行内 style 的 verticalAlign 在 flex 下不生效，一期统一垂直居中；
     二期接 style_key 时改为按 valign token 映射 align-items */
  align-items: center;
  box-sizing: border-box;
  overflow: hidden;
  padding: 2px 6px;
  font-size: 13px;
  cursor: cell;
}

.cell-content {
  width: 100%;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}

.cell.selected {
  z-index: 1;
}

.cell-editor-input {
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: inherit;
  resize: none;
  overflow: hidden;
}
</style>
