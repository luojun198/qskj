<template>
  <HiprintDialog
    v-model="visible"
    template-type="voucher"
    :title="dialogTitle"
    :print-data="printData"
    :default-panel-builder="buildDefaultVoucherPanel"
    :prepare-print-data="preparePrintData"
    :builtin-panels="builtinPanels"
    :pick-template="pickTemplate"
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
  buildForeignVoucherPanel,
  splitVoucherForPrint,
  voucherHasForeign,
  DEFAULT_VOUCHER_FIXED_ROWS,
  VOUCHER_FOREIGN_TEMPLATE_KEY,
} from '@/utils/printTemplateDefaultsHiprint'
import type { ApplicableTemplate } from '@/types/print'
import { useSystemParamsStore } from '@/stores/systemParams'
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
const systemParams = useSystemParamsStore()
const printOpts = () => ({ brand: brand.value, baseCurrency: systemParams.baseCurrency })

/** 下拉里的内置版式：标准记账凭证 / 复币记账凭证（参照润衡） */
const BUILTIN_STANDARD = '__builtin:standard'
const BUILTIN_FOREIGN = '__builtin:foreign'
const builtinPanels = [
  { id: BUILTIN_STANDARD, name: '标准记账凭证', build: buildDefaultVoucherPanel },
  { id: BUILTIN_FOREIGN, name: '复币记账凭证', build: buildForeignVoucherPanel },
]
/** 要打印的凭证里有外币分录 */
const hasForeign = computed(() => vouchers.value.some(voucherHasForeign))
/**
 * 默认模板：有外币分录 → 已保存的复币模板（默认优先），没有则内置复币版式；
 * 没有外币 → 原规则，但不自动选复币模板（只保存了复币模板时用内置标准版式）
 */
const pickTemplate = computed(() => {
  const foreign = hasForeign.value
  return (list: ApplicableTemplate[]) => {
    const isFx = (t: ApplicableTemplate) => t.template_key === VOUCHER_FOREIGN_TEMPLATE_KEY
    if (foreign) {
      const fx = list.filter(isFx)
      return (fx.find(t => t.is_default) || fx[0])?.id || BUILTIN_FOREIGN
    }
    const std = list.filter(t => !isFx(t))
    return (std.find(t => t.is_default) || std[0])?.id || BUILTIN_STANDARD
  }
})
/** 左侧竖排品牌字样：品牌设置的主标题 */
const brand = computed(() => brandingStore.title)

/** 接口原始凭证数据（切页要用未格式化的金额） */
const vouchers = ref<VoucherPrintData[]>([])
/** 未切页的打印数据：HiprintDialog 用来判断有无内容；实际渲染走 preparePrintData */
const printData = ref<Record<string, unknown>[]>([])

/** 按当前模板分录表的固定行数切页：超出的分录续打到下一张凭证纸（承前页 / 过次页） */
function preparePrintData(panel: unknown) {
  const rows = voucherRowsPerPage(panel, DEFAULT_VOUCHER_FIXED_ROWS)
  return vouchers.value.flatMap(v => splitVoucherForPrint(v, rows)).map(v => voucherToHiprintData(v, printOpts()))
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
    printData.value = list.map(v => voucherToHiprintData(v, printOpts()))
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
      systemParams.load()
      loadVoucherData()
    }
  }
)
</script>
