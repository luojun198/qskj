<template>
  <div class="page bvc-page">
    <!-- 顶部导航 -->
    <div class="bvc-header">
      <div class="bvc-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="bvc-header__sep">/</span>
        <span class="bvc-header__title">财务总账 / 业务凭证中心</span>
        <el-tag v-if="pendingTotal > 0" type="warning" size="small" style="margin-left:8px">待生成 {{ pendingTotal }}</el-tag>
        <el-tag v-else-if="summary" type="success" size="small" effect="plain" style="margin-left:8px">业务凭证已全部生成</el-tag>
      </div>
    </div>

    <div class="bvc-main">
      <!-- 左侧来源导航 -->
      <aside class="bvc-nav">
        <div
          v-for="tab in tabs"
          :key="tab.key"
          class="bvc-nav__item"
          :class="{ 'is-active': activeTab === tab.key }"
          @click="switchTab(tab.key)"
        >
          <el-icon class="bvc-nav__icon"><component :is="tab.icon" /></el-icon>
          <span class="bvc-nav__text">
            <span class="bvc-nav__title">{{ tab.title }}</span>
            <span class="bvc-nav__desc">{{ tab.desc }}</span>
          </span>
          <el-badge v-if="tab.badge" :value="tab.badge" type="warning" class="bvc-nav__badge" />
        </div>
        <div v-if="canSetting" class="bvc-nav__item bvc-nav__setting" @click="router.push('/base/scm-voucher-setting')">
          <el-icon class="bvc-nav__icon"><Setting /></el-icon>
          <span class="bvc-nav__text">
            <span class="bvc-nav__title">凭证设置</span>
            <span class="bvc-nav__desc">科目、辅助对应、摘要预设</span>
          </span>
          <el-badge v-if="auxPending" :value="auxPending" type="danger" class="bvc-nav__badge" />
        </div>
        <div class="bvc-nav__tip">
          业务单据审核后在这里统一生成凭证；生成的凭证到「凭证审核」「凭证过账」按正常流程处理。删除凭证后业务恢复为待生成，可重新生成。
        </div>
      </aside>

      <section class="bvc-content" v-loading="loading">
        <!-- 本次处理结果 -->
        <el-alert v-if="lastResult" :type="lastResult.failed ? 'warning' : 'success'" show-icon :closable="true" class="bvc-result" @close="lastResult = null">
          <template #title>
            {{ lastResult.title }}：成功 {{ lastResult.ok }} 项<span v-if="lastResult.failed">，失败 {{ lastResult.failed }} 项</span>
            <el-button v-if="lastResult.failed" link type="primary" size="small" @click="resultExpanded = !resultExpanded">
              {{ resultExpanded ? '收起' : '查看失败原因' }}
            </el-button>
            <el-button v-if="lastResult.failed > FAILED_SHOW_MAX" link size="small" @click="exportFailed">导出失败清单</el-button>
          </template>
          <ul v-if="resultExpanded && lastResult.failed" class="bvc-result__list">
            <li v-for="(item, i) in failedShown" :key="i">
              <b>{{ item.label }}</b>：{{ item.message }}
              <el-button v-if="item.link" link type="primary" size="small" @click="router.push(item.link.to)">{{ item.link.text }}</el-button>
            </li>
            <li v-if="lastResult.failed > FAILED_SHOW_MAX" class="bvc-muted">还有 {{ lastResult.failed - FAILED_SHOW_MAX }} 条失败未显示，请「导出失败清单」查看全部</li>
          </ul>
        </el-alert>

        <!-- 总览 -->
        <template v-if="activeTab === 'overview'">
          <div class="bvc-toolbar">
            <span class="bvc-muted">业务期间</span>
            <el-date-picker
              v-model="monthRange"
              type="monthrange"
              value-format="YYYY-MM"
              range-separator="至"
              start-placeholder="全部"
              end-placeholder="期间"
              size="small"
              style="width:220px"
              clearable
              @change="reloadAll"
            />
            <el-button size="small" :loading="loading" @click="reloadAll">刷新</el-button>
          </div>
          <div class="bvc-hint">各业务模块的凭证生成情况。点「去处理」进入对应来源，可勾选批量生成、删除后重新生成。</div>
          <div class="bvc-cards">
            <div v-for="card in overviewCards" :key="card.key" class="bvc-card">
              <div class="bvc-card__head">
                <el-icon class="bvc-card__icon"><component :is="card.icon" /></el-icon>
                <span class="bvc-card__title">{{ card.title }}</span>
              </div>
              <div class="bvc-card__nums">
                <div class="bvc-card__num is-pending"><span>{{ card.count.pending }}</span>待生成</div>
                <div class="bvc-card__num"><span>{{ card.count.generated }}</span>已生成</div>
              </div>
              <div class="bvc-card__desc">{{ card.desc }}</div>
              <el-button type="primary" size="small" plain @click="switchTab(card.key)">去处理</el-button>
            </div>
            <el-empty v-if="!overviewCards.length && summary" description="当前用户没有可处理的业务凭证来源（进销存 / 出纳 / 固定资产）" />
          </div>
          <div class="bvc-flow">
            <span>业务单据审核</span><el-icon><Right /></el-icon>
            <span class="is-strong">业务凭证中心生成凭证</span><el-icon><Right /></el-icon>
            <span>凭证审核</span><el-icon><Right /></el-icon>
            <span>凭证过账</span><el-icon><Right /></el-icon>
            <span>账簿 / 报表</span>
          </div>
        </template>

        <!-- 来源列表 -->
        <template v-else>
          <div class="bvc-toolbar">
            <el-radio-group v-model="status" size="small" @change="reloadList">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="pending">待生成</el-radio-button>
              <el-radio-button value="generated">已生成</el-radio-button>
            </el-radio-group>
            <el-select v-if="activeTab === 'scm'" v-model="scmDocType" size="small" placeholder="全部单据类型" style="width:150px" @change="reloadList" :empty-values="[null, undefined]">
              <el-option label="全部单据类型" value="" />
              <el-option v-for="t in summary?.scm_doc_types || []" :key="t" :label="SCM_TYPE_NAMES[t] || t" :value="t" />
            </el-select>
            <el-select v-if="activeTab === 'asset'" v-model="assetKind" size="small" placeholder="全部业务类型" style="width:140px" @change="reloadList" :empty-values="[null, undefined]">
              <el-option label="全部业务类型" value="" />
              <el-option v-for="(name, code) in ASSET_VOUCHER_KIND_LABELS" :key="code" :label="name" :value="code" />
            </el-select>
            <span class="bvc-muted">业务期间</span>
            <el-date-picker
              v-model="monthRange"
              type="monthrange"
              value-format="YYYY-MM"
              range-separator="至"
              start-placeholder="全部"
              end-placeholder="期间"
              size="small"
              style="width:220px"
              clearable
              @change="reloadAll"
            />
            <el-button size="small" :loading="loading" @click="reloadAll">刷新</el-button>
            <el-input v-model="keyword" size="small" clearable :placeholder="keywordPlaceholder" style="width:200px" @keyup.enter="reloadList" @clear="reloadList" />
            <el-button size="small" @click="reloadList">查询</el-button>
            <span class="bvc-toolbar__spacer" />
            <span v-if="selection.length" class="bvc-selected">{{ allSelection ? `已选中全部 ${selection.length} 项（所有分页）` : `已选 ${selection.length} 项（本页）` }}</span>
            <template v-if="progress">
              <el-progress :percentage="progressPct" :stroke-width="14" style="width:200px" />
              <span class="bvc-muted">{{ progress.label }} {{ progress.done }} / {{ progress.total }}</span>
              <el-button size="small" :disabled="cancelRequested" @click="cancelRequested = true">{{ cancelRequested ? '正在取消…' : '取消' }}</el-button>
            </template>
            <template v-else>
              <el-button size="small" type="primary" :disabled="!selPending.length" :loading="working" @click="handleGenerate(selPending)">
                生成凭证{{ selPending.length ? `（${selPending.length}）` : '' }}
              </el-button>
              <el-button size="small" type="danger" plain :disabled="!selGenerated.length" :loading="working" @click="handleDelete(selGenerated)">
                删除凭证{{ selGenerated.length ? `（${selGenerated.length}）` : '' }}
              </el-button>
            </template>
          </div>

          <!-- 进销存 -->
          <el-table v-if="activeTab === 'scm'" :data="scmRows" size="small" border stripe height="100%" ref="tableRef" class="bvc-table" row-key="id" @selection-change="onSel">
            <el-table-column type="selection" width="40" />
            <el-table-column label="单据日期" prop="doc_date" width="100" />
            <el-table-column label="单据类型" width="100"><template #default="{ row }">{{ row.doc_type_name || row.doc_type }}</template></el-table-column>
            <el-table-column label="单据号" width="150">
              <template #default="{ row }"><el-button link type="primary" size="small" @click="openScmDoc(row)">{{ row.doc_no }}</el-button></template>
            </el-table-column>
            <el-table-column label="往来单位" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.partner_name || row.partner_code || '-' }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="right"><template #default="{ row }">{{ money(row.total_amount) }}</template></el-table-column>
            <el-table-column label="税额" width="90" align="right"><template #default="{ row }">{{ money(row.total_tax) }}</template></el-table-column>
            <el-table-column label="凭证" width="170">
              <template #default="{ row }">
                <span v-if="isExternal(row)" class="external-voucher">原系统已制证</span>
                <VoucherCell v-else :row="voucherCell(row.voucher_id, row.voucher_no, row.voucher_status, row.voucher_year, row.voucher_period)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" align="center">
              <template #default="{ row }">
                <template v-if="isExternal(row)" />
                <el-button v-else-if="!row.voucher_id" link type="primary" size="small" @click="handleGenerate([row])">生成</el-button>
                <el-button v-else link type="danger" size="small" @click="handleDelete([row])">删除凭证</el-button>
                <el-button link size="small" @click="openScmDoc(row)">单据</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 出纳 -->
          <el-table v-else-if="activeTab === 'cashier'" :data="cashierRows" size="small" border stripe height="100%" ref="tableRef" class="bvc-table" row-key="id" @selection-change="onSel">
            <el-table-column type="selection" width="40" />
            <el-table-column label="日期" prop="biz_date" width="100" />
            <el-table-column label="出纳账户" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.account_code }} {{ row.account_name || '' }}</template>
            </el-table-column>
            <el-table-column label="摘要" prop="summary" min-width="180" show-overflow-tooltip />
            <el-table-column label="收入" width="110" align="right"><template #default="{ row }">{{ money(row.debit) }}</template></el-table-column>
            <el-table-column label="支出" width="110" align="right"><template #default="{ row }">{{ money(row.credit) }}</template></el-table-column>
            <el-table-column label="对方科目" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.counter_account">{{ row.counter_account }} {{ row.counter_account_name || '' }}</span>
                <span v-else class="bvc-danger">未填（生成会失败）</span>
              </template>
            </el-table-column>
            <el-table-column label="凭证" width="170"><template #default="{ row }"><VoucherCell :row="voucherCell(row.voucher_id, row.voucher_no, row.voucher_status, row.voucher_year, row.voucher_month)" /></template></el-table-column>
            <el-table-column label="操作" width="120" align="center">
              <template #default="{ row }">
                <el-button v-if="!isGenerated(row)" link type="primary" size="small" @click="handleGenerate([row])">生成</el-button>
                <el-button v-else link type="danger" size="small" @click="handleDelete([row])">删除凭证</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 固定资产 -->
          <el-table v-else-if="activeTab === 'asset'" :data="assetRows" size="small" border stripe height="100%" ref="tableRef" class="bvc-table" :row-key="assetRowKey" @selection-change="onSel">
            <el-table-column type="selection" width="40" />
            <el-table-column label="期间" width="90"><template #default="{ row }">{{ row.year ? `${row.year}-${String(row.period).padStart(2, '0')}` : '-' }}</template></el-table-column>
            <el-table-column label="业务类型" width="100"><template #default="{ row }">{{ ASSET_VOUCHER_KIND_LABELS[row.kind as AssetVoucherKind] }}</template></el-table-column>
            <el-table-column label="业务" prop="title" min-width="200" show-overflow-tooltip />
            <el-table-column label="资产" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ [row.assetNo, row.assetName].filter(Boolean).join(' ') || '-' }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="right"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column>
            <el-table-column label="凭证" width="170"><template #default="{ row }"><VoucherCell :row="voucherCell(row.voucherId, row.voucherNo, row.voucherStatus, row.year, row.period)" /></template></el-table-column>
            <el-table-column label="操作" width="150" align="center">
              <template #default="{ row }">
                <template v-if="!row.hasVoucher">
                  <el-button link type="primary" size="small" :disabled="!!row.regenerateBlockReason" :title="row.regenerateBlockReason || ''" @click="handleGenerate([row])">生成</el-button>
                  <el-button link size="small" @click="router.push({ path: '/asset/vouchers/regenerate', query: { kind: row.kind, ref: row.refId } })">指定科目</el-button>
                </template>
                <el-button v-else link type="danger" size="small" :disabled="!!row.deleteBlockReason" :title="row.deleteBlockReason || ''" @click="handleDelete([row])">删除凭证</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="bvc-pager">
            <el-pagination
              v-model:current-page="page"
              v-model:page-size="pageSize"
              :total="total"
              :page-sizes="[50, 100, 200]"
              size="small"
              layout="total, sizes, prev, pager, next"
              @current-change="loadList"
              @size-change="reloadList"
            />
          </div>
        </template>
      </section>
    </div>

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="reloadAll" />

    <!-- 进销存多张单据生成方式（轻量选择器） -->
    <el-dialog v-model="genModeVisible" :title="showGenModes ? '选择生成方式' : '生成凭证'" width="440px" append-to-body>
      <div class="bvc-gen-type">
        <span>凭证类型</span>
        <VoucherTypeSelect v-model="genVoucherType" :default-label="genTypeDefaultLabel" width="240px" />
      </div>
      <template v-if="showGenModes">
        <el-radio-group v-model="genMode" class="bvc-gen-modes">
          <el-radio value="all">所选单据汇总生成一张凭证</el-radio>
          <el-radio value="date">所选单据按日期汇总生成凭证</el-radio>
          <el-radio value="partner">所选单据按客商汇总生成凭证</el-radio>
          <el-radio value="single">每张单生成一张凭证</el-radio>
        </el-radio-group>
        <div class="bvc-gen-modes__hint">
          共 {{ genModePending.length }} 张单据。汇总时同科目、同方向、同辅助项的分录合并；凭证不能跨期，跨月的单据按月份分别生成。
        </div>
      </template>
      <div v-else class="bvc-gen-modes__hint">为选中的 {{ genModePending.length }} 项业务生成记账凭证，凭证日期取业务日期。</div>
      <template #footer>
        <el-button type="primary" @click="confirmGenMode">立即生成</el-button>
        <el-button @click="genModeVisible = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { ElButton, ElMessage, ElMessageBox, ElTag } from 'element-plus'
