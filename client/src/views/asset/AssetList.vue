<template>
  <div class="page page-asset-list">
    <div class="list-toolbar" style="margin-bottom:8px">
      <el-button v-permission="'asset:edit'" type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增固定资产</el-button>
      <el-button size="small" :disabled="!selection.length" @click="openPrint('card')">
        打印卡片{{ selection.length ? `（${selection.length}）` : '' }}
      </el-button>
      <el-button size="small" :disabled="!selection.length" @click="openPrint('label')">
        打印标签{{ selection.length ? `（${selection.length}）` : '' }}
      </el-button>
      <el-button v-permission="'asset:change'" size="small" :disabled="!selection.length" @click="openBatchChange('dept')">
        批量调拨{{ selection.length ? `（${selection.length}）` : '' }}
      </el-button>
      <el-button v-permission="'asset:change'" size="small" :disabled="!selection.length" @click="openBatchChange('status')">
        批量停启用
      </el-button>
      <el-button v-permission="'asset:edit'" size="small" @click="$router.push('/asset/import')">批量导入</el-button>
    </div>
    <div ref="tableContainerRef" class="table-container">
      <el-table ref="tableRef" :data="list" :height="tableHeight" border stripe size="small" class="compact-data-table"
        highlight-current-row @row-dblclick="openEdit" @header-dragend="onDragEnd"
        @selection-change="rows => (selection = rows)">
        <el-table-column type="selection" width="42" />
        <el-table-column label="资产编号" prop="asset_no" :width="cw('asset_no', 120)" />
        <el-table-column label="资产名称" prop="asset_name" :width="cw('asset_name', 150)" show-overflow-tooltip />
        <el-table-column label="类别" prop="category_name" :width="cw('category_name', 100)" />
        <el-table-column label="状态" :width="cw('status_code', 80)">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status_code)" size="small">{{ row.status_name || row.status_code }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="使用部门" prop="dept_name" :width="cw('dept_name', 110)" />
        <el-table-column label="购置日期" prop="acquire_date" :width="cw('acquire_date', 105)" />
        <el-table-column label="原值" prop="original_value" :width="cw('original_value', 110)" align="right">
          <template #default="{ row }">{{ fmtAmt(row.original_value) }}</template>
        </el-table-column>
        <el-table-column label="累计折旧" prop="accum_depr" :width="cw('accum_depr', 110)" align="right">
          <template #default="{ row }">{{ fmtAmt(row.accum_depr) }}</template>
        </el-table-column>
        <el-table-column label="净值" prop="net_value" :width="cw('net_value', 110)" align="right">
          <template #default="{ row }">{{ fmtAmt(row.net_value) }}</template>
        </el-table-column>
        <el-table-column label="折旧方法" prop="depr_method" :width="cw('depr_method', 110)">
          <template #default="{ row }">{{ DEPR_METHODS[row.depr_method] || row.depr_method }}</template>
        </el-table-column>
        <el-table-column label="已提月数" prop="depr_months_done" :width="cw('depr_months_done', 80)" align="center" />
        <el-table-column label="使用人" prop="user_name" :width="cw('user_name', 90)" />
        <el-table-column label="操作" :width="cw('actions', 190)" align="center" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="success" size="small" @click.stop="$router.push(`/asset/detail/${row.id}`)">明细</el-button>
              <el-button v-permission="'asset:edit'" link type="primary" size="small" @click.stop="openEdit(row)">编辑</el-button>
              <el-button v-if="!row.scrap_date" v-permission="'asset:change'" link type="primary" size="small" @click.stop="$router.push(`/asset/change?assetId=${row.id}`)">变动</el-button>
              <el-button v-if="!row.scrap_date" v-permission="'asset:dispose'" link type="warning" size="small" @click.stop="openDispose(row)">处置</el-button>
              <el-button v-if="row.scrap_date" v-permission="'asset:dispose'" link type="success" size="small" @click.stop="handleCancelDispose(row)">撤销处置</el-button>
              <el-button v-permission="'asset:edit'" link type="danger" size="small" @click.stop="handleDelete(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="table-footer">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.page_size"
        :total="pagination.total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="handleQuery"
      />
    </div>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editId ? '编辑固定资产' : '新增固定资产'" width="800px" draggable>
      <div v-if="editId && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="100px" size="small">
        <div class="form-sector">
          <div class="form-sector-title">资产基本信息</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="资产编号" required>
                <el-input v-model="form.asset_no" :disabled="!!editId" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="资产名称" required>
                <el-input v-model="form.asset_name" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="资产类别" required>
                <el-select v-model="form.category_code" clearable style="width:100%"
                  @change="onCategoryChange">
                  <el-option v-for="c in dicts.category" :key="c.code" :label="c.name" :value="c.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="资产状态">
                <el-select v-model="form.status_code" clearable style="width:100%">
                  <el-option v-for="s in dicts.status" :key="s.code" :label="s.name" :value="s.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="使用部门">
                <el-select v-model="form.dept_code" clearable style="width:100%">
                  <el-option v-for="d in dicts.dept" :key="d.code" :label="d.name" :value="d.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="用途" required>
                <el-select v-model="form.purpose_code" clearable style="width:100%">
                  <el-option v-for="p in dicts.purpose" :key="p.code" :label="p.name" :value="p.code" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">财务与折旧信息</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="原值" required>
                <el-input-number v-model="form.original_value" :precision="2" :min="0" style="width:100%" @change="onOriginalValueChange" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="折旧方法" required>
                <el-select v-model="form.depr_method" clearable style="width:100%">
                  <el-option v-for="(label, val) in DEPR_METHODS" :key="val" :label="label" :value="val" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="购置日期">
                <el-date-picker v-model="form.acquire_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="起折日期" required>
                <el-date-picker v-model="form.start_depr_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="期初累计折旧">
                <el-input-number v-model="form.accum_depr" :precision="2" :min="0" style="width:100%" @change="onAccumDeprChange" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="已计提月份">
                <el-input-number v-model="form.depr_months_done" :min="0" :precision="0" :disabled="!!editId" style="width:100%" @change="onDeprMonthsChange" />
                <span v-if="editId" class="tip-text">已提月数由折旧计提维护，不能手工修改</span>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="使用总月数" :required="form.depr_method !== '2'">
                <el-input-number v-model="form.use_months" :min="1" :precision="0" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="残值率">
                <el-input-number v-model="form.salvage_rate" :precision="4" :step="0.01" :min="0" :max="0.9999" style="width:100%" @change="calcSalvage" />
                <span class="tip-text">小数口径，0.05 表示 5%</span>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="预计净残值">
                <el-input-number v-model="form.salvage_value" :precision="2" :min="0" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12" v-if="form.depr_method === '2'">
              <el-form-item label="总工作量" required>
                <el-input-number v-model="form.total_workload" :min="0.01" :precision="2" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="24" v-if="!editId">
              <div class="voucher-gen-area">
                <el-form-item label="生成购置凭证">
                  <el-switch v-model="(form as any).generate_voucher" />
                  <span v-if="(form as any).generate_voucher" class="sector-tip">借：固定资产 / 贷：资金来源</span>
                </el-form-item>
                <el-form-item v-if="(form as any).generate_voucher" label="贷方(资金)">
                  <AccountSelect v-model="(form as any).credit_account" placeholder="默认 1001 银行存款" search-keyword="银行存款" />
                </el-form-item>
              </div>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">附属管理信息</div>
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="卡片号">
                <el-input v-model="form.card_no" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="数量">
                <el-input-number v-model="form.qty" :min="1" :precision="0" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="计量单位">
                <el-input v-model="form.unit" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="使用人">
                <el-input v-model="form.user_name" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="保管人">
                <el-input v-model="form.keeper" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="安装地点">
                <el-input v-model="form.install_place" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="form.remark" type="textarea" :rows="2" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确认保存</el-button>
      </template>
    </el-dialog>

    <!-- 资产处置弹窗 -->
    <el-dialog v-model="disposeVisible" title="资产处置" width="560px" draggable>
      <div class="dispose-info" v-if="disposeAsset">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="资产编号">{{ disposeAsset.asset_no }}</el-descriptions-item>
          <el-descriptions-item label="资产名称">{{ disposeAsset.asset_name }}</el-descriptions-item>
          <el-descriptions-item label="原值">¥{{ fmtAmt(disposeAsset.original_value) }}</el-descriptions-item>
          <el-descriptions-item label="累计折旧">¥{{ fmtAmt(disposeAsset.accum_depr) }}</el-descriptions-item>
          <el-descriptions-item label="净值" :span="2">
            <b>¥{{ fmtAmt(disposeAsset.net_value) }}</b>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <el-form :model="disposeForm" label-width="100px" size="small" style="margin-top:14px">
        <el-form-item label="减少方式">
          <el-select v-model="disposeForm.change_type_code" clearable style="width:100%">
            <el-option v-for="c in disposeTypes" :key="c.code" :label="c.name" :value="c.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="处置日期" required>
          <el-date-picker v-model="disposeForm.scrap_date" type="date" value-format="YYYY-MM-DD" style="width:100%" :disabled-date="disableFutureMonth" />
        </el-form-item>
        <el-form-item label="处置原因">
          <el-input v-model="disposeForm.scrap_reason" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="处置收入">
          <el-input-number v-model="disposeForm.disposal_income" :precision="2" :min="0" style="width:100%" />
        </el-form-item>
        <el-form-item label="处置费用">
          <el-input-number v-model="disposeForm.disposal_expense" :precision="2" :min="0" style="width:100%" />
        </el-form-item>
        <el-form-item label="生成凭证">
          <el-switch v-model="disposeForm.generate_voucher" />
          <span class="tip-text" v-if="disposeForm.generate_voucher">自动生成固定资产清理凭证</span>
        </el-form-item>
        <el-divider v-if="disposeForm.generate_voucher" />
        <el-form-item v-if="disposeForm.generate_voucher" label="清理科目">
          <el-input v-model="disposeForm.clearing_account" placeholder="1606" style="width:140px" />
        </el-form-item>
      </el-form>
      <!-- 处置预览 -->
      <div v-if="disposeAsset" class="dispose-preview">
        <span>净值：<b>¥{{ fmtAmt(disposeAsset.net_value) }}</b></span>
        <el-divider direction="vertical" />
        <span>处置损益：<b :class="disposePreviewGainLoss >= 0 ? 'incr' : 'decr'">
          {{ disposePreviewGainLoss >= 0 ? '+' : '' }}¥{{ fmtAmt(Math.abs(disposePreviewGainLoss)) }}
        </b></span>
      </div>
      <template #footer>
        <el-button @click="disposeVisible = false">取消</el-button>
        <el-button type="warning" :loading="disposing" @click="handleDispose">确认处置</el-button>
      </template>
    </el-dialog>

    <!-- 批量变动：只支持不涉及逐条金额的类型（部门调拨 / 使用状态） -->
    <el-dialog
      v-model="batchVisible"
      :title="batchKind === 'dept' ? '批量部门调拨' : '批量变更使用状态'"
      width="520px"
      draggable
    >
      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="`将对已勾选的 ${selection.length} 张卡片执行同一变动；任一张失败则整批回滚。`"
        style="margin-bottom: 12px"
      />
      <el-form :model="batchForm" label-width="100px" size="small">
        <el-form-item label="变动日期" required>
          <el-date-picker
            v-model="batchForm.change_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item v-if="batchKind === 'dept'" label="调入部门" required>
          <el-select v-model="batchForm.dept_code" style="width: 100%" placeholder="选择调入部门">
            <el-option
              v-for="d in dicts.dept"
              :key="d.code"
              :label="`${d.code} ${d.name}`"
              :value="d.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="变更为" required>
          <el-select v-model="batchForm.status_code" style="width: 100%" placeholder="选择使用状态">
            <el-option
              v-for="st in dicts.status.filter(x => x.code !== '04')"
              :key="st.code"
              :label="`${st.name}${st.depreciable ? '' : '（不计提折旧）'}`"
              :value="st.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="batchForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchSubmitting" @click="submitBatchChange">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 资产卡片 / 标签打印 -->
    <HiprintDialog
      v-model="printVisible"
      template-type="report"
      :template-key="printMode === 'card' ? 'asset:card' : 'asset:label'"
      :title="printMode === 'card' ? '打印资产卡片' : '打印资产标签'"
      :get-print-html="() => printHtml"
      :raw-html-preview="true"
      default-paper="A4"
      :default-orientation="printMode === 'card' ? 'portrait' : 'portrait'"
    />
  </div>
