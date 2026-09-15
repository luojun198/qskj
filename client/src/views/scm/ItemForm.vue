<template>
  <div class="page item-form-page">
    <!-- 顶部导航条 -->
    <div class="item-form-header">
      <div class="item-form-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="item-form-header__sep">/</span>
        <span class="item-form-header__title">{{ pageTitle }}</span>
        <span v-if="editId" class="item-form-header__meta">{{ form.code }} {{ form.name }}</span>
      </div>
      <div class="item-form-header__right">
        <el-button size="small" @click="goBack">取消</el-button>
        <el-button v-if="!editId" :loading="saving" :disabled="!ready" size="small" @click="handleSave(true)">
          保存并新增 (Ctrl+Enter)
        </el-button>
        <el-button type="primary" :loading="saving" :disabled="!ready" size="small" @click="handleSave(false)">
          确认保存 (Enter)
        </el-button>
      </div>
    </div>

    <!-- 表单主体 -->
    <div class="item-form-body" v-loading="!ready" @keydown="onKeydown">
      <el-form v-if="ready" :model="form" label-width="90px" size="small">
        <div class="form-sector">
          <div class="form-sector-title">基本信息</div>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="上级物料">
                <el-tree-select
                  v-model="form.parent_id"
                  :data="treeSelectData"
                  :props="{ value: 'id', label: 'displayLabel', children: 'children' } as any"
                  check-strictly filterable clearable
                  placeholder="不选则为顶级"
                  style="width:100%"
                  @change="onParentChange"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="物料性质">
                <el-radio-group v-model="form.is_leaf">
                  <el-radio :value="1">明细</el-radio>
                  <el-radio :value="0">目录</el-radio>
                </el-radio-group>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="编号" required>
                <el-input v-model="form.code" :disabled="!!editId">
                  <template v-if="!editId" #append>{{ expectedCodeLen }}位</template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="名称" required>
                <el-input v-model="form.name" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="规格">
                <el-input v-model="form.spec" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">业务属性</div>
          <el-row :gutter="12">
            <el-col :span="8">
              <el-form-item label="物料属性">
                <div style="display:flex;gap:4px;width:100%">
                  <el-select v-model="form.item_type" clearable style="flex:1">
                    <el-option v-for="(n, k) in dynamicItemTypes" :key="k" :label="n" :value="k" />
                  </el-select>
                  <el-button size="small" @click="showQuickAttr = true"><el-icon><Plus /></el-icon></el-button>
                </div>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="物料来源">
                <el-select v-model="form.source_type" style="width:100%" @change="form.supplier_code = ''">
                  <el-option v-for="(n, k) in SOURCE_TYPES" :key="k" :label="n" :value="k" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="form.source_type === 'outsource' ? '委外厂' : '供应商'">
                <el-select v-model="form.supplier_code" filterable clearable :disabled="form.source_type === 'self' || form.source_type === 'assembly'"
                  :placeholder="(form.source_type === 'self' || form.source_type === 'assembly') ? '自制/组装无需供应商' : '选择供应商'" style="width:100%">
                  <el-option v-for="p in supplierOptions" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="默认仓库">
                <el-select v-model="form.default_warehouse_code" clearable filterable style="width:100%">
                  <el-option v-for="warehouse in warehouses" :key="warehouse.code" :label="warehouse.name || warehouse.code" :value="warehouse.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="主单位" required>
                <div style="display:flex;gap:4px;width:100%">
                  <el-select v-model="form.primary_unit_code" filterable placeholder="选择单位" style="flex:1" clearable>
                    <el-option v-for="u in unitOptions" :key="u.code" :label="u.name" :value="u.code" />
                  </el-select>
                  <el-button size="small" @click="showQuickUnit = true"><el-icon><Plus /></el-icon></el-button>
                </div>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="辅单位换算">
                <div style="width:100%">
                  <div v-for="(su, i) in form.secondary_units" :key="i" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
                    <span style="color:var(--el-text-color-secondary);font-size: var(--cw-text-base)">1</span>
                    <el-select v-model="su.unit_code" filterable placeholder="辅单位" style="width:160px" clearable>
                      <el-option v-for="u in unitOptions" :key="u.code" :label="u.name" :value="u.code" />
                    </el-select>
                    <span style="color:var(--el-text-color-secondary);font-size: var(--cw-text-base)">=</span>
                    <el-input-number v-model="su.conversion_rate" :min="0" :precision="6" :controls="false" style="width:140px" placeholder="含主单位数量" />
                    <span style="color:var(--el-text-color-secondary);font-size: var(--cw-text-base)">{{ form.primary_unit_code || '主单位' }}</span>
                    <el-button link type="danger" size="small" @click="removeSecondaryUnit(i)">删除</el-button>
                  </div>
                  <el-button size="small" @click="addSecondaryUnit"><el-icon><Plus /></el-icon>添加辅单位</el-button>
                  <span style="margin-left:8px;font-size:12px;color:var(--el-text-color-secondary)">换算率＝1 个辅单位 = 多少主单位</span>
                </div>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="条码">
                <el-input v-model="form.barcode" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="进价">
                <el-input-number v-model="form.purchase_price" :precision="4" :controls="false" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="售价">
                <el-input-number v-model="form.sale_price" :precision="4" :controls="false" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="成本价">
                <el-input-number v-model="form.fixed_cost" :precision="4" :controls="false" style="width:100%" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">财务与库存</div>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="存货科目">
                <AccountSelect v-model="form.inv_account" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="销售科目">
                <AccountSelect v-model="form.sale_account" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <div style="display:flex;gap:30px;padding-left:10px">
                <el-form-item label="批号管理" label-width="70px">
                  <el-switch v-model="form.batch_flag" :active-value="1" :inactive-value="0" />
                </el-form-item>
                <el-form-item label="序列号" label-width="56px">
                  <el-switch v-model="form.serial_flag" :active-value="1" :inactive-value="0" />
                </el-form-item>
                <el-form-item label="生成资产" label-width="70px">
                  <el-switch v-model="form.is_asset" :active-value="1" :inactive-value="0" />
                </el-form-item>
              </div>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">采购 / 库存 / 物流</div>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="安全库存"><el-input-number v-model="form.safety_stock" :min="0" :precision="2" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="最小订货量"><el-input-number v-model="form.min_order_qty" :min="0" :precision="2" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="订货提前期" label-width="84px"><el-input-number v-model="form.lead_time_days" :min="0" :precision="0" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="保质期(天)"><el-input-number v-model="form.shelf_life_days" :min="0" :precision="0" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8">
              <el-form-item label="扣批方式" label-width="70px">
                <el-select v-model="form.batch_out_mode" :disabled="!form.batch_flag" style="width:100%">
                  <el-option value="fifo" label="先进先出(FIFO)" />
                  <el-option value="manual" label="手工选批" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8"><el-form-item label="体积"><el-input-number v-model="form.volume" :min="0" :precision="4" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="调拨价"><el-input-number v-model="form.transfer_price" :min="0" :precision="4" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="二级售价"><el-input-number v-model="form.sale_price2" :min="0" :precision="4" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="三级售价"><el-input-number v-model="form.sale_price3" :min="0" :precision="4" :controls="false" style="width:100%" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="采购员"><el-input v-model="form.buyer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="工位"><el-input v-model="form.work_station" /></el-form-item></el-col>
          </el-row>
        </div>

        <!-- 自定义扩展信息 -->
        <div class="form-sector" v-if="activeFieldDefs.length > 0">
          <div class="form-sector-title">扩展信息</div>
          <el-row :gutter="12">
            <el-col v-for="field in activeFieldDefs" :key="field.field_key" :span="12">
              <el-form-item :label="field.field_name">
                <el-input
                  v-if="field.field_type === 'text'"
                  v-model="(form.field_values as any)[field.field_key]"
                />
                <el-input-number
                  v-else-if="field.field_type === 'number'"
                  v-model="(form.field_values as any)[field.field_key]"
                  :controls="false"
                  style="width:100%"
                />
                <el-date-picker
                  v-else-if="field.field_type === 'date'"
                  v-model="(form.field_values as any)[field.field_key]"
                  type="date"
                  value-format="YYYY-MM-DD"
                  style="width:100%"
                />
                <el-select
                  v-else-if="field.field_type === 'select'"
                  v-model="(form.field_values as any)[field.field_key]"
                  clearable
                  style="width:100%"
                >
                  <el-option
                    v-for="opt in parseFieldOptions(field.options_json)"
                    :key="opt"
                    :label="opt"
                    :value="opt"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">其他备注</div>
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" />
          </el-form-item>
        </div>
      </el-form>
    </div>

    <!-- 快速新增单位 -->
    <el-dialog v-model="showQuickUnit" title="快速新增单位" width="360px" append-to-body draggable>
      <el-form label-width="76px" size="small" @submit.prevent>
        <el-form-item label="单位名称">
          <el-input v-model="quickUnitName" placeholder="如：箱 / 件" @keyup.enter="handleQuickAddUnit" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showQuickUnit = false">取消</el-button>
        <el-button type="primary" :loading="quickUnitSaving" @click="handleQuickAddUnit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 快速新增物料属性 -->
    <el-dialog v-model="showQuickAttr" title="快速新增物料属性" width="360px" append-to-body draggable>
      <el-form label-width="76px" size="small" @submit.prevent>
        <el-form-item label="属性名称">
          <el-input v-model="quickAttrName" placeholder="如：包材 / 赠品" @keyup.enter="handleQuickAddAttr" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showQuickAttr = false">取消</el-button>
        <el-button type="primary" :loading="quickAttrSaving" @click="handleQuickAddAttr">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated, onDeactivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import { scmApi, ITEM_TYPES, SOURCE_TYPES, type ScmItem, type ScmUnit, type ScmItemFieldDef, type ScmWarehouse } from '@/api/scm'
