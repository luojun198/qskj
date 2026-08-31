<template>
  <el-button v-if="returnLabel" plain @click="handleReturn">
    <el-icon><Back /></el-icon>
    返回{{ returnLabel }}
  </el-button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back } from '@element-plus/icons-vue'
import { useNavigationReturnStore } from '@/stores/navigationReturn'
import { useVoucherModalReturnStore } from '@/stores/voucherModalReturn'

const route = useRoute()
const router = useRouter()
const navigationReturnStore = useNavigationReturnStore()
const voucherModalReturnStore = useVoucherModalReturnStore()

const returnLabel = computed(() => {
  if (route.query.from === 'voucher' && voucherModalReturnStore.peek()) {
    return '凭证'
  }
  if (route.query.from === 'drill') {
    return navigationReturnStore.peek()?.label || ''
  }
  return ''
})

function handleReturn() {
  if (route.query.from === 'voucher') {
    const state = voucherModalReturnStore.peek()
    if (state?.sourcePath && state.voucherId) {
      router.push({
        path: state.sourcePath,
        query: { openVoucherId: state.voucherId },
      })
      return
    }
  }

  const state = navigationReturnStore.peek()
  if (state?.path) {
    router.push({
      path: state.path,
      query: state.query || {},
    })
    return
  }

  router.back()
}
</script>
