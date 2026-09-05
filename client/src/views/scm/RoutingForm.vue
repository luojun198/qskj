<template>
  <div class="page rt-form-page">
    <div class="rt-form-header">
      <div class="rt-form-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="rt-form-header__sep">/</span>
        <span class="rt-form-header__title">{{ editId ? '编辑工艺路线' : '新增工艺路线' }}</span>
        <span v-if="form.code" class="rt-form-header__code">{{ form.code }}</span>
        <el-tag v-if="editId" :type="form.status === 'active' ? 'success' : 'info'" size="small" effect="plain">
          {{ form.status === 'active' ? '启用' : '停用' }}
        </el-tag>
      </div>
      <div class="rt-form-header__right">
        <el-button size="small" @click="goBack">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </div>

    <div v-loading="loading" class="rt-form-body">
      <el-form :model="form" label-width="76px" size="small">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="编码" required>
              <el-input v-model="form.code" :disabled="!!editId" placeholder="工艺路线唯一编号" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="名称"><el-input v-model="form.name" placeholder="如 总装线标准工艺" /></el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="成品" required>
              <el-select v-model="form.item_code" filterable placeholder="选择成品" style="width:100%">
                <el-option v-for="i in items" :key="i.code" :label="`${i.code} ${i.name}`" :value="i.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width:100%">
                <el-option label="启用" value="active" />
                <el-option label="停用" value="inactive" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注"><el-input v-model="form.remark" placeholder="可留空" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <div class="rt-lines-hd">
        <span>工序明细</span>
        <span class="rt-lines-hd__hint">标准工时 × 工作中心费率 = 标准成本差异表里的标准人工/制费</span>
        <el-button size="small" @click="addLine"><el-icon><Plus /></el-icon>加工序</el-button>
      </div>
      <div class="rt-lines">
        <el-table :data="form.lines" border stripe size="small" height="100%">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="工序名" min-width="160">
            <template #default="{ row }"><el-input v-model="row.process_name" size="small" placeholder="如 总装" /></template>
          </el-table-column>
          <el-table-column label="工作中心" width="220">
            <template #default="{ row }">
              <el-select v-model="row.work_center_code" size="small" clearable filterable placeholder="选择" style="width:100%">
                <el-option v-for="w in workCenters" :key="w.code" :label="`${w.code} ${w.name}`" :value="w.code" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="标准工时" width="130" align="right">
            <template #default="{ row }">
              <el-input-number v-model="row.std_hours" :min="0" :precision="2" :controls="false" size="small" style="width:100%" />
            </template>
          </el-table-column>
          <el-table-column label="委外工序" width="90" align="center">
            <template #default="{ row }"><el-switch v-model="row.is_outsource" :active-value="1" :inactive-value="0" size="small" /></template>
          </el-table-column>
          <el-table-column label="备注" min-width="180">
            <template #default="{ row }"><el-input v-model="row.remark" size="small" placeholder="可留空" /></template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center" fixed="right">
            <template #default="{ $index }">
              <el-button link type="danger" size="small" @click="form.lines.splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty><div class="rt-empty">还没有工序，点右上角「加工序」开始</div></template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'

const route = useRoute()
const router = useRouter()
const editId = computed(() => (route.name === 'ScmRoutingEdit' ? String(route.params.id || '') : ''))

const loading = ref(false)
const saving = ref(false)
const items = ref<any[]>([])
const workCenters = ref<any[]>([])
const form = reactive<any>({ code: '', name: '', item_code: '', status: 'active', remark: '', lines: [] })

function goBack() { router.push({ name: 'ScmRouting' }) }
function addLine() { form.lines.push({ process_name: '', work_center_code: '', std_hours: 0, is_outsource: 0, remark: '' }) }

async function loadRefs() {
  const [it, wc] = await Promise.all([scmApi.getItems({ all: '1' }), scmApi.getWorkCenters()])
  if (it.code === 0) items.value = ((it.data as any).list || []).filter((i: any) => i.is_leaf !== 0)
  if (wc.code === 0) workCenters.value = wc.data.filter((w: any) => w.enabled !== 0)
}

async function init() {
  loading.value = true
  try {
    await loadRefs()
    if (editId.value) {
      const r = await scmApi.getRouting(editId.value)
      if (r.code === 0) Object.assign(form, { ...r.data, lines: (r.data as any).lines || [] })
    } else {
      const no = await scmApi.getRoutingNextNo()
      form.code = no.code === 0 ? no.data.next_no : ''
    }
  } finally { loading.value = false }
}

async function handleSave() {
  if (!form.code || !form.item_code) return ElMessage.warning('编码和成品不能为空')
  if (form.lines.some((l: any) => !String(l.process_name || '').trim())) return ElMessage.warning('工序名不能为空')
  saving.value = true
  try {
    if (editId.value) await scmApi.updateRouting(editId.value, form)
    else await scmApi.createRouting(form)
    ElMessage.success('已保存')
    goBack()
  } finally { saving.value = false }
}

onMounted(init)
</script>

<style scoped>
.rt-form-page { display: flex; flex-direction: column; height: 100%; }
.rt-form-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.rt-form-header__left { display: flex; align-items: center; gap: 8px; }
.rt-form-header__sep { color: var(--el-text-color-placeholder); }
.rt-form-header__title { font-weight: 600; }
.rt-form-header__code { font-size: 12px; color: var(--el-text-color-secondary); }
.rt-form-header__right { display: flex; gap: 8px; }
.rt-form-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px; gap: 6px; }
.rt-lines-hd { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 13px; }
.rt-lines-hd__hint { margin-left: auto; font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); }
.rt-lines { flex: 1; min-height: 200px; }
.rt-empty { padding: 24px 0; color: var(--el-text-color-secondary); font-size: 13px; }
</style>
