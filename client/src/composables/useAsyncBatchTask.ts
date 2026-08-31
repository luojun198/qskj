import { ref } from 'vue'
import request from '@/api/request'
import type { AsyncTaskType } from '@/types/task'

export function useAsyncBatchTask() {
  const taskProgressVisible = ref(false)
  const currentTaskId = ref('')
  const currentTaskType = ref<AsyncTaskType>('init-balance-import')

  async function startAsyncTask(
    taskType: AsyncTaskType,
    submit: () => Promise<{ data?: { taskId?: string } }>
  ): Promise<boolean> {
    const res = await submit()
    const taskId = res.data?.taskId
    if (!taskId) {
      throw new Error('未获取到任务ID')
    }
    currentTaskType.value = taskType
    currentTaskId.value = taskId
    taskProgressVisible.value = true
    return true
  }

  function resetTaskDialog() {
    taskProgressVisible.value = false
    currentTaskId.value = ''
  }

  return {
    taskProgressVisible,
    currentTaskId,
    currentTaskType,
    startAsyncTask,
    resetTaskDialog,
  }
}

export async function pollTaskOnce(taskId: string) {
  return request.get(`/tasks/${taskId}`)
}
