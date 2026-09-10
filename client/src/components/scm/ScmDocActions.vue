<template>
  <div class="action-btns">
    <el-button link type="primary" size="small" title="查看" @click="handleView">查</el-button>
    <el-button v-if="row.doc_type !== 'MRP'" link type="primary" size="small" title="打印" @click="handlePrint">印</el-button>
    <el-button v-if="row.status === 'draft' && !isLocked(row)" link type="primary" size="small" title="编辑" @click="handleEdit">编</el-button>
    <el-button v-if="row.doc_type !== 'MRP' && row.status === 'draft'" link type="success" size="small"
      :disabled="row.doc_type === 'AS' && row.mrp_status === 'draft'"
      :title="row.doc_type === 'AS' && row.mrp_status === 'draft' ? '请先审核或删除关联的草稿MRP计算单' : '审核'" @click="handleAudit">审</el-button>
    <el-button v-if="row.doc_type !== 'MRP' && row.status === 'audited'" link type="warning" size="small"
      :disabled="mrpLocked" :title="mrpLocked ? `已进入 MRP 计算单 ${row.mrp_doc_no || ''}，不能反审核` : '反审核'"
      @click="handleUnaudit">反</el-button>
    <el-button v-if="row.doc_type !== 'MRP' && row.status === 'draft' && !isLocked(row)" link type="danger" size="small" title="删除" @click="handleDelete">删</el-button>
    <el-button v-if="row.doc_type !== 'MRP' && row.status === 'audited' && !row.voucher_id" link type="warning" size="small" title="生成凭证" @click="handleGenVoucher">凭</el-button>
    <ScmPushMenu v-if="row.id && row.doc_type === 'SOa' && row.status === 'audited'"
      source-kind="sales_order" :source-id="row.id" compact :auto-load="false" @changed="emit('changed')" />
    <ScmPushMenu v-if="row.id && row.doc_type === 'AS' && row.status === 'draft'"
      source-kind="assembly" :source-id="row.id" compact :auto-load="false" @changed="emit('changed')" />
    <el-button v-if="row.doc_type === 'MR' && canGenerateDownstream(row.status, row.doc_type, row.push_progress)" link type="success" size="small" :title="row.push_progress === 'part' ? '继续下推生成采购订单/委外计划/生产计划' : '下推生成采购订单/委外计划/生产计划'" @click="handleMrPush">推</el-button>
    <el-button v-if="hasTrace(row)" link type="primary" size="small" title="查看上下游关联单据" @click="openDownstream">览</el-button>
    <el-button v-if="canShowStandardPushAction(row.doc_type) && canGenerateDownstream(row.status, row.doc_type, row.push_progress)" link type="success" size="small" :title="downstreamActionLabel(row.doc_type, row.push_progress)" @click="handlePush">推</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi, type ScmDoc } from '@/api/scm'
import ScmPushMenu from './ScmPushMenu.vue'
import { isLocked, hasTrace, canGenerateDownstream, canShowStandardPushAction, downstreamActionLabel, PUSH_MAP, typeName } from '@/utils/scmDoc'
import { scmDocumentRoute, scmDocNavContextToDetailQuery, type ScmDocNavContext } from '@/utils/scmDocNavigation'
import { confirmAuditDefaultWarehouses } from '@/utils/scmAuditDefaultWarehouseConfirm'

const props = defineProps<{ row: ScmDoc; navContext?: ScmDocNavContext }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const router = useRouter()
const mrpLocked = computed(() => ['draft', 'audited'].includes(String(props.row.mrp_status || '')))

// 跳转类（与列表一致）
function handleView() { router.push(scmDocumentRoute(props.row.id!, props.row.doc_type, props.row.status, scmDocNavContextToDetailQuery(props.navContext))) }
function handlePrint() { router.push({ name: 'ScmDocPrint', params: { id: props.row.id } }) }
function handleEdit() { router.push(scmDocumentRoute(props.row.id!, props.row.doc_type, 'draft', scmDocNavContextToDetailQuery(props.navContext))) }
function handlePush() {
  const target = PUSH_MAP[props.row.doc_type]
  if (!target) return
  router.push({ name: 'ScmDocNew', query: { doc_type: target, source_doc_id: props.row.id } })
}
function handleMrPush() { router.push({ name: 'ScmMrPushPreview', params: { id: props.row.id! }, query: { from: 'list' } }) }
function openDownstream() { router.push({ name: 'ScmDocDownstream', params: { id: props.row.id! } }) }