import { ArrowLeft, Right, DataBoard, ShoppingCart, Wallet, OfficeBuilding, Setting } from '@element-plus/icons-vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { useUserStore } from '@/stores/user'
import { useBaseDataStore } from '@/stores/baseData'
import VoucherTypeSelect from '@/components/voucher/VoucherTypeSelect.vue'
import { readStoredVoucherType, storeVoucherType } from '@/utils/voucherTypePick'
import { useSystemParamsStore } from '@/stores/systemParams'
import { bizVoucherCenterApi, type BizScmGenMode, type BizScmDocRow, type BizVoucherStatus, type BizVoucherSummary } from '@/api/bizVoucherCenter'
import { cashierApi, type CashierSearchRow } from '@/api/cashier'
import { fixedAssetApi, ASSET_VOUCHER_KIND_LABELS, type AssetVoucherKind, type AssetVoucherRow } from '@/api/fixedAsset'
import { scmVoucherSettingApi, type ScmAuxProblem } from '@/api/scmVoucherSetting'
import { handleScmAuxUnmatched, SCM_VOUCHER_TYPE_STORAGE_KEY } from '@/utils/scmVoucherAux'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'
import { confirmRenumberAfterDelete, type RenumberGroup } from '@/composables/useRenumberPrompt'

type TabKey = 'overview' | 'scm' | 'cashier' | 'asset'

