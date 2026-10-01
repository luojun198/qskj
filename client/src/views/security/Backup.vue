<template>
  <div class="page">
    <div class="page-header">
      <h3>备份恢复</h3>
      <div class="header-actions">
        <el-button type="primary" :loading="backingUp" @click="handleBackup">
          <el-icon v-if="!backingUp"><Download /></el-icon>
          完整备份
        </el-button>
        <el-button type="primary" plain :loading="accountSetBackingUp" @click="handleAccountSetBackup">
          <el-icon v-if="!accountSetBackingUp"><Download /></el-icon>
          单账套备份
        </el-button>
        <el-button type="success" @click="handleImportClick">
          <el-icon><Upload /></el-icon>
          导入备份
        </el-button>
        <el-button type="info" :loading="cleaning" @click="handleDatabaseCleanup">
          <el-icon><Brush /></el-icon>
          数据库瘦身
        </el-button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".db,.sqlite,.sqlite3"
          style="display: none"
          @change="handleFileSelected"
        />
      </div>
    </div>
    <!-- 统计卡片 -->
    <el-row :gutter="16" style="margin-bottom: 16px">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">备份总数</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-value">{{ formatSize(stats.totalSize) }}</div>
          <div class="stat-label">占用空间</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-value">{{ stats.autoCount }}</div>
          <div class="stat-label">自动备份</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-value">
            {{ stats.lastBackupTime ? formatDate(stats.lastBackupTime) : '暂无' }}
          </div>
          <div class="stat-label">上次备份</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 自动备份设置 -->
    <el-card shadow="never" style="margin-bottom: 16px">
      <template #header>
        <div class="card-header">
          <span>自动备份设置</span>
          <el-switch
            v-model="settingsForm.enabled"
            active-text="启用"
            inactive-text="停用"
            @change="handleSaveSettings"
          />
        </div>
      </template>

      <el-form :model="settingsForm" label-width="100px" :disabled="!settingsForm.enabled">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="备份频率">
              <el-select
                v-model="settingsForm.schedule"
                style="width: 100%"
                @change="handleSaveSettings"
              >
                <el-option label="每天" value="daily" />
                <el-option label="每周一" value="weekly" />
                <el-option label="每月1号" value="monthly" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="执行时间">
              <el-time-select
                v-model="settingsForm.time"
                start="00:00"
                step="00:30"
                end="23:30"
                placeholder="选择时间"
                style="width: 100%"
                @change="handleSaveSettings"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="保留天数">
              <el-select
                v-model="settingsForm.retention"
                style="width: 100%"
                @change="handleSaveSettings"
              >
                <el-option label="永久保存" :value="0" />
                <el-option label="7天" :value="7" />
                <el-option label="15天" :value="15" />
                <el-option label="30天" :value="30" />
                <el-option label="60天" :value="60" />
                <el-option label="90天" :value="90" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="备份路径">
          <el-input
            v-model="settingsForm.backupPath"
            placeholder="留空使用默认路径 server/backups"
            clearable
            @change="handleSaveSettings"
          >
            <template #prefix
              ><el-icon><Folder /></el-icon
            ></template>
          </el-input>
          <div class="form-tip">设置绝对路径，如 /data/backups 或 D:\backups</div>
        </el-form-item>
      </el-form>

      <div v-if="settingsForm.enabled" class="schedule-info">
        <el-icon><Clock /></el-icon>
        下次执行：{{ getNextRunTime() }}
      </div>
    </el-card>

    <!-- 提示 -->
    <el-alert
      title="完整备份用于整库恢复；单账套备份仅含当前账套数据，导入时将合并恢复到当前登录账套（不会覆盖其他账套）。恢复全量备份后需重新登录。"
      type="info"
      :closable="false"
      style="margin-bottom: 16px"
    />

    <!-- 备份记录 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>备份记录</span>
          <div class="toolbar" style="display: flex; gap: 8px; align-items: center">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              style="width: 260px"
              clearable
              @change="onDateRangeChange"
            />
            <el-button text type="primary" size="small" @click="fetchData">刷新</el-button>
          </div>
        </div>
      </template>

      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="list"
        stripe
        border
        class="compact-data-table"
        @header-dragend="onDragEnd"
      >
        <el-table-column
          prop="filename"
          label="文件名"
          :width="colWidth('filename', 260)"
          show-overflow-tooltip
        />
        <el-table-column
          prop="account_set_name"
          label="触发账套"
          :width="colWidth('account_set_name', 120)"
          show-overflow-tooltip
        />
        <el-table-column column-key="大小" label="大小" :width="colWidth('大小', 100)">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column column-key="类型" label="类型" :width="colWidth('类型', 80)">
          <template #default="{ row }">
            <el-tag :type="row.type === 'auto' ? 'success' : 'primary'" size="small">
              {{ row.type === 'auto' ? '自动' : '手动' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column column-key="状态" label="状态" :width="colWidth('状态', 80)">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column column-key="操作人" label="操作人" :width="colWidth('操作人', 100)">
          <template #default="{ row }">
            {{ row.operator_name || row.operator_username || (row.type === 'auto' ? '系统' : '-') }}
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" :width="colWidth('created_at', 170)" />
        <el-table-column
          column-key="操作"
          label="操作"
          :width="colWidth('操作', 200)"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleRestore(row)">恢复</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-bar">
        <span class="pagination-text">共 {{ pagination.total }} 条</span>
        <el-select v-model="pagination.pageSize" style="width: 95px" @change="onPageSizeChange">
          <el-option label="10条" :value="10" />
          <el-option label="20条" :value="20" />
          <el-option label="50条" :value="50" />
          <el-option label="100条" :value="100" />
        </el-select>
        <el-pagination
          v-model:current-page="pagination.page"
          :total="pagination.total"
          :page-size="pagination.pageSize"
          layout="prev, pager, next, jumper"
          :pager-count="5"
          @current-change="onPageChange"
        />
      </div>
    </el-card>

    <!-- 备份路径选择对话框 -->
    <el-dialog v-model="backupDialogVisible" title="选择备份方式" width="500px">
      <el-form label-width="100px">
        <el-form-item label="备份方式">
          <el-radio-group v-model="backupMode">
            <el-radio value="default">
              备份到服务器
              <span style="color: #909399; font-size: 12px; margin-left: 8px">
                {{ settingsForm.backupPath || '(服务器默认路径)' }}
              </span>
            </el-radio>
            <el-radio value="download">备份并下载到本地</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-alert
          v-if="backupMode === 'download'"
          title="备份文件将下载到您的浏览器下载目录"
          type="info"
          :closable="false"
          style="margin-top: 12px"
        />
      </el-form>

      <template #footer>
        <el-button @click="backupDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="backingUp" @click="confirmBackup">
          {{ backupMode === 'download' ? '备份并下载' : '确认备份' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download, Folder, Clock, Upload, Brush } from '@element-plus/icons-vue'
import request from '@/api/request'
import axios from 'axios'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useDeleteConfirm, useConfirm } from '@/composables/useConfirm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('security_backup')
const loading = ref(false)
const backingUp = ref(false)
const accountSetBackingUp = ref(false)
const cleaning = ref(false)
const list = ref<any[]>([])
const fileInputRef = ref<HTMLInputElement>()
const dateRange = ref<string[]>([])

// 分页状态
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

// 备份路径选择对话框状态
const backupDialogVisible = ref(false)
const backupMode = ref<'default' | 'download'>('default')

const stats = reactive({
  total: 0,
  totalSize: 0,
  autoCount: 0,
  manualCount: 0,
  lastBackupTime: null as string | null,
  lastBackupFilename: null as string | null,
})

const settingsForm = reactive({
  enabled: false,
  schedule: 'daily',
  time: '02:00',
  backupPath: '',
  retention: 30,
})

function formatSize(bytes: number) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatDate(dateStr: string) {
  if (!dateStr) return '暂无'
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getNextRunTime() {
  if (settingsForm.schedule === 'daily') {
    return `每天 ${settingsForm.time}`
  }
  if (settingsForm.schedule === 'weekly') {
    return `每周一 ${settingsForm.time}`
  }
  if (settingsForm.schedule === 'monthly') {
    return `每月1号 ${settingsForm.time}`
  }
  return ''
}

async function fetchSettings() {
  const res = await request.get<Record<string, unknown>>('/security/backups/settings')
  const data = (res.data || {}) as Record<string, unknown>
  settingsForm.enabled = Boolean(data.enabled)
  settingsForm.schedule = String(data.schedule || 'daily')
  settingsForm.time = String(data.time || '02:00')
  settingsForm.backupPath = String(data.backupPath || '')
  settingsForm.retention = Number(data.retention) || 30
}

async function handleSaveSettings() {
  try {
    await request.put('/security/backups/settings', {
      enabled: settingsForm.enabled,
      schedule: settingsForm.schedule,
      time: settingsForm.time,
      backupPath: settingsForm.backupPath,
      retention: settingsForm.retention,
    })
    showSuccess('备份设置已保存')
    await fetchSettings()
  } catch (error: any) {
    // 显示详细的错误信息（如路径验证失败）
    const errorMsg = error?.response?.data?.message || error?.message || '保存失败'
    ElMessage.error(errorMsg)
  }
}

async function fetchStats() {
  const res = await request.get('/security/backups/stats')
  Object.assign(stats, res.data)
}

async function fetchData() {
  loading.value = true
  try {
    await Promise.all([
      fetchSettings(),
      fetchStats(),
      request
        .get('/security/backups', {
          params: {
            page: pagination.page,
            pageSize: pagination.pageSize,
            start_date: dateRange.value?.[0] || undefined,
            end_date: dateRange.value?.[1] || undefined,
          },
        })
        .then((res: any) => {
          const nextTotal = res.total || 0
          const maxPage = Math.max(1, Math.ceil(nextTotal / pagination.pageSize))
          if ((res.data || []).length === 0 && nextTotal > 0 && pagination.page > maxPage) {
            pagination.page = maxPage
            return fetchData()
          }
          list.value = res.data
          pagination.total = nextTotal
        }),
    ])
  } catch (error) {
    showOperationError('加载备份数据', error)
  } finally {
    loading.value = false
  }
}

function onDateRangeChange() {
  pagination.page = 1
  fetchData()
}

function onPageChange(page: number) {
  pagination.page = page
  fetchData()
}

function onPageSizeChange(size: number) {
  pagination.pageSize = size
  pagination.page = 1
  fetchData()
}

async function handleAccountSetBackup() {
  try {
    accountSetBackingUp.value = true

    // 直接下载单账套备份
    const token = localStorage.getItem('token')
    const accountSetId = localStorage.getItem('accountSetId')

    const res = await axios.post(
      '/api/security/backups/account-set',
      {},
      {
        responseType: 'blob',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-AccountSet-Id': accountSetId || '',
          Accept: 'application/octet-stream',
        },
      }
    )

    // 检查响应是否为错误（JSON）
    const contentType = String(res.headers['content-type'] || '')
    if (contentType.includes('application/json')) {
      const text = await res.data.text()
      const error = JSON.parse(text)
      throw new Error(error.message || '单账套备份失败')
    }

    // 从响应头获取文件名
    const contentDisposition = res.headers['content-disposition']
    let filename = `单账套备份_${new Date().getTime()}.db`
    if (contentDisposition) {
      const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition)
      if (matches && matches[1]) {
        filename = decodeURIComponent(matches[1].replace(/['"]/g, ''))
      }
    }

    // 创建下载链接
    const url = window.URL.createObjectURL(res.data)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    const statsHeader = res.headers['x-backup-stats']
    if (statsHeader) {
      try {
        const stats = JSON.parse(decodeURIComponent(statsHeader)) as {
          accounts?: number
          vouchers?: number
          auxCategories?: number
          auxItems?: number
          initBalances?: number
          reportDefinitions?: number
          voucherAttachments?: number
          attachmentFilesEmbedded?: number
          extraTables?: number
          extraRows?: number
        }
        const parts = [`科目 ${stats.accounts ?? 0} 个`]
        if ((stats.vouchers ?? 0) > 0) parts.push(`凭证 ${stats.vouchers} 张`)
        if ((stats.auxCategories ?? 0) > 0 || (stats.auxItems ?? 0) > 0) {
          parts.push(
            `辅助类目 ${stats.auxCategories ?? 0} 个、辅助项目 ${stats.auxItems ?? 0} 条`
          )
        }
        if ((stats.initBalances ?? 0) > 0) parts.push(`期初 ${stats.initBalances} 条`)
        if ((stats.reportDefinitions ?? 0) > 0) {
          parts.push(`动态报表 ${stats.reportDefinitions} 个`)
        }
        // FIX-329：出纳、固定资产、进销存、标准报表等总账之外的数据
        if ((stats.extraRows ?? 0) > 0) {
          parts.push(`出纳 / 固定资产 / 供应链等 ${stats.extraTables ?? 0} 张表 ${stats.extraRows} 条`)
        }
        const attRecords = stats.voucherAttachments ?? 0
        const attEmbedded = stats.attachmentFilesEmbedded ?? 0
        if (attRecords > 0) {
          const missing = attRecords - attEmbedded
          if (missing > 0) {
            parts.push(
              `附件 ${attRecords} 条（已打包 ${attEmbedded} 个，${missing} 个源文件缺失）`
            )
          } else {
            parts.push(`附件 ${attRecords} 条（已打包 ${attEmbedded} 个文件）`)
          }
        }
        ElMessage.success(`单账套备份已开始下载（${parts.join('，')}）`)
      } catch {
        ElMessage.success('单账套备份文件已开始下载')
      }
    } else {
      ElMessage.success('单账套备份文件已开始下载')
    }
  } catch (error: any) {
    // 处理 blob 响应中的错误
    if (error?.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text()
        const errorData = JSON.parse(text)
        ElMessage.error(errorData.message || '单账套备份失败')
      } catch {
        ElMessage.error('单账套备份失败')
      }
    } else {
      const errorMsg = error?.response?.data?.message || error?.message || '单账套备份失败'
      ElMessage.error(errorMsg)
    }
  } finally {
    accountSetBackingUp.value = false
  }
}

async function handleBackup() {
  // 打开备份方式选择对话框
  backupMode.value = 'default'
  backupDialogVisible.value = true
}

async function handleDatabaseCleanup() {
  try {
    cleaning.value = true
    const res: any = await request.post('/security/database/cleanup')
    if (res.code === 0) {
      const d = res.data
      const saved =
        d.savedBytes >= 1073741824
          ? (d.savedBytes / 1073741824).toFixed(1) + ' GB'
          : d.savedBytes >= 1048576
            ? (d.savedBytes / 1048576).toFixed(1) + ' MB'
            : (d.savedBytes / 1024).toFixed(0) + ' KB'
      showSuccess(`数据库清理完成！释放 ${saved}（${d.freedPages} 页）`)
      if (d.deletedLogs > 0) {
        ElMessage.info(`已清理 ${d.deletedLogs} 条过期操作日志`)
      }
      await fetchData()
    }
  } catch (error) {
    showOperationError('数据库瘦身', error)
  } finally {
    cleaning.value = false
  }
}

async function confirmBackup() {
  backingUp.value = true
  try {
    if (backupMode.value === 'download') {
      // 备份并下载到本地 - 直接使用 axios 实例
      const token = localStorage.getItem('token')
      const accountSetId = localStorage.getItem('accountSetId')

      const res = await axios.post(
        '/api/security/backups',
        { download: true },
        {
          responseType: 'blob',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-AccountSet-Id': accountSetId || '',
            Accept: 'application/octet-stream',
          },
        }
      )

      // 检查响应是否为错误（JSON）
      const contentType = String(res.headers['content-type'] || '')
      if (contentType.includes('application/json')) {
        // 响应是 JSON 错误
        const text = await res.data.text()
        const error = JSON.parse(text)
        throw new Error(error.message || '备份失败')
      }

      // 从响应头获取文件名
      const contentDisposition = res.headers['content-disposition']
      let filename = `备份文件_${new Date().getTime()}.db`
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition)
        if (matches && matches[1]) {
          filename = decodeURIComponent(matches[1].replace(/['"]/g, ''))
        }
      }

      // 创建下载链接
      const url = window.URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      ElMessage.success('备份文件已开始下载')
      backupDialogVisible.value = false
      await fetchData()
    } else {
      // 备份到服务器
      const res = await request.post('/security/backups')
      const successMsg = res.message || '备份成功'
      ElMessage.success(successMsg)
      backupDialogVisible.value = false
      await fetchData()
    }
  } catch (error: any) {
    // 处理 blob 响应中的错误
    if (error?.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text()
        const errorData = JSON.parse(text)
        ElMessage.error(errorData.message || '备份失败')
      } catch {
        ElMessage.error('备份失败')
      }
    } else {
      const errorMsg = error?.response?.data?.message || error?.message || '备份失败'
      ElMessage.error(errorMsg)
    }
  } finally {
    backingUp.value = false
  }
}

async function finishRestoreSuccess(message?: string, requireRelogin = true) {
  showSuccess(message || (requireRelogin ? '恢复成功，即将跳转到登录页' : '恢复成功'))
  if (requireRelogin) {
    userStore.logout()
    await router.replace('/login')
  } else {
    await fetchData()
  }
}

async function handleRestore(row: any) {
  const confirmed = await useConfirm({
    message: `恢复前将自动备份当前数据，再用「${row.filename}」覆盖恢复。系统将自动比对并升级旧版数据库结构。恢复成功后需重新登录，是否继续？`,
    title: '警告',
    type: 'warning',
    confirmButtonText: '确认恢复',
    cancelButtonText: '取消',
  })
  if (!confirmed) return

  try {
    const res = await request.post(`/security/backups/${row.id}/restore`)
    await finishRestoreSuccess(res.message)
  } catch (error) {
    showOperationError('恢复备份', error)
  }
}

async function handleDelete(row: any) {
  const confirmed = await useDeleteConfirm(`备份「${row.filename}」`)
  if (!confirmed) return

  try {
    await request.delete(`/security/backups/${row.id}`)
    showSuccess('删除成功')
    await fetchData()
  } catch (error) {
    showOperationError('删除备份', error)
  }
}

function handleImportClick() {
  fileInputRef.value?.click()
}

async function handleFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const confirmed = await useConfirm({
    message: `将上传的备份文件恢复到当前账套。单账套备份会合并导入当前账套；完整备份将覆盖整个数据库并需重新登录。恢复前会自动备份当前数据，是否继续？\n\n文件：${file.name}`,
    title: '警告',
    type: 'warning',
    confirmButtonText: '确认恢复',
    cancelButtonText: '取消',
  })
  if (!confirmed) {
    target.value = ''
    return
  }

  const formData = new FormData()
  formData.append('file', file)

  try {
    const res: any = await request.post('/security/backups/restore-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    const requireRelogin = res.data?.restoreType !== 'single_account_set'
    await finishRestoreSuccess(res.message, requireRelogin)
  } catch (error) {
    showOperationError('导入备份恢复', error)
  }
  target.value = ''
}

onMounted(fetchData)
</script>

<style scoped>
.page {
  padding: var(--page-pad);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--block-gap);
}

.page-header h2 {
  margin: 0;
}
.header-actions {
  display: flex;
  gap: 8px;
}

.stat-card {
  text-align: center;
  border: 1px solid #ebeef5;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  margin-bottom: 4px;
}
.stat-label {
  font-size: var(--cw-text-base);
  color: #909399;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.schedule-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--cw-text-base);
  color: #67c23a;
  padding: 8px 12px;
  background: #f0f9eb;
  border-radius: 4px;
  margin-top: 8px;
}
</style>