import AccountSelect from '@/components/base/AccountSelect.vue'

const route = useRoute()
const router = useRouter()
const editId = computed(() => (route.params.id as string) || null)
const pageTitle = computed(() => (editId.value ? '编辑物料' : '新增物料'))

// ── 数据 ──────────────────────────────────────────────────────────────────
const allList = ref<ScmItem[]>([])
const unitOptions = ref<ScmUnit[]>([])
const warehouses = ref<ScmWarehouse[]>([])
const allPartners = ref<any[]>([])
const customItemTypes = ref<Record<string, string>>({})
const dynamicItemTypes = computed(() => ({ ...ITEM_TYPES, ...customItemTypes.value }))
const activeFieldDefs = ref<ScmItemFieldDef[]>([])
const itemLevels = ref(4)
const itemCodeLengths = ref([2, 2, 2, 2])
const form = ref<Partial<ScmItem>>({})
const saving = ref(false)
// 数据就绪后才渲染表单，避免 el-form 先以空 form 挂载、后续重赋值不回显
const ready = ref(false)

// 物料来源对应的供应商候选：采购→供应商类、委外→委外厂
const supplierOptions = computed(() => {
  if (form.value.source_type === 'outsource') return allPartners.value.filter(p => p.is_outsource === 1)
  return allPartners.value.filter(p => p.partner_type === 'supplier' || p.partner_type === 'both')
})