const route = useRoute()
const router = useRouter()
const systemParams = useSystemParamsStore()
const baseData = useBaseDataStore()
const userStore = useUserStore()

const SCM_TYPE_NAMES: Record<string, string> = {
  PI: '采购入库', PR: '采购退货', RP: '采购发票', SO: '销售发货', SR: '销售退货', RS: '销售发票',
  RCV: '收款单', PAY: '付款单', IS: '期初入库', OI: '其他入库', OO: '其他出库',
  PL: '生产领用', PB: '补料单', PF: '完工入库', PS: '不良品入库', PJ: '退料单', CA: '结案结转', AS: '组装单', DS: '拆卸单',
  WO: '委外发货', WI: '委外入库', OP: '工序委外单',
}
const VOUCHER_STATUS: Record<string, { label: string; type: 'info' | 'warning' | 'success' }> = {
  draft: { label: '未审核', type: 'info' },
  audited: { label: '已审核', type: 'warning' },
  posted: { label: '已记账', type: 'success' },
}

const loading = ref(false)
const working = ref(false)
const summary = ref<BizVoucherSummary | null>(null)
const auxPending = ref(0)
const monthRange = ref<[string, string] | null>(null)
const activeTab = ref<TabKey>('overview')
const status = ref<BizVoucherStatus>('all')
const scmDocType = ref('')
const assetKind = ref<AssetVoucherKind | ''>('')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(50)
const total = ref(0)
const scmRows = ref<BizScmDocRow[]>([])
const cashierRows = ref<CashierSearchRow[]>([])
const assetRows = ref<AssetVoucherRow[]>([])
const tableSelection = ref<any[]>([])            // 当前页表格勾选
const allSelection = ref<any[] | null>(null)       // 「选择所有分页」后的全部记录（跨页）
const selection = computed(() => allSelection.value ?? tableSelection.value)
const selectingAll = ref(false)