</template>

<script setup lang="ts">

/** P1-20：变动 / 处置 / 盘点日期不得晚于当前月份（与后端同口径） */
function disableFutureMonth(date: Date): boolean {
  const now = new Date()
  return date.getFullYear() * 100 + date.getMonth() > now.getFullYear() * 100 + now.getMonth()
}
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Setting } from '@element-plus/icons-vue'
import { fixedAssetApi, type AssetCard, type AssetDicts, DEPR_METHODS } from '@/api/fixedAsset'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildQrMap, buildAssetCardHtml, buildAssetLabelHtml } from '@/utils/assetCardPrint'
import AccountSelect from '@/components/base/AccountSelect.vue'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const { tableRef: colWidthTableRef, colWidth, onDragEnd } = useListColumnWidth('asset_list')
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const tableRef = colWidthTableRef
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const list = ref<AssetCard[]>([])
const selection = ref<AssetCard[]>([])

// ── 卡片 / 标签打印 ──────────────────────────────────────
const printVisible = ref(false)
const printMode = ref<'card' | 'label'>('card')
const printHtml = ref('')

/**
 * 二维码需要异步渲染成 data URI，因此先把 HTML 备好再打开打印对话框，
 * HiprintDialog 的 getPrintHtml 是同步接口，直接返回已备好的字符串。
 */
