<template>
  <el-alert
    v-if="showAlert"
    class="account-scope-alert"
    :type="alertType"
    :title="alertTitle"
    :closable="false"
    show-icon
  >
    {{ alertDescription }}
  </el-alert>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAccountScopeHint } from '@/composables/useAccountScopeHint'

const props = defineProps<{
  /** 当前页科目列表条数（可选，用于检测授权后无可用科目） */
  accountsCount?: number
}>()

const accountsCountRef = computed(() => props.accountsCount)

const { showAlert, alertType, alertTitle, alertDescription } = useAccountScopeHint({
  accountsCount: accountsCountRef,
})
</script>

<style scoped>
.account-scope-alert {
  margin-bottom: 12px;
}
</style>
