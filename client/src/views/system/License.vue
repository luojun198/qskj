<template>
  <div class="page lic-page">
    <!-- 顶部导航 -->
    <div class="lic-header">
      <div class="lic-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="lic-header__sep">/</span>
        <span class="lic-header__title">注册信息</span>
        <el-tag v-if="statusTag" :type="statusTag.type" size="small" effect="plain" style="margin-left: 8px">
          {{ statusTag.text }}
        </el-tag>
        <el-tag size="small" type="info" effect="plain" style="margin-left: 4px">
          {{ concurrentText }}
        </el-tag>
      </div>
      <div class="lic-header__right">
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="lic-body" v-loading="loading">
      <!-- 授权概览 -->
      <el-card shadow="never" class="lic-card">
        <template #header><span class="lic-card__title">授权概览</span></template>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="机器码">
            <span class="lic-mono">{{ status.machineId || '-' }}</span>
            <el-button link type="primary" size="small" style="margin-left: 8px" @click="copyMachineId">复制</el-button>
          </el-descriptions-item>
          <el-descriptions-item label="授权状态">
            <el-tag v-if="statusTag" :type="statusTag.type" size="small">{{ statusTag.text }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="有效期至">
            {{ status.expiresAt || '-' }}
            <span v-if="status.activated && !status.expired" class="lic-muted">（剩余 {{ status.daysRemaining }} 天）</span>
          </el-descriptions-item>
          <el-descriptions-item label="并发授权">
            {{ concurrentText }}
            <span class="lic-muted">（当前在线 {{ status.onlineCount }} 人）</span>
          </el-descriptions-item>
          <el-descriptions-item label="已授权模块" :span="2">
            <el-tag
              v-for="key in status.modules"
              :key="key"
              size="small"
              type="success"
              effect="plain"
              class="lic-tag"
            >
              {{ getLicenseModuleName(key) }}
            </el-tag>
            <span v-if="!status.modules.length" class="lic-muted">未授权任何模块</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 变更注册码 -->
      <el-card shadow="never" class="lic-card">
        <template #header><span class="lic-card__title">授权变更 / 重新提交注册码</span></template>
        <p class="lic-hint">
          续期、增减模块或调整并发人数时，请联系供应商用上方机器码重新生成注册码，在此粘贴提交即可覆盖当前授权。
        </p>
        <el-input
          v-model="newCode"
          type="textarea"
          :rows="3"
          placeholder="请粘贴新的注册码"
          @keyup.enter.ctrl="submit"
        />
        <div class="lic-actions">
          <el-button type="primary" :loading="submitting" :disabled="!newCode.trim()" @click="submit">
            提交注册码
          </el-button>
        </div>
      </el-card>

      <!-- 当前在线 -->
      <el-card shadow="never" class="lic-card">
        <template #header>
          <span class="lic-card__title">当前在线用户</span>
          <span class="lic-muted">（{{ windowMinutes }} 分钟内有操作；同一用户同一 IP 只计 1 人）</span>
        </template>
        <el-table :data="online" size="small" border empty-text="暂无在线用户">
          <el-table-column prop="username" label="用户" min-width="120" />
          <el-table-column label="登录 IP" min-width="140">
            <template #default="{ row }">{{ row.loginIp || '-' }}</template>
          </el-table-column>
          <el-table-column label="登录时间" min-width="160">
            <template #default="{ row }">{{ fmtTime(row.loginAt) }}</template>
          </el-table-column>
          <el-table-column label="最后活动" min-width="160">
            <template #default="{ row }">{{ fmtTime(row.lastSeenAt) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 变动历史 -->
      <el-card shadow="never" class="lic-card">
        <template #header><span class="lic-card__title">注册变动记录</span></template>
        <el-table :data="history" size="small" border empty-text="暂无记录">
          <el-table-column label="提交时间" min-width="160">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="operator" label="操作人" min-width="100">
            <template #default="{ row }">{{ row.operator || '-' }}</template>
          </el-table-column>
          <el-table-column prop="issuedAt" label="签发日期" width="110">
            <template #default="{ row }">{{ row.issuedAt || '-' }}</template>
          </el-table-column>
          <el-table-column prop="expiresAt" label="有效期至" width="110" />
          <el-table-column label="并发" width="90">
            <template #default="{ row }">{{ row.maxConcurrent > 0 ? `${row.maxConcurrent} 人` : '不限' }}</template>
          </el-table-column>
          <el-table-column label="授权模块" min-width="220">
            <template #default="{ row }">{{ row.modules.map(getLicenseModuleName).join('、') }}</template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import {
  getLicenseInfo,
  type LicenseLogEntry,
  type LicenseOnlineUser,
  type LicenseStatus,
} from '@/api/license'
import { useLicenseStore } from '@/stores/license'
import { getLicenseModuleName } from '@/config/licenseModules'

const router = useRouter()
const licenseStore = useLicenseStore()

const loading = ref(false)
const submitting = ref(false)
const newCode = ref('')
const status = ref<LicenseStatus>({ ...licenseStore.status })
const online = ref<LicenseOnlineUser[]>([])
const history = ref<LicenseLogEntry[]>([])
const windowMinutes = ref(30)

const statusTag = computed<{ text: string; type: 'success' | 'warning' | 'danger' } | null>(() => {
  const s = status.value
  if (!s.activated) return { text: '未激活', type: 'danger' }
  if (s.machineMismatch) return { text: '硬件已变更', type: 'danger' }
  if (s.expired) return { text: '已过期', type: 'danger' }
  if (s.daysRemaining <= 30) return { text: '即将到期', type: 'warning' }
  return { text: '正常', type: 'success' }
})

const concurrentText = computed(() =>
  status.value.maxConcurrent > 0 ? `最多 ${status.value.maxConcurrent} 人同时在线` : '并发不限'
)

/** SQLite datetime('now') 为 UTC，转成本地时间显示 */
function fmtTime(value: string | null | undefined): string {
  if (!value) return '-'
  const d = new Date(value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return value
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

async function load() {
  loading.value = true
  try {
    const res = await getLicenseInfo()
    const data = res.data
    if (data) {
      status.value = data.status
      online.value = data.online
      history.value = data.history
      windowMinutes.value = data.onlineWindowMinutes
    }
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '加载注册信息失败')
  } finally {
    loading.value = false
  }
}

async function copyMachineId() {
  if (!status.value.machineId) return
  try {
    await navigator.clipboard.writeText(status.value.machineId)
    ElMessage.success('机器码已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

async function submit() {
  const code = newCode.value.trim()
  if (!code) return
  submitting.value = true
  try {
    const data = await licenseStore.activate(code)
    const moduleText = (data?.modules || []).map(getLicenseModuleName).join('、')
    const cc = data?.maxConcurrent ? `，并发 ${data.maxConcurrent} 人` : '，并发不限'
    ElMessage.success(`注册码已更新，有效期至 ${data?.expiresAt || ''}${cc}${moduleText ? `，模块：${moduleText}` : ''}`)
    newCode.value = ''
    await load()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '提交失败，请检查注册码')
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.lic-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.lic-header__left {
  display: flex;
  align-items: center;
}
.lic-header__sep {
  margin: 0 8px;
  color: var(--el-text-color-placeholder);
}
.lic-header__title {
  font-weight: 600;
}
.lic-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lic-card__title {
  font-weight: 600;
}
.lic-mono {
  font-family: Consolas, monospace;
}
.lic-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 4px;
}
.lic-tag {
  margin-right: 6px;
}
.lic-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.lic-actions {
  margin-top: 8px;
  text-align: right;
}
</style>
