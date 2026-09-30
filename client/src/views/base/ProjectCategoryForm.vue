<template>
  <div v-loading="loading" class="category-form-page" @keydown.ctrl.s.prevent="saveCategory">
    <header class="category-nav">
      <div class="category-nav__left">
        <el-button link class="back-button" @click="leavePage">
          <el-icon><ArrowLeft /></el-icon>返回核算项目
        </el-button>
        <span class="category-nav__separator">/</span>
        <div>
          <h2>{{ pageTitle }}</h2>
          <p v-if="isEdit && form.name">{{ form.code }} · {{ form.name }}</p>
          <p v-else>配置核算类别及其项目档案扩展字段</p>
        </div>
      </div>
      <div class="category-nav__actions">
        <el-button @click="leavePage">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCategory">保存</el-button>
      </div>
    </header>

    <main class="category-form-body">
      <section class="form-card basic-card">
        <div class="section-heading">
          <div>
            <h3>基本信息</h3>
            <p>类别编码由系统自动生成，类别名称在当前账套内不可重复。</p>
          </div>
          <el-tag :type="isEdit ? 'warning' : 'success'" effect="plain">
            {{ isEdit ? '编辑类别' : '新增类别' }}
          </el-tag>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="basic-form">
          <el-form-item label="类别编码">
            <el-input v-model="form.code" disabled />
          </el-form-item>
          <el-form-item label="类别名称" prop="name">
            <el-input v-model="form.name" maxlength="100" show-word-limit placeholder="请输入类别名称" />
          </el-form-item>
          <el-form-item v-if="isEdit" label="默认项目">
            <el-select
              v-model="form.default_item_id"
              placeholder="选择默认辅助项目"
              clearable
              filterable
              remote
              :remote-method="searchCategoryItems"
              :loading="itemOptionsLoading"
              style="width:100%"
              @focus="searchCategoryItems('')"
            >
              <el-option v-for="item in itemOptions" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
            <div class="field-help">默认项目用于需要自动带出该类别项目的业务场景。</div>
          </el-form-item>
        </el-form>
      </section>

      <section class="form-card fields-card">
        <div class="section-heading fields-heading">
          <div>
            <h3>字段配置</h3>
            <p>配置该类别项目档案的扩展字段及其在凭证录入中的显示、必填规则。</p>
          </div>
          <el-button type="primary" plain @click="addField"><el-icon><Plus /></el-icon>添加字段</el-button>
        </div>

        <el-table :data="form.fields" border stripe size="small" class="fields-table" empty-text="暂无扩展字段，可点击“添加字段”开始配置">
          <el-table-column type="index" label="序号" width="52" align="center" />
          <el-table-column label="字段名称" min-width="180">
            <template #default="{ row }"><el-input v-model="row.field_name" placeholder="字段名称" /></template>
          </el-table-column>
          <el-table-column label="字段编码" min-width="160">
            <template #default="{ row }">
              <el-input v-model="row.field_key" placeholder="自动生成" :disabled="!!row._persisted" />
            </template>
          </el-table-column>
          <el-table-column label="字段类型" width="140">
            <template #default="{ row }">
              <el-select v-model="row.field_type" style="width:100%">
                <el-option label="文本" value="text" /><el-option label="数字" value="number" />
                <el-option label="日期" value="date" /><el-option label="下拉" value="select" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="下拉选项" min-width="220">
            <template #default="{ row }">
              <el-input v-if="row.field_type === 'select'" v-model="row.options_text" placeholder="多个选项用逗号分隔" />
              <span v-else class="not-applicable">—</span>
            </template>
          </el-table-column>
          <el-table-column label="凭证显示" width="96" align="center">
            <template #default="{ row }"><el-checkbox v-model="row.show_in_voucher" /></template>
          </el-table-column>
          <el-table-column label="凭证必填" width="96" align="center">
            <template #default="{ row }"><el-checkbox v-model="row.required_in_voucher" /></template>
          </el-table-column>
          <el-table-column label="档案必填" width="96" align="center">
            <template #default="{ row }"><el-checkbox v-model="row.required_in_archive" /></template>
          </el-table-column>
          <el-table-column label="操作" width="82" fixed="right" align="center">
            <template #default="{ $index }"><el-button link type="danger" @click="form.fields.splice($index,1)">删除</el-button></template>
          </el-table-column>
        </el-table>

        <div class="fields-tip">
          <el-icon><InfoFilled /></el-icon>
          已保存字段的字段编码不可修改；删除已保存字段后，保存时将停用该字段，不会删除历史档案数据。
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, InfoFilled, Plus } from '@element-plus/icons-vue'
import request from '@/api/request'
import { showOperationError, showSuccess } from '@/composables/useMessage'
import { useVoucherAuxItems } from '@/composables/useVoucherAuxItems'
import { filterAuxCategoriesForProjectList } from '@/utils/accountCashFlow'
import {
  buildProjectCategoryFieldsPayload,
  nextProjectCategoryCode,
  normalizeProjectCategoryField,
  type ProjectCategoryFieldForm,
} from '@/utils/projectCategoryForm'

