<template>
  <div class="page scm-rpt-page">
    <div class="rpt-bar">
      <span class="rpt-title">序列号查询</span>
      <el-input v-model="kw" placeholder="物料编码/名称" size="small" clearable style="width:170px" @keyup.enter="load" />
      <el-input v-model="sn" placeholder="序列号" size="small" clearable style="width:150px" @keyup.enter="load" />
      <el-select v-model="status" size="small" style="width:110px" @change="load">
        <el-option value="" label="全部状态" />
        <el-option value="in_stock" label="在库" />
        <el-option value="out" label="已出库" />
      </el-select>
      <el-button type="primary" plain size="small" :loading="loading" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <span class="rpt-hint">共 {{ rows.length }} 条（最多 500）</span>
    </div>
    <div class="rpt-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
        <el-table-column type="index" label="序号" width="48" align="center" />
        <el-table-column label="编号" prop="item_code" width="120" show-overflow-tooltip />
        <el-table-column label="名称" prop="item_name" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="110" show-overflow-tooltip />
        <el-table-column label="序列号" prop="serial_no" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'in_stock' ? 'success' : 'info'" size="small">{{ row.status === 'in_stock' ? '在库' : '已出库' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所在仓" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code || '-' }}</template>
        </el-table-column>
        <el-table-column label="入库单" prop="in_doc_no" width="140" show-overflow-tooltip />
        <el-table-column label="出库单" prop="out_doc_no" width="140" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
const rows = ref<any[]>([]); const loading = ref(false)
const kw = ref(''); const sn = ref(''); const status = ref('')
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getSerials({ keyword: kw.value || undefined, serial_no: sn.value || undefined, status: status.value || undefined })
    if (r.code === 0) rows.value = r.data || []
  } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.scm-rpt-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; }
.rpt-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.rpt-title { font-size: 15px; font-weight: 600; margin-right: 4px; }
.rpt-hint { margin-left: auto; font-size: 13px; color: var(--el-text-color-secondary); }
.rpt-body { flex: 1; min-height: 0; }
</style>
