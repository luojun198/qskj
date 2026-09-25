<template>
  <div class="page page-cashier-reset">
        <div class="content">
      <el-alert
        title="危险操作"
        type="error"
        description="此操作将清除当前账套下所有出纳日记账、期初余额、对账结果与出纳结账记录，并删除出纳生成的凭证（已记账的自动反记账后删除），不可恢复。执行前会自动完整备份本账套。"
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
  loading.value = true
  let impact
  try {
    const res = await cashierApi.resetPreview()
    if (res.code !== 0) return
    impact = res.data
  } finally {
    loading.value = false
  }
  // 唯一不能自动处理的情况：已记账出纳凭证所在的总账期间已结账（总账审计冻结，初始化不越权反结总账）
  if (impact.blockedGlPeriods.length) {
    await ElMessageBox.alert(
      `总账 ${impact.blockedGlPeriods.join('、')} 已结账，其中有已记账的出纳凭证，无法自动反记账。请先在总账「期末结账」中取消结账后再初始化。`,
      '无法初始化', { type: 'error' }).catch(() => {})
    return
  }
  const posted = impact.postedVouchers
  const lines = [
    `出纳日记账 <b>${impact.journalRows}</b> 行、期初余额、对账结果`,
    `出纳生成的凭证 <b>${impact.vouchers}</b> 张${posted.length
      ? `，其中已记账 <b>${posted.length}</b> 张（${posted.slice(0, 5).join('、')}${posted.length > 5 ? ' 等' : ''}）将<b>自动反记账后删除</b>`
      : ''}`,
    impact.closedMonths.length ? `出纳结账记录 ${impact.closedMonths.join('、')} 将一并清除` : '',
  ].filter(Boolean)
  try {
    await ElMessageBox.confirm(
      `将清理以下出纳数据，操作不可恢复：<br>· ${lines.join('<br>· ')}<br><br>执行前会自动完整备份本账套。确认继续？`,
      '出纳初始化确认',
      { type: 'warning', dangerouslyUseHTMLString: true, confirmButtonText: '确认清理', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch { return }
  loading.value = true
  try {
    const res = await cashierApi.reset()
    if (res.code !== 0) return
    const d = res.data
    ElMessage.success(
      `出纳数据已清空：删除凭证 ${d.deletedVouchers} 张（其中自动反记账 ${d.unpostedVouchers} 张）`
      + `${d.clearedClosings ? `，清除结账 ${d.clearedClosings} 个月` : ''}；备份文件 ${d.backup}`)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.page-cashier-reset { display: flex; flex-direction: column; height: 100%; }
.content { padding: 32px 24px; }
</style>