// 批量处理：分批提交 + 进度 + 可取消（后端单次同步处理，批太大会长时间占住服务）
const SCM_BATCH = 50          // 进销存每批单据数（后端上限 200）
const SCM_MERGE_BATCH = 2000 // 进销存汇总生成一次提交上限（与后端一致）
const CASHIER_BATCH = 200     // 出纳每批流水数
const MAX_SELECT_ALL = 2000   // 「全选所有分页」上限，超出请缩小筛选范围
const FAILED_SHOW_MAX = 50    // 结果区最多展示的失败条数
const progress = ref<{ label: string; done: number; total: number } | null>(null)
const cancelRequested = ref(false)
const progressPct = computed(() => (progress.value && progress.value.total ? Math.min(100, Math.round((progress.value.done / progress.value.total) * 100)) : 0))
function startProgress(label: string, total: number) { cancelRequested.value = false; progress.value = { label, done: 0, total } }
function tickProgress(n: number) { if (progress.value) progress.value.done += n }
function endProgress() { progress.value = null; cancelRequested.value = false }
const cancelledItem = (left: number): ResultItem => ({ label: '已取消', ok: false, message: `剩余 ${left} 项未处理，可重新选择后继续` })
const tableRef = ref<{ clearSelection: () => void; toggleAllSelection: () => void } | null>(null)
const currentRows = computed<any[]>(() => (activeTab.value === 'scm' ? scmRows.value : activeTab.value === 'cashier' ? cashierRows.value : assetRows.value))
const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)

interface ResultItem { label: string; ok: boolean; message?: string; link?: { text: string; to: RouteLocationRaw } }
const lastResult = ref<{ title: string; ok: number; failed: number; items: ResultItem[] } | null>(null)
const resultExpanded = ref(false)
const failedItems = computed(() => (lastResult.value?.items || []).filter(x => !x.ok))
const failedShown = computed(() => failedItems.value.slice(0, FAILED_SHOW_MAX))
/** 导出全部失败清单（CSV，带 BOM 供 Excel 直接打开） */
function exportFailed() {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = [['对象', '失败原因'], ...failedItems.value.map(i => [i.label, i.message || ''])]
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${lastResult.value?.title || '处理结果'}-失败清单.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const canSetting = computed(() => userStore.permissions.includes('*') || userStore.permissions.includes('scm:param'))
const pendingTotal = computed(() => {
  const s = summary.value
  return s ? (s.scm?.pending || 0) + (s.cashier?.pending || 0) + (s.asset?.pending || 0) : 0
})

const SOURCES = [
  { key: 'scm' as const, title: '进销存单据', icon: ShoppingCart, desc: '采购、销售、库存、收付款、生产、委外单据（已审核）' },
  { key: 'cashier' as const, title: '出纳流水', icon: Wallet, desc: '出纳录单中的现金 / 银行流水，每条流水一张凭证' },
  { key: 'asset' as const, title: '固定资产', icon: OfficeBuilding, desc: '购置、折旧、变动 / 减值、处置、盘点' },
]
const overviewCards = computed(() => SOURCES.filter(s => summary.value?.[s.key]).map(s => ({ ...s, count: summary.value![s.key]! })))
const tabs = computed(() => [
  { key: 'overview' as TabKey, title: '总览', desc: '各来源待生成情况', icon: DataBoard, badge: 0 },
  ...overviewCards.value.map(c => ({ key: c.key as TabKey, title: c.title, desc: `待生成 ${c.count.pending} / 已生成 ${c.count.generated}`, icon: c.icon, badge: c.count.pending })),
])
const keywordPlaceholder = computed(() =>
  activeTab.value === 'scm' ? '单据号 / 往来单位 / 凭证号' : activeTab.value === 'cashier' ? '摘要' : '资产编号 / 名称 / 凭证号')

/** 业务期间 → 日期区间 */
const range = computed(() => {
  const r = monthRange.value
  if (!r || !r[0]) return {}
  const [ey, em] = r[1].split('-').map(Number)
  const last = new Date(ey, em, 0).getDate()
  return { start_date: `${r[0]}-01`, end_date: `${r[1]}-${String(last).padStart(2, '0')}` }
})

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
}
const isGenerated = (row: any) => !!(row.voucher_id || row.voucher_no)
/** 原系统导入（如润衡 ACD）的历史单据：原系统已制证，不能生成 / 删除凭证 */
const isExternal = (row: any) => !row.voucher_id && Number(row.external_voucher) === 1
const assetRowKey = (row: AssetVoucherRow) => `${row.kind}|${row.refId}`

