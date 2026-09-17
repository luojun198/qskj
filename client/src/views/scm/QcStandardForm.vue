<template>
  <div class="page qc-std-form">
    <div class="std-header">
      <div class="std-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="std-header__sep">/</span>
        <span class="std-header__title">{{ editId ? '编辑检验标准' : '新增检验标准' }}</span>
      </div>
      <div class="std-header__right">
        <el-button size="small" @click="goBack">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="save">保存</el-button>
      </div>
    </div>

    <div v-loading="loading" class="std-body">
      <el-form :model="form" label-width="96px" size="small">
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="物料" required>
            <ItemPicker v-model="form.item_code" @pick="(it: any) => { form.item_code = it.code; if (!form.name) form.name = `${it.name} 检验标准` }" />
          </el-form-item></el-col>
          <el-col :span="5"><el-form-item label="检验类型">
            <el-select v-model="form.qc_type" style="width:100%">
              <el-option label="通用（所有类型）" value="" /><el-option label="到货检验(IQC)" value="IQC" /><el-option label="过程检验(IPQC)" value="IPQC" /><el-option label="完工检验(FQC)" value="FQC" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="7"><el-form-item label="标准名称"><el-input v-model="form.name" placeholder="可留空" /></el-form-item></el-col>
          <el-col :span="4"><el-form-item label="启用"><el-switch v-model="form.is_enabled" :active-value="1" :inactive-value="0" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="抽样方案">
            <el-select v-model="form.sampling_mode" style="width:100%">
              <el-option label="全检" value="full" /><el-option label="按比例抽样（%）" value="percent" /><el-option label="固定抽样数" value="fixed" />
            </el-select>
          </el-form-item></el-col>
          <el-col v-if="form.sampling_mode !== 'full'" :span="5"><el-form-item :label="form.sampling_mode === 'percent' ? '抽样比例%' : '抽样数'">
            <el-input-number v-model="form.sampling_value" :min="0" :precision="form.sampling_mode === 'percent' ? 2 : 0" :controls="false" style="width:100%" />
          </el-form-item></el-col>
          <el-col v-if="form.sampling_mode === 'percent'" :span="5"><el-form-item label="最少样本"><el-input-number v-model="form.min_sample" :min="1" :precision="0" :controls="false" style="width:100%" /></el-form-item></el-col>
          <el-col :span="5"><el-form-item label="允收不良数">
            <el-input-number v-model="form.accept_defects" :min="0" :precision="0" :controls="false" style="width:100%" />
          </el-form-item></el-col>
          <el-col :span="24"><el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item></el-col>
        </el-row>
      </el-form>

      <div class="items-hd">
        <span>检验项</span>
        <span class="items-hd__hint">关键项任一不合格即整行不合格；非关键项不合格只记录。数值型按上下限判定，判定型填「合格/不合格」</span>
        <el-button size="small" @click="addItem"><el-icon><Plus /></el-icon>加检验项</el-button>
      </div>
      <el-table :data="form.items" border stripe size="small" class="items-table">
        <el-table-column type="index" label="序" width="48" align="center" />
        <el-table-column label="检验项" min-width="150"><template #default="{ row }"><el-input v-model="row.name" size="small" placeholder="如 直径" /></template></el-table-column>
        <el-table-column label="检验方法" min-width="130"><template #default="{ row }"><el-input v-model="row.method" size="small" placeholder="如 卡尺" /></template></el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }"><el-select v-model="row.value_type" size="small"><el-option label="数值" value="numeric" /><el-option label="判定" value="bool" /></el-select></template>
        </el-table-column>
        <el-table-column label="目标值" width="110"><template #default="{ row }"><el-input-number v-if="row.value_type === 'numeric'" v-model="row.target" :controls="false" size="small" style="width:100%" /></template></el-table-column>
        <el-table-column label="下限" width="110"><template #default="{ row }"><el-input-number v-if="row.value_type === 'numeric'" v-model="row.lower_limit" :controls="false" size="small" style="width:100%" /></template></el-table-column>
        <el-table-column label="上限" width="110"><template #default="{ row }"><el-input-number v-if="row.value_type === 'numeric'" v-model="row.upper_limit" :controls="false" size="small" style="width:100%" /></template></el-table-column>
        <el-table-column label="单位" width="80"><template #default="{ row }"><el-input v-model="row.unit" size="small" /></template></el-table-column>
        <el-table-column label="关键项" width="80" align="center"><template #default="{ row }"><el-checkbox v-model="row.is_key" :true-value="1" :false-value="0" /></template></el-table-column>
        <el-table-column label="操作" width="70" align="center"><template #default="{ $index }"><el-button link type="danger" size="small" @click="form.items.splice($index, 1)">删除</el-button></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'
import ItemPicker from '@/components/scm/ItemPicker.vue'

const route = useRoute(); const router = useRouter()
const editId = computed(() => (route.name === 'ScmQcStandardEdit' ? String(route.params.id || '') : ''))
const loading = ref(false); const saving = ref(false)
const form = reactive<any>({ item_code: '', qc_type: '', name: '', sampling_mode: 'full', sampling_value: 0, min_sample: 1, accept_defects: 0, is_enabled: 1, remark: '', items: [] })
const blank = () => ({ name: '', method: '', value_type: 'numeric', target: null, lower_limit: null, upper_limit: null, unit: '', is_key: 1 })
function addItem() { form.items.push(blank()) }
function goBack() { router.push('/scm/qc-standards') }

async function init() {
  if (!editId.value) { addItem(); if (typeof route.query.item_code === 'string') form.item_code = route.query.item_code; return }
  loading.value = true
  try {
    const r = await scmApi.getQcStandard(editId.value)
    if (r.code !== 0) { ElMessage.error('检验标准不存在'); return goBack() }
    Object.assign(form, { ...r.data, items: (r.data.items || []).length ? r.data.items : [blank()] })
  } finally { loading.value = false }
}
async function save() {
  if (!form.item_code) return ElMessage.warning('请选择物料')
  const items = form.items.filter((x: any) => String(x.name || '').trim())
  if (!items.length) return ElMessage.warning('至少需要一个检验项')
  saving.value = true
  try {
    const payload = { ...form, items }
    const r: any = editId.value ? await scmApi.updateQcStandard(editId.value, payload) : await scmApi.createQcStandard(payload)
    if (r.code !== 0) return ElMessage.error(r.message || '保存失败')
    ElMessage.success('已保存'); goBack()
  } finally { saving.value = false }
}
onMounted(init)
</script>

<style scoped>
.qc-std-form { display: flex; flex-direction: column; height: 100%; }
.std-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.std-header__left { display: flex; align-items: center; gap: 8px; }
.std-header__sep { color: var(--el-text-color-placeholder); }
.std-header__title { font-weight: 600; }
.std-header__right { display: flex; gap: 8px; }
.std-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
.items-hd { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: var(--cw-text-base); }
.items-hd__hint { margin-left: auto; font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); }
.items-table { flex-shrink: 0; }
</style>
