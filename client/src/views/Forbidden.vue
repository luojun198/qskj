<template>
  <div class="forbidden">
    <el-result icon="warning" title="403" sub-title="您没有访问此页面的权限">
      <template #extra>
        <el-button type="primary" @click="goBack">返回</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { getDefaultLandingPath } from '@/config/navigation'
import { useUserStore } from '@/stores/user'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useLicenseStore } from '@/stores/license'

const router = useRouter()
const userStore = useUserStore()
const systemParamsStore = useSystemParamsStore()
const licenseStore = useLicenseStore()

function goBack() {
  router.push(
    getDefaultLandingPath(userStore.permissions, systemParamsStore.enableCashFlow, licenseStore.modules)
  )
}
</script>

<style scoped>
@import './Forbidden.styles.css';
</style>
