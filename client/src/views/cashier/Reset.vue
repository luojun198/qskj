<template>
  <div class="page page-cashier-reset">
        <div class="content">
      <el-alert
        title="危险操作"
        type="error"
        description="此操作将清除当前账套下所有出纳单据、期初余额和银行对账单，且不可恢复。请确认后再执行。"
        show-icon
        :closable="false"
        style="margin-bottom:24px"
      />
      <el-button type="danger" size="large" :loading="loading" @click="handleReset">
        <el-icon><Delete /></el-icon>一键清理出纳单据
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { cashierApi } from '@/api/cashier'

const loading = ref(false)

async function handleReset() {
  await ElMessageBox.confirm(
    '将清空所有出纳单据、期初余额和银行对账单，操作不可恢复，确认继续？',
    '出纳初始化确认',
    { type: 'warning', confirmButtonText: '确认清理', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
  )
  loading.value = true
  try {
    await cashierApi.reset()
    ElMessage.success('出纳数据已清空')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.page-cashier-reset { display: flex; flex-direction: column; height: 100%; }
.content { padding: 32px 24px; }
</style>
