<template>
  <HiprintDialog
    v-model="visible"
    template-type="voucher"
    :title="dialogTitle"
    :print-data="printData"
    :default-panel-builder="buildDefaultVoucherPanel"
    :prepare-print-data="preparePrintData"
    voucher-print
    :auto-print="autoPrint"
    :allow-merge-a4="mode === 'batch'"
    :merge-a4="mergeA4"
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
  splitVoucherForPrint,
  DEFAULT_VOUCHER_FIXED_ROWS,
} from '@/utils/printTemplateDefaultsHiprint'
import { voucherRowsPerPage } from '@/utils/printTemplateHiprint'
import { useBrandingStore } from '@/stores/branding'

interface Props {
  modelValue: boolean
  voucherIds: Array<string | number>
  mode?: 'single' | 'batch'
  autoPrint?: boolean
  /** 连打时默认合打（一张 A4 上下各一张凭证） */
  mergeA4?: boolean
}
const props = withDefaults(defineProps<Props>(), { mode: 'single', autoPrint: false, mergeA4: false })
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const brandingStore = useBrandingStore()
/** 左侧竖排品牌字样：品牌设置的主标题 */
const brand = computed(() => brandingStore.title)

/** 接口原始凭证数据（切页要用未格式化的金额） */
const vouchers = ref<VoucherPrintData[]>([])
/** 未切页的打印数据：HiprintDialog 用来判断有无内容；实际渲染走 preparePrintData */
const printData = ref<Record<string, unknown>[]>([])

/** 按当前模板分录表的固定行数切页：超出的分录续打到下一张凭证纸（承前页 / 过次页） */
function preparePrintData(panel: unknown) {
  const rows = voucherRowsPerPage(panel, DEFAULT_VOUCHER_FIXED_ROWS)
  return vouchers.value.flatMap(v => splitVoucherForPrint(v, rows)).map(v => voucherToHiprintData(v, { brand: brand.value }))
}

const dialogTitle = computed(() =>
  props.voucherIds.length > 1 ? `套打凭证（共 ${props.voucherIds.length} 张）` : '套打凭证'
)

const loadVoucherData = async () => {
  if (props.voucherIds.length === 0) {
    vouchers.value = []
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
    vouchers.value = list
    printData.value = list.map(v => voucherToHiprintData(v, { brand: brand.value }))
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载凭证数据失败')
    vouchers.value = []
    printData.value = []
  }
}

watch(
  () => props.modelValue,
  v => {
    if (v) {
      brandingStore.load()
      loadVoucherData()
    }
  }
)
</script>
