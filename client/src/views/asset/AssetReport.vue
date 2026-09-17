<template>
  <div class="page page-asset-report">
    
    <el-tabs v-model="activeTab" class="report-tabs">
      <!-- 折旧汇总表 -->
      <el-tab-pane label="折旧汇总表" name="depr-summary">
        <div class="filter-bar">
          <el-date-picker v-model="deprSummaryPeriod" type="month" value-format="YYYY-MM" placeholder="选择期间" style="width:140px" @change="loadDeprSummary" />
          <el-radio-group v-model="deprSummaryGroupBy" @change="loadDeprSummary">
            <el-radio-button value="category">按类别</el-radio-button>
            <el-radio-button value="dept">按部门</el-radio-button>
          </el-radio-group>
          <span class="filter-hint" v-if="deprSummaryRows.length">
            合计本月折旧：<b class="total-amt">¥{{ fmtAmt(deprSummaryTotal) }}</b>
          </span>
        </div>
        <el-table ref="t1Ref" :data="deprSummaryRows" size="small" border stripe max-height="420"
          @row-click="showDeprSummaryDetail" highlight-current-row style="cursor:pointer" @header-dragend="t1Drag">
          <el-table-column :label="deprSummaryGroupBy === 'category' ? '类别编码' : '部门编码'" prop="group_code" :width="t1Cw('group_code', 100)" />
          <el-table-column :label="deprSummaryGroupBy === 'category' ? '类别名称' : '部门名称'" prop="group_name" min-width="140" :width="t1Widths.group_name" />
          <el-table-column label="资产数量" prop="asset_count" :width="t1Cw('asset_count', 90)" align="center" />
          <el-table-column label="原值合计" prop="total_original" :width="t1Cw('total_original', 130)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_original) }}</template>
          </el-table-column>
          <el-table-column label="本月折旧" prop="month_depr" :width="t1Cw('month_depr', 130)" align="right">
            <template #default="{ row }"><span class="depr-amt">{{ fmtAmt(row.month_depr) }}</span></template>
          </el-table-column>
          <el-table-column label="累计折旧" prop="total_accum_depr" :width="t1Cw('total_accum_depr', 130)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_accum_depr) }}</template>
          </el-table-column>
          <el-table-column label="净值合计" prop="total_net_value" :width="t1Cw('total_net_value', 130)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_net_value) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!deprSummaryRows.length && deprSummaryLoaded" description="所选期间无折旧数据" />

        <!-- 下钻明细弹窗 -->
        <el-dialog v-model="deprDetailVisible" :title="deprDetailTitle" width="900px" draggable>
          <el-table :data="deprDetailRows" size="small" border stripe max-height="400">
            <el-table-column label="资产编号" prop="asset_no" width="110" />
            <el-table-column label="资产名称" prop="asset_name" min-width="140" show-overflow-tooltip />
            <el-table-column label="类别" prop="category_name" width="100" />
            <el-table-column label="使用部门" prop="dept_name" width="100" />
            <el-table-column label="折旧方法" width="110">
              <template #default="{ row }">{{ DEPR_METHODS[row.depr_method] || row.depr_method }}</template>
            </el-table-column>
            <el-table-column label="原值" prop="original_value" width="110" align="right">
              <template #default="{ row }">{{ fmtAmt(row.original_value) }}</template>
            </el-table-column>
            <el-table-column label="本月折旧" prop="month_depr" width="110" align="right">
              <template #default="{ row }"><span class="depr-amt">{{ fmtAmt(row.month_depr) }}</span></template>
            </el-table-column>
            <el-table-column label="累计折旧" prop="accum_depr" width="110" align="right">
              <template #default="{ row }">{{ fmtAmt(row.accum_depr) }}</template>
            </el-table-column>
            <el-table-column label="净值" prop="net_value" width="110" align="right">
              <template #default="{ row }">{{ fmtAmt(row.net_value) }}</template>
            </el-table-column>
          </el-table>
        </el-dialog>
      </el-tab-pane>

      <!-- 折旧分配表 -->
      <el-tab-pane label="折旧分配表" name="depr-allocation">
        <div class="filter-bar">
          <el-date-picker v-model="deprAllocPeriod" type="month" value-format="YYYY-MM" placeholder="选择期间" style="width:140px" @change="loadDeprAllocation" />
          <span class="filter-hint" v-if="deprAllocRows.length">
            合计分配折旧：<b class="total-amt">¥{{ fmtAmt(deprAllocTotal) }}</b>
          </span>
        </div>
        <el-table ref="t2Ref" :data="deprAllocRows" size="small" border stripe max-height="420"
          @row-click="showDeprAllocDetail" highlight-current-row style="cursor:pointer" @header-dragend="t2Drag">
          <el-table-column label="费用科目编码" prop="expense_account" :width="t2Cw('expense_account', 140)" />
          <el-table-column label="资产数量" prop="asset_count" :width="t2Cw('asset_count', 100)" align="center" />
          <el-table-column label="折旧金额" prop="total_depr" min-width="150" :width="t2Widths.total_depr" align="right">
            <template #default="{ row }"><span class="depr-amt">{{ fmtAmt(row.total_depr) }}</span></template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!deprAllocRows.length && deprAllocLoaded" description="所选期间无折旧分配数据" />

        <!-- 分配明细弹窗 -->
        <el-dialog v-model="deprAllocDetailVisible" :title="`费用科目 ${deprAllocDetailAccount} 折旧明细`" width="800px" draggable>
          <el-table :data="deprAllocDetailRows" size="small" border stripe max-height="400">
            <el-table-column label="资产编号" prop="asset_no" width="110" />
            <el-table-column label="资产名称" prop="asset_name" min-width="140" show-overflow-tooltip />
            <el-table-column label="类别" prop="category_name" width="100" />
            <el-table-column label="使用部门" prop="dept_name" width="100" />
            <el-table-column label="原值" prop="original_value" width="110" align="right">
              <template #default="{ row }">{{ fmtAmt(row.original_value) }}</template>
            </el-table-column>
            <el-table-column label="本月折旧" prop="month_depr" width="110" align="right">
              <template #default="{ row }"><span class="depr-amt">{{ fmtAmt(row.month_depr) }}</span></template>
            </el-table-column>
            <el-table-column label="累计折旧" prop="accum_depr" width="110" align="right">
              <template #default="{ row }">{{ fmtAmt(row.accum_depr) }}</template>
            </el-table-column>
            <el-table-column label="净值" prop="net_value" width="110" align="right">
              <template #default="{ row }">{{ fmtAmt(row.net_value) }}</template>
            </el-table-column>
          </el-table>
        </el-dialog>
      </el-tab-pane>

      <!-- 资产分类汇总表 -->
      <el-tab-pane label="分类汇总" name="category-summary">
        <div class="filter-bar">
          <el-select v-model="catSummaryStatus" placeholder="资产状态" clearable style="width:130px" @change="loadCategorySummary">
            <el-option v-for="s in dictStatus" :key="s.code" :label="s.name" :value="s.code" />
          </el-select>
        </div>
        <el-table ref="t3Ref" :data="catSummaryRows" size="small" border stripe max-height="420" show-summary
          :summary-method="catSummaryMethod" @header-dragend="t3Drag">
          <el-table-column label="类别编码" prop="category_code" :width="t3Cw('category_code', 100)" />
          <el-table-column label="类别名称" prop="category_name" min-width="140" :width="t3Widths.category_name" />
          <el-table-column label="资产数量" prop="asset_count" :width="t3Cw('asset_count', 100)" align="center" />
          <el-table-column label="原值合计" prop="total_original" :width="t3Cw('total_original', 140)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_original) }}</template>
          </el-table-column>
          <el-table-column label="累计折旧合计" prop="total_accum_depr" :width="t3Cw('total_accum_depr', 140)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_accum_depr) }}</template>
          </el-table-column>
          <el-table-column label="净值合计" prop="total_net_value" :width="t3Cw('total_net_value', 140)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_net_value) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 部门资产汇总表 -->
      <el-tab-pane label="部门汇总" name="dept-summary">
        <div class="filter-bar">
          <el-select v-model="deptSummaryStatus" placeholder="资产状态" clearable style="width:130px" @change="loadDeptSummary">
            <el-option v-for="s in dictStatus" :key="s.code" :label="s.name" :value="s.code" />
          </el-select>
        </div>
        <el-table ref="t4Ref" :data="deptSummaryRows" size="small" border stripe max-height="420" show-summary
          :summary-method="deptSummaryMethod" @header-dragend="t4Drag">
          <el-table-column label="部门编码" prop="dept_code" :width="t4Cw('dept_code', 100)" />
          <el-table-column label="部门名称" prop="dept_name" min-width="140" :width="t4Widths.dept_name" />
          <el-table-column label="资产数量" prop="asset_count" :width="t4Cw('asset_count', 100)" align="center" />
          <el-table-column label="原值合计" prop="total_original" :width="t4Cw('total_original', 140)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_original) }}</template>
          </el-table-column>
          <el-table-column label="累计折旧合计" prop="total_accum_depr" :width="t4Cw('total_accum_depr', 140)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_accum_depr) }}</template>
          </el-table-column>
          <el-table-column label="净值合计" prop="total_net_value" :width="t4Cw('total_net_value', 140)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.total_net_value) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 到期提示表 -->
      <el-tab-pane label="到期提示" name="expiry-warning">
        <div class="filter-bar">
          <span>未来</span>
          <el-input-number v-model="expiryWithinMonths" :min="1" :max="36" style="width:100px" @change="loadExpiryWarning" />
          <span>个月内到期</span>
          <span class="filter-hint" v-if="expiryWarningRows.length">共 <b>{{ expiryWarningRows.length }}</b> 项</span>
        </div>
        <el-table ref="t5Ref" :data="expiryWarningRows" size="small" border stripe max-height="420" @header-dragend="t5Drag">
          <el-table-column label="资产编号" prop="asset_no" :width="t5Cw('asset_no', 110)" />
          <el-table-column label="资产名称" prop="asset_name" min-width="140" :width="t5Widths.asset_name" show-overflow-tooltip />
          <el-table-column label="类别" prop="category_name" :width="t5Cw('category_name', 100)" />
          <el-table-column label="使用部门" prop="dept_name" :width="t5Cw('dept_name', 100)" />
          <el-table-column label="原值" prop="original_value" :width="t5Cw('original_value', 110)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.original_value) }}</template>
          </el-table-column>
          <el-table-column label="累计折旧" prop="accum_depr" :width="t5Cw('accum_depr', 110)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.accum_depr) }}</template>
          </el-table-column>
          <el-table-column label="净值" prop="net_value" :width="t5Cw('net_value', 110)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.net_value) }}</template>
          </el-table-column>
          <el-table-column label="已提/总月数" column-key="months_progress" :width="t5Cw('months_progress', 110)" align="center">
            <template #default="{ row }">{{ row.depr_months_done }} / {{ row.use_months }}</template>
          </el-table-column>
          <el-table-column label="剩余月数" prop="remaining_months" :width="t5Cw('remaining_months', 90)" align="center">
            <template #default="{ row }">
              <el-tag :type="row.remaining_months <= 1 ? 'danger' : 'warning'" size="small">{{ row.remaining_months }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="预计提完" prop="finished_month" :width="t5Cw('finished_month', 90)" />
        </el-table>
        <el-empty v-if="!expiryWarningRows.length && expiryLoaded" description="无即将到期资产" />
      </el-tab-pane>

      <!-- 增减变动表 -->
      <el-tab-pane label="增减变动" name="change-summary">
        <div class="filter-bar">
          <el-date-picker v-model="changeSummaryPeriod" type="month" value-format="YYYY-MM" placeholder="选择期间" style="width:140px" @change="loadChangeSummary" />
          <span class="filter-hint" v-if="changeSummaryRows.length">
            期初 ¥{{ fmtAmt(changeSummaryTotals.opening_original) }} → 期末 ¥{{ fmtAmt(changeSummaryTotals.closing_original) }}
          </span>
        </div>
        <el-table ref="t6Ref" :data="changeSummaryRows" size="small" border stripe max-height="380" show-summary
          :summary-method="changeSummaryMethod" @header-dragend="t6Drag">
          <el-table-column label="类别" prop="category_name" min-width="120" :width="t6Widths.category_name" />
          <el-table-column label="期初数量" prop="opening_count" :width="t6Cw('opening_count', 90)" align="center" />
          <el-table-column label="期初原值" prop="opening_original" :width="t6Cw('opening_original', 130)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.opening_original) }}</template>
          </el-table-column>
          <el-table-column label="本期增加(数量)" prop="increase_count" :width="t6Cw('increase_count', 120)" align="center">
            <template #default="{ row }">
              <el-link v-if="row.increase_count > 0" type="success" @click="showChangeDetail(row, 'increase')">
                {{ row.increase_count }}
              </el-link>
              <span v-else>0</span>
            </template>
          </el-table-column>
          <el-table-column label="本期增加(金额)" prop="increase_amount" :width="t6Cw('increase_amount', 140)" align="right">
            <template #default="{ row }">
              <span :class="row.increase_amount > 0 ? 'incr' : ''">{{ fmtAmt(row.increase_amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="本期减少(数量)" prop="decrease_count" :width="t6Cw('decrease_count', 120)" align="center">
            <template #default="{ row }">
              <el-link v-if="row.decrease_count > 0" type="danger" @click="showChangeDetail(row, 'decrease')">
                {{ row.decrease_count }}
              </el-link>
              <span v-else>0</span>
            </template>
          </el-table-column>
          <el-table-column label="本期减少(金额)" prop="decrease_amount" :width="t6Cw('decrease_amount', 140)" align="right">
            <template #default="{ row }">
              <span :class="row.decrease_amount > 0 ? 'decr' : ''">{{ fmtAmt(row.decrease_amount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="期末数量" prop="closing_count" :width="t6Cw('closing_count', 90)" align="center" />
          <el-table-column label="期末原值" prop="closing_original" :width="t6Cw('closing_original', 130)" align="right">
            <template #default="{ row }">{{ fmtAmt(row.closing_original) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!changeSummaryRows.length && changeSummaryLoaded" description="所选期间无增减变动数据" />

        <!-- 变动明细弹窗 -->
        <el-dialog v-model="changeDetailVisible" :title="changeDetailTitle" width="800px" draggable>
          <el-table :data="changeDetailRows" size="small" border stripe max-height="400">
            <el-table-column label="资产编号" prop="asset_no" width="110" />
            <el-table-column label="资产名称" prop="asset_name" min-width="140" show-overflow-tooltip />
            <el-table-column label="类别" prop="category_name" width="100" />
            <el-table-column label="使用部门" prop="dept_name" width="100" />
            <el-table-column label="变动性质" prop="change_item" width="100" />
            <el-table-column label="金额" prop="original_value" width="120" align="right">
              <template #default="{ row }">{{ fmtAmt(row.original_value) }}</template>
            </el-table-column>
            <el-table-column label="日期" prop="change_date" width="105" />
          </el-table>
        </el-dialog>
      </el-tab-pane>

      <!-- 变动记录查询 -->
      <el-tab-pane label="变动记录" name="changes">
        <div class="filter-bar">
          <el-date-picker v-model="changesPeriod" type="month" value-format="YYYY-MM" placeholder="筛选期间" clearable style="width:140px" @change="queryChanges" />
          <el-input v-model="changesAssetNo" placeholder="资产编号" clearable style="width:150px" @keyup.enter="queryChanges" />
          <el-button type="primary" @click="queryChanges" size="small">查询</el-button>
          <FilterClearButton size="small" @clear="handleClearChangesFilters" />
        </div>
        <el-table ref="t7Ref" :data="changeRecordRows" size="small" border stripe max-height="360" @header-dragend="t7Drag">
          <el-table-column label="日期" prop="change_date" :width="t7Cw('change_date', 100)" />
          <el-table-column label="资产编号" prop="asset_no" :width="t7Cw('asset_no', 110)" />
          <el-table-column label="资产名称" prop="asset_name" min-width="130" :width="t7Widths.asset_name" show-overflow-tooltip />
          <el-table-column label="类别" prop="category_name" :width="t7Cw('category_name', 90)" />
          <el-table-column label="变动项目" prop="change_item" :width="t7Cw('change_item', 120)" />
          <el-table-column label="旧值" prop="old_value" :width="t7Cw('old_value', 110)" align="right">
            <template #default="{ row }">{{ row.old_value != null ? fmtAmt(row.old_value) : '-' }}</template>
          </el-table-column>
          <el-table-column label="新值" prop="new_value" :width="t7Cw('new_value', 110)" align="right">
            <template #default="{ row }">{{ row.new_value != null ? fmtAmt(row.new_value) : '-' }}</template>
          </el-table-column>
          <el-table-column label="增减金额" prop="amount" :width="t7Cw('amount', 110)" align="right">
            <template #default="{ row }">
              <span v-if="row.amount != null" :class="row.amount > 0 ? 'incr' : 'decr'">
                {{ row.amount > 0 ? '+' : '' }}{{ fmtAmt(row.amount) }}
              </span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作人" prop="operator" :width="t7Cw('operator', 80)" />
          <el-table-column label="备注" prop="remark" min-width="100" :width="t7Widths.remark" show-overflow-tooltip />
        </el-table>
        <div class="table-footer" v-if="changesTotal > 0">
          <el-pagination v-model:current-page="changesPage" :page-size="changesPageSize" :total="changesTotal"
            :page-sizes="[20, 50]" layout="total, prev, pager, next" size="small" @change="loadChanges" />
        </div>
        <el-empty v-if="!changeRecordRows.length && changesLoaded" description="无变动记录" />
      </el-tab-pane>

      <!-- 折旧预测表 -->
      <el-tab-pane label="折旧预测" name="depr-forecast">
        <div class="filter-bar">
          <span>预测未来</span>
          <el-input-number v-model="forecastMonths" :min="1" :max="60" style="width:100px" @change="loadForecast" />
          <span>个月</span>
          <el-button type="primary" size="small" @click="loadForecast">查询</el-button>
        </div>
        <el-table ref="t8Ref" :data="forecastRows" size="small" border stripe max-height="380" show-summary
          :summary-method="forecastSummaryMethod" @header-dragend="t8Drag">
          <el-table-column label="预测期间" prop="period" :width="t8Cw('period', 100)" />
          <el-table-column label="资产数量" prop="asset_count" :width="t8Cw('asset_count', 90)" align="center" />
          <el-table-column label="预测折旧额" prop="total_depr" :width="t8Cw('total_depr', 140)" align="right">
            <template #default="{ row }"><span class="depr-amt">{{ fmtAmt(row.total_depr) }}</span></template>
          </el-table-column>
          <el-table-column label="明细" column-key="details" min-width="200" :width="t8Widths.details">
            <template #default="{ row }">
              <div class="forecast-details">
                <el-tag v-for="d in row.details.slice(0, 5)" :key="d.asset_no" size="small" effect="plain" style="margin:1px">
                  {{ d.asset_name }} ¥{{ fmtAmt(d.month_depr) }}
                </el-tag>
                <span v-if="row.details.length > 5" class="more-hint">
                  ...等 {{ row.details.length }} 项
                </span>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!forecastRows.length && forecastLoaded" description="暂无预测数据（所有资产可能已提完折旧）" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  fixedAssetApi,
  type DeprSummaryRow,
  type DeprAllocationRow,
  type CategorySummaryRow,
  type DeptSummaryRow,
  type ExpiryWarningRow,
  type ChangeSummaryRow,
  type ChangeDetailRow,
  type ChangeRecordRow,
  type ForecastRow,
  DEPR_METHODS,
} from '@/api/fixedAsset'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'

// 各报表 Tab 表格列宽记忆
const { tableRef: t1Ref, colWidth: t1Cw, onDragEnd: t1Drag, widths: t1Widths } = useListColumnWidth('asset_rpt_depr_summary')
const { tableRef: t2Ref, colWidth: t2Cw, onDragEnd: t2Drag, widths: t2Widths } = useListColumnWidth('asset_rpt_depr_alloc')
const { tableRef: t3Ref, colWidth: t3Cw, onDragEnd: t3Drag, widths: t3Widths } = useListColumnWidth('asset_rpt_cat_summary')
const { tableRef: t4Ref, colWidth: t4Cw, onDragEnd: t4Drag, widths: t4Widths } = useListColumnWidth('asset_rpt_dept_summary')
const { tableRef: t5Ref, colWidth: t5Cw, onDragEnd: t5Drag, widths: t5Widths } = useListColumnWidth('asset_rpt_expiry')
const { tableRef: t6Ref, colWidth: t6Cw, onDragEnd: t6Drag, widths: t6Widths } = useListColumnWidth('asset_rpt_change_summary')
const { tableRef: t7Ref, colWidth: t7Cw, onDragEnd: t7Drag, widths: t7Widths } = useListColumnWidth('asset_rpt_changes')
const { tableRef: t8Ref, colWidth: t8Cw, onDragEnd: t8Drag, widths: t8Widths } = useListColumnWidth('asset_rpt_forecast')

const now = new Date()
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

const REPORT_TABS = ['depr-summary', 'depr-allocation', 'category-summary', 'dept-summary', 'expiry-warning', 'change-summary', 'changes', 'depr-forecast']
const route = useRoute()
const initialTab = typeof route.query.tab === 'string' && REPORT_TABS.includes(route.query.tab) ? route.query.tab : 'depr-summary'
const activeTab = ref(initialTab)
const dictStatus = ref<{ code: string; name: string }[]>([])

const fmtAmt = (v: number) =>
  v == null || v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── 折旧汇总表 ──────────────────────────────────────────
const deprSummaryPeriod = ref(thisMonth)
const deprSummaryGroupBy = ref('category')
const deprSummaryRows = ref<DeprSummaryRow[]>([])
const deprSummaryTotal = ref(0)
const deprSummaryLoaded = ref(false)

const deprDetailVisible = ref(false)
const deprDetailTitle = ref('')
const deprDetailRows = ref<any[]>([])

async function loadDeprSummary() {
  if (!deprSummaryPeriod.value) return
  const [y, m] = deprSummaryPeriod.value.split('-').map(Number)
  const res = await fixedAssetApi.getDeprSummary({ year: y, month: m, group_by: deprSummaryGroupBy.value })
  if (res.code === 0) {
    deprSummaryRows.value = res.data.rows
    deprSummaryTotal.value = res.data.totalMonthDepr
    deprSummaryLoaded.value = true
  }
}

async function showDeprSummaryDetail(row: DeprSummaryRow) {
  if (!row.group_code) return
  const [y, m] = deprSummaryPeriod.value.split('-').map(Number)
  const label = deprSummaryGroupBy.value === 'category' ? '类别' : '部门'
  deprDetailTitle.value = `${label}「${row.group_name || row.group_code}」折旧明细`
  const res = await fixedAssetApi.getDeprSummaryDetail({ year: y, month: m, group_by: deprSummaryGroupBy.value, group_code: row.group_code! })
  if (res.code === 0) deprDetailRows.value = res.data
  deprDetailVisible.value = true
}

// ── 折旧分配表 ──────────────────────────────────────────
const deprAllocPeriod = ref(thisMonth)
const deprAllocRows = ref<DeprAllocationRow[]>([])
const deprAllocTotal = ref(0)
const deprAllocLoaded = ref(false)

const deprAllocDetailVisible = ref(false)
const deprAllocDetailAccount = ref('')
const deprAllocDetailRows = ref<any[]>([])

async function loadDeprAllocation() {
  if (!deprAllocPeriod.value) return
  const [y, m] = deprAllocPeriod.value.split('-').map(Number)
  const res = await fixedAssetApi.getDeprAllocation({ year: y, month: m })
  if (res.code === 0) {
    deprAllocRows.value = res.data.rows
    deprAllocTotal.value = res.data.totalDepr
    deprAllocLoaded.value = true
  }
}

async function showDeprAllocDetail(row: DeprAllocationRow) {
  if (!row.expense_account) return
  const [y, m] = deprAllocPeriod.value.split('-').map(Number)
  deprAllocDetailAccount.value = row.expense_account
  const res = await fixedAssetApi.getDeprAllocationDetail({ year: y, month: m, expense_account: row.expense_account })
  if (res.code === 0) deprAllocDetailRows.value = res.data
  deprAllocDetailVisible.value = true
}

// ── 资产分类汇总表 ──────────────────────────────────────
const catSummaryStatus = ref('')
const catSummaryRows = ref<CategorySummaryRow[]>([])
const catSummaryTotals = ref<Record<string, number>>({})

async function loadCategorySummary() {
  const res = await fixedAssetApi.getCategorySummary({ status_code: catSummaryStatus.value || undefined })
  if (res.code === 0) {
    catSummaryRows.value = res.data.rows
    catSummaryTotals.value = res.data.totals
  }
}

function catSummaryMethod({ columns, data }: any) {
  const sums: string[] = []
  columns.forEach((col: any, i: number) => {
    if (i === 0) sums[i] = '合计'
    else if (['asset_count', 'total_original', 'total_accum_depr', 'total_net_value'].includes(col.property)) {
      sums[i] = fmtAmt(data.reduce((s: number, r: any) => s + (r[col.property] ?? 0), 0))
      if (col.property === 'asset_count') sums[i] = String(data.reduce((s: number, r: any) => s + (r[col.property] ?? 0), 0))
    } else sums[i] = ''
  })
  return sums
}

// ── 部门资产汇总表 ──────────────────────────────────────
const deptSummaryStatus = ref('')
const deptSummaryRows = ref<DeptSummaryRow[]>([])

async function loadDeptSummary() {
  const res = await fixedAssetApi.getDeptSummary({ status_code: deptSummaryStatus.value || undefined })
  if (res.code === 0) deptSummaryRows.value = res.data.rows
}

const deptSummaryMethod = catSummaryMethod

// ── 到期提示表 ──────────────────────────────────────────
const expiryWithinMonths = ref(3)
const expiryWarningRows = ref<ExpiryWarningRow[]>([])
const expiryLoaded = ref(false)

async function loadExpiryWarning() {
  const res = await fixedAssetApi.getExpiryWarning({ within_months: expiryWithinMonths.value })
  if (res.code === 0) {
    expiryWarningRows.value = res.data
    expiryLoaded.value = true
  }
}

// ── 资产增减变动表 ──────────────────────────────────────
const changeSummaryPeriod = ref(thisMonth)
const changeSummaryRows = ref<ChangeSummaryRow[]>([])
const changeSummaryTotals = ref<Record<string, number>>({})
const changeSummaryLoaded = ref(false)

const changeDetailVisible = ref(false)
const changeDetailTitle = ref('')
const changeDetailRows = ref<ChangeDetailRow[]>([])

async function loadChangeSummary() {
  if (!changeSummaryPeriod.value) return
  const [y, m] = changeSummaryPeriod.value.split('-').map(Number)
  const res = await fixedAssetApi.getChangeSummary({ year: y, month: m })
  if (res.code === 0) {
    changeSummaryRows.value = res.data.rows
    changeSummaryTotals.value = res.data.totals
    changeSummaryLoaded.value = true
  }
}

async function showChangeDetail(row: ChangeSummaryRow, type: string) {
  const [y, m] = changeSummaryPeriod.value.split('-').map(Number)
  const label = type === 'increase' ? '增加' : '减少'
  changeDetailTitle.value = `${row.category_name || '未分类'} — 本期${label}明细`
  const res = await fixedAssetApi.getChangeDetail({ year: y, month: m, type, category_code: row.category_code ?? undefined })
  if (res.code === 0) changeDetailRows.value = res.data
  changeDetailVisible.value = true
}

function changeSummaryMethod({ columns, data }: any) {
  const sums: string[] = []
  columns.forEach((col: any, i: number) => {
    if (i === 0) sums[i] = '合计'
    else if (col.property === 'opening_count' || col.property === 'closing_count') {
      sums[i] = String(data.reduce((s: number, r: any) => s + (r[col.property] ?? 0), 0))
    } else if (col.property) {
      sums[i] = fmtAmt(data.reduce((s: number, r: any) => s + (r[col.property] ?? 0), 0))
    } else sums[i] = ''
  })
  return sums
}

// ── 变动记录查询 ──────────────────────────────────────────
const changesPeriod = ref('')
const changesAssetNo = ref('')
const changeRecordRows = ref<ChangeRecordRow[]>([])
const changesTotal = ref(0)
const changesPage = ref(1)
const changesPageSize = ref(20)
const changesLoaded = ref(false)
const { clearFilters: clearChangesFilters } = useFilterClear([changesPeriod, changesAssetNo])

/** 清空变动记录筛选条件并恢复默认查询 */
function handleClearChangesFilters() {
  clearChangesFilters()
  changesPage.value = 1
  queryChanges()
}

async function loadChanges() {
  const params: any = { page: changesPage.value, page_size: changesPageSize.value }
  if (changesPeriod.value) {
    const [y, m] = changesPeriod.value.split('-').map(Number)
    params.year = y
    params.month = m
  }
  if (changesAssetNo.value) params.asset_no = changesAssetNo.value
  const res = await fixedAssetApi.getGlobalChanges(params)
  if (res.code === 0) {
    const maxPage = Math.max(1, Math.ceil((res.data as any).total / changesPageSize.value))
    if ((res.data as any).rows.length === 0 && (res.data as any).total > 0 && changesPage.value > maxPage) {
      changesPage.value = maxPage
      await loadChanges()
      return
    }
    changeRecordRows.value = (res.data as any).rows
    changesTotal.value = (res.data as any).total
    changesLoaded.value = true
  }
}

function queryChanges() {
  changesPage.value = 1
  return loadChanges()
}

// ── 折旧预测 ──────────────────────────────────────────
const forecastMonths = ref(12)
const forecastRows = ref<ForecastRow[]>([])
const forecastLoaded = ref(false)

async function loadForecast() {
  const res = await fixedAssetApi.getDeprForecast(forecastMonths.value)
  if (res.code === 0) {
    forecastRows.value = res.data
    forecastLoaded.value = true
  }
}

function forecastSummaryMethod({ columns, data }: any) {
  const sums: string[] = []
  columns.forEach((col: any, i: number) => {
    if (i === 0) sums[i] = '合计'
    else if (col.property === 'asset_count') {
      sums[i] = String(data.reduce((s: number, r: any) => s + r.asset_count, 0))
    } else if (col.property === 'total_depr') {
      sums[i] = fmtAmt(data.reduce((s: number, r: any) => s + r.total_depr, 0))
    } else sums[i] = ''
  })
  return sums
}

// ── 初始化 ──────────────────────────────────────────────
onMounted(async () => {
  // 获取资产状态字典（供筛选用）
  const dictRes = await fixedAssetApi.getDicts()
  if (dictRes.code === 0) dictStatus.value = dictRes.data.status

  loadDeprSummary()
  loadDeprAllocation()
  loadCategorySummary()
  loadDeptSummary()
  loadExpiryWarning()
  loadChangeSummary()
  loadChanges()
  loadForecast()
})
</script>

<style scoped>
.page-asset-report { display: flex; flex-direction: column; height: 100%; }
.report-tabs { flex: 1; display: flex; flex-direction: column; padding: 0 16px; overflow: hidden; }
.report-tabs :deep(.el-tabs__content) { flex: 1; overflow: auto; padding-top: 8px; }
.filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.filter-hint { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.total-amt { color: #e6a23c; }
.depr-amt { color: #409eff; font-weight: 600; }
.incr { color: #67c23a; font-weight: 500; }
.decr { color: #f56c6c; font-weight: 500; }
.table-footer { padding: 8px 0; display: flex; justify-content: flex-end; }
.forecast-details { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.more-hint { font-size: 12px; color: var(--el-text-color-placeholder); margin-left: 4px; }
:deep(.el-table__row) { cursor: pointer; }
</style>
