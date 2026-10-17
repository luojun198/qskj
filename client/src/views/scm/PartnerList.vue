<template>
  <div class="page scm-partner-page">

    <div class="partner-toolbar toolbar">
      <div v-if="!propType" class="partner-tabs">
        <el-radio-group v-model="activeTab" size="small" @change="onTabChange">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="supplier"><el-icon><Sell /></el-icon>供应商</el-radio-button>
          <el-radio-button value="customer"><el-icon><User /></el-icon>客户</el-radio-button>
        </el-radio-group>
      </div>
      <el-input v-model="keyword" size="small" clearable placeholder="编号 / 名称" style="width:180px" @keyup.enter="load" @clear="load">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="auditFilter" size="small" placeholder="审核状态" style="width:128px" @change="load" :empty-values="[null, undefined]">
        <el-option label="全部审核状态" value="" />
        <el-option label="未审核" value="draft" />
        <el-option label="已审核" value="audited" />
      </el-select>
      <el-select v-model="enabledFilter" size="small" placeholder="状态" style="width:128px" @change="load" :empty-values="[null, undefined]">
        <el-option label="全部启用状态" value="" />
        <el-option label="启用" value="1" />
        <el-option label="停用" value="0" />
      </el-select>
      <span class="toolbar-gap" />
      <!-- 第六份反馈：客户、供应商增加另存、导入模板、批量审核；停用 -->
      <SaveAsButton :handler="exportAll" />
      <el-button size="small" plain @click="goImport"><el-icon><Upload /></el-icon>导入</el-button>
      <el-button v-permission="'scm:master-audit'" size="small" type="success" plain :disabled="!selection.length" @click="batchAudit('audit')">审核</el-button>
      <el-button v-permission="'scm:master-audit'" size="small" type="warning" plain :disabled="!selection.length" @click="batchAudit('unaudit')">反审核</el-button>
      <el-button size="small" plain :disabled="!selection.length" @click="batchEnable(false)">停用</el-button>
      <el-button size="small" plain :disabled="!selection.length" @click="batchEnable(true)">启用</el-button>
      <el-button type="primary" size="small" @click="openAdd">
        <el-icon><Plus /></el-icon>{{ addLabel }}
      </el-button>
    </div>

    <div class="page-table-fill">
      <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" height="100%" class="compact-data-table"
        :row-class-name="rowClass" @header-dragend="onDragEnd" @selection-change="(rows: ScmPartner[]) => (selection = rows)">
        <el-table-column type="selection" width="40" fixed="left" />
        <el-table-column label="编号" prop="code" :width="cw('code', 110)" />
        <el-table-column label="名称" prop="name" min-width="180" :width="widths.name" show-overflow-tooltip />
        <el-table-column label="属性" column-key="partner_type" :width="cw('partner_type', 100)" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.partner_type === 'supplier'" type="warning" size="small">供应商</el-tag>
            <el-tag v-else-if="row.partner_type === 'customer'" type="success" size="small">客户</el-tag>
            <el-tag v-else type="info" size="small">双向</el-tag>
            <el-tag v-if="row.is_outsource === 1" type="danger" size="small" effect="plain" style="margin-left:4px">委外厂</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="审核" column-key="audit_status" :width="cw('audit_status', 76)" align="center">
          <template #default="{ row }">
            <el-tag :type="row.audit_status === 'draft' ? 'info' : 'success'" size="small" effect="plain">{{ row.audit_status === 'draft' ? '未审核' : '已审核' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" column-key="enabled" :width="cw('enabled', 70)" align="center">
          <template #default="{ row }"><span :class="row.enabled === 0 ? 'text-disabled' : ''">{{ row.enabled === 0 ? '停用' : '启用' }}</span></template>
        </el-table-column>
        <el-table-column label="应收科目" prop="ar_account" :width="cw('ar_account', 100)" />
        <el-table-column label="应付科目" prop="ap_account" :width="cw('ap_account', 100)" />
        <el-table-column label="业务员" prop="salesman" :width="cw('salesman', 90)" />
        <el-table-column label="联系人" prop="contact" :width="cw('contact', 90)" show-overflow-tooltip />
        <el-table-column label="电话" prop="phone" min-width="120" :width="widths.phone" show-overflow-tooltip />
        <el-table-column label="操作" column-key="操作" :width="cw('操作', 170)" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">{{ row.audit_status === 'audited' ? '查看' : '编辑' }}</el-button>
            <el-button link size="small" @click="toggleEnable(row)">{{ row.enabled === 0 ? '启用' : '停用' }}</el-button>
            <el-button v-if="row.audit_status !== 'audited'" link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <PartnerDialog v-model="dialogVisible" :row="editRow" :default-type="propType || activeTab" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Sell, Upload, User } from '@element-plus/icons-vue'
import { scmApi, type ScmPartner } from '@/api/scm'
import PartnerDialog from '@/components/scm/PartnerDialog.vue'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { exportDateStamp } from '@/utils/exportElTable'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_partner')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const route = useRoute()
const router = useRouter()
const propType = computed(() => (route.query.partner_type as string) || '')

const list = ref<ScmPartner[]>([])
const loading = ref(false)
const keyword = ref('')
const activeTab = ref(propType.value)
const auditFilter = ref('')
const enabledFilter = ref<'' | '1' | '0'>('')
const selection = ref<ScmPartner[]>([])

const addLabel = computed(() => {
  const t = propType.value || activeTab.value
  return t === 'supplier' ? '新增供应商' : t === 'customer' ? '新增客户' : '新增往来单位'
})

const tabLabel = computed(() => {
  if (propType.value === 'supplier') return '供应商档案'
  if (propType.value === 'customer') return '客户档案'
  if (activeTab.value === 'supplier') return '供应商'
  if (activeTab.value === 'customer') return '客户'
  return '往来单位'
})

// 从导航固定类型进入时，锁定类型
watch(propType, v => { activeTab.value = v; load() })

async function load() {
  loading.value = true
  try {
    const res = await scmApi.getPartners({
      keyword: keyword.value || undefined,
      partner_type: activeTab.value || undefined,
      audit_status: auditFilter.value || undefined,
      // 默认不显示停用；勾「显示停用」时全部列出
      enabled: enabledFilter.value || undefined,
    })
    if (res.code === 0) list.value = res.data
  } finally { loading.value = false }
}

function onTabChange() { load() }
const rowClass = ({ row }: { row: ScmPartner }) => ((row as any).enabled === 0 ? 'row-disabled' : '')

// 新增/编辑共用 PartnerDialog（row 为空=新增）
const dialogVisible = ref(false)
const editRow = ref<ScmPartner | null>(null)

function openAdd() { editRow.value = null; dialogVisible.value = true }
function openEdit(row: ScmPartner) { editRow.value = row; dialogVisible.value = true }

async function handleDelete(row: ScmPartner) {
  await ElMessageBox.confirm(`确认删除「${row.name}」？`, '提示', { type: 'warning' })
  await scmApi.deletePartner(row.id); ElMessage.success('已删除'); load()
}

async function batchAudit(action: 'audit' | 'unaudit') {
  const r = await scmApi.batchAuditMaster('partners', selection.value.map(x => x.id), action)
  ElMessage.success(`${action === 'audit' ? '审核' : '反审核'} ${r.data.changed} 个${r.data.skipped ? `，${r.data.skipped} 个状态无需变更` : ''}`)
  load()
}
async function batchEnable(enabled: boolean) {
  if (!enabled) {
    try { await ElMessageBox.confirm(`停用选中的 ${selection.value.length} 个往来单位？停用后单据录入时不能再选，已有单据不受影响。`, '停用', { type: 'warning' }) } catch { return }
  }
  const r = await scmApi.batchEnableMaster('partners', selection.value.map(x => x.id), enabled)
  ElMessage.success(`已${enabled ? '启用' : '停用'} ${r.data.changed} 个`)
  load()
}
async function toggleEnable(row: ScmPartner) {
  const enabled = (row as any).enabled === 0
  await scmApi.batchEnableMaster('partners', [row.id], enabled)
  ElMessage.success(enabled ? '已启用' : '已停用')
  load()
}

function goImport() {
  router.push({ name: 'ScmMasterImport', query: { kind: 'partners', partner_type: propType.value || activeTab.value || undefined } })
}

/** 另存：当前筛选下的全部往来单位 */
async function exportAll() {
  const typeText = (t?: string) => (t === 'supplier' ? '供应商' : t === 'customer' ? '客户' : '客户兼供应商')
  await exportStyledTable({
    fileName: `${tabLabel.value}_${exportDateStamp()}.xlsx`,
    title: tabLabel.value,
    columns: [
      { label: '单位编码', value: (r: any) => r.code },
      { label: '单位名称', value: (r: any) => r.name },
      { label: '简称', value: (r: any) => r.short_name },
      { label: '类型', value: (r: any) => typeText(r.partner_type) },
      { label: '联系人', value: (r: any) => r.contact },
      { label: '电话', value: (r: any) => r.phone },
      { label: '地址', value: (r: any) => r.address },
      { label: '税号', value: (r: any) => r.tax_no },
      { label: '开户行', value: (r: any) => r.bank_name },
      { label: '银行账号', value: (r: any) => r.bank_account },
      { label: '税率(%)', type: 'number', align: 'right', value: (r: any) => r.tax_rate },
      { label: '账期(天)', type: 'integer', align: 'right', value: (r: any) => r.credit_days },
      { label: '信用额度', type: 'amount', align: 'right', value: (r: any) => r.credit_limit },
      { label: '应收科目', value: (r: any) => r.ar_account },
      { label: '应付科目', value: (r: any) => r.ap_account },
      { label: '业务员', value: (r: any) => r.salesman },
      { label: '邮箱', value: (r: any) => r.email },
      { label: '备注', value: (r: any) => r.remark },
      { label: '审核', value: (r: any) => (r.audit_status === 'draft' ? '未审核' : '已审核') },
      { label: '状态', value: (r: any) => (r.enabled === 0 ? '停用' : '启用') },
    ],
    rows: list.value,
  })
}

onMounted(load)
</script>

<style scoped>
.scm-partner-page { padding: var(--page-pad); height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.partner-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.toolbar-gap { flex: 1; }
.text-disabled { color: var(--el-text-color-placeholder); }
:deep(.row-disabled td) { color: var(--el-text-color-placeholder); }
</style>