interface CategoryForm {
  id?: string
  code: string
  name: string
  default_item_id: string | null
  sort_order: number
  fields: ProjectCategoryFieldForm[]
}

const route = useRoute()
const router = useRouter()
const isEdit = computed(() => route.name === 'ProjectCategoryEdit')
const categoryId = computed(() => String(route.params.id || ''))
const pageTitle = computed(() => isEdit.value ? '编辑核算类别' : '新增核算类别')
const loading = ref(false)
const saving = ref(false)
const allowLeave = ref(false)
const formRef = ref<FormInstance>()
const form = ref<CategoryForm>({ code: '', name: '', default_item_id: null, sort_order: 0, fields: [] })
const baseline = ref('')
const rules: FormRules<CategoryForm> = {
  name: [{ required: true, message: '请输入类别名称', trigger: 'blur' }],
}

const {
  optionsByCategory,
  loadingByCategory,
  fetchAuxItems,
  ensureSelectedItems,
} = useVoucherAuxItems()
const itemOptions = computed(() => form.value.id ? optionsByCategory.value[form.value.id] || [] : [])
const itemOptionsLoading = computed(() => form.value.id ? !!loadingByCategory.value[form.value.id] : false)

function comparableValue() {
  return JSON.stringify({
    code: form.value.code,
    name: form.value.name,
    default_item_id: form.value.default_item_id || null,
    fields: form.value.fields.map(({ options_json: _optionsJson, sort_order: _sortOrder, ...field }) => field),
  })
}

const isDirty = computed(() => !!baseline.value && comparableValue() !== baseline.value)

async function initialize() {
  loading.value = true
  try {
    const response = await request.get<any[]>('/base/aux-categories')
    const categories = filterAuxCategoriesForProjectList(response.data || [])
    if (isEdit.value) {
      const category = categories.find(item => String(item.id) === categoryId.value)
      if (!category) {
        ElMessage.error('核算类别不存在或已被删除')
        allowLeave.value = true
        await router.replace('/base/project')
        return
      }
      form.value = {
        ...category,
        code: String(category.code || ''),
        name: String(category.name || ''),
        default_item_id: category.default_item_id || null,
        sort_order: Number(category.sort_order) || 0,
        fields: (category.fields || []).map(normalizeProjectCategoryField),
      }
      await searchCategoryItems('')
    } else {
      form.value = {
        code: nextProjectCategoryCode(categories),
        name: '',
        default_item_id: null,
        sort_order: categories.length,
        fields: [],
      }
    }
    baseline.value = comparableValue()
  } catch (error) {
    showOperationError('加载核算类别', error)
  } finally {
    loading.value = false
  }
}

async function searchCategoryItems(keyword: string) {
  if (!form.value.id) return
  await fetchAuxItems(form.value.id, { keyword, limit: 80 })
  if (form.value.default_item_id) await ensureSelectedItems(form.value.id, [form.value.default_item_id])
}

function addField() {
  let index = form.value.fields.length + 1
  const keys = new Set(form.value.fields.map(field => field.field_key))
  while (keys.has(`field_${index}`)) index += 1
  form.value.fields.push({
    field_key: `field_${index}`, field_name: '', field_type: 'text', options_json: null, options_text: '',
    show_in_voucher: false, required_in_voucher: false, required_in_archive: false,
    sort_order: form.value.fields.length, _persisted: false,
  })
}