// ── 批量变动 ──────────────────────────────────────────────
const batchVisible = ref(false)
const batchSubmitting = ref(false)
const batchKind = ref<'dept' | 'status'>('dept')
const batchForm = reactive({
  change_date: new Date().toISOString().slice(0, 10),
  dept_code: '',
  status_code: '',
  remark: '',
})

function openBatchChange(kind: 'dept' | 'status') {
  if (!selection.value.length) return ElMessage.warning('请先勾选要变动的资产')
  batchKind.value = kind
  batchForm.change_date = new Date().toISOString().slice(0, 10)
  batchForm.dept_code = ''
  batchForm.status_code = ''
  batchForm.remark = ''
  batchVisible.value = true
}

async function submitBatchChange() {
  if (!batchForm.change_date) return ElMessage.warning('请选择变动日期')
  const payload =
    batchKind.value === 'dept'
      ? { dept_code: batchForm.dept_code }
      : { status_code: batchForm.status_code }
  if (!Object.values(payload)[0]) {
    return ElMessage.warning(batchKind.value === 'dept' ? '请选择调入部门' : '请选择使用状态')
  }

  batchSubmitting.value = true
  try {
    const res = await fixedAssetApi.batchChange({
      asset_ids: selection.value.map(a => a.id),
      kind: batchKind.value,
      change_date: batchForm.change_date,
      payload,
      remark: batchForm.remark || null,
    })
    ElMessage.success(`批量变动成功，共 ${res.data.successCount} 张卡片`)
    batchVisible.value = false
    handleQuery()
  } finally {
    batchSubmitting.value = false
  }
}