/** 凭证单元格：凭证号（可点开）+ 状态 */
function voucherCell(id: string | null | undefined, no: unknown, st: string | null | undefined, year?: number | null, period?: number | null) {
  return { id: id || '', no: no == null || no === '' ? '' : String(no), status: st || '', year, period }
}
const VoucherCell = defineComponent({
  props: { row: { type: Object, required: true } },
  setup(props) {
    return () => {
      const r = props.row as ReturnType<typeof voucherCell>
      if (!r.id && !r.no) return h('span', { class: 'bvc-muted' }, '未生成')
      const st = VOUCHER_STATUS[r.status]
      const label = `${r.year && r.period ? `${r.year}-${String(r.period).padStart(2, '0')} ` : ''}${r.no || '查看'}`
      return h('span', { class: 'bvc-voucher' }, [
        r.id
          ? h(ElButton, { link: true, type: 'primary', size: 'small', onClick: () => entryDialogHostRef.value?.open({ id: r.id }) }, () => label)
          : h('span', label),
        st ? h(ElTag, { size: 'small', type: st.type, effect: 'plain', style: 'margin-left:4px' }, () => st.label) : null,
      ])
    }
  },
})

const selPending = computed(() => selection.value.filter(r => (activeTab.value === 'asset' ? !r.hasVoucher && !r.regenerateBlockReason : !isGenerated(r) && !isExternal(r))))
const selGenerated = computed(() => selection.value.filter(r => (activeTab.value === 'asset' ? r.hasVoucher && !r.deleteBlockReason : isGenerated(r))))
const onSel = (rows: any[]) => {
  tableSelection.value = rows
  // 跨页全选后用户又手动改了本页勾选：回到「只按勾选」
  if (allSelection.value && rows.length !== currentRows.value.length) allSelection.value = null
  // 与凭证审核页一致：表头全选了本页且还有其它分页，询问「全选所有 / 仅本页」
  if (!allSelection.value && rows.length > 0 && rows.length === currentRows.value.length && total.value > rows.length) {
    void askSelectScope()
  }
}

/** 全选范围二选一：全选所有分页 / 仅本页 */
async function askSelectScope() {
  if (total.value > MAX_SELECT_ALL) {
    // 超出上限不再静默截断：明确告知，保留本页勾选
    await ElMessageBox.alert(
      `按当前筛选共 ${total.value} 项，超过一次可全选的上限 ${MAX_SELECT_ALL} 项。已保留本页勾选；如需处理全部，请缩小筛选范围（期间 / 单据类型 / 关键字）后分批处理。`,
      '超出全选上限', { type: 'warning', confirmButtonText: '知道了' },
    ).catch(() => {})
    return
  }
  try {
    await ElMessageBox.confirm(
      `本页 ${tableSelection.value.length} 项已全选，按当前筛选共 ${total.value} 项（分多页），请选择全选范围：`,
      '全选范围',
      { confirmButtonText: `全选所有（${total.value} 项）`, cancelButtonText: '仅本页', type: 'info', distinguishCancelAndClose: true, closeOnClickModal: false },
    )
    await selectAllPages()
    ElMessage.success(`已选中全部 ${allSelection.value?.length ?? total.value} 项（所有分页）`)
  } catch (action) {
    // 「仅本页」保留当前页勾选；关闭弹窗视为取消全选
    if (action === 'close') tableRef.value?.clearSelection()
  }
}

/** 按当前筛选条件取某一页（loadList 与「选择全部」共用） */
async function fetchPage(pg: number, size: number): Promise<{ list: any[]; total: number }> {
  const base = { ...range.value, page: pg, page_size: size, keyword: keyword.value.trim() || undefined }
  if (activeTab.value === 'scm') {
    const r = (await bizVoucherCenterApi.scmDocs({ ...base, status: status.value, doc_type: scmDocType.value || undefined })).data
    return { list: r.list, total: r.total }
  }
  if (activeTab.value === 'cashier') {
    const voucher_status = status.value === 'pending' ? 'none' : status.value === 'generated' ? 'draft,audited,posted' : undefined
    // 收付款单直接制证模式：收付款单写入的流水在「进销存」页签处理，这里不列，避免两边重复制证
    await systemParams.load()
    const exclude_scm_payment = systemParams.paymentVoucherMode === 'cashier' ? undefined : 1
    const r = (await cashierApi.searchJournals({ ...base, summary: base.keyword, keyword: undefined, voucher_status, currency: 'ALL', exclude_scm_payment })).data
    return { list: r.list, total: r.total }
  }
  const r = (await bizVoucherCenterApi.assetItems({ ...base, status: status.value, kind: assetKind.value || undefined })).data
  return { list: r.list, total: r.total }
}

/** 选择所有分页：按当前筛选逐页取回全部记录 */
async function selectAllPages() {
  selectingAll.value = true
  try {
    const size = 200
    const all: any[] = []
    for (let pg = 1; pg <= Math.ceil(MAX_SELECT_ALL / size); pg++) {
      const r = await fetchPage(pg, size)
      all.push(...r.list)
      if (all.length >= r.total || !r.list.length) break
    }
    allSelection.value = all
  } finally {
    selectingAll.value = false
  }
}

const chunk = <T,>(arr: T[], n = 200): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

// ── 数据加载 ──────────────────────────────────────────────

async function loadSummary() {
  summary.value = (await bizVoucherCenterApi.summary(range.value)).data
  if (canSetting.value && summary.value.scm) {
    try {
      const p = (await scmVoucherSettingApi.get()).data.pending
      auxPending.value = p.partner + p.dept + p.person
    } catch { auxPending.value = 0 }
  }
}

