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
      <el-button type="primary" size="small" class="partner-add-btn" @click="openAdd">
        <el-icon><Plus /></el-icon>{{ addLabel }}
      </el-button>
    </div>

    <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" max-height="calc(100vh - 260px)" class="compact-data-table" @header-dragend="onDragEnd">
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
      <el-table-column label="应收科目" prop="ar_account" :width="cw('ar_account', 100)" />
      <el-table-column label="应付科目" prop="ap_account" :width="cw('ap_account', 100)" />
      <el-table-column label="业务员" prop="salesman" :width="cw('salesman', 90)" />
      <el-table-column label="电话" prop="phone" min-width="120" :width="widths.phone" show-overflow-tooltip />
      <el-table-column label="操作" column-key="操作" :width="cw('操作', 120)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <PartnerDialog v-model="dialogVisible" :row="editRow" :default-type="propType" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Sell, User } from '@element-plus/icons-vue'
import { scmApi, type ScmPartner } from '@/api/scm'
import PartnerDialog from '@/components/scm/PartnerDialog.vue'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_partner')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const route = useRoute()
const propType = computed(() => (route.query.partner_type as string) || '')

const list = ref<ScmPartner[]>([])
const loading = ref(false)
const keyword = ref('')
const activeTab = ref(propType.value)

const addLabel = computed(() =>
  propType.value === 'supplier' ? '新增供应商'
    : propType.value === 'customer' ? '新增客户'
    : '新增往来单位')

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
    })
    if (res.code === 0) list.value = res.data
  } finally { loading.value = false }
}

function onTabChange() { load() }

// 新增/编辑共用 PartnerDialog（row 为空=新增）
const dialogVisible = ref(false)
const editRow = ref<ScmPartner | null>(null)

function openAdd() { editRow.value = null; dialogVisible.value = true }
function openEdit(row: ScmPartner) { editRow.value = row; dialogVisible.value = true }

async function handleDelete(row: ScmPartner) {
  await ElMessageBox.confirm(`确认删除「${row.name}」？`, '提示', { type: 'warning' })
  await scmApi.deletePartner(row.id); ElMessage.success('已删除'); load()
}

onMounted(load)
</script>

<style scoped>
.scm-partner-page { padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.partner-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.partner-add-btn { margin-left: auto; }
</style>