async function openPrint(mode: 'card' | 'label') {
  if (!selection.value.length) return ElMessage.warning('请先勾选要打印的资产')
  printMode.value = mode
  const assets = selection.value
  const qrMap = await buildQrMap(assets, mode === 'card' ? 180 : 140)
  printHtml.value =
    mode === 'card' ? buildAssetCardHtml(assets, qrMap) : buildAssetLabelHtml(assets, qrMap)
  printVisible.value = true
}
const dicts = ref<AssetDicts>({ category: [], status: [], purpose: [], dept: [] } as any)
const filters = reactive({ keyword: '', category_code: '', status_code: '', dept_code: '' })
const pagination = reactive({ page: 1, page_size: 20, total: 0 })

const dialogVisible = ref(false)
const editId = ref<string | null>(null)

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  const allRows = list.value
  if (allRows.length === 0 || !editId.value) return null
  const idx = allRows.findIndex(r => r.id === editId.value)
  return {
    current: idx + 1,
    total: allRows.length,
    isFirst: idx <= 0,
    isLast: idx >= allRows.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  const allRows = list.value
  if (allRows.length === 0) return
  
  let targetIdx = 0
  const currentIdx = allRows.findIndex(r => r.id === editId.value)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = allRows.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(allRows.length - 1, currentIdx + 1)
  
  if (allRows[targetIdx]) {
    openEdit(allRows[targetIdx])
  }
}

