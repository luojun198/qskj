<template>
  <el-dialog
    v-model="visible"
    :title="!row ? '新增往来单位' : isAudited ? '查看往来单位（已审核）' : '编辑往来单位'"
    width="760px"
    draggable
    @keydown="onDialogKeydown"
  >
    <el-form :model="form" label-width="90px" size="small" :disabled="isAudited">
      <div class="form-sector">
        <div class="form-sector-title">基本身份</div>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="单位编号" required><el-input v-model="form.code" :disabled="!!row" /></el-form-item></el-col>
          <el-col :span="16"><el-form-item label="单位全称" required><el-input v-model="form.name" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="单位属性" required>
              <el-radio-group v-model="form.partner_type">
                <el-radio value="supplier">供应商</el-radio>
                <el-radio value="customer">客户</el-radio>
                <el-radio value="both">双向</el-radio>
              </el-radio-group>
              <el-checkbox
                :model-value="form.is_outsource === 1"
                :disabled="form.partner_type === 'customer'"
                style="margin-left:12px"
                @update:model-value="(v:any) => form.is_outsource = v ? 1 : 0"
              >委外厂</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :span="6"><el-form-item label="简称"><el-input v-model="form.short_name" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="税号"><el-input v-model="form.tax_no" /></el-form-item></el-col>
        </el-row>
      </div>

      <div class="form-sector">
        <div class="form-sector-title">业务与财务</div>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="业务员"><el-input v-model="form.salesman" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="信用额度"><el-input-number v-model="form.credit_limit" :precision="2" :controls="false" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="默认税率%"><el-input-number v-model="form.tax_rate" :precision="2" :controls="false" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8">
            <el-form-item label="付款方式">
              <el-select v-model="form.payment_type" clearable style="width:100%">
                <el-option label="现金" value="cash" />
                <el-option label="转账" value="transfer" />
                <el-option label="挂账" value="credit" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8"><el-form-item label="账期(天)"><el-input-number v-model="form.credit_days" :min="0" :precision="0" :controls="false" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8">
            <el-form-item label="价格等级">
              <el-select v-model="form.price_level" style="width:100%">
                <el-option :value="1" label="1 级售价（默认）" />
                <el-option :value="2" label="2 级售价" />
                <el-option :value="3" label="3 级售价" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8"><el-form-item label="应收科目"><AccountSelect v-model="form.ar_account" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="应付科目"><AccountSelect v-model="form.ap_account" /></el-form-item></el-col>
        </el-row>
      </div>

      <div class="form-sector">
        <div class="form-sector-title">联系方式</div>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="联系人"><el-input v-model="form.contact" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="联系电话"><el-input v-model="form.phone" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="邮箱"><el-input v-model="form.email" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="QQ"><el-input v-model="form.qq" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="微信"><el-input v-model="form.wechat" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="详细地址"><el-input v-model="form.address" type="textarea" :rows="1" /></el-form-item></el-col>
        </el-row>
      </div>

      <div class="form-sector">
        <div class="form-sector-title">收货信息</div>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="收货联系人"><el-input v-model="form.ship_contact" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="收货电话"><el-input v-model="form.ship_phone" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="国家"><el-input v-model="form.country" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="省"><el-input v-model="form.province" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="市"><el-input v-model="form.city" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="区/县"><el-input v-model="form.county" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="收货地址"><el-input v-model="form.ship_address" type="textarea" :rows="1" /></el-form-item></el-col>
        </el-row>
      </div>
    </el-form>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <span v-if="isAudited" class="audited-tip">已审核的往来单位不能修改、删除，须先反审核</span>
        <el-button @click="visible = false">{{ isAudited ? '关闭' : '取消' }}</el-button>
        <el-button v-if="isAudited" v-permission="'scm:master-audit'" type="warning" :loading="saving" @click="handleUnaudit">反审核</el-button>
        <el-button v-if="!row" :loading="saving" @click="handleSave(true)">保存并新增 (Ctrl+Enter)</el-button>
        <el-button v-if="!isAudited" type="primary" :loading="saving" @click="handleSave(false)">确认保存 (Enter)</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi, type ScmPartner } from '@/api/scm'
