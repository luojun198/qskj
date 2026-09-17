<template>
  <el-dialog
    v-model="visible"
    title="批量操作进度"
    width="500px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="taskStatus === 'completed' || taskStatus === 'failed'"
  >
    <div class="task-progress">
      <div class="task-info">
        <div class="task-type">{{ taskTypeText }}</div>
        <div class="task-status" :class="taskStatus">{{ taskStatusText }}</div>
      </div>

      <el-progress
        :percentage="progress"
        :status="progressStatus"
        :stroke-width="20"
      />

      <div class="task-detail">
        <div v-if="taskStatus === 'processing'">
          <p>总数：{{ total }} 条</p>
          <p>已处理：{{ processed }} 条</p>
          <p>成功：{{ success }} 条</p>
          <p>失败：{{ failed }} 条</p>
        </div>
        <div v-else-if="taskStatus === 'completed'">
          <p class="success-message">{{ message }}</p>
          <p>总数：{{ total }} 条</p>
          <p>成功：{{ success }} 条</p>
          <p v-if="failed > 0" class="error-text">失败：{{ failed }} 条</p>
          <div
            v-if="failed > 0 && errorDetails && errorDetails.length > 0 && !initBalanceBlocked"
            class="error-details"
          >
            <p v-if="initBalanceBlocked" class="error-title">失败原因：</p>
            <p v-else class="error-title">失败详情（前10条）：</p>
            <div v-for="(err, idx) in errorDetails.slice(0, 10)" :key="idx" class="error-item">
              <span v-if="errorSubject(err)" class="error-id">{{ errorIdLabel }}：{{ errorSubject(err) }}</span>
              <span class="error-msg">{{ err.error }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="taskStatus === 'failed'">
          <p class="error-message">{{ message || '操作失败' }}</p>
        </div>
        <div v-else>
          <p>正在准备...</p>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button
        v-if="taskStatus === 'completed' && taskResult?.downloadUrl"
        type="success"
        :loading="downloading"
        @click="downloadResult"
      >
        下载文件
      </el-button>
      <el-button
        v-if="firstAuxBlockDetail && (taskStatus === 'completed' || taskStatus === 'failed')"
        type="warning"
        plain
        @click="emit('show-block-detail', firstAuxBlockDetail!)"
      >
        查看引用详情
      </el-button>
      <el-button
        v-if="taskStatus === 'completed' || taskStatus === 'failed'"
        type="primary"
        @click="handleClose"
      >
        关闭
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import request from '@/api/request'
import { showInitBalanceUnbalancedAlert } from '@/composables/useMessage'
import type { AuxItemDeleteBlockDetail } from '@/components/base/AuxItemDeleteBlockDialog.vue'
import type { AsyncTaskType } from '@/types/task'
import { TASK_ERROR_ID_LABELS, TASK_TYPE_LABELS } from '@/types/task'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuidLike(value: string) {
  return UUID_PATTERN.test(value.trim())
}

function formatRowId(id: string): string | null {
  const match = id.match(/^row-(\d+)$/i)
  return match ? `第 ${match[1]} 行` : null
}

interface Props {
  modelValue: boolean
  taskId: string
  taskType: AsyncTaskType
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  completed: []
  'show-block-detail': [detail: AuxItemDeleteBlockDetail]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const taskStatus = ref<'pending' | 'processing' | 'completed' | 'failed'>('pending')
const progress = ref(0)
const total = ref(0)
const processed = ref(0)
const success = ref(0)
const failed = ref(0)
const message = ref('')
const taskResult = ref<Record<string, any> | null>(null)
const downloading = ref(false)
const errorDetails = ref<
  Array<{ id: string; label?: string; error: string; block?: AuxItemDeleteBlockDetail }>
>([])
const initBalanceBlocked = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let initBalanceAlertShown = false
let completedEmitted = false
let consecutivePollErrors = 0
const MAX_TRANSIENT_POLL_ERRORS = 8

const taskTypeText = computed(() => TASK_TYPE_LABELS[props.taskType] || '批量操作')

const errorIdLabel = computed(() => TASK_ERROR_ID_LABELS[props.taskType] || '记录')

const taskStatusText = computed(() => {
  const map = {
    pending: '等待中...',
    processing: '处理中...',
    completed: '已完成',
    failed: '失败',
  }
  return map[taskStatus.value]
})

const firstAuxBlockDetail = computed(() => {
  if (props.taskType !== 'aux-items-delete') return null
  const hit = errorDetails.value.find(item => item.block?.blocked)
  return hit?.block ?? null
})

/** 失败详情标题：优先 label / 名称（编码），不展示 UUID */
function errorSubject(err: { id: string; label?: string; block?: AuxItemDeleteBlockDetail }) {
  if (err.label?.trim()) return err.label.trim()
  const item = err.block?.item
  if (item?.name || item?.code) {
    const name = item.name?.trim()
    const code = item.code?.trim()
    if (name && code) return `${name}（${code}）`
    return name || code || null
  }
  if (err.id) {
    const rowLabel = formatRowId(err.id)
    if (rowLabel) return rowLabel
    if (!isUuidLike(err.id)) return err.id
  }
  return null
}

const progressStatus = computed(() => {
  if (taskStatus.value === 'completed') return 'success'
  if (taskStatus.value === 'failed') return 'exception'
  return undefined
})

watch(
  () => props.modelValue,
  visible => {
    if (!visible) stopPolling()
  }
)

// 监听 taskId 变化，开始/停止轮询
watch(
  () => props.taskId,
  (newTaskId, oldTaskId) => {
    if (!newTaskId) {
      stopPolling()
      return
    }
    if (newTaskId !== oldTaskId) {
      startPolling()
    }
  },
  { immediate: true }
)

// 开始轮询任务状态
function startPolling() {
  if (!props.taskId) return

  initBalanceBlocked.value = false
  errorDetails.value = []
  initBalanceAlertShown = false
  completedEmitted = false
  consecutivePollErrors = 0
  taskResult.value = null

  // 清除之前的定时器
  if (pollTimer) {
    clearInterval(pollTimer)
  }

  // 立即查询一次
  pollTaskStatus()

  // 500ms 轮询，便于大数据量导入时进度条及时刷新
  pollTimer = setInterval(() => {
    pollTaskStatus()
  }, 500)
}

// 查询任务状态
async function pollTaskStatus() {
  try {
    const res = await request.get(`/tasks/${props.taskId}`, { skipErrorToast: true })
    const task = res.data as any
    consecutivePollErrors = 0

    taskStatus.value = task.status
    progress.value = task.progress
    total.value = task.total
    processed.value = task.processed
    success.value = task.success
    failed.value = task.failed
    message.value = task.message || ''
    taskResult.value = task.result || null

    // 获取错误详情
    initBalanceBlocked.value = Boolean(task.result?.initBalanceBlocked)
    if (task.result?.initBalanceBlocked && task.result?.reason) {
      errorDetails.value = [{ id: '', error: task.result.reason }]
    } else if (task.result?.errors) {
      errorDetails.value = (task.result.errors as Array<{
        id: string
        label?: string
        error: string
        block?: AuxItemDeleteBlockDetail
      }>).map(item => ({
        id: item.id,
        label: item.label,
        error: item.error,
        block: item.block,
      }))
    } else if (task.result?.failedItems) {
      errorDetails.value = task.result.failedItems.map(
        (item: {
          id: string
          label?: string
          reason: string
          block?: AuxItemDeleteBlockDetail
        }) => ({
          id: item.id,
          label: item.label,
          error: item.reason,
          block: item.block,
        })
      )
    }

    // 如果任务完成或失败，停止轮询
    if (task.status === 'completed' || task.status === 'failed') {
      if (
        task.status === 'completed' &&
        task.result?.initBalanceBlocked &&
        !initBalanceAlertShown
      ) {
        initBalanceAlertShown = true
        void showInitBalanceUnbalancedAlert({ count: task.failed })
      }
      stopPolling()
      if (!completedEmitted) {
        completedEmitted = true
        emit('completed')
      }
    }
  } catch (error: any) {
    console.error('查询任务状态失败：', error)
    const status = error.response?.status
    if (status === 404) {
      stopPolling()
      taskStatus.value = 'failed'
      message.value = '任务不存在或已过期；若后台仍在执行，请稍后刷新页面查看数据是否已更新'
      return
    }
    if (status >= 500 || !status) {
      consecutivePollErrors += 1
      if (consecutivePollErrors >= MAX_TRANSIENT_POLL_ERRORS) {
        stopPolling()
        taskStatus.value = 'failed'
        message.value = error.response?.data?.message || '查询任务状态失败，请稍后刷新页面确认结果'
      }
    }
  }
}

// 停止轮询
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// 关闭对话框
function handleClose() {
  stopPolling()
  visible.value = false
}

async function downloadResult() {
  if (!props.taskId || downloading.value) return
  downloading.value = true
  try {
    const blob = await request.download(`/tasks/${props.taskId}/download`)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = String(taskResult.value?.fileName || 'export.xlsx')
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    downloading.value = false
  }
}

// 组件卸载时停止轮询
import { onUnmounted } from 'vue'
onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.task-progress {
  padding: 20px 0;
}

.task-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.task-type {
  font-size: var(--cw-text-lg);
  font-weight: 600;
  font-weight: bold;
}

.task-status {
  font-size: var(--cw-text-base);
  padding: 4px 12px;
  border-radius: 4px;
}

.task-status.pending {
  background-color: #e6f7ff;
  color: #1890ff;
}

.task-status.processing {
  background-color: #fff7e6;
  color: #fa8c16;
}

.task-status.completed {
  background-color: #f6ffed;
  color: #52c41a;
}

.task-status.failed {
  background-color: #fff1f0;
  color: #ff4d4f;
}

.task-detail {
  margin-top: 20px;
  padding: 16px;
  background-color: #f5f5f5;
  border-radius: 4px;
}

.task-detail p {
  margin: 8px 0;
  font-size: var(--cw-text-base);
}

.success-message {
  color: #52c41a;
  font-weight: bold;
}

.error-message {
  color: #ff4d4f;
  font-weight: bold;
}

.error-text {
  color: #ff4d4f;
}

.error-details {
  margin-top: 16px;
  padding: 12px;
  background-color: #fff1f0;
  border-radius: 4px;
  max-height: 300px;
  overflow-y: auto;
}

.error-title {
  font-weight: bold;
  color: #ff4d4f;
  margin-bottom: 8px;
}

.error-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  border-bottom: 1px solid #ffccc7;
}

.error-item:last-child {
  border-bottom: none;
}

.error-id {
  color: #666;
  min-width: 120px;
}

.error-msg {
  color: #ff4d4f;
  flex: 1;
}
</style>
