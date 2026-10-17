<template>
  <div class="page project-page">
    <div class="page-header project-header">
      <div class="project-title">
        <h3>核算项目</h3>
        <span v-if="activeTab" class="project-title-meta">
          {{ activeCatName }} · 共 {{ projectStats.total }} 项（进行中 {{ projectStats.active }} /
          已完结 {{ projectStats.closed }}）· 显示 {{ projectStats.displayed }}
          <template v-if="searchFilterIds && searchFilterIds.length > 0">
            · 已过滤 {{ searchFilterIds.length }}
            <el-button type="primary" link size="small" @click="clearSearchFilter">清除</el-button>
          </template>
        </span>
      </div>
      <div class="project-toolbar">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索类目/项目/自定义..."
          class="project-search"
          size="small"
          clearable
          @keyup.enter="handleSearch"
        />
        <el-button type="info" size="small" @click="handleSearch">搜索</el-button>
        <el-button type="primary" size="small" @click="openCategoryForm('add')">新增类别</el-button>
        <el-button
          type="primary"
          size="small"
          :disabled="!activeTab"
          @click="openItemDialog('add')"
        >
          新增项目
        </el-button>
        <el-button
          size="small"
          :disabled="!activeTab"
          @click="openCategoryForm('edit', categories.find(c => c.id === activeTab))"
        >
          字段配置
        </el-button>
        <el-button
          size="small"
          :disabled="!activeTab || pagination.total === 0"
          @click="exportData"
        >
          导出
        </el-button>
        <el-button type="success" size="small" :disabled="!activeTab" @click="openImportDialog">
          导入
        </el-button>
        <el-button
          type="warning"
          size="small"
          :disabled="selectedRows.length === 0"
          @click="batchStatusVisible = true"
        >
          批量状态
        </el-button>
        <el-button
          type="danger"
          size="small"
          :disabled="!activeTab || pagination.total === 0"
          @click="openBatchDelete"
        >
          批量删除
        </el-button>
        <el-select v-model="statusFilter" size="small" placeholder="状态" class="project-closed-switch" style="width: 128px" :empty-values="[null, undefined]">
          <el-option label="全部完结状态" value="" />
          <el-option label="进行中" value="active" />
          <el-option label="已完结" value="closed" />
        </el-select>
      </div>
    </div>

    <el-tabs
      v-if="categories.length > 0"
      v-model="activeTab"
      class="project-tabs"
      @tab-change="onTabChange"
    >
      <el-tab-pane v-for="cat in categories" :key="cat.id" :name="cat.id">
        <template #label>
          <span class="cat-tab-label">
            {{ cat.name }}
            <el-icon class="cat-tab-icon" title="编辑类别" @click.stop="openCategoryForm('edit', cat)">
              <Edit />
            </el-icon>
            <el-icon
              class="cat-tab-icon cat-tab-icon-danger"
              title="删除类别"
              @click.stop="handleDeleteCat(cat)"
            >
              <Close />
            </el-icon>
          </span>
        </template>
      </el-tab-pane>
    </el-tabs>
    <div v-else class="project-empty">暂无核算类别，请先添加核算类别</div>

    <el-table
      ref="tableRef"
      v-loading="tableLoading"
      :data="pageItems"
      stripe
      border
      size="small"
      class="project-table compact-data-table"
      height="100%"
      @header-dragend="onDragEnd"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="45" />
      <el-table-column column-key="code" prop="code" label="编码" :width="colWidth('code', 120)" />
      <el-table-column column-key="name" prop="name" label="名称" :width="colWidth('name', 160)" />
      <el-table-column
        column-key="status"
        prop="status"
        label="状态"
        :width="colWidth('status', 100)"
      >
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{
            row.status === 'active' ? '进行中' : '已完结'
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        column-key="remark"
        prop="remark"
        label="备注"
        :width="colWidth('remark', 120)"
      />
      <el-table-column
        v-for="field in activeCategoryFields"
        :key="field.field_key"
        :column-key="field.field_key"
        :label="field.field_name"
        :width="colWidth(field.field_key, 100)"
      >
        <template #default="{ row }">
          {{ formatItemFieldDisplay(field, row) }}
        </template>
      </el-table-column>
      <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 160)">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openItemDialog('edit', row)"
            >编辑</el-button
          >
          <el-button link type="danger" size="small" @click="handleDeleteItem(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-bar project-pagination">
      <span class="pagination-text">共 {{ pagination.total }} 条</span>
      <el-select
        v-model="pagination.pageSize"
        size="small"
        class="pagination-size-select"
        @change="onPageSizeChange"
      >
        <el-option label="10条" :value="10" />
        <el-option label="20条" :value="20" />
        <el-option label="50条" :value="50" />
        <el-option label="100条" :value="100" />
      </el-select>
      <el-pagination
        v-model:current-page="pagination.page"
        :total="pagination.total"
        :page-size="pagination.pageSize"
        size="small"
        layout="prev, pager, next, jumper"
        :pager-count="5"
        @current-change="onPageChange"
      />
    </div>

    <!-- 核算项目对话框 -->
    <el-dialog
      v-model="itemDialogVisible"
      :title="itemDialogTitle"
      width="520px"
      @keydown="onItemDialogKeydown"
    >
      <div v-if="itemDialogType === 'edit' && itemNavigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="itemNavigationInfo.current"
          :total="itemNavigationInfo.total"
          :is-first="itemNavigationInfo.isFirst"
          :is-last="itemNavigationInfo.isLast"
          @navigate="handleItemNavigate"
        />
      </div>
      <el-form :model="itemForm" label-width="100px">
        <el-form-item label="所属类别" required>
          <el-select
            v-model="itemForm.type"
            :disabled="itemDialogType === 'edit'"
            style="width: 100%"
          >
            <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目编码" required>
          <el-input v-model="itemForm.code" placeholder="自动编号，可修改" />
        </el-form-item>
        <el-form-item label="名称" required><el-input v-model="itemForm.name" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="itemForm.status" style="width: 100%">
            <el-option label="进行中" value="active" />
            <el-option label="已完结" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"
          ><el-input v-model="itemForm.remark" type="textarea" :rows="2"
        /></el-form-item>

        <!-- 动态自定义字段 -->
        <template v-if="currentItemFields.length > 0">
          <el-divider content-position="left">扩展信息</el-divider>
          <el-form-item
            v-for="field in currentItemFields"
            :key="field.field_key"
            :label="field.field_name"
            :required="!!field.required_in_archive"
          >
            <!-- 文本 -->
            <el-input
              v-if="field.field_type === 'text'"
              v-model="itemForm.field_values[field.field_key]"
            />
            <!-- 数字 -->
            <el-input-number
              v-else-if="field.field_type === 'number'"
              v-model="itemForm.field_values[field.field_key]"
              :controls="false"
              style="width: 100%"
            />
            <!-- 日期 -->
            <el-date-picker
              v-else-if="field.field_type === 'date'"
              v-model="itemForm.field_values[field.field_key]"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
            <!-- 现金流量流向（存英文枚举） -->
            <el-select
              v-else-if="field.field_type === 'select' && field.field_key === 'direction'"
              v-model="itemForm.field_values[field.field_key]"
              clearable
              style="width: 100%"
            >
              <el-option label="流入" value="inflow" />
              <el-option label="流出" value="outflow" />
              <el-option label="中性" value="neutral" />
            </el-select>
            <!-- 下拉 -->
            <el-select
              v-else-if="field.field_type === 'select'"
              v-model="itemForm.field_values[field.field_key]"
              clearable
              style="width: 100%"
            >
              <el-option
                v-for="opt in parseFieldOptions(field.options_json)"
                :key="opt"
                :label="opt"
                :value="opt"
              />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 8px; flex-wrap: nowrap;">
          <el-button @click="itemDialogVisible = false">取消</el-button>
          <el-button
            v-if="itemDialogType === 'add'"
            :loading="itemSaving"
            @click="handleSaveItem(true)"
          >
            保存并新增 (Ctrl+Enter)
          </el-button>
          <el-button type="primary" :loading="itemSaving" @click="handleSaveItem(false)">
            保存 (Enter)
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 批量导入对话框 -->
    <el-dialog
      v-model="importDialogVisible"
      title="批量导入核算项目"
      width="960px"
      class="spreadsheet-import-dialog"
      @closed="resetImportDialog"
    >
      <div class="import-tips">
        <p>
          1. 请先
          <el-link type="primary" @click="downloadTemplate">下载导入模板</el-link
          >，按模板格式填写数据
        </p>
        <p>2. 导入将向当前选中的类别「{{ activeCatName }}」下批量新增项目</p>
        <p>3. 编码为空时将自动生成，名称为必填</p>
      </div>

      <!-- 已上传文件显示 -->
      <div v-if="uploadedFileName" class="uploaded-file-info">
        <div class="file-name">
          <el-icon><Document /></el-icon>
          <span>{{ uploadedFileName }}</span>
        </div>
        <el-button type="danger" size="small" @click="clearUploadedFile"> 删除文件 </el-button>
      </div>

      <!-- 上传区域 -->
      <el-upload
        v-show="!uploadedFileName"
        ref="importUploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls"
        :disabled="importParsing"
        :on-change="onImportFileChange"
        :on-exceed="() => showError('只能上传一个文件')"
        :show-file-list="false"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx / .xls 格式</div>
        </template>
      </el-upload>

      <div v-if="importParsing" class="import-parsing">
        <el-progress :percentage="importParseProgress" :stroke-width="16" />
        <p class="import-parsing__text">{{ importParseMessage }}</p>
      </div>

      <el-alert
        v-if="largeImportFile"
        title="已启用后台导入"
        description="大文件不会在浏览器中展开为 JSON；确认后将上传原始 XLSX 文件并由后台逐行处理。"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      />

      <!-- 编号断号警告 -->
      <div v-if="importWarnings.length > 0" class="import-warnings">
        <el-alert
          :title="importWarnings[0].message"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
        >
          <template #default>
            <div style="margin-top: 8px">
              <div style="font-weight: bold; margin-bottom: 4px">断号位置：</div>
              <div
                v-for="(gap, index) in importWarnings[0].gaps"
                :key="index"
                style="margin-left: 12px; color: #e6a23c"
              >
                {{ gap }}
              </div>
              <div style="margin-top: 8px; color: #606266">
                {{ importWarnings[0].suggestion }}
              </div>
            </div>
          </template>
        </el-alert>
      </div>

      <!-- 导入预览 -->
      <div v-if="importPreview.length > 0" class="import-preview">
        <SpreadsheetImportSummaryAlert
          :summary="importSummary"
          :issue-count="importIssueCount"
          @view-issues="openImportIssuesDialog"
        />
        <el-table :data="importPreview.slice(0, 15)" stripe border size="small" max-height="280">
          <el-table-column prop="rowIndex" label="行号" width="60" />
          <el-table-column prop="code" label="编码" width="100" />
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column prop="status" label="状态" width="80">
            <template #default="{ row }">
              {{ row.status === 'active' ? '进行中' : '已完结' }}
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="100" />
          <el-table-column prop="matched" label="校验" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.matched ? 'success' : 'danger'" size="small">
                {{ row.matched ? '有效' : row.error || '无效' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="importPreview.length > 15" class="import-preview-more">
          预览仅显示前 15 行，共 {{ importPreview.length }} 行；异常明细请点「查看异常说明」
        </div>
      </div>

      <template #footer>
        <el-button @click="closeImportDialog">取消</el-button>
        <el-button
          v-if="importIssueCount > 0"
          @click="openImportIssuesDialog"
        >
          查看异常说明
        </el-button>
        <el-button
          type="primary"
          :disabled="!largeImportFile && importMatchedCount === 0"
          :loading="importing"
          @click="handleImport"
        >
          {{ largeImportFile ? '上传并后台导入' : `确认导入（${importMatchedCount} 条）` }}
        </el-button>
      </template>
    </el-dialog>

    <SpreadsheetImportIssuesDialog
      v-model:visible="importIssuesDialogVisible"
      :issues="importIssues"
      :loading="importIssuesLoading"
      :total-count="importIssueCount > 0 ? importIssueCount : null"
      intro="以下行未能通过校验，不会写入核算项目。同类问题已合并展示；请按说明修正模板后重新上传。"
    />

    <!-- 批量删除对话框 -->
    <el-dialog v-model="batchDeleteVisible" title="批量删除" width="480px">
      <el-radio-group v-model="batchDeleteMode" style="margin-bottom: 16px">
        <el-radio value="selected">
          删除已选中的 <strong>{{ selectedRows.length }}</strong> 个项目
        </el-radio>
        <el-radio value="all" :disabled="pagination.total === 0">
          删除当前类别的全部 <strong>{{ pagination.total }}</strong> 个项目
        </el-radio>
      </el-radio-group>
      <el-alert
        v-if="batchDeleteMode === 'all'"
        title="警告：此操作将删除当前类别的所有项目！"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      />
      <p style="color: #909399; font-size: var(--cw-text-base)">
        系统将自动跳过已被科目或凭证使用的项目，仅删除未使用的项目。
      </p>
      <template #footer>
        <el-button @click="batchDeleteVisible = false">取消</el-button>
        <el-button type="danger" :loading="batchDeleteSaving" @click="handleBatchDelete"
          >确认删除</el-button
        >
      </template>
    </el-dialog>
    <el-dialog v-model="batchStatusVisible" title="批量设置状态" width="400px">
      <p style="margin-bottom: 12px; color: #606266">
        已选择 <strong>{{ selectedRows.length }}</strong> 个项目，将统一设置为：
      </p>
      <el-select v-model="batchStatusValue" style="width: 100%">
        <el-option label="进行中" value="active" />
        <el-option label="已完结" value="closed" />
      </el-select>
      <template #footer>
        <el-button @click="batchStatusVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchStatusSaving" @click="handleBatchStatus"
          >确定</el-button
        >
      </template>
    </el-dialog>

    <!-- 搜索结果弹窗 -->
    <el-dialog v-model="searchDialogVisible" title="搜索结果" width="640px">
      <div
        v-if="
          searchResults.categories.length === 0 &&
          searchResults.items.length === 0 &&
          searchResults.customFields.length === 0
        "
        style="text-align: center; color: #909399; padding: 40px 0"
      >
        未找到匹配「{{ searchKeyword }}」的结果
      </div>
      <div v-else>
        <!-- 类目匹配 -->
        <div v-if="searchResults.categories.length > 0" class="search-result-group">
          <div class="search-result-title">类目匹配 ({{ searchResults.categories.length }})</div>
          <div v-for="cat in searchResults.categories" :key="cat.id" class="search-result-item">
            <el-tag size="small" type="info">类目</el-tag>
            <span class="search-result-name">{{ cat.name }}</span>
            <el-button type="primary" link size="small" @click="locateCategory(cat.id)"
              >定位</el-button
            >
          </div>
        </div>
        <!-- 项目匹配 -->
        <div v-if="searchResults.items.length > 0" class="search-result-group">
          <div class="search-result-title">项目匹配 ({{ searchResults.items.length }})</div>
          <div v-for="item in searchResults.items" :key="item.id" class="search-result-item">
            <el-tag size="small" type="success">项目</el-tag>
            <span class="search-result-cat">[{{ getCategoryName(item.type) }}]</span>
            <span class="search-result-name">{{ item.code }} - {{ item.name }}</span>
            <el-button type="primary" link size="small" @click="locateItem(item)">定位</el-button>
          </div>
        </div>
        <!-- 自定义字段匹配 -->
        <div v-if="searchResults.customFields.length > 0" class="search-result-group">
          <div class="search-result-title">
            自定义字段匹配 ({{ searchResults.customFields.length }})
          </div>
          <div
            v-for="(result, index) in searchResults.customFields"
            :key="index"
            class="search-result-item"
          >
            <el-tag size="small" type="warning">字段</el-tag>
            <span class="search-result-cat">[{{ getCategoryName(result.item.type) }}]</span>
            <span class="search-result-name"
              >{{ result.fieldName }}: {{ result.value }} ({{ result.item.name }})</span
            >
            <el-button type="primary" link size="small" @click="locateItem(result.item)"
              >定位</el-button
            >
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="searchDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <TaskProgressDialog
      v-model="taskProgressVisible"
      :task-id="currentTaskId"
      :task-type="currentTaskType"
      @completed="handleTaskCompleted"
      @show-block-detail="showDeleteBlockDialog"
    />

    <AuxItemDeleteBlockDialog
      v-model="deleteBlockVisible"
      :detail="deleteBlockDetail"
      @open-voucher="openBlockedVoucher"
      @go-init-balance-aux="goInitBalanceAux"
    />

    <VoucherEntryDialogHost ref="entryDialogHostRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated, reactive, nextTick, watch, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { TabPaneName, UploadFile } from 'element-plus'
import { Edit, Close, Upload, Document } from '@element-plus/icons-vue'
import { ElMessageBox, ElLoading } from 'element-plus'
import request from '@/api/request'
import { useAsyncBatchTask } from '@/composables/useAsyncBatchTask'
import TaskProgressDialog from '@/components/task/TaskProgressDialog.vue'
import SpreadsheetImportSummaryAlert from '@/components/common/SpreadsheetImportSummaryAlert.vue'
import SpreadsheetImportIssuesDialog from '@/components/common/SpreadsheetImportIssuesDialog.vue'
import {
  buildProjectImportSummary,
  collectProjectImportIssues,
  describeProjectRowIssue,
  detectProjectCodeGaps,
  parseProjectImportRowsAsync,
  type ProjectImportRow,
} from '@/utils/projectImport'
import { aggregateImportIssuesAsync } from '@/utils/spreadsheetImportReport'
import { yieldToMain } from '@/utils/asyncChunk'
import {
  normalizeDuplicateKey,
  normalizeImportText,
} from '@/utils/textNormalize'
import AuxItemDeleteBlockDialog from '@/components/base/AuxItemDeleteBlockDialog.vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { useAuxItemDeleteBlock } from '@/composables/useAuxItemDeleteBlock'
import { showSuccess, showError, showOperationError } from '@/composables/useMessage'
import { useDeleteConfirm, useConfirm } from '@/composables/useConfirm'
import { useKeyboardShortcuts, commonShortcuts } from '@/composables/useKeyboardShortcuts'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'
import type { ExportColumnDef } from '@/utils/exportStyledExcel'
import {
  filterAuxCategoriesForProjectList,
  isAuxCategoryExcludedFromProjectList,
} from '@/utils/accountCashFlow'
import { fetchAuxItemsPage } from '@/composables/useAuxItemsPage'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const {
  taskProgressVisible,
  currentTaskId,
  currentTaskType,
  startAsyncTask,
} = useAsyncBatchTask()

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const {
  deleteBlockVisible,
  deleteBlockDetail,
  showDeleteBlockDialog,
  deleteAuxItemWithDialog,
  openBlockedVoucher,
  goInitBalanceAux,
} = useAuxItemDeleteBlock(entryDialogHostRef)

const categories = ref<any[]>([])
const route = useRoute()
const router = useRouter()
const pageItems = shallowRef<any[]>([])
const tableLoading = ref(false)
const categoryStats = reactive({ total: 0, active: 0, closed: 0 })
const activeTab = ref('')
const itemDialogVisible = ref(false)
const itemDialogType = ref('add')
const itemDialogTitle = computed(() =>
  itemDialogType.value === 'add' ? '新增核算项目' : '编辑核算项目'
)

/** 翻页导航信息 */
const itemNavigationInfo = computed(() => {
  if (pageItems.value.length === 0 || itemDialogType.value === 'add') return null
  const idx = pageItems.value.findIndex(r => r.id === itemForm.value.id)
  return {
    current: idx + 1,
    total: pageItems.value.length,
    isFirst: idx <= 0,
    isLast: idx >= pageItems.value.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleItemNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  if (pageItems.value.length === 0) return
  
  let targetIdx = 0
  const currentIdx = pageItems.value.findIndex(r => r.id === itemForm.value.id)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = pageItems.value.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(pageItems.value.length - 1, currentIdx + 1)
  
  if (pageItems.value[targetIdx]) {
    openItemDialog('edit', pageItems.value[targetIdx])
  }
}

const itemForm = ref<any>({ status: 'active' })
const itemSaving = ref(false)

// 当前项目编辑弹窗对应的类别字段配置
const currentItemFields = computed(() => {
  if (!itemForm.value.type) return []
  const cat = categories.value.find(c => c.id === itemForm.value.type)
  return (cat?.fields || []).filter((f: any) => f.is_enabled !== 0)
})

// 搜索过滤状态
const searchFilterIds = ref<string[] | null>(null)

// 分页（服务端）
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const projectStats = computed(() => ({
  total: categoryStats.total,
  active: categoryStats.active,
  closed: categoryStats.closed,
  displayed: pagination.total,
}))

const activeCatName = computed(
  () => categories.value.find(c => c.id === activeTab.value)?.name || ''
)

async function loadCategoryStats() {
  if (!activeTab.value) {
    categoryStats.total = 0
    categoryStats.active = 0
    categoryStats.closed = 0
    return
  }
  try {
    const res = await request.get<{ total: number; active: number; closed: number }>(
      '/base/aux-items/stats',
      { params: { type: activeTab.value } }
    )
    const data = res.data || { total: 0, active: 0, closed: 0 }
    categoryStats.total = data.total
    categoryStats.active = data.active
    categoryStats.closed = data.closed
  } catch {
    categoryStats.total = pagination.total
    categoryStats.active = 0
    categoryStats.closed = 0
  }
}

async function loadPageItems() {
  if (!activeTab.value) {
    pageItems.value = []
    pagination.total = 0
    return
  }
  tableLoading.value = true
  try {
    const params: Parameters<typeof fetchAuxItemsPage>[0] = {
      type: activeTab.value,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
    if (statusFilter.value) params.status = statusFilter.value
    if (searchFilterIds.value?.length) params.ids = searchFilterIds.value
    const { items, total } = await fetchAuxItemsPage(params)
    const maxPage = Math.max(1, Math.ceil(total / pagination.pageSize))
    if (items.length === 0 && total > 0 && pagination.page > maxPage) {
      pagination.page = maxPage
      await loadPageItems()
      return
    }
    pageItems.value = items
    pagination.total = total
  } finally {
    tableLoading.value = false
  }
}

const activeCategoryFields = computed(() => {
  const cat = categories.value.find(c => c.id === activeTab.value)
  return (cat?.fields || []).filter((f: any) => f.is_enabled !== 0)
})

const CASH_FLOW_DIRECTION_LABELS: Record<string, string> = {
  inflow: '流入',
  outflow: '流出',
  neutral: '中性',
}

const CASH_FLOW_DIRECTION_FROM_LABEL: Record<string, string> = {
  流入: 'inflow',
  流出: 'outflow',
  中性: 'neutral',
}

function parseItemFieldValues(item: any): Record<string, string> {
  if (!item?.field_values) return {}
  try {
    return typeof item.field_values === 'string'
      ? JSON.parse(item.field_values)
      : { ...item.field_values }
  } catch {
    return {}
  }
}

function formatFieldDisplayValue(field: any, raw: string | undefined | null): string {
  const val = raw == null ? '' : String(raw)
  if (field.field_key === 'direction') {
    return CASH_FLOW_DIRECTION_LABELS[val] || val
  }
  return val
}

function formatItemFieldDisplay(field: any, row: any): string {
  const fv = parseItemFieldValues(row)
  return formatFieldDisplayValue(field, fv[field.field_key])
}

function normalizeDirectionFieldValue(field: any, raw: string): string {
  if (field.field_key !== 'direction') return raw
  return CASH_FLOW_DIRECTION_FROM_LABEL[raw] || raw
}

// ========== 状态过滤 & 多选 ==========
const statusFilter = ref<'' | 'active' | 'closed'>('')

watch(activeTab, () => {
  pagination.page = 1
  searchFilterIds.value = null
  void loadCategoryStats()
  void loadPageItems()
})

watch(statusFilter, () => {
  pagination.page = 1
  void loadPageItems()
})

const tableRef = ref<any>(null)
const { onDragEnd, load, colWidth, bindTable } = useColumnWidthMemory('base_project')
bindTable(tableRef)
onActivated(() => load())

async function relayoutTable() {
  await nextTick()
  tableRef.value?.doLayout?.()
}

const selectedRows = ref<any[]>([])
const batchStatusVisible = ref(false)
const batchStatusValue = ref<'active' | 'closed'>('closed')
const batchStatusSaving = ref(false)

const batchDeleteVisible = ref(false)
const batchDeleteSaving = ref(false)

// ========== 搜索功能 ==========
const searchKeyword = ref('')
const searchDialogVisible = ref(false)
const searchResults = ref<{ categories: any[]; items: any[]; customFields: any[] }>({
  categories: [],
  items: [],
  customFields: [],
})

function handleSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

// ========== 导入相关 ==========
const importDialogVisible = ref(false)
const importPreview = ref<ProjectImportRow[]>([])
const importWarnings = ref<any[]>([])
const importUploadRef = ref<any>(null)
const importing = ref(false)
const uploadedFileName = ref('')
const largeImportFile = shallowRef<File | null>(null)
const importIssuesDialogVisible = ref(false)
const importBlankSkipped = ref(0)
const importParsing = ref(false)
const importParseProgress = ref(0)
const importParseMessage = ref('')
const importIssues = ref<ReturnType<typeof collectProjectImportIssues>>([])
const importIssuesLoading = ref(false)
let importIssuesBuildToken = 0

const importMatchedCount = computed(() => importPreview.value.filter(r => r.matched).length)
const importIssueCount = computed(() => importPreview.value.filter(r => !r.matched).length)
const importSummary = computed(() =>
  buildProjectImportSummary({
    contentRowCount: importPreview.value.length,
    validCount: importMatchedCount.value,
    issueCount: importIssueCount.value,
    blankSkipped: importBlankSkipped.value,
    templateWarning: null,
  })
)

async function fetchData() {
  const catRes = await request.get<any[]>('/base/aux-categories')
  const allCats = catRes.data || []
  categories.value = filterAuxCategoriesForProjectList(allCats)
  const requestedCategoryId = typeof route.query.category_id === 'string' ? route.query.category_id : ''
  if (requestedCategoryId && categories.value.some(category => category.id === requestedCategoryId)) {
    activeTab.value = requestedCategoryId
    const { category_id: _categoryId, ...restQuery } = route.query
    void router.replace({ path: '/base/project', query: restQuery })
  } else if (!activeTab.value && categories.value.length > 0) {
    activeTab.value = categories.value[0].id
  }
  await Promise.all([loadCategoryStats(), loadPageItems()])
  await relayoutTable()
}

function onTabChange(tabId: TabPaneName) {
  activeTab.value = String(tabId)
  relayoutTable()
}

function onPageChange(page: number) {
  pagination.page = page
  void loadPageItems()
}

function onPageSizeChange(size: number) {
  pagination.pageSize = size
  pagination.page = 1
  void loadPageItems()
}

function openCategoryForm(type: 'add' | 'edit', row?: any) {
  if (type === 'edit' && !row?.id) return
  router.push(type === 'add'
    ? { name: 'ProjectCategoryNew', query: { _n: String(Date.now()) } } // 一次性标记：每次点「新增类别」都重新初始化表单，不复用被缓存的旧页面
    : { name: 'ProjectCategoryEdit', params: { id: row.id } })
}

function parseFieldOptions(optionsJson: string | null): string[] {
  if (!optionsJson) return []
  try {
    const arr = JSON.parse(optionsJson)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

async function handleDeleteCat(row: any) {
  const confirmed = await useDeleteConfirm(`类别「${row.name}」`)
  if (!confirmed) return

  try {
    await request.delete(`/base/aux-categories/${row.id}`)
    showSuccess('删除成功')
    // 如果删除的是当前选中的tab，切换到第一个
    if (activeTab.value === row.id) {
      activeTab.value = categories.value[0]?.id || ''
    }
    await fetchData()
  } catch (error) {
    showOperationError('删除类别', error)
  }
}

async function nextItemCodeForCategory(categoryId: string) {
  // 后端按纯数字编码最大值 + 1 并跳过已存在的（FIX-419；此前按字符串倒序取第 1 条会取到旧号）
  try {
    const res = await request.get<{ next_code: string }>('/base/aux-items/next-code', {
      params: { type: categoryId },
    })
    return res.data?.next_code || ''
  } catch {
    return ''
  }
}

/** 同类别内查重：依赖服务端保存校验；本地仅做精确名称提示 */
async function findItemDuplicates(type: string, name: string, excludeId?: string) {
  try {
    const { items } = await fetchAuxItemsPage({ type, keyword: name, pageSize: 20 })
    const normalizedInput = normalizeDuplicateKey(name)
    let exactDuplicate: any = null
    let fuzzyDuplicate: any = null
    for (const item of items) {
      if (excludeId && item.id === excludeId) continue
      const itemName = item.name || ''
      if (itemName === name) {
        exactDuplicate = item
        break
      }
      if (!fuzzyDuplicate && normalizeDuplicateKey(itemName) === normalizedInput) {
        fuzzyDuplicate = item
      }
    }
    return { exactDuplicate, fuzzyDuplicate }
  } catch {
    return { exactDuplicate: null, fuzzyDuplicate: null }
  }
}

/** 保存成功后就地更新当前页列表 */
function applyLocalItemUpdate(id: string) {
  const cat = categories.value.find(c => c.id === itemForm.value.type)
  const updated = {
    id,
    type: itemForm.value.type,
    code: itemForm.value.code,
    name: itemForm.value.name,
    remark: itemForm.value.remark || '',
    status: itemForm.value.status || 'active',
    field_values: itemForm.value.field_values || {},
    category_name: cat?.name,
    category_code: cat?.code,
  }
  const idx = pageItems.value.findIndex(i => i.id === id)
  if (idx >= 0) {
    const next = [...pageItems.value]
    next[idx] = updated
    pageItems.value = next
  } else {
    void loadPageItems()
  }
}

/** 新增时自动带出的编码；用户没改过则保存时允许后端撞号顺延 */
const itemAutoCode = ref('')

async function resetItemFormForAdd(categoryId?: string) {
  const type = categoryId || itemForm.value.type || activeTab.value
  const code = await nextItemCodeForCategory(type)
  itemAutoCode.value = code
  itemForm.value = {
    type,
    code,
    name: '',
    remark: '',
    status: 'active',
    field_values: {},
  }
}

async function openItemDialog(t: string, row?: any) {
  itemDialogType.value = t
  if (t === 'add') {
    await resetItemFormForAdd(activeTab.value)
  } else {
    // 编辑时解析 field_values
    let fv = {}
    try {
      fv = row.field_values
        ? typeof row.field_values === 'string'
          ? JSON.parse(row.field_values)
          : row.field_values
        : {}
    } catch {
      /* ignore */
    }
    itemForm.value = { ...row, field_values: { ...fv } }
  }
  itemDialogVisible.value = true
}

function onItemDialogKeydown(e: KeyboardEvent) {
  if (!itemDialogVisible.value || itemSaving.value) return
  if (e.key !== 'Enter') return

  const target = e.target as HTMLElement
  const isTextarea = target.tagName === 'TEXTAREA'

  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    if (itemDialogType.value === 'add') {
      handleSaveItem(true)
    } else {
      handleSaveItem(false)
    }
    return
  }

  // 备注等多行框：Enter 换行，不触发保存
  if (isTextarea || e.shiftKey || e.altKey) return

  e.preventDefault()
  handleSaveItem(false)
}

async function handleSaveItem(continueAdd = false) {
  itemSaving.value = true
  try {
    itemForm.value.name = normalizeImportText(itemForm.value.name?.trim?.() || '')

    const excludeId = itemDialogType.value === 'edit' ? itemForm.value.id : undefined
    const { exactDuplicate, fuzzyDuplicate } = await findItemDuplicates(
      itemForm.value.type,
      itemForm.value.name,
      excludeId
    )

    if (exactDuplicate) {
      showError(
        `名称已存在，不允许存盘。编码：${exactDuplicate.code}；名称：${exactDuplicate.name}`
      )
      return
    }

    if (fuzzyDuplicate) {
      const confirmed = await useConfirm({
        message: `检测到近似项目 "编码：${fuzzyDuplicate.code}；名称：${fuzzyDuplicate.name}" ，保存后会形成近似重复，是否继续？`,
        title: '重复提醒',
        confirmButtonText: '继续保存',
        cancelButtonText: '取消',
      })
      if (!confirmed) return
    }

    const savedCategoryId = itemForm.value.type

    if (itemDialogType.value === 'add') {
      // 编码没改过（仍是自动带出的）或留空：撞号时由后端顺延到下一个可用编码
      const autoCode = !itemForm.value.code || itemForm.value.code === itemAutoCode.value
      const res = await request.post<{ id: string; code?: string }>('/base/aux-items', {
        ...itemForm.value,
        auto_code: autoCode,
      })
      if (res.data?.code) itemForm.value.code = res.data.code
      if (res.data?.id) {
        applyLocalItemUpdate(res.data.id)
      }
      showSuccess(continueAdd ? '项目创建成功，可继续新增' : '项目创建成功')
    } else {
      await request.put(`/base/aux-items/${itemForm.value.id}`, itemForm.value)
      applyLocalItemUpdate(itemForm.value.id)
      showSuccess('项目更新成功')
      itemDialogVisible.value = false
      void relayoutTable()
      return
    }

    if (continueAdd) {
      await resetItemFormForAdd(savedCategoryId)
    } else {
      itemDialogVisible.value = false
      void relayoutTable()
    }
    void loadCategoryStats()
  } catch (error) {
    showOperationError(itemDialogType.value === 'add' ? '创建项目' : '更新项目', error)
  } finally {
    itemSaving.value = false
  }
}

async function handleDeleteItem(row: any) {
  const confirmed = await useDeleteConfirm(`项目「${row.name}」`)
  if (!confirmed) return

  const result = await deleteAuxItemWithDialog(row.id, '删除项目')
  if (result === 'success') {
    await loadPageItems()
    void loadCategoryStats()
    showSuccess('删除成功')
  }
}

// ========== 批量设置状态 ==========
async function handleBatchStatus() {
  batchStatusSaving.value = true
  let successCount = 0
  let failCount = 0

  try {
    for (const row of selectedRows.value) {
      try {
        await request.put(`/base/aux-items/${row.id}`, {
          ...row,
          status: batchStatusValue.value,
        })
        successCount++
      } catch {
        failCount++
      }
    }

    if (successCount > 0) {
      const statusLabel = batchStatusValue.value === 'active' ? '进行中' : '已完结'
      showSuccess(
        `已将 ${successCount} 个项目设为「${statusLabel}」${failCount > 0 ? `，${failCount} 个失败` : ''}`
      )
    }

    batchStatusVisible.value = false
    selectedRows.value = []
    // 清除表格选中状态
    tableRef.value?.clearSelection()
    await fetchData()
  } catch (error) {
    showOperationError('批量设置状态', error)
  } finally {
    batchStatusSaving.value = false
  }
}

// ========== 批量删除 ==========
const batchDeleteMode = ref<'selected' | 'all'>('selected')

function openBatchDelete() {
  batchDeleteMode.value = 'selected'
  batchDeleteVisible.value = true
}

async function handleBatchDelete() {
  batchDeleteSaving.value = true

  try {
    if (batchDeleteMode.value === 'all') {
      if (!activeTab.value || pagination.total === 0) {
        showError('没有可删除的项目')
        batchDeleteVisible.value = false
        return
      }
      await startAsyncTask('aux-items-delete', () =>
        request.post('/base/aux-items/batch-delete-async', {
          type: activeTab.value,
          ...(statusFilter.value ? { status: statusFilter.value } : {}),
        })
      )
    } else {
      if (selectedRows.value.length === 0) {
        showError('没有可删除的项目')
        batchDeleteVisible.value = false
        return
      }
      const ids = selectedRows.value.map(item => item.id)
      await startAsyncTask('aux-items-delete', () =>
        request.post('/base/aux-items/batch-delete-async', { ids })
      )
    }

    batchDeleteVisible.value = false
    selectedRows.value = []
    tableRef.value?.clearSelection()
  } catch (error) {
    showOperationError('批量删除', error)
  } finally {
    batchDeleteSaving.value = false
  }
}

async function handleTaskCompleted() {
  await fetchData()
}

// ========== 搜索功能 ==========
function getCategoryName(typeId: string): string {
  const cat = categories.value.find(c => c.id === typeId)
  return cat?.name || ''
}

async function handleSearch() {
  const keyword = searchKeyword.value.trim()
  if (!keyword) {
    showError('请输入搜索关键字')
    return
  }

  const lower = keyword.toLowerCase()
  const results: { categories: any[]; items: any[]; customFields: any[] } = {
    categories: [],
    items: [],
    customFields: [],
  }

  for (const cat of categories.value) {
    if (cat.name.toLowerCase().includes(lower) || String(cat.code || '').toLowerCase().includes(lower)) {
      results.categories.push(cat)
    }
  }

  try {
    const { items } = await fetchAuxItemsPage({ keyword, page: 1, pageSize: 200 })
    results.items = items.filter(
      (item: any) => !isAuxCategoryExcludedFromProjectList(item.category_code)
    )

    for (const item of results.items) {
      const cat = categories.value.find(c => c.id === item.type)
      const fields = cat?.fields || []
      let fieldValues: Record<string, string> = {}
      try {
        fieldValues = item.field_values
          ? typeof item.field_values === 'string'
            ? JSON.parse(item.field_values)
            : item.field_values
          : {}
      } catch {
        /* ignore */
      }
      for (const field of fields) {
        const value = fieldValues[field.field_key]
        if (value && String(value).toLowerCase().includes(lower)) {
          const alreadyAdded = results.customFields.some(
            r => r.item.id === item.id && r.fieldName === field.field_name
          )
          if (!alreadyAdded) {
            results.customFields.push({
              item,
              fieldName: field.field_name,
              value: String(value),
            })
          }
        }
      }
    }
  } catch (error) {
    showOperationError('搜索项目', error)
    return
  }

  searchResults.value = results
  searchDialogVisible.value = true
}

function locateCategory(catId: string) {
  // 清除过滤，切换到该类目
  searchFilterIds.value = null
  activeTab.value = catId
  searchDialogVisible.value = false
}

function locateItem(item: any) {
  if (statusFilter.value && statusFilter.value !== (item.status || 'active')) {
    statusFilter.value = ''
  }
  activeTab.value = item.type
  searchFilterIds.value = [item.id]
  pagination.page = 1
  void loadPageItems()
  searchDialogVisible.value = false
}

function clearSearchFilter() {
  searchFilterIds.value = null
  pagination.page = 1
  void loadPageItems()
}

// ========== 导出功能 ==========
async function exportData() {
  const currentPageCount = pageItems.value.length
  const totalCount = pagination.total

  if (currentPageCount === totalCount) {
    await performExport(pageItems.value)
    return
  }

  try {
    await ElMessageBox.confirm(
      `当前页：${currentPageCount} 条\n全部数据：${totalCount} 条\n\n请选择导出范围：`,
      '导出确认',
      {
        confirmButtonText: `导出全部（${totalCount}条）`,
        cancelButtonText: `仅当前页（${currentPageCount}条）`,
        distinguishCancelAndClose: true,
        type: 'info',
      }
    )
    await startAsyncTask('aux-items-export', () =>
      request.post('/base/aux-items/export-async', {
        type: activeTab.value,
        status: statusFilter.value || undefined,
      })
    )
  } catch (action) {
    if (action === 'cancel') {
      await performExport(pageItems.value)
    }
  }
}

async function performExport(dataList: any[]) {
  const catName = activeCatName.value
  const cat = categories.value.find(c => c.id === activeTab.value)
  const customFields = (cat?.fields || []).filter((f: any) => f.is_enabled !== 0)

  // 数据量大时显示loading
  let loadingInstance: any = null
  if (dataList.length > 500) {
    loadingInstance = ElLoading.service({
      lock: true,
      text: `正在导出 ${dataList.length} 条数据，请稍候...`,
      background: 'rgba(0, 0, 0, 0.7)',
    })
  }

  try {
    const { exportStyledTable } = await import('@/utils/exportStyledExcel')
    // 使用 setTimeout 让 UI 有机会更新
    await new Promise(resolve => setTimeout(resolve, 100))

    const batchSize = 1000
    const allRows: any[] = []

    for (let i = 0; i < dataList.length; i += batchSize) {
      const batch = dataList.slice(i, i + batchSize)
      const batchRows = batch.map((item: any) => {
        const row: Record<string, string> = {
          编码: item.code,
          名称: item.name,
          状态: item.status === 'active' ? '进行中' : '已完结',
          备注: item.remark || '',
        }
        let fv: Record<string, string> = {}
        try {
          fv = item.field_values
            ? typeof item.field_values === 'string'
              ? JSON.parse(item.field_values)
              : item.field_values
            : {}
        } catch {
          /* ignore */
        }
        for (const field of customFields) {
          row[field.field_name] = formatFieldDisplayValue(field, fv[field.field_key])
        }
        return row
      })
      allRows.push(...batchRows)

      if (loadingInstance && dataList.length > 500) {
        const progress = Math.round(((i + batch.length) / dataList.length) * 100)
        loadingInstance.setText(`正在导出 ${dataList.length} 条数据... ${progress}%`)
      }

      await new Promise(resolve => setTimeout(resolve, 0))
    }

    const columns: ExportColumnDef[] = [
      { label: '编码', width: 100, value: row => String(row.编码 ?? '') },
      { label: '名称', width: 180, value: row => String(row.名称 ?? '') },
      { label: '状态', width: 80, align: 'center', value: row => String(row.状态 ?? '') },
      { label: '备注', width: 200, value: row => String(row.备注 ?? '') },
    ]
    for (const field of customFields) {
      columns.push({
        label: field.field_name,
        width: 120,
        value: row => String(row[field.field_name] ?? ''),
      })
    }

    await exportStyledTable({
      fileName: `核算项目_${catName}_${dataList.length}条.xlsx`,
      sheetName: catName || '核算项目',
      title: `核算项目 · ${catName || ''}`,
      subtitle: `共 ${dataList.length} 条`,
      columns,
      rows: allRows,
    })

    showSuccess(`成功导出 ${dataList.length} 条数据`)
  } catch (error) {
    showError('导出失败，请重试')
    console.error('Export error:', error)
  } finally {
    if (loadingInstance) {
      loadingInstance.close()
    }
  }
}

// ========== 导入功能 ==========
function openImportDialog() {
  resetImportDialog()
  importDialogVisible.value = true
}

function closeImportDialog() {
  importDialogVisible.value = false
}

function resetImportDialog() {
  importPreview.value = []
  importWarnings.value = []
  importBlankSkipped.value = 0
  importIssuesDialogVisible.value = false
  importIssues.value = []
  importParsing.value = false
  importParseProgress.value = 0
  importParseMessage.value = ''
  uploadedFileName.value = ''
  largeImportFile.value = null
  importing.value = false
  importUploadRef.value?.clearFiles()
}

async function refreshImportIssuesAsync() {
  const token = ++importIssuesBuildToken
  importIssuesLoading.value = true
  importIssues.value = []
  try {
    await nextTick()
    await yieldToMain()
    importIssues.value = await aggregateImportIssuesAsync(
      importPreview.value,
      describeProjectRowIssue
    )
  } finally {
    if (token === importIssuesBuildToken) importIssuesLoading.value = false
  }
}

async function openImportIssuesDialog() {
  importIssuesDialogVisible.value = true
  await refreshImportIssuesAsync()
}

function clearUploadedFile() {
  resetImportDialog()
}

async function onImportFileChange(file: UploadFile) {
  if (!file.raw || importParsing.value) return
  uploadedFileName.value = file.name
  if (file.raw.size >= 5 * 1024 * 1024 && file.name.toLowerCase().endsWith('.xlsx')) {
    largeImportFile.value = file.raw
    importPreview.value = []
    importWarnings.value = []
    importIssues.value = []
    return
  }
  importParsing.value = true
  importParseProgress.value = 0
  importParseMessage.value = '正在读取 Excel 文件…'
  try {
    await nextTick()
    await yieldToMain()
    const arrayBuffer = await file.raw.arrayBuffer()
    await yieldToMain()
    importParseMessage.value = '正在解析工作表…'
    const { utils, read } = await import('xlsx')
    const workbook = read(arrayBuffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    await yieldToMain()
    importParseMessage.value = '正在校验导入数据…'
    const rawData: Record<string, unknown>[] = utils.sheet_to_json(sheet, { defval: '' })

    if (rawData.length === 0) {
      showError('文件中没有数据')
      clearUploadedFile()
      return
    }

    // 导入时空编码从「下一个可用编码 - 1」续号（FIX-419：不再按字符串倒序取第 1 条）
    const nextCode = await nextItemCodeForCategory(activeTab.value)
    const nextNum = Number.parseInt(nextCode, 10)
    const maxCode = Number.isNaN(nextNum) ? 0 : nextNum - 1

    const cat = categories.value.find(c => c.id === activeTab.value)
    const customFields = (cat?.fields || []).filter((f: any) => f.is_enabled !== 0)

    const { rows, blankSkipped } = await parseProjectImportRowsAsync(rawData, {
      customFields,
      maxCode,
      normalizeDirection: normalizeDirectionFieldValue,
      onProgress: pct => {
        importParseProgress.value = pct
      },
    })

    importBlankSkipped.value = blankSkipped
    importWarnings.value = []
    const gapWarning = detectProjectCodeGaps(rows.filter(r => r.matched).map(r => ({ code: r.code })))
    if (gapWarning) importWarnings.value = [gapWarning]

    importPreview.value = rows
    importIssues.value = []
    if (rows.length > 0 && rows.every(r => !r.matched) && rows.some(r => r.error)) {
      void openImportIssuesDialog()
    }
  } catch (error) {
    showError('文件解析失败，请检查文件格式')
    console.error('Import parse error:', error)
    clearUploadedFile()
  } finally {
    importParsing.value = false
    importParseMessage.value = ''
  }
}

async function downloadTemplate() {
  const { utils, writeFile } = await import('xlsx')
  const cat = categories.value.find(c => c.id === activeTab.value)
  const customFields = (cat?.fields || []).filter((f: any) => f.is_enabled !== 0)

  // 固定列 + 动态列
  const baseRow: Record<string, string> = {
    编码: '000001',
    名称: '示例项目1',
    状态: '进行中',
    备注: '',
  }
  for (const field of customFields) {
    baseRow[field.field_name] = ''
  }

  const templateData = [
    baseRow,
    { ...baseRow, 编码: '000002', 名称: '示例项目2', 状态: '已完结', 备注: '备注信息' },
  ]
  const ws = utils.json_to_sheet(templateData)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, '导入模板')
  writeFile(wb, '核算项目导入模板.xlsx')
}

async function handleImport() {
  if (largeImportFile.value) {
    importing.value = true
    try {
      const formData = new FormData()
      formData.append('type', activeTab.value)
      formData.append('file', largeImportFile.value)
      await startAsyncTask('aux-items-import-file', () =>
        request.post('/base/aux-items/import-file-async', formData, {
          timeout: 600_000,
        })
      )
      closeImportDialog()
    } catch (error) {
      showOperationError('后台文件导入', error)
    } finally {
      importing.value = false
    }
    return
  }
  const matched = importPreview.value.filter(r => r.matched)
  if (matched.length === 0) {
    if (importIssueCount.value > 0) void openImportIssuesDialog()
    return
  }
  importing.value = true

  try {
    await startAsyncTask('aux-items-import', () =>
      request.post('/base/aux-items/batch-import-async', {
        type: activeTab.value,
        items: matched.map(({ rowIndex: _ri, matched: _m, error: _e, ...rest }) => rest),
      })
    )
    closeImportDialog()
  } catch (error) {
    showOperationError('批量导入', error)
  } finally {
    importing.value = false
  }
}

useKeyboardShortcuts([
  commonShortcuts.save(() => {
    if (
      itemDialogVisible.value &&
      !itemSaving.value &&
      !importDialogVisible.value
    ) {
      handleSaveItem(false)
    }
  }),
])

onMounted(fetchData)
onActivated(() => {
  if (route.query.category_id && categories.value.length) void fetchData()
})
</script>

<style scoped>
.project-page {
  height: calc(100vh - 60px);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
  box-sizing: border-box;
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 6px;
  flex-shrink: 0;
  padding: 6px 10px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.project-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.project-title h3 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
  font-weight: 600;
  line-height: 1.25;
  color: #303133;
}

.project-title-meta {
  font-size: 12px;
  line-height: 1.35;
  color: var(--el-text-color-secondary);
}

.project-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 6px;
  flex-shrink: 0;
  min-width: 0;
  flex: 1 1 auto;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.project-toolbar > * {
  flex-shrink: 0;
}

.project-search {
  width: 168px;
}

.project-closed-switch {
  margin-left: 2px;
  height: 24px;
}

.project-tabs {
  flex-shrink: 0;
  margin-bottom: 4px;
}

.project-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.project-tabs :deep(.el-tabs__nav-wrap) {
  padding: 0 2px;
}

.project-tabs :deep(.el-tabs__item) {
  height: 32px;
  line-height: 32px;
  padding: 0 12px;
  font-size: var(--cw-text-base);
}

.project-empty {
  padding: 12px;
  color: #909399;
  text-align: center;
  font-size: var(--cw-text-base);
}

.project-table {
  flex: 1;
  min-height: 0;
  border-radius: 6px;
}

.project-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.pagination-size-select {
  width: 88px;
}

.cat-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.cat-tab-icon {
  font-size: 12px;
  color: #909399;
  cursor: pointer;
  margin-left: 2px;
  opacity: 0;
  transition: opacity 0.2s;
}
.cat-tab-label:hover .cat-tab-icon {
  opacity: 1;
}
.cat-tab-icon:hover {
  color: #409eff;
}
.cat-tab-icon-danger:hover {
  color: #f56c6c;
}
.uploaded-file-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: #f5f7fa;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  margin-bottom: 16px;
}
.uploaded-file-info .file-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--cw-text-base);
  color: #606266;
}
.uploaded-file-info .file-name .el-icon {
  font-size: 18px;
  color: #409eff;
}
.import-tips {
  margin-bottom: 16px;
  font-size: var(--cw-text-base);
  color: #606266;
  line-height: 1.8;
}
.import-tips p {
  margin: 0;
}
.import-preview {
  margin-top: 16px;
}
.import-preview-more {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}
.import-parsing {
  margin-top: 12px;
}
.import-parsing__text {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
  text-align: center;
}
.import-warnings {
  margin-top: 16px;
}
.import-more-hint {
  text-align: center;
  color: #909399;
  font-size: 12px;
  margin-top: 8px;
}

.search-result-group {
  margin-bottom: 16px;
}

.search-result-title {
  font-weight: bold;
  color: #303133;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #ebeef5;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 4px;
}

.search-result-item:hover {
  background-color: #ecf5ff;
}

.search-result-cat {
  color: #909399;
  font-size: 12px;
}

.search-result-name {
  flex: 1;
  color: #303133;
}
</style>