const saving = ref(false)
const form = ref<Partial<AssetCard>>({})

const fmtAmt = (v: number) =>
  v == null || v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statusTagType = (code: string | null) => {
  const map: Record<string, string> = { '01': 'success', '02': 'warning', '03': 'info', '04': 'danger' }
  return (map[code ?? ''] ?? 'info') as any
}

onMounted(async () => {
  // 字典与列表无依赖关系，并行加载减少首屏等待
  const [dictRes] = await Promise.all([
    fixedAssetApi.getDicts(),
    handleQuery(),
  ])
  if (dictRes.code === 0) dicts.value = dictRes.data
})

async function handleQuery() {
  const res = await fixedAssetApi.getCards({
    keyword: filters.keyword || undefined,
    category_code: filters.category_code || undefined,
    status_code: filters.status_code || undefined,
    dept_code: filters.dept_code || undefined,
    page: pagination.page,
    page_size: pagination.page_size,
  })
  if (res.code === 0) {
    const maxPage = Math.max(1, Math.ceil(res.data.total / pagination.page_size))
    if (res.data.list.length === 0 && res.data.total > 0 && pagination.page > maxPage) {
      pagination.page = maxPage
      await handleQuery()
      return
    }
    list.value = res.data.list
    pagination.total = res.data.total
  }
}

async function openAdd() {
  editId.value = null
  form.value = {
    original_value: 0,
    // AS-P0-1：残值率统一小数口径（0.05 表示 5%），与服务端/导入一致
    salvage_rate: 0.05,
    salvage_value: 0,
    qty: 1,
    depr_method: '1',
    accum_depr: 0,
    depr_months_done: 0,
    generate_voucher: false,
    credit_account: '1001',
  } as any
  dialogVisible.value = true
  // 自动生成资产编号（可手动修改）
  try {
    const res = await fixedAssetApi.getNextAssetNo()
    if (res.code === 0 && !form.value.asset_no) form.value.asset_no = res.data.next_no
  } catch { /* 忽略，留空让用户手填 */ }
}

function openEdit(row: AssetCard) {
  editId.value = row.id
  form.value = { ...row }
  dialogVisible.value = true
}

function onOriginalValueChange() {
  calcSalvage()
}

function onDeprMonthsChange() {
  if (!form.value.original_value || !form.value.use_months) return
  const monthly = (form.value.original_value - (form.value.salvage_value || 0)) / form.value.use_months
  form.value.accum_depr = Math.round(monthly * (form.value.depr_months_done || 0) * 100) / 100
}

