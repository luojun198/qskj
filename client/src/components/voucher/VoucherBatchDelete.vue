<template>
  <el-dialog v-model="visible" title="批量删除凭证" width="480px" @close="handleClose">
    <el-form :model="form" label-width="100px">
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
          <el-option v-for="t in voucherTypes" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="起始编号">
        <el-input v-model="form.start_no" placeholder="为空则从最小编号开始" />
      </el-form-item>
      <el-form-item label="结束编号">
        <el-input v-model="form.end_no" placeholder="为空则到最大编号结束" />
      </el-form-item>
      <el-form-item label="删除预览">
        <div>
          <el-button :loading="previewing" @click="handlePreview">预览数量</el-button>
          <div v-if="previewData.count !== null" style="margin-top: 8px; color: #606266">
            预计删除 <b>{{ previewData.count }}</b> 张凭证
          </div>
          <div
            v-if="previewData.firstVoucherNo || previewData.lastVoucherNo"
            style="margin-top: 4px; color: #606266"
          >
            删除范围：{{ previewData.firstVoucherNo || '-' }} 至
            {{ previewData.lastVoucherNo || '-' }}
          </div>
          <div v-if="previewData.blockedVoucherNo" style="margin-top: 4px; color: #f56c6c">
            命中已记账凭证：{{ previewData.blockedVoucherNo }}，当前条件下不可删除
          </div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="danger" :loading="deleting" @click="handleDelete">确认删除</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/api/request'
import { BATCH_REQUEST_OPTIONS } from '@/api/batchRequest'

interface Props {
  modelValue: boolean
  voucherTypes: any[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
}>()

const visible = ref(props.modelValue)
const previewing = ref(false)
const deleting = ref(false)

const form = ref({
  dateRange: [] as string[],
  voucher_type_ids: [] as string[],
  start_no: '',
  end_no: '',
})

const previewData = ref({
  count: null as number | null,
  firstVoucherNo: null as string | null,
  lastVoucherNo: null as string | null,
  blockedVoucherNo: null as string | null,
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

async function handlePreview() {
  const [start_date, end_date] = form.value.dateRange || []
  if (!start_date || !end_date || !form.value.voucher_type_ids?.length) {
    ElMessage.error('请完整选择日期区间和凭证类型')
    return
  }

  previewing.value = true
  try {
    const res = await request.post<{
      count: number
      firstVoucherNo: string | null
      lastVoucherNo: string | null
      blockedVoucherNo: string | null
    }>('/voucher/vouchers/batch-delete/preview', {
      start_date,
      end_date,
      voucher_type_ids: form.value.voucher_type_ids,
      start_no: form.value.start_no,
      end_no: form.value.end_no,
    })
    previewData.value = {
      count: res.data?.count ?? 0,
      firstVoucherNo: res.data?.firstVoucherNo || null,
      lastVoucherNo: res.data?.lastVoucherNo || null,
      blockedVoucherNo: res.data?.blockedVoucherNo || null,
    }
  } finally {
    previewing.value = false
  }
}

async function handleDelete() {
  const [start_date, end_date] = form.value.dateRange || []
  if (!start_date || !end_date || !form.value.voucher_type_ids?.length) {
    ElMessage.error('请完整选择日期区间和凭证类型')
    return
  }

  if (previewData.value.count === null) {
    await handlePreview()
  }
  if (previewData.value.blockedVoucherNo) {
    ElMessage.error(`存在已记账凭证，无法删除：${previewData.value.blockedVoucherNo}`)
    return
  }

  await ElMessageBox.confirm(
    `当前条件预计删除 ${previewData.value.count ?? 0} 张凭证，删除后不可恢复，是否继续？`,
    '二次确认',
    {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    }
  )

  deleting.value = true
  try {
    const res = await request.post('/voucher/vouchers/batch-delete', {
      start_date,
      end_date,
      voucher_type_ids: form.value.voucher_type_ids,
      start_no: form.value.start_no,
      end_no: form.value.end_no,
    }, BATCH_REQUEST_OPTIONS)
    ElMessage.success(res.message || '批量删除成功')
    handleClose()
    emit('success')
  } finally {
    deleting.value = false
  }
}

function handleClose() {
  visible.value = false
  form.value = { dateRange: [], voucher_type_ids: [], start_no: '', end_no: '' }
  previewData.value = { count: null, firstVoucherNo: null, lastVoucherNo: null, blockedVoucherNo: null }
}
</script>