async function loadList() {
  if (activeTab.value === 'overview') return
  loading.value = true
  tableSelection.value = []
  try {
    const r = await fetchPage(page.value, pageSize.value)
    if (activeTab.value === 'scm') scmRows.value = r.list
    else if (activeTab.value === 'cashier') cashierRows.value = r.list
    else assetRows.value = r.list
    total.value = r.total
  } finally {
    loading.value = false
  }
}
function reloadList() { page.value = 1; allSelection.value = null; return loadList() }
async function reloadAll() {
  loading.value = true
  try { await loadSummary() } finally { loading.value = false }
  await reloadList()
}

function switchTab(key: TabKey) {
  activeTab.value = key
  status.value = 'all'
  keyword.value = ''
  allSelection.value = null
  router.replace({ query: { ...route.query, tab: key } })
  void reloadList()
}

function openScmDoc(row: BizScmDocRow) {
  router.push(scmDocumentRoute(row.id, row.doc_type, 'audited'))
}

function showResult(title: string, items: ResultItem[]) {
  const ok = items.filter(i => i.ok).length
  lastResult.value = { title, ok, failed: items.length - ok, items }
  resultExpanded.value = items.length - ok > 0
  if (!lastResult.value.failed) ElMessage.success(`${title}：成功 ${ok} 项`)
}

// ── 生成 ──────────────────────────────────────────────────

// 进销存多张生成：先选生成方式（记住上次选择）
const GEN_MODE_KEY = 'bizVoucher:scmGenMode'
const genModeVisible = ref(false)
const genModePending = ref<any[]>([])
const genMode = ref<BizScmGenMode>(readGenMode())
function readGenMode(): BizScmGenMode {
  try {
    const v = localStorage.getItem(GEN_MODE_KEY)
    if (v === 'single' || v === 'all' || v === 'date' || v === 'partner') return v
  } catch { /* 无痕 / 禁用存储 */ }
  return 'all'
}
// 凭证类型：按页签分别记住（进销存与单据页共用同一个记忆键）；空 = 各模块默认设置
const genVoucherType = ref('')
const voucherTypeKey = () => activeTab.value === 'scm' ? SCM_VOUCHER_TYPE_STORAGE_KEY : `voucherType:${activeTab.value}`
const showGenModes = computed(() => activeTab.value === 'scm' && genModePending.value.length > 1)
const genTypeDefaultLabel = computed(() => activeTab.value === 'scm' ? '按进销存凭证设置默认'
  : activeTab.value === 'cashier' ? '按出纳参数默认' : '按资产参数默认')

async function confirmGenMode() {
  genModeVisible.value = false
  if (showGenModes.value) {
    try { localStorage.setItem(GEN_MODE_KEY, genMode.value) } catch { /* ignore */ }
  }
  storeVoucherType(voucherTypeKey(), genVoucherType.value)
  await runGenerate(genModePending.value, showGenModes.value ? genMode.value : 'single', genVoucherType.value)
}

async function handleGenerate(rows: any[]) {
  if (!rows.length) return
  await baseData.loadVoucherTypes()
  const stored = readStoredVoucherType(voucherTypeKey())
  genVoucherType.value = baseData.voucherTypes.some(t => String(t.id) === stored) ? stored : ''
  genModePending.value = rows
  genModeVisible.value = true
}

async function runGenerate(rows: any[], scmMode: BizScmGenMode, voucherTypeId = '') {
  working.value = true
  try {
    if (activeTab.value === 'scm') await generateScm(rows.map(r => r.id), scmMode, voucherTypeId)
    else if (activeTab.value === 'cashier') await generateCashier(rows, voucherTypeId)
    else await generateAsset(rows, voucherTypeId)
  } finally {
    working.value = false
    allSelection.value = null
    await Promise.all([loadSummary(), loadList()])
  }
}

async function generateScm(ids: string[], mode: BizScmGenMode = 'single', voucherTypeId = '') {
  // 逐张：后端单次同步处理一批，批小一点才不会长时间占住服务；每批之间可取消。
  // 汇总：分组要一次拿到全部单据，整批提交（后端上限 2000）
  const batch = mode === 'single' ? SCM_BATCH : SCM_MERGE_BATCH
  const results: Awaited<ReturnType<typeof bizVoucherCenterApi.scmGenerate>>['data']['results'] = []
  startProgress('生成中', ids.length)
  let done = 0
  try {
    for (const part of chunk(ids, batch)) {
      if (cancelRequested.value) break
      results.push(...(await bizVoucherCenterApi.scmGenerate(part, mode, voucherTypeId)).data.results)
      done += part.length
      tickProgress(part.length)
    }
  } finally {
    endProgress()
  }
  const items: ResultItem[] = results.map(x => ({
    label: x.doc_no,
    ok: x.ok,
    message: x.ok ? `凭证 ${x.voucher_no}${(x.merged_count ?? 1) > 1 ? `（${x.merged_count} 张单据合并）` : ''}` : x.message,
    link: !x.ok && x.reason === 'SCM_AUX_UNMATCHED' ? { text: '去凭证设置', to: '/base/scm-voucher-setting?tab=partner' } : undefined,
  }))
  if (done < ids.length) items.push(cancelledItem(ids.length - done))
  showResult('进销存生成凭证', items)
  // 辅助核算对应不上的：汇总成一次提示（自动新建后重试这些单据）
  const auxFailed = results.filter(x => !x.ok && x.reason === 'SCM_AUX_UNMATCHED')
  if (auxFailed.length) {
    const seen = new Map<string, ScmAuxProblem>()
    for (const f of auxFailed) {
      for (const p of f.data?.items || []) {
        const k = `${p.kind}|${p.categoryId}|${p.sourceType}|${p.sourceCode}`
        const hit = seen.get(k) || { ...p, docs: [] }
        hit.docs = [...(hit.docs || []), { id: f.id, doc_no: f.doc_no }]
        seen.set(k, hit)
      }
    }
    const problems = [...seen.values()]
    await handleScmAuxUnmatched({ response: { data: { reason: 'SCM_AUX_UNMATCHED', data: { items: problems } } } }, async () => {
      await generateScm(auxFailed.map(x => x.id), mode, voucherTypeId)
    }, () => Promise.all([loadSummary(), loadList()]))
  }
}