function onAccumDeprChange() {
  if (!form.value.original_value || !form.value.use_months) return
  const monthly = (form.value.original_value - (form.value.salvage_value || 0)) / form.value.use_months
  if (monthly > 0) {
    form.value.depr_months_done = Math.round((form.value.accum_depr || 0) / monthly)
  }
}

/** 自动估算已提月份和累计折旧（仅限录入新资产时参考） */
function autoEstimateInitialDepr() {
  if (!form.value.start_depr_date || !form.value.original_value || !form.value.use_months) return
  
  const start = new Date(form.value.start_depr_date)
  const now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  
  if (months > 0) {
    const validMonths = Math.min(months, form.value.use_months)
    form.value.depr_months_done = validMonths
    
    // 粗略估算累计折旧 (直线法)
    const monthly = (form.value.original_value - (form.value.salvage_value || 0)) / form.value.use_months
    form.value.accum_depr = Math.round(monthly * validMonths * 100) / 100
  }
}

// 监听日期和年限变化尝试自动填充
watch(() => form.value.start_depr_date, () => {
  if (!editId.value) autoEstimateInitialDepr()
})
watch(() => form.value.use_months, () => {
  if (!editId.value) autoEstimateInitialDepr()
})

function onCategoryChange(code: string) {
  const cat = dicts.value.category.find(c => c.code === code)
  if (cat?.salvage_rate != null) {
    form.value.salvage_rate = cat.salvage_rate
    calcSalvage()
  }
}

function calcSalvage() {
  const ov = form.value.original_value ?? 0
  // AS-P0-1：残值率为小数口径，直接参与计算（不再 ÷100）
  const rate = form.value.salvage_rate ?? 0
  form.value.salvage_value = Math.round(ov * rate * 100) / 100
}

async function handleSave() {
  if (!form.value.asset_no || !form.value.asset_name) return ElMessage.warning('请填写资产编号和名称')
  if (!form.value.category_code) return ElMessage.warning('请选择资产类别')
  if (!form.value.purpose_code) return ElMessage.warning('请选择资产用途')
  if (!form.value.start_depr_date) return ElMessage.warning('请选择起折日期')
  if (!form.value.original_value) return ElMessage.warning('资产原值不能为空')
  if (!form.value.depr_method) return ElMessage.warning('请选择折旧方法')
  
  // 动态校验：根据折旧方法判断必填项
  if (form.value.depr_method === '2') {
    if (!form.value.total_workload) return ElMessage.warning('使用工作量法时，总工作量不能为空')
  } else {
    if (!form.value.use_months) return ElMessage.warning('请填写预计使用月数')
  }

  saving.value = true
  try {
    if (editId.value) {
      await fixedAssetApi.updateCard(editId.value, form.value)
      ElMessage.success('保存成功')
    } else {
      const res = await fixedAssetApi.createCard(form.value)
      const data: any = res?.data || {}
      if (data.voucher?.voucherNo) {
        ElMessage.success(`保存成功，已生成购置凭证 ${data.voucher.voucherNo}`)
      } else if (data.voucherWarning) {
        ElMessage.warning(`资产已保存，但购置凭证未生成：${data.voucherWarning}`)
      } else {
        ElMessage.success('保存成功')
      }
    }
    dialogVisible.value = false
    handleQuery()
  } finally {
    saving.value = false
  }
}

async function handleCancelDispose(row: AssetCard) {
  await ElMessageBox.confirm(
    `确认撤销「${row.asset_name}」的处置？将还原资产状态为在用，删除处置流水及处置凭证。`,
    '撤销处置', { type: 'warning', confirmButtonText: '确认撤销', confirmButtonClass: 'el-button--danger' }
  )
  try {
    const res = await fixedAssetApi.cancelDispose(row.id)
    if (res.code === 0) {
      const d = res.data
      ElMessage.success(`已撤销处置：${d.assetNo} 还原为在用${d.deletedVoucherNo ? `，已删除凭证 ${d.deletedVoucherNo}` : ''}`)
      handleQuery()
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '撤销失败')
  }
}