// 需刷新类（成功后 emit changed）
async function auditWithItemDefaultWarehouses(id: string) {
  try {
    return await scmApi.auditDoc(id, {}, { skipErrorToast: true })
  } catch (error: any) {
    const data = error?.response?.data?.data
    if (data?.error_code !== 'DEFAULT_WAREHOUSE_CONFIRMATION_REQUIRED') throw error
    await confirmAuditDefaultWarehouses(data)
    return scmApi.auditDoc(id, { apply_item_default_warehouses: true }, { skipErrorToast: true })
  }
}

async function handleAudit() {
  await ElMessageBox.confirm('确认审核？', '提示', { type: 'info' })
  const r = await auditWithItemDefaultWarehouses(props.row.id!)
  // 信用额度与序列号（盘点差异）告警都不阻断审核，合并后一并提示
  const warns = [(r as any)?.data?.credit_warning, (r as any)?.data?.serial_warning].filter(Boolean)
  // 发票校正来源单据挂账额属于正常结果，用 info 语气提示而非告警
  const notice = (r as any)?.data?.invoice_notice
  if (warns.length) ElMessage.warning({ message: warns.join('；'), duration: 6000 })
  else if (notice) ElMessage.success({ message: `已审核。${notice}`, duration: 6000 })
  else ElMessage.success('已审核')
  emit('changed')
}
async function handleUnaudit() {
  try { await ElMessageBox.confirm('确认反审核（将撤销库存移动）？', '提示', { type: 'warning' }) } catch { return }
  try {
    await scmApi.unauditDoc(props.row.id!, { skipErrorToast: true })
    ElMessage.success('已反审核')
    emit('changed')
  } catch (e) { await showActionError(e, '反审核') }
}
async function handleDelete() {
  try { await ElMessageBox.confirm(`确认删除单据「${props.row.doc_no}」？`, '提示', { type: 'warning' }) } catch { return }
  try {
    await scmApi.deleteDoc(props.row.id!, { skipErrorToast: true })
    ElMessage.success('已删除')
    emit('changed')
  } catch (e) { await showActionError(e, '删除') }
}

// 「已被下游引用」类错误 → 优雅弹窗列出下游单据，并可一键跳上下游追溯页
async function showActionError(err: any, actionLabel: string) {
  const msg: string = err?.response?.data?.message || ''
  if (!msg.includes('下游单据引用')) {
    if (msg) ElMessage.error(msg)
    return
  }
  let downs: any[] = []
  try {
    const r = await scmApi.getDocDownstream(props.row.id!)
    if (r.code === 0) downs = r.data.downstream_docs || []
  } catch { /* 兜底：取不到下游也照常弹窗 */ }

  const body = h('div', { style: 'line-height:1.9' }, [
    h('p', { style: 'margin:0 0 8px' }, `本单据已被以下下游单据引用，需先删除或反审核这些下游单据后，才能${actionLabel}：`),
    downs.length
      ? h('ul', { style: 'margin:0;padding-left:18px;max-height:240px;overflow:auto' },
          downs.map(d => h('li', { style: 'margin:2px 0' },
            `${typeName(d.doc_type)}　${d.doc_no}（${d.status === 'audited' ? '已审核' : '草稿'}）`)))
      : h('p', { style: 'margin:0;color:var(--el-text-color-secondary)' }, msg),
  ])

  try {
    await ElMessageBox({
      title: `无法${actionLabel}`,
      message: body,
      type: 'warning',
      showCancelButton: true,
      confirmButtonText: '查看下游单据',
      cancelButtonText: '关闭',
    })
    router.push({ name: 'ScmDocDownstream', params: { id: props.row.id! } })
  } catch { /* 关闭 */ }
}
async function handleGenVoucher() {
  await ElMessageBox.confirm('为该单据生成记账凭证？', '提示', { type: 'info' })
  const r = await scmApi.genVoucher(props.row.id!)
  if (r.code === 0) ElMessage.success(`已生成凭证 ${r.data.voucher_no}`)
  emit('changed')
}
</script>

<style scoped>
.action-btns { display: flex; justify-content: center; align-items: center; gap: 2px; flex-wrap: wrap; }
.action-btns .el-button { margin: 0 !important; padding: 0 2px !important; min-width: auto; font-size: var(--cw-text-base); }
</style>