async function generateCashier(rows: CashierSearchRow[], voucherTypeId = '') {
  const groups = new Map<string, CashierSearchRow[]>()
  for (const row of rows) groups.set(row.account_code, [...(groups.get(row.account_code) || []), row])
  const items: ResultItem[] = []
  startProgress('生成中', rows.length)
  let done = 0
  try {
    outer: for (const [account, list] of groups) {
      const parts = chunk(list, CASHIER_BATCH)
      for (const [pi, part] of parts.entries()) {
        if (cancelRequested.value) break outer
        const label = `${account} ${list[0].account_name || ''}（${parts.length > 1 ? `第 ${pi + 1}/${parts.length} 批，` : ''}${part.length} 条）`
        try {
          const r = (await cashierApi.generateVoucher({ account_code: account, ids: part.map(x => x.id), ...(voucherTypeId ? { voucher_type_id: voucherTypeId } : {}) })).data
          items.push({ label, ok: true, message: `生成 ${r.syncedCount} 张：${r.voucherNos.join('、')}` })
        } catch (e: any) {
          const body = e?.response?.data
          const missing = Array.isArray(body?.missingRows) ? body.missingRows.length : 0
          items.push({
            label,
            ok: false,
            message: missing ? `${missing} 条流水未填对方科目，请到出纳录单补填（或在出纳录单生成时选择挂账科目）` : (body?.message || e?.message || '生成失败'),
            link: { text: '去出纳录单', to: '/cashier/journal' },
          })
        }
        done += part.length
        tickProgress(part.length)
      }
    }
  } finally {
    endProgress()
  }
  if (done < rows.length) items.push(cancelledItem(rows.length - done))
  showResult('出纳生成凭证', items)
}

async function generateAsset(rows: AssetVoucherRow[], voucherTypeId = '') {
  const items: ResultItem[] = []
  startProgress('生成中', rows.length)
  let done = 0
  try {
    for (const row of rows) {
      if (cancelRequested.value) break
      const label = row.title
      try {
        const r = (await fixedAssetApi.regenerateAssetVoucher({ kind: row.kind, ref_id: row.refId, ...(voucherTypeId ? { voucher_type_id: voucherTypeId } : {}) })).data
        items.push({ label, ok: true, message: `凭证 ${r.voucherNo}` })
      } catch (e: any) {
        items.push({
          label, ok: false,
          message: e?.response?.data?.message || e?.message || '生成失败',
          link: { text: '指定科目后生成', to: { path: '/asset/vouchers/regenerate', query: { kind: row.kind, ref: row.refId } } },
        })
      }
      done++
      tickProgress(1)
    }
  } finally {
    endProgress()
  }
  if (done < rows.length) items.push(cancelledItem(rows.length - done))
  showResult('固定资产生成凭证', items)
}

// ── 删除 ──────────────────────────────────────────────────

async function handleDelete(rows: any[]) {
  if (!rows.length) return
  try {
    await ElMessageBox.confirm(`删除选中 ${rows.length} 项业务的凭证？业务数据保留，删除后可重新生成。已记账的凭证不能删除。`, '删除凭证', {
      type: 'warning', confirmButtonText: '删除',
    })
  } catch { return }
  working.value = true
  let groups: RenumberGroup[] = []
  let deleted = 0
  try {
    startProgress('删除中', rows.length)
    let done = 0
    const cancelled = () => cancelRequested.value
    if (activeTab.value === 'scm') {
      const results: Array<{ doc_no: string; ok: boolean; voucher_no?: string; message?: string }> = []
      // 合并凭证：删掉后同凭证的其它单据已一并恢复，后续批次里跳过它们
      const restored = new Set<string>()
      const docNoOf = new Map(rows.map(x => [x.id, x.doc_no as string]))
      for (const all of chunk(rows.map(x => x.id), SCM_BATCH)) {
        if (cancelled()) break
        const ids = all.filter(id => !restored.has(id))
        for (const id of all) if (restored.has(id)) results.push({ doc_no: docNoOf.get(id) || '', ok: true, message: '随合并凭证一并删除' })
        if (ids.length) {
          const r = (await bizVoucherCenterApi.scmDelete(ids)).data   // 顺序提交，避免并发删除互相干扰
          results.push(...r.results)
          for (const x of r.results) for (const sid of x.shared_ids || []) restored.add(sid)
          groups.push(...r.affectedGroups); deleted += r.ok
        }
        done += all.length; tickProgress(all.length)
      }
      const items: ResultItem[] = results.map(x => ({ label: x.doc_no, ok: x.ok, message: x.ok ? (x.message || `已删除凭证 ${x.voucher_no || ''}`) : x.message }))
      if (done < rows.length) items.push(cancelledItem(rows.length - done))
      showResult('进销存删除凭证', items)
    } else if (activeTab.value === 'cashier') {
      const byAccount = new Map<string, string[]>()
      for (const row of rows as CashierSearchRow[]) byAccount.set(row.account_code, [...(byAccount.get(row.account_code) || []), row.id])
      const items: ResultItem[] = []
      outer: for (const [account, ids] of byAccount) {
        const parts = chunk(ids, CASHIER_BATCH)
        for (const [pi, part] of parts.entries()) {
          if (cancelled()) break outer
          const label = `${account}（${parts.length > 1 ? `第 ${pi + 1}/${parts.length} 批，` : ''}${part.length} 条）`
          try {
            const r = (await cashierApi.deleteCashierVouchers({ account_code: account, ids: part })).data
            items.push({ label, ok: r.skipped === 0, message: `已删除 ${r.deleted} 张${r.skipped ? `，${r.skipped} 张已记账未删除` : ''}` })
            groups.push(...r.affectedGroups); deleted += r.deleted
          } catch (e: any) {
            items.push({ label, ok: false, message: e?.response?.data?.message || '删除失败' })
          }
          done += part.length; tickProgress(part.length)
        }
      }
      if (done < rows.length) items.push(cancelledItem(rows.length - done))
      showResult('出纳删除凭证', items)
    } else {
      const items: ResultItem[] = []
      for (const row of rows as AssetVoucherRow[]) {
        if (cancelled()) break
        try {
          const r = (await fixedAssetApi.deleteAssetVoucher({ kind: row.kind, ref_id: row.refId })).data
          items.push({ label: row.title, ok: true, message: `已删除凭证 ${r.voucherNo || ''}` })
          groups.push(...(r.affectedGroups || [])); deleted++
        } catch (e: any) {
          items.push({ label: row.title, ok: false, message: e?.response?.data?.message || '删除失败' })
        }
        done++; tickProgress(1)
      }
      if (done < rows.length) items.push(cancelledItem(rows.length - done))
      showResult('固定资产删除凭证', items)
    }
  } finally {
    endProgress()
    working.value = false
    allSelection.value = null
    await Promise.all([loadSummary(), loadList()])
  }
  const uniq = [...new Map(groups.map(g => [`${g.year}-${g.period}-${g.voucher_type_id ?? ''}`, g])).values()]
  await confirmRenumberAfterDelete(uniq, deleted)
}