async function saveCategory() {
  if (saving.value || loading.value) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = { ...form.value, name: form.value.name.trim(), fields: buildProjectCategoryFieldsPayload(form.value.fields) }
    let savedId = form.value.id || ''
    if (isEdit.value) {
      await request.put(`/base/aux-categories/${categoryId.value}`, payload)
      showSuccess('类别更新成功')
    } else {
      const response = await request.post<{ id: string }>('/base/aux-categories', payload)
      savedId = response.data.id
      showSuccess('类别创建成功')
    }
    allowLeave.value = true
    await router.push({ path: '/base/project', query: { category_id: savedId } })
  } catch (error) {
    showOperationError(isEdit.value ? '更新类别' : '创建类别', error)
  } finally {
    saving.value = false
  }
}

function leavePage() { router.push('/base/project') }

onBeforeRouteLeave(async () => {
  if (allowLeave.value || !isDirty.value) return true
  try {
    await ElMessageBox.confirm('当前类别配置尚未保存，确定离开吗？', '未保存的修改', {
      type: 'warning', confirmButtonText: '离开', cancelButtonText: '继续编辑',
    })
    return true
  } catch { return false }
})

// 页面被标签页 keep-alive 缓存：再次进入时不会重新挂载，会残留上次填写 / 保存后的旧表单。
// 这里在被激活时判断「是不是一次新的进入」——新增页带着新的一次性标记（query._n）、编辑的类别变了、
// 或上次已保存离开——是则重新初始化；仅是切换标签回来（标记不变）则保留未保存的输入。
let lastNonce = ''
let loadedKey = ''
let firstActivation = true

function currentKey() {
  return isEdit.value ? `edit:${categoryId.value}` : 'new'
}

async function startFresh() {
  allowLeave.value = false
  lastNonce = String(route.query._n || '')
  loadedKey = currentKey()
  await initialize()
  formRef.value?.clearValidate()
}

onMounted(() => {
  lastNonce = String(route.query._n || '')
  loadedKey = currentKey()
  void initialize()
})

onActivated(() => {
  // 首次挂载时 onActivated 也会触发，已由 onMounted 初始化，跳过
  if (firstActivation) { firstActivation = false; return }
  const nonce = String(route.query._n || '')
  if (allowLeave.value || nonce !== lastNonce || loadedKey !== currentKey()) void startFresh()
})
</script>

<style scoped>
.category-form-page{height:calc(100vh - 60px);min-height:640px;display:flex;flex-direction:column;background:#f4f7fb;overflow:hidden}.category-nav{display:flex;align-items:center;justify-content:space-between;min-height:72px;padding:12px 22px;background:#fff;border-bottom:1px solid #dfe6ef;box-shadow:0 2px 10px rgba(15,23,42,.04);box-sizing:border-box}.category-nav__left{display:flex;align-items:center;gap:14px}.back-button{font-size: var(--cw-text-base)}.category-nav__separator{color:#c2cad6}.category-nav h2{margin:0;font-size:var(--cw-text-lg);font-weight:600;color:#1c2a3a}.category-nav p{margin:4px 0 0;font-size:12px;color:#7b8797}.category-nav__actions{display:flex;gap:8px}.category-form-body{flex:1;min-height:0;overflow:auto;padding:18px 22px 28px}.form-card{max-width:1480px;margin:0 auto 16px;padding:20px 22px;background:#fff;border:1px solid #e1e7ef;border-radius:10px;box-shadow:0 3px 12px rgba(15,23,42,.04);box-sizing:border-box}.section-heading{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}.section-heading h3{margin:0;color:#243247;font-size:var(--cw-text-lg)}.section-heading p{margin:5px 0 0;color:#7a8798;font-size:12px}.basic-form{display:grid;grid-template-columns:minmax(220px,360px) minmax(320px,1fr);gap:0 20px}.basic-form :deep(.el-form-item:last-child:nth-child(3)){grid-column:1 / -1;max-width:740px}.field-help{margin-top:5px;color:#8a96a6;font-size:12px}.fields-heading{align-items:center}.fields-table{width:100%}.not-applicable{color:#c0c8d2}.fields-tip{display:flex;align-items:center;gap:6px;margin-top:12px;color:#778397;font-size:12px}@media(max-width:900px){.category-form-page{height:auto;min-height:100vh}.category-nav{align-items:flex-start;gap:12px;padding:12px 14px}.category-nav__left{align-items:flex-start;gap:8px}.category-nav__separator{display:none}.category-nav__actions{flex-shrink:0}.category-form-body{padding:12px}.form-card{padding:16px}.basic-form{grid-template-columns:1fr}}
</style>
