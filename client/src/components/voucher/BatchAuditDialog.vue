<template>
  <el-dialog v-model="visible" title="批量操作凭证" width="480px" @close="handleClose">
    <el-form :model="form" label-width="100px">
      <el-form-item label="操作类型" required>
        <el-select v-model="form.operation" style="width: 100%">
          <el-option label="审核" value="audit" />
          <el-option label="反审核" value="unaudit" />
          <el-option label="记账" value="post" />
          <el-option v-if="canUnpost" label="反记账" value="unpost" />
        </el-select>
      </el-form-item>
      <el-form-item label="日期区间" required>
        <el-date-picker
          v-model="form.dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="凭证类型" required>
        <el-select v-model="form.voucher_type_ids" style="width: 100%" multiple clearable>
          <el-option label="全部类型" value="all" />
          <el-option v-for="t in voucherTypes" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="起始编号">
        <el-input v-model="form.start_no" placeholder="为空则从最小编号开始" />
      </el-form-item>
      <el-form-item label="结束编号">
        <el-input v-model="form.end_no" placeholder="为空则到最大编号结束" />
      </el-form-item>
      <el-form-item label="操作预览">
        <div>
          <el-button :loading="previewing" @click="emit('preview')">预览数量</el-button>
          <div v-if="previewCount !== null" style="margin-top: 8px; color: #606266">
            预计{{ operationLabel }} <b>{{ previewCount }}</b> 张凭证
          </div>
          <div
            v-if="previewFirstVoucherNo || previewLastVoucherNo"
            style="margin-top: 4px; color: #606266"
          >
            操作范围：{{ previewFirstVoucherNo || '-' }} 至 {{ previewLastVoucherNo || '-' }}
          </div>
          <div v-if="previewBlockedVoucherNo" style="margin-top: 4px; color: #f56c6c">
            {{ previewBlockedMessage }}
          </div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="auditing" @click="emit('confirm')">确认{{ operationLabel }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'

interface Props {
  modelValue: boolean
  form: any
  voucherTypes: any[]
  auditing: boolean
  previewing: boolean
  previewCount: number | null
  previewFirstVoucherNo: string | null
  previewLastVoucherNo: string | null
  previewBlockedVoucherNo: string | null
  canUnpost?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  canUnpost: true,
})
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  preview: []
  confirm: []
}>()

const visible = ref(props.modelValue)

const operationLabel = computed(() => {
  const labels: Record<string, string> = {
    audit: '审核',
    unaudit: '反审核',
    post: '记账',
    unpost: '反记账',
  }
  return labels[props.form.operation] || '操作'
})

const previewBlockedMessage = computed(() => {
  if (!props.previewBlockedVoucherNo) return ''
  const operation = props.form.operation
  if (operation === 'audit') {
    return `命中本人制单凭证：${props.previewBlockedVoucherNo}，当前条件下不可审核`
  }
  return `存在不符合条件的凭证：${props.previewBlockedVoucherNo}`
})

watch(
  () => props.modelValue,
  val => {
    visible.value = val
  }
)

watch(visible, val => {
  emit('update:modelValue', val)
})

function handleClose() {
  visible.value = false
}
</script>
