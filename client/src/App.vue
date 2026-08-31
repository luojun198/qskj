<template>
  <div v-if="!routerReady" class="app-loading-shell" role="status" aria-live="polite">
    <span class="app-loading-dot"></span>
    <span>正在加载系统…</span>
  </div>
  <el-config-provider v-else :locale="zhCn" :dialog="dialogDefaults">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import router from './router'

const routerReady = ref(false)

onMounted(() => {
  void router.isReady().finally(() => {
    routerReady.value = true
  })
})

const dialogDefaults = {
  draggable: true,
  overflow: true,
}
</script>

<style scoped>
.app-loading-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #557277;
  background: #f5faf9;
  font: 14px/1.5 system-ui, "Microsoft YaHei", sans-serif;
}

.app-loading-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #12c7ae;
  animation: app-loading-pulse 0.9s ease-in-out infinite alternate;
}

@keyframes app-loading-pulse {
  to { opacity: 0.3; transform: scale(0.72); }
}
</style>