// ── 加载 ──────────────────────────────────────────────────────────────────
async function loadParams() {
  try {
    const r = await scmApi.getParams()
    for (const p of r.data as any[]) {
      if (p.param_key === 'scm:item_levels') itemLevels.value = parseInt(p.param_value) || 4
      else if (p.param_key === 'scm:item_code_lengths') {
        try { itemCodeLengths.value = JSON.parse(p.param_value).map(Number) }
        catch { itemCodeLengths.value = (p.param_value || '2,2,2,2').split(',').map(Number) }
      }
      else if (p.param_key === 'scm:item_types') {
        try { customItemTypes.value = JSON.parse(p.param_value) } catch {}
      }
    }
  } catch {}
}
async function loadUnits() {
  try { const r = await scmApi.getUnits(); if (r.code === 0) unitOptions.value = r.data } catch {}
}
async function loadWarehouses() {
  try { const r = await scmApi.getWarehouses(); if (r.code === 0) warehouses.value = r.data }
  catch {}
}
async function loadPartners() {
  try { const r = await scmApi.getPartners(); if (r.code === 0) allPartners.value = r.data as any[] } catch {}
}
async function loadFieldDefs() {
  try { const r = await scmApi.getItemFieldDefs(); if (r.code === 0) activeFieldDefs.value = r.data as ScmItemFieldDef[] } catch {}
}
async function loadAllItems() {
  const res = await (scmApi.getItems as any)({ all: '1' })
  if (res.code === 0) allList.value = (res.data as any).list
}

