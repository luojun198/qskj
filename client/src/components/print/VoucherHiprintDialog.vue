<template>
  <HiprintDialog
    v-model="visible"
    template-type="voucher"
    template-key="voucher:standard"
    :title="dialogTitle"
    :print-data="printData"
    :default-panel-builder="buildDefaultVoucherPanel"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import HiprintDialog from './HiprintDialog.vue'
import request from '@/api/request'
import type { VoucherPrintData } from '@/types/print'
import {
  voucherToHiprintData,
  buildDefaultVoucherPanel,
} from '@/utils/printTemplateDefaultsHiprint'

interface Props {
  modelValue: boolean
  voucherIds: Array<string | number>
  mode?: 'single' | 'batch'
}
const props = withDefaults(defineProps<Props>(), { mode: 'single' })
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const printData = ref<Record<string, unknown>[]>([])

const dialogTitle = computed(() =>
  props.voucherIds.length > 1 ? `套打凭证（共 ${props.voucherIds.length} 张）` : '套打凭证'
)

const loadVoucherData = async () => {
  if (props.voucherIds.length === 0) {
    printData.value = []
    return
  }
  try {
    let list: VoucherPrintData[] = []
    if (props.mode === 'single' && props.voucherIds.length === 1) {
      const res = await request.get(`/voucher/print-data/${props.voucherIds[0]}`)
      list = [res.data as VoucherPrintData]
    } else {
      const res = await request.post('/voucher/print-data/batch', {
        voucher_ids: props.voucherIds,
      })
      list = (res.data as VoucherPrintData[]) || []
    }
    printData.value = list.map(voucherToHiprintData)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载凭证数据失败')
    printData.value = []
  }
}

watch(
  () => props.modelValue,
  v => {
    if (v) loadVoucherData()
  }
)
</script>
