<template>
  <div class="page">
    <div class="page-header log-page-header">
      <h3>操作日志</h3>
      <div class="filter-row">
        <el-select
          v-model="filters.action"
          placeholder="操作"
          class="filter-ctl--md"
          clearable
          filterable
          size="small"
        >
          <el-option v-for="item in filterOptions.actions" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select
          v-model="filters.module"
          placeholder="模块"
          class="filter-ctl--sm"
          clearable
          filterable
          size="small"
        >
          <el-option v-for="item in filterOptions.modules" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select
          v-model="filters.ipAddress"
          placeholder="IP 地址"
          class="filter-ctl--md"
          clearable
          filterable
          allow-create
          default-first-option
          size="small"
        >
          <el-option
            v-for="item in ipFilterOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-date-picker
          v-model="filters.dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          value-format="YYYY-MM-DD"
          class="filter-ctl--lg"
          size="small"
        />
        <el-button type="primary" size="small" @click="handleSearch">查询</el-button>
        <el-button size="small" @click="handleReset">重置</el-button>
      </div>
    </div>

    <el-table
      ref="tableRef"
      :data="list"
      stripe
      border
      size="small"
      height="100%"
      class="compact-data-table"
      :loading="loading"
      @header-dragend="onDragEnd"
    >
      <el-table-column prop="created_at" label="时间" :width="colWidth('created_at', 158)" />
      <el-table-column prop="username" label="用户" :width="colWidth('username', 88)" show-overflow-tooltip />
      <el-table-column prop="action" label="操作" :width="colWidth('action', 128)" show-overflow-tooltip />
      <el-table-column prop="module" label="模块" :width="colWidth('module', 88)" />
      <el-table-column label="详情" min-width="200">
        <template #default="{ row }">
          <span class="log-detail">{{ formatLogDetail(row.detail) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="IP" :width="colWidth('ip_address', 132)">
        <template #default="{ row }">
          <span class="log-ip">{{ formatLogIp(row.ip_address) }}</span>
        </template>
      </el-table-column>
      <template #empty>
        <EmptyState type="data" description="暂无操作日志" />
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="[20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next"
        size="small"
        @current-change="fetchData"
        @size-change="fetchData"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import request from '@/api/request'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { formatLogDetail, formatLogIp } from '@/utils/operationLog'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('system_log')
const list = ref<any[]>([])
const loading = ref(false)
const filters = ref({
  action: '',
  module: '',
  ipAddress: '',
  dateRange: [] as string[],
})
const filterOptions = reactive({
  actions: [] as string[],
  modules: [] as string[],
  ipAddresses: [] as string[],
})
const pagination = reactive({ page: 1, pageSize: 50, total: 0 })

const ipFilterOptions = computed(() => {
  const seen = new Set<string>()
  const options: { label: string; value: string }[] = []
  for (const ip of filterOptions.ipAddresses) {
    const value = (ip || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    options.push({ label: formatLogIp(value), value })
  }
  return options
})

async function fetchFilterOptions() {
  const res = await request.get<{ actions: string[]; modules: string[]; ipAddresses: string[] }>(
    '/system/logs/options'
  )
  filterOptions.actions = res.data?.actions ?? []
  filterOptions.modules = res.data?.modules ?? []
  filterOptions.ipAddresses = res.data?.ipAddresses ?? []
}

async function fetchData() {
  loading.value = true
  try {
    const params: Record<string, string | number> = {
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
    if (filters.value.action) params.action = filters.value.action
    if (filters.value.module) params.module = filters.value.module
    if (filters.value.ipAddress) params.ip_address = filters.value.ipAddress.trim()
    if (filters.value.dateRange?.length) {
      params.start_date = filters.value.dateRange[0]
      params.end_date = filters.value.dateRange[1]
    }
    const res = await request.get<any[]>('/system/logs', { params })
    list.value = res.data
    pagination.total = res.total ?? 0
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchData()
}

function handleReset() {
  filters.value = { action: '', module: '', ipAddress: '', dateRange: [] }
  pagination.page = 1
  fetchData()
}

onMounted(async () => {
  await fetchFilterOptions()
  await fetchData()
})
</script>

<style scoped>
.log-page-header {
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px 8px;
  overflow: hidden;
}

.log-page-header h3 {
  flex-shrink: 0;
}

.log-page-header .filter-row {
  flex: 1 1 auto;
  justify-content: flex-end;
  margin-bottom: 0 !important;
}

.log-detail,
.log-ip {
  display: inline-block;
  max-width: 100%;
  word-break: break-word;
  white-space: normal;
  line-height: 1.3;
  font-size: 12px;
}

.log-ip {
  white-space: nowrap;
}
</style>
