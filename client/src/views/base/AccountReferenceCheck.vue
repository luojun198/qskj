<template>
  <div class="page page-account-ref-check">
    <header class="check-header">
      <div class="check-header__left">
        <el-button link :icon="ArrowLeft" @click="router.push('/base/account')">返回</el-button>
        <h3>科目设置检查</h3>
        <el-tag v-if="!loading" :type="issues.length ? 'danger' : 'success'">
          {{ issues.length ? `${issues.length} 项待修复` : '全部正常' }}
        </el-tag>
      </div>
      <div class="check-header__right">
        <el-button :icon="Refresh" :loading="loading" @click="load">重新检查</el-button>
        <el-button v-permission="'system:account'" type="primary" :disabled="!fixableCount" :loading="fixing" @click="fixAll">
          全部改指建议科目
        </el-button>
      </div>
    </header>

    <el-alert type="info" :closable="false" show-icon class="check-tip"
      title="设置里选用的科目有了下级科目（变成父科目）时，生成凭证会记到父科目上，余额表会丢失这部分金额；指向本账套不存在的科目时，生成凭证会报错。「有下级科目」的可一键改指各自的第一个末级子科目，「科目不存在」的需到对应设置页手工选择。" />

    <el-table v-loading="loading" :data="issues" border stripe size="small" :max-height="560" empty-text="没有发现指向父科目的设置">
      <el-table-column label="设置项" prop="label" min-width="220" show-overflow-tooltip />
      <el-table-column label="位置" prop="where" min-width="240" show-overflow-tooltip />
      <el-table-column label="问题" width="150">
        <template #default="{ row }">
          <el-tag :type="row.kind === 'missing' ? 'warning' : 'danger'" size="small">
            {{ row.kind === 'missing' ? '科目不存在' : '有下级科目' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前科目" width="160">
        <template #default="{ row }"><span class="bad">{{ row.value }}</span></template>
      </el-table-column>
      <el-table-column label="建议改为" min-width="220">
        <template #default="{ row }">
          <span v-if="row.kind === 'nonleaf'" class="good">{{ row.suggested }} {{ row.suggestedName }}</span>
          <span v-else class="muted">请到对应设置页手工选择</span>
        </template>
      </el-table-column>
      <el-table-column label="影响条数" prop="count" width="100" align="right" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import request from '@/api/request'

interface Issue { kind: 'nonleaf' | 'missing'; label: string; where: string; value: string; count: number; suggested: string; suggestedName: string }

const router = useRouter()
const issues = ref<Issue[]>([])
const loading = ref(false)
const fixing = ref(false)
const fixableCount = computed(() => issues.value.filter(i => i.kind === 'nonleaf').length)

async function load() {
  loading.value = true
  try {
    const res: any = await request.get('/base/accounts/reference-check')
    issues.value = res?.data?.issues || []
  } finally {
    loading.value = false
  }
}

async function fixAll() {
  try {
    await ElMessageBox.confirm(`将把 ${fixableCount.value} 项设置改指各自的第一个末级子科目，确认继续？`, '一键修复', { type: 'warning' })
  } catch { return }
  fixing.value = true
  try {
    const res: any = await request.post('/base/accounts/reference-check/fix', {})
    ElMessage.success(res?.message || '已修复')
    await load()
  } finally {
    fixing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-account-ref-check { display: flex; flex-direction: column; gap: var(--block-gap); padding: var(--page-pad); }
.check-header { display: flex; align-items: center; justify-content: space-between; }
.check-header__left { display: flex; align-items: center; gap: 12px; }
.check-header__left h3 { margin: 0; }
.bad { color: var(--el-color-danger); font-weight: 600; }
.good { color: var(--el-color-success); }
.muted { color: var(--el-text-color-secondary); }
</style>
