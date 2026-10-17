<template>
  <div class="page dq-page">
    <!-- 顶部导航（第七份反馈：折旧查询参照润衡「折旧查询」表格样式，按年月范围查询） -->
    <div class="dq-header">
      <div class="dq-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="dq-header__sep">/</span>
        <span class="dq-header__title">折旧查询</span>
        <el-tag v-if="panel?.queried" size="small" effect="plain" style="margin-left:8px">
          {{ panel.rangeLabel }} · {{ panel.dataRows.length }} 条 · 合计 {{ panel.fmtAmt(panel.totalDepr) }}
        </el-tag>
      </div>
      <div class="dq-header__right">
        <el-button size="small" :disabled="!panel?.dataRows.length" @click="panel?.exportExcel()">另存</el-button>
        <el-button size="small" plain @click="router.push('/asset/depreciation')">去计提折旧</el-button>
      </div>
    </div>

    <DeprQueryPanel ref="panel" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import DeprQueryPanel from './DeprQueryPanel.vue'

const router = useRouter()
const panel = ref<InstanceType<typeof DeprQueryPanel> | null>(null)

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/asset/depreciation')
}
</script>

<style scoped>
.dq-page { display: flex; flex-direction: column; height: 100%; }
.dq-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.dq-header__left { display: flex; align-items: center; }
.dq-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.dq-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.dq-header__right { display: flex; align-items: center; gap: 8px; }
</style>