// ── 上级物料树选择器 ───────────────────────────────────────────────────────
function buildTree(items: any[]): any[] {
  const map = new Map<string, any>()
  for (const item of items) map.set(item.id, { ...item, children: [] })
  const roots: any[] = []
  for (const item of items) {
    const node = map.get(item.id)!
    if (item.parent_id && map.has(item.parent_id)) map.get(item.parent_id)!.children.push(node)
    else roots.push(node)
  }
  return roots
}
const treeSelectData = computed(() => {
  const data = buildTree(allList.value)
  function addLabel(nodes: any[]): any[] {
    return nodes.map(n => ({ ...n, displayLabel: `${n.code} ${n.name}`, children: addLabel(n.children || []) }))
  }
  if (!editId.value) return addLabel(data)
  return addLabel(filterOutSelf(data, editId.value))
})
function filterOutSelf(nodes: any[], excludeId: string): any[] {
  return nodes.filter(n => n.id !== excludeId).map(n => ({ ...n, children: filterOutSelf(n.children || [], excludeId) }))
}

// ── 级次 / 自动编号 / 校验 ─────────────────────────────────────────────────
function getFormLevel(): number {
  if (!form.value.parent_id) return 1
  const parent = allList.value.find(i => i.id === form.value.parent_id)
  return ((parent as any)?.level || 1) + 1
}
function getExpectedLen(level: number): number {
  return itemCodeLengths.value.slice(0, level).reduce((s, n) => s + n, 0)
}
const expectedCodeLen = computed(() => getExpectedLen(getFormLevel()))

function validateCodeLength(): string | null {
  const code = form.value.code || ''
  const level = getFormLevel()
  if (level > itemLevels.value) return `最大物料级次为 ${itemLevels.value} 级，无法继续向下新增`
  const expected = getExpectedLen(level)
  if (expected > 0 && code.length !== expected) return `第 ${level} 级物料编号应为 ${expected} 位（当前 ${code.length} 位）`
  if (form.value.parent_id) {
    const parent = allList.value.find(i => i.id === form.value.parent_id)
    if (parent && !code.startsWith(parent.code)) return `子物料编号须以上级编号「${parent.code}」开头`
  }
  return null
}
function buildNextCode(parentId: string | null): string {
  if (!parentId) {
    const segLen = itemCodeLengths.value[0] || 2
    const items = allList.value.filter(i => !(i as any).parent_id)
    const maxNo = items.reduce((m, i) => {
      const n = parseInt(String(i.code).replace(/^\D+/, '')) || 0
      return Math.max(m, n)
    }, 0)
    return String(maxNo + 1).padStart(segLen, '0')
  }
  const parent = allList.value.find(i => i.id === parentId)
  if (!parent) return buildNextCode(null)
  const segLen = itemCodeLengths.value[((parent as any).level || 1)] || 2
  const prefix = parent.code
  const siblings = allList.value.filter(i => (i as any).parent_id === parentId)
  const maxNo = siblings.reduce((m, s) => {
    const suffix = String(s.code).slice(prefix.length)
    return Math.max(m, parseInt(suffix) || 0)
  }, 0)
  return prefix + String(maxNo + 1).padStart(segLen, '0')
}
function onParentChange(newPid: string) {
  if (!editId.value) form.value.code = buildNextCode(newPid || null)
}
watch(() => form.value.parent_id, (newPid) => {
  if (!editId.value) form.value.code = buildNextCode((newPid as string) || null)
})