async function handleDelete(row: AssetCard) {
  await ElMessageBox.confirm(`确认删除资产「${row.asset_name}」？`, '提示', { type: 'warning' })
  await fixedAssetApi.deleteCard(row.id)
  ElMessage.success('已删除')
  handleQuery()
}

// ── 处置 ──────────────────────────────────────────────
const disposeVisible = ref(false)
const disposing = ref(false)
const disposeAsset = ref<AssetCard | null>(null)
const disposeTypes = ref<{ code: string; name: string }[]>([])
const disposeForm = ref({
  change_type_code: '',
  scrap_date: '',
  scrap_reason: '',
  disposal_income: 0,
  disposal_expense: 0,
  generate_voucher: false,
  accum_account: '1602',
  clearing_account: '1606',
})

const disposePreviewGainLoss = computed(() => {
  if (!disposeAsset.value) return 0
  return Math.round((disposeForm.value.disposal_income - disposeForm.value.disposal_expense - disposeAsset.value.net_value) * 100) / 100
})

function openDispose(row: AssetCard) {
  disposeAsset.value = row
  const today = new Date().toISOString().slice(0, 10)
  disposeForm.value = {
    change_type_code: '',
    scrap_date: today,
    scrap_reason: '',
    disposal_income: 0,
    disposal_expense: 0,
    generate_voucher: false,
    accum_account: '1602',
    clearing_account: '1606',
  }
  // 加载减少方式
  loadDisposeTypes()
  disposeVisible.value = true
}

async function loadDisposeTypes() {
  if (disposeTypes.value.length) return
  const res = await fixedAssetApi.getDict('change_type')
  if (res.code === 0) {
    disposeTypes.value = (res.data as any[]).filter((d: any) => d.direction === 'decrease')
  }
}

async function handleDispose() {
  if (!disposeAsset.value) return
  if (!disposeForm.value.scrap_date) return ElMessage.warning('请选择处置日期')
  await ElMessageBox.confirm(
    `确认处置资产「${disposeAsset.value.asset_name}」？处置后将标记为已减少，${disposeForm.value.generate_voucher ? '并生成清理凭证。' : '此操作不可撤销。'}`,
    '处置确认', { type: 'warning' }
  )
  disposing.value = true
  try {
    const res = await fixedAssetApi.disposeAsset(disposeAsset.value.id, disposeForm.value)
    if (res.code === 0) {
      disposeVisible.value = false
      ElMessage.success('处置成功')
      const rd: any = res.data
      if (rd.voucher) {
        ElMessage.success(`已生成清理凭证 ${rd.voucher.voucherNo || ''}`)
      }
      handleQuery()
    }
  } finally {
    disposing.value = false
  }
}
</script>

<style scoped>
.page-asset-list { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.table-container { flex: 1; overflow: hidden; padding: 0 16px 0; }
.table-footer { padding: 8px 16px; display: flex; justify-content: flex-end; border-top: 1px solid var(--el-border-color-lighter); }
.dispose-info { margin-bottom: 4px; }
.dispose-preview { display: flex; align-items: center; gap: 4px; padding: 8px 12px; background: var(--el-color-warning-light-9); border-radius: 4px; font-size: var(--cw-text-base); margin-top: 8px; }
.tip-text { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.voucher-gen-area {
  padding: 12px;
  background: var(--ink-50);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  margin-top: 8px;
}
.sector-tip {
  margin-left: 10px;
  color: var(--mint-700);
  font-size: 12px;
  font-weight: 500;
}
/* 操作列按钮紧凑排列：去掉相邻按钮默认 12px 间距，改为 2px 间隔 */
.row-actions { display: inline-flex; align-items: center; gap: 0; }
.row-actions .el-button + .el-button { margin-left: 6px; }
.row-actions .el-button { padding: 0; }
</style>
