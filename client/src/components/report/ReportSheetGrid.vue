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