onMounted(async () => {
  await reloadAll()
  const tab = String(route.query.tab || '') as TabKey
  if (['scm', 'cashier', 'asset'].includes(tab) && summary.value?.[tab as 'scm']) switchTab(tab)
})
</script>

<style scoped>
.external-voucher { color: var(--el-text-color-secondary); font-size: 12px; }
.bvc-gen-type {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 24px 12px;
}
.bvc-gen-modes {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 24px;
}
.bvc-gen-modes__hint {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.bvc-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.bvc-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.bvc-header__left { display: flex; align-items: center; flex-wrap: wrap; }
.bvc-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.bvc-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.bvc-header__right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.bvc-main { flex: 1; min-height: 0; display: flex; }
.bvc-nav {
  width: 220px; flex-shrink: 0; padding: 12px 8px; border-right: 1px solid var(--el-border-color-lighter);
  overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
}
.bvc-nav__item { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.bvc-nav__item:hover { background: var(--el-fill-color-light); }
.bvc-nav__item.is-active { background: var(--el-color-primary-light-9); }
.bvc-nav__item.is-active .bvc-nav__title { color: var(--el-color-primary); }
.bvc-nav__icon { margin-top: 2px; font-size: 16px; color: var(--el-text-color-secondary); }
.bvc-nav__text { display: flex; flex-direction: column; min-width: 0; }
.bvc-nav__title { font-weight: 600; font-size: var(--cw-text-base); }
.bvc-nav__desc { font-size: 12px; color: var(--el-text-color-secondary); }
.bvc-nav__badge { position: absolute; right: 8px; top: 6px; }
.bvc-nav__setting { margin-top: 6px; background: var(--el-color-primary-light-9); border: 1px solid var(--el-color-primary-light-5); }
.bvc-nav__setting:hover { background: var(--el-color-primary-light-8); }
.bvc-nav__setting .bvc-nav__icon, .bvc-nav__setting .bvc-nav__title { color: var(--el-color-primary); }
.bvc-nav__tip { margin-top: auto; padding: 10px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); background: var(--el-fill-color-lighter); border-radius: 6px; }

.bvc-content { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 12px 16px; overflow: auto; }
.bvc-hint { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-bottom: 12px; }
.bvc-muted { color: var(--el-text-color-secondary); font-size: 12px; }
.bvc-danger { color: var(--el-color-danger); }
.bvc-result { margin-bottom: 10px; }
.bvc-result__list { margin: 6px 0 0 16px; padding: 0; line-height: 1.8; }

.bvc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.bvc-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.bvc-card__head { display: flex; align-items: center; gap: 8px; }
.bvc-card__icon { font-size: 18px; color: var(--el-color-primary); }
.bvc-card__title { font-weight: 600; }
.bvc-card__nums { display: flex; gap: 24px; }
.bvc-card__num { display: flex; flex-direction: column; font-size: 12px; color: var(--el-text-color-secondary); }
.bvc-card__num span { font-size: 22px; font-weight: 600; color: var(--el-text-color-primary); }
.bvc-card__num.is-pending span { color: var(--el-color-warning); }
.bvc-card__desc { font-size: 12px; color: var(--el-text-color-secondary); flex: 1; }
.bvc-card .el-button { align-self: flex-start; }
.bvc-flow { margin-top: 18px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.bvc-flow .is-strong { color: var(--el-color-primary); font-weight: 600; }

.bvc-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.bvc-toolbar__spacer { flex: 1; }
.bvc-selected { font-size: 12px; color: var(--el-color-primary); }
.bvc-table { flex: 1; min-height: 240px; }
.bvc-pager { display: flex; justify-content: flex-end; padding-top: 8px; }
.bvc-voucher { display: inline-flex; align-items: center; }
</style>
