<template>
  <div class="page bom-where-used-page">
    <!-- 顶部导航条 -->
    <div class="bwu-header">
      <div class="bwu-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="bwu-header__sep">/</span>
        <span class="bwu-header__title">BOM 反查用途</span>
        <span class="bwu-header__meta">查看某个物料被哪些 BOM 引用（作为子件 / 副产品 / 联产品）</span>
      </div>
      <div class="bwu-header__right">
        <span class="bwu-label">物料</span>
        <el-select v-model="itemCode" filterable remote clearable :remote-method="searchItems" :loading="searching"
          placeholder="输入编号/名称搜索" size="small" style="width:280px" @change="load">
          <el-option v-for="it in itemOptions" :key="it.code" :label="`${it.code} ${it.name}${it.spec ? '（' + it.spec + '）' : ''}`" :value="it.code" />
        </el-select>
        <el-button type="primary" plain size="small" :disabled="!itemCode" @click="load"><el-icon><Search /></el-icon>查询</el-button>
        <span class="bwu-count">共 {{ rows.length }} 处引用</span>
      </div>
    </div>

    <div class="bwu-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%" class="compact-data-table" @row-dblclick="openTree">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column label="BOM编码" prop="bom_code" width="140" />
        <el-table-column label="BOM名称" prop="bom_name" min-width="150" show-overflow-tooltip />
        <el-table-column label="版本" prop="version" width="70" align="center" />
        <el-table-column label="成品物料" prop="product_code" width="130" />
        <el-table-column label="成品名称" prop="product_name" min-width="150" show-overflow-tooltip />
        <el-table-column label="行类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.line_type === 'component' ? 'info' : 'warning'">{{ lineTypeLabel(row.line_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="单件用量" prop="qty" width="100" align="right">
          <template #default="{ row }">{{ fmtQty(row.qty) }}</template>
        </el-table-column>
        <el-table-column label="单位" prop="unit" width="64" align="center" />
        <el-table-column label="损耗%" prop="scrap_rate" width="72" align="right">
          <template #default="{ row }">{{ row.scrap_rate ? row.scrap_rate : '' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="success" size="small" @click="openTree(row)">展开</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="itemCode ? '该物料未被任何 BOM 引用' : '请选择物料'" :image-size="60" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'

const route = useRoute()
const router = useRouter()
const itemCode = ref<string>(typeof route.query.item_code === 'string' ? route.query.item_code : '')
const itemOptions = ref<any[]>([])
const rows = ref<any[]>([])
const loading = ref(false)
const searching = ref(false)

const fmtQty = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
function lineTypeLabel(t: string) { return t === 'by_product' ? '副产品' : t === 'co_product' ? '联产品' : '子件' }

async function searchItems(keyword: string) {
  searching.value = true
  try {
    const r = await scmApi.getItems({ keyword: keyword || undefined, page: 1, page_size: 50 })
    if (r.code === 0) itemOptions.value = (r.data as any).list || r.data || []
  } finally {
    searching.value = false
  }
}

async function load() {
  if (!itemCode.value) { rows.value = []; return }
  loading.value = true
  try {
    const r = await scmApi.getBomWhereUsed(itemCode.value)
    if (r.code === 0) rows.value = r.data || []
    router.replace({ query: { ...route.query, item_code: itemCode.value } })
  } finally {
    loading.value = false
  }
}

function openTree(row: any) { router.push(`/scm/boms/${row.bom_id}/tree`) }
function openEdit(row: any) { router.push(`/scm/boms/${row.bom_id}/edit`) }
function goBack() { router.push('/scm/boms') }

onMounted(async () => {
  await searchItems(itemCode.value)
  if (itemCode.value) await load()
})
</script>

<style scoped>
.bom-where-used-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.bwu-header {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0; gap: 12px;
}
.bwu-header__left { display: flex; align-items: center; gap: 8px; font-size: var(--cw-text-base); min-width: 0; }
.bwu-header__sep { color: var(--el-text-color-placeholder); }
.bwu-header__title { font-weight: 600; color: var(--el-text-color-primary); white-space: nowrap; }
.bwu-header__meta { color: var(--el-text-color-secondary); font-size: var(--cw-text-base); white-space: nowrap; }
.bwu-header__right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.bwu-label, .bwu-count { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.bwu-body { flex: 1; min-height: 0; padding: 8px 16px 12px; }
</style>