// ── 副单位 ────────────────────────────────────────────────────────────────
function addSecondaryUnit() {
  if (!form.value.secondary_units) form.value.secondary_units = []
  form.value.secondary_units.push({ unit_code: '', conversion_rate: 1, is_primary: 0 })
}
function removeSecondaryUnit(i: number) { form.value.secondary_units?.splice(i, 1) }

// ── 表单初始化 ────────────────────────────────────────────────────────────
function newForm(parent?: ScmItem | null) {
  form.value = {
    purchase_price: 0, sale_price: 0, fixed_cost: 0,
    batch_flag: 0, batch_out_mode: 'fifo', serial_flag: 0, is_asset: 0, is_leaf: 1,
    source_type: 'purchase', primary_unit_code: '', secondary_units: [],
    parent_id: parent?.id || '', field_values: {},
  }
  form.value.code = buildNextCode(parent?.id || null)
}
function editForm(row: ScmItem) {
  form.value = {
    ...row,
    parent_id: (row as any).parent_id || '',
    primary_unit_code: row.primary_unit_code || '',
    secondary_units: (row.secondary_units || []).map(s => ({ ...s })),
    is_leaf: row.is_leaf !== undefined ? row.is_leaf : 1,
    field_values: { ...(row.field_values || {}) },
  }
}

// ── 保存 ──────────────────────────────────────────────────────────────────
async function handleSave(continueAdd = false) {
  if (!form.value.code || !form.value.name) return ElMessage.warning('编号和名称不能为空')
  if (!editId.value) {
    const err = validateCodeLength()
    if (err) return ElMessage.warning(err)
  }
  saving.value = true
  try {
    if (editId.value) await scmApi.updateItem(editId.value, form.value)
    else await scmApi.createItem(form.value)
    ElMessage.success(continueAdd ? '保存成功，可继续新增' : '保存成功')
    if (continueAdd) {
      const parentId = form.value.parent_id || null
      await loadAllItems()
      const parent = parentId ? (allList.value.find(i => i.id === parentId) || null) : null
      newForm(parent)
    } else {
      goBack()
    }
  } finally { saving.value = false }
}

function onKeydown(e: KeyboardEvent) {
  if (saving.value) return
  if (e.key !== 'Enter') return
  const target = e.target as HTMLElement
  if (target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    if (!editId.value) handleSave(true)
    else handleSave(false)
  } else {
    handleSave(false)
  }
}

function goBack() {
  router.push('/scm/items')
}

// ── 快速新增单位 ──────────────────────────────────────────────────────────
const showQuickUnit = ref(false)
const quickUnitName = ref('')
const quickUnitSaving = ref(false)
async function handleQuickAddUnit() {
  const name = quickUnitName.value.trim()
  if (!name) return ElMessage.warning('请输入单位名称')
  quickUnitSaving.value = true
  try {
    const r1 = await scmApi.getUnitNextNo()
    const code = r1.code === 0 ? r1.data.next_no : 'UN' + Date.now()
    const r2 = await scmApi.createUnit({ code, name, enabled: 1 })
    if (r2.code === 0) {
      ElMessage.success(`已新增单位：${name}`)
      await loadUnits()
      form.value.primary_unit_code = code
      showQuickUnit.value = false
      quickUnitName.value = ''
    }
  } catch {} finally { quickUnitSaving.value = false }
}

