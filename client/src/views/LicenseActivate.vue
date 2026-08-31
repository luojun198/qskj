<template>
  <div class="login-container">
    <div class="login-box">
      <div class="login-header">
        <h2>{{ brandingStore.title }}{{ brandingStore.subtitle ? ' · ' + brandingStore.subtitle : '' }}</h2>
        <p class="activate-subtitle">软件授权激活</p>
      </div>

      <div class="activate-info">
        <div class="activate-row">
          <span class="activate-label">机器码</span>
          <div class="activate-machine">
            <el-input :model-value="machineId" readonly />
            <el-button type="primary" plain @click="copyMachineId">复制</el-button>
          </div>
        </div>
        <p class="activate-hint">请将机器码发送给供应商以获取注册码</p>

        <el-alert
          v-if="status?.machineMismatch"
          type="warning"
          :closable="false"
          show-icon
          title="检测到硬件变更，请使用当前机器码重新获取注册码"
          class="activate-alert"
        />
        <el-alert
          v-else-if="status?.expired"
          type="warning"
          :closable="false"
          show-icon
          title="软件授权已过期，请输入新注册码续期"
          class="activate-alert"
        />
        <el-alert
          v-else-if="status?.activated && status.expiresAt"
          type="success"
          :closable="false"
          show-icon
          :title="`当前授权有效期至 ${status.expiresAt}（剩余 ${status.daysRemaining} 天）`"
          class="activate-alert"
        />
      </div>

      <el-form class="login-form" @submit.prevent="handleActivate">
        <el-form-item>
          <el-input
            v-model="licenseCode"
            type="textarea"
            :rows="3"
            placeholder="请输入注册码"
            @keyup.enter.ctrl="handleActivate"
          />
        </el-form-item>
        <el-form-item class="login-submit-item">
          <el-button type="primary" :loading="loading" style="width: 100%" @click="handleActivate">
            {{ status?.expired || status?.machineMismatch ? '续期激活' : '激 活' }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useBrandingStore } from '@/stores/branding'
import { useLicenseStore } from '@/stores/license'
import './Login.styles.css'

const router = useRouter()
const brandingStore = useBrandingStore()
const licenseStore = useLicenseStore()

const licenseCode = ref('')
const loading = ref(false)

const status = computed(() => licenseStore.status)
const machineId = computed(() => licenseStore.status.machineId || '加载中…')

onMounted(async () => {
  void brandingStore.load()
  await licenseStore.loadStatus(true)
  if (licenseStore.isValid) {
    await router.replace('/login')
  }
})

async function copyMachineId() {
  const id = licenseStore.status.machineId
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    ElMessage.success('机器码已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

async function handleActivate() {
  const code = licenseCode.value.trim()
  if (!code) {
    ElMessage.warning('请输入注册码')
    return
  }
  loading.value = true
  try {
    const data = await licenseStore.activate(code)
    ElMessage.success(`激活成功，授权有效期至 ${data?.expiresAt || ''}`)
    await router.replace('/login')
  } catch (error: any) {
    const msg = error?.response?.data?.message || '激活失败，请检查注册码'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.activate-subtitle {
  margin: 8px 0 0;
  font-size: 14px;
  color: #909399;
  font-weight: normal;
}

.activate-info {
  margin-bottom: 16px;
}

.activate-row {
  margin-bottom: 8px;
}

.activate-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}

.activate-machine {
  display: flex;
  gap: 8px;
}

.activate-machine .el-input {
  flex: 1;
}

.activate-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #909399;
}

.activate-alert {
  margin-bottom: 12px;
}
</style>