import AccountSelect from '@/components/base/AccountSelect.vue'

const props = defineProps<{ modelValue: boolean; row?: ScmPartner | null; defaultType?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'saved', partner: any): void }>()

// el-dialog 用普通 ref 作 v-model，prop↔ref 双向同步（computed 作 v-model 时 el-dialog 对外部关闭不反应）
const visible = ref(false)
const form = ref<Partial<ScmPartner>>({})
const saving = ref(false)
/** 已审核档案只读（FIX-416，与物料 FIX-412 同口径；服务端同样拦截） */
const isAudited = computed(() => !!props.row && form.value.audit_status === 'audited')

/** 最近一次自动取到的编号；用户没手改时，切换「单位属性」会按新属性的编码规则重新取号 */
let autoCode = ''
let fetchSeq = 0

async function fetchCode(partnerType?: string) {
  const seq = ++fetchSeq
  try {
    const r = await scmApi.getPartnerNextNo(partnerType || undefined)
    // 只认最后一次取号；返回前用户已手改编号 / 已切到编辑，则不覆盖
    if (seq !== fetchSeq) return
    if (r.code === 0 && !props.row && (form.value.code || '') === autoCode) {
      form.value.code = r.data.next_no
      autoCode = r.data.next_no
    }
  } catch { /* 取号失败可手填 */ }
}

async function resetForNew() {
  autoCode = ''
  form.value = { partner_type: (props.defaultType as any) || 'both', credit_limit: 0, tax_rate: 0, price_level: 1 }
  await fetchCode(form.value.partner_type)
}

watch(() => form.value.partner_type, (t, old) => {
  if (props.row || !old || t === old) return
  fetchCode(t)
})

// 父 prop → 内部 ref；打开时初始化表单（编辑取 row，新增默认值+取号）
watch(() => props.modelValue, v => { visible.value = v; if (v) { if (props.row) form.value = { ...props.row }; else resetForNew() } }, { immediate: true })
// 内部 ref → 父（含 el-dialog 自身关闭：X/遮罩/ESC）
watch(visible, v => emit('update:modelValue', v))

async function handleUnaudit() {
  if (!props.row?.id) return
  try { await ElMessageBox.confirm(`反审核「${form.value.name}」？反审核后可修改、删除，参数要求审核时单据将不能再选它。`, '反审核', { type: 'warning' }) } catch { return }
  saving.value = true
  try {
    await scmApi.batchAuditMaster('partners', [props.row.id as string], 'unaudit')
    form.value.audit_status = 'draft'
    ElMessage.success('已反审核，可修改')
    emit('saved', { ...form.value })
  } finally { saving.value = false }
}

async function handleSave(continueAdd = false) {
  if (isAudited.value) return
  if (!form.value.code || !form.value.name) return ElMessage.warning('编号和名称不能为空')
  saving.value = true
  try {
    if (props.row) await scmApi.updatePartner(props.row.id as string, form.value)
    else await scmApi.createPartner(form.value)
    ElMessage.success(continueAdd ? '保存成功，可继续新增' : '保存成功')
    emit('saved', { ...form.value })
    if (continueAdd) await resetForNew()
    else visible.value = false
  } finally { saving.value = false }
}

function onDialogKeydown(e: KeyboardEvent) {
  if (saving.value || e.key !== 'Enter') return
  const target = e.target as HTMLElement
  if (target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) { if (!props.row) handleSave(true); else handleSave(false) }
  else handleSave(false)
}
</script>

<style scoped>
.audited-tip { margin-right: auto; align-self: center; color: var(--el-color-warning); font-size: 12px; }
</style>