// ── 快速新增物料属性 ──────────────────────────────────────────────────────
const showQuickAttr = ref(false)
const quickAttrName = ref('')
const quickAttrSaving = ref(false)
async function handleQuickAddAttr() {
  const name = quickAttrName.value.trim()
  if (!name) return ElMessage.warning('请输入属性名称')
  if (Object.values(dynamicItemTypes.value).includes(name)) return ElMessage.warning('该属性名称已存在')
  quickAttrSaving.value = true
  try {
    const nextKey = String(Math.max(10, ...Object.keys(dynamicItemTypes.value).map(Number).filter(n => !isNaN(n))) + 1)
    const newTypes = { ...customItemTypes.value, [nextKey]: name }
    await scmApi.saveParams([{ param_key: 'scm:item_types', param_value: JSON.stringify(newTypes) }])
    customItemTypes.value = newTypes
    form.value.item_type = nextKey
    ElMessage.success(`已新增属性：${name}`)
    showQuickAttr.value = false
    quickAttrName.value = ''
  } catch (err: any) {
    ElMessage.error(err.message || '保存失败')
  } finally { quickAttrSaving.value = false }
}

// 解析下拉选项 JSON
function parseFieldOptions(optionsJson?: string): string[] {
  if (!optionsJson) return []
  try { return JSON.parse(optionsJson) } catch { return [] }
}

// ── 初始化 ────────────────────────────────────────────────────────────────
// 身份键：编辑=edit|<id>，新增=new|<parent_id>，用于判断 keep-alive 复用时是否需重新初始化
function currentFormKey(): string {
  return editId.value ? `edit|${editId.value}` : `new|${(route.query.parent_id as string) || ''}`
}
let initedKey = ''
let needReinitOnActivate = false   // 离开「新增」页后置位：下次激活强制刷新为干净表单

// 填表初始化：每次都先刷新全量物料，保证 buildNextCode 看到最新兄弟节点、树选择器数据最新
async function initForm() {
  await loadAllItems()
  if (editId.value) {
    const row = allList.value.find(i => i.id === editId.value)
    if (row) editForm(row)
    else { ElMessage.error('未找到该物料'); newForm(null) }
  } else {
    const pid = (route.query.parent_id as string) || ''
    const parent = pid ? (allList.value.find(i => i.id === pid) || null) : null
    newForm(parent)
  }
  initedKey = currentFormKey()
}

onMounted(async () => {
  // 元数据仅需挂载时加载一次；物料全量随每次 initForm 刷新
  await Promise.all([loadParams(), loadUnits(), loadWarehouses(), loadPartners(), loadFieldDefs()])
  await initForm()
  ready.value = true
})

// keep-alive 会按组件类型复用同一实例（onMounted 不再重跑）。
// 复用时若不重新初始化，会沿用上一次的上级/编号（本 BUG 现象）：
//  · 换一个上级新增、编辑后再新增 → 身份键变化 → 重新初始化
//  · 新增页离开后再次进入（保存/取消/返回列表）→ needReinitOnActivate → 刷新为干净表单
onActivated(() => {
  if (!ready.value) return   // 首次挂载尚未就绪，onMounted 会负责初始化
  if (needReinitOnActivate) { needReinitOnActivate = false; initForm(); return }
  if (currentFormKey() !== initedKey) initForm()
})
onDeactivated(() => {
  // 离开「新增」页时标记：下次回到新增页应是全新表单并重读 parent_id，而非残留上一条
  if (initedKey.startsWith('new|')) needReinitOnActivate = true
})
</script>

<style scoped>
.item-form-page { display: flex; flex-direction: column; height: 100%; padding: 0; }

.item-form-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0; gap: 12px;
}
.item-form-header__left { display: flex; align-items: center; gap: 8px; font-size: var(--cw-text-base); min-width: 0; }
.item-form-header__sep { color: var(--el-text-color-placeholder); }
.item-form-header__title { font-weight: 600; color: var(--el-text-color-primary); white-space: nowrap; }
.item-form-header__meta { color: var(--el-text-color-secondary); font-size: var(--cw-text-base); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-form-header__right { display: flex; gap: 8px; flex-shrink: 0; }

.item-form-body { flex: 1; overflow: auto; padding: 16px 18px; }
</style>
