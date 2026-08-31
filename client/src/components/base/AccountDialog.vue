<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="640px"
    draggable
    append-to-body
    destroy-on-close
    :modal="false"
    :close-on-click-modal="false"
    class="account-dialog"
    @close="handleClose"
  >
    <el-form :model="form" label-width="100px" size="small">
      <!-- 基础信息板块 -->
      <div class="form-sector">
        <div class="form-sector-title">基础信息</div>
        <el-row :gutter="20">
          <el-col :span="24">
            <el-form-item label="上级科目">
              <el-tree-select
                v-model="form.parent_id"
                class="account-tree-select"
                :data="treeSelectData"
                :props="treeSelectProps"
                :popper-class="ACCOUNT_TREE_SELECT_POPPER_CLASS"
                :popper-style="ACCOUNT_TREE_SELECT_POPPER_STYLE"
                :fit-input-width="false"
                check-strictly
                filterable
                :filter-node-method="filterTreeNode"
                clearable
                placeholder="不选则为顶级科目"
                style="width: 100%"
                @change="handleParentChange"
              >
                <template #default="{ data }">
                  <span class="account-tree-node-option" :title="data.displayLabel">
                    <span class="account-tree-node-option__code">{{ data.code }}</span>
                    <span class="account-tree-node-option__name">{{ data.name }}</span>
                  </span>
                </template>
              </el-tree-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="科目编码" required>
              <el-input v-model="form.code" :disabled="mode === 'edit'" placeholder="如: 1001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="科目名称" required>
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="余额方向" required>
              <el-radio-group v-model="form.direction">
                <el-radio value="debit">借方</el-radio>
                <el-radio value="credit">贷方</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>
      </div>

      <!-- 属性设置板块 -->
      <div class="form-sector">
        <div class="form-sector-title">科目属性</div>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="类型开关">
              <div class="form-switch-row">
                <div class="form-switch-item">
                  <span class="form-switch-label">现金</span>
                  <el-switch v-model="form.is_cash" :active-value="1" :inactive-value="0" />
                </div>
                <div class="form-switch-item">
                  <span class="form-switch-label">银行</span>
                  <el-switch v-model="form.is_bank" :active-value="1" :inactive-value="0" />
                </div>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="余额控制">
              <div class="form-switch-item">
                <el-tooltip
                  effect="dark"
                  placement="top"
                  content="开启后：该科目及其所有下级科目的余额都不能为负数；下级科目若启用辅助核算，每个辅助项目余额也不能为负数。"
                >
                  <span class="form-switch-label">不允许负数</span>
                </el-tooltip>
                <el-switch v-model="form.no_negative" :active-value="1" :inactive-value="0" />
              </div>
              <div v-if="form.no_negative === 1" class="form-label-tip">
                ✓ 不允许负数生效
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </div>

      <!-- 辅助核算板块 -->
      <div class="form-sector">
        <div class="form-sector-title">辅助核算</div>
        <div class="aux-list">
          <div v-for="(item, index) in form.aux_list" :key="index" class="aux-item">
            <el-select
              v-model="item.cat_id"
              placeholder="核算类型"
              clearable
              style="width: 130px; margin-right: 8px"
              @change="val => onAuxCatChange(item, val)"
            >
              <el-option
                v-for="cat in getAvailableCats(item)"
                :key="cat.id"
                :label="cat.name"
                :value="cat.id"
              />
            </el-select>
            <el-select
              v-model="item.item_id"
              placeholder="默认项目"
              clearable
              filterable
              remote
              remote-show-suffix
              style="flex: 1"
              :disabled="!item.cat_id"
              :loading="isAuxSelectLoading(item.cat_id)"
              :remote-method="(q: string) => searchAuxItems(item.cat_id, q)"
              @visible-change="(visible: boolean) => visible && onAuxDropdownOpen(item.cat_id)"
            >
              <el-option
                v-for="i in getAuxOptions(item.cat_id)"
                :key="i.id"
                :label="formatAuxItemLabel(i)"
                :value="i.id"
              />
            </el-select>
            <el-button
              link
              type="danger"
              :disabled="form.aux_list.length <= 1"
              style="margin-left: 8px"
              @click="removeAux(index)"
              >删除</el-button
            >
          </div>
          <el-button link type="primary" style="margin-top: 4px" @click="addAux"
            ><el-icon><Plus /></el-icon> 添加核算类型</el-button
          >
        </div>
      </div>

      <!-- 其他设置 -->
      <div class="form-sector">
        <div class="form-sector-title">状态与其他</div>
        <el-form-item label="启用状态">
          <el-switch v-model="form.is_enabled" :active-value="1" :inactive-value="0" />
          <span v-if="childrenCount > 0" class="form-label-tip">
            （该科目有 {{ childrenCount }} 个子科目，将同步{{ form.is_enabled ? '启用' : '禁用' }}）
          </span>
        </el-form-item>
        
        <div v-if="childrenCount > 0 && mode === 'edit'" class="form-label-tip sync-tip">
          <el-icon><InfoFilled /></el-icon> 修改属性/辅助核算将同步到 {{ childrenCount }} 个下级科目
        </div>

        <el-alert
          v-if="mode === 'add' && parentUsage"
          type="warning"
          :closable="false"
          show-icon
          style="margin-top: 8px"
        >
          <template #title> 上级科目已有数据，将自动转入本次新建的子科目 </template>
          <template #default>
            上级科目从末级变为汇总级后不能再记账/挂期初，其
            <template v-if="parentUsage.voucherCount > 0"
              >{{ parentUsage.voucherCount }} 条凭证分录、</template
            ><template v-if="parentUsage.initBalanceCount > 0">年初余额、</template
            ><template v-if="parentUsage.auxInitCount > 0"
              >{{ parentUsage.auxInitCount }} 条辅助期初、</template
            >等将自动转入。
          </template>
        </el-alert>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button
        v-if="mode === 'add'"
        :loading="saving"
        @click="emit('save-and-add')"
      >保存并新增</el-button>
      <el-button type="primary" :loading="saving" @click="emit('save')">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  ACCOUNT_TREE_SELECT_POPPER_CLASS,
  ACCOUNT_TREE_SELECT_POPPER_STYLE,
} from '@/utils/accountSelectDisplay'

interface Props {
  modelValue: boolean
  mode: 'add' | 'edit'
  title: string
  form: any
  parentUsage: any
  childrenCount?: number
  treeSelectData: any[]
  getAvailableCats: (item: any) => any[]
  getAuxOptions: (catId: string) => any[]
  searchAuxItems: (catId: string, keyword: string) => void
  onAuxDropdownOpen: (catId: string) => void
  isAuxSelectLoading: (catId: string) => boolean
  onAuxCatChange: (item: any, val: string) => void
  addAux: () => void
  removeAux: (index: number) => void
  saving: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'parent-change': [parentId: string]
  save: []
  'save-and-add': []
}>()

const visible = ref(props.modelValue)
const childrenCount = ref(0)

const treeSelectProps = {
  label: 'displayLabel',
  value: 'id',
  children: 'children',
  disabled: 'disabled',
}

function filterTreeNode(value: string, data: any) {
  if (!value) return true
  const lower = value.toLowerCase()
  return (data.name && data.name.toLowerCase().includes(lower)) ||
         (data.code && data.code.toLowerCase().includes(lower))
}

function formatAuxItemLabel(item: { code?: string; name?: string }) {
  const code = String(item.code || '').trim()
  const name = String(item.name || '').trim()
  return code ? `${code} ${name}` : name
}

watch(
  () => props.modelValue,
  val => {
    visible.value = val
    if (val && props.mode === 'edit' && props.form.id) {
      childrenCount.value = props.childrenCount || 0
    } else {
      childrenCount.value = 0
    }
  }
)

watch(visible, val => {
  emit('update:modelValue', val)
})

function handleParentChange(parentId: string) {
  emit('parent-change', parentId)
}

function handleClose() {
  visible.value = false
}
</script>

<style scoped>
/* 无遮罩时加强弹窗阴影，便于与后方列表区分 */
:global(.account-dialog.el-dialog) {
  box-shadow:
    0 12px 48px rgba(12, 42, 46, 0.22),
    0 0 0 1px rgba(12, 42, 46, 0.05) !important;
}

.aux-list {
  width: 100%;
  padding: 12px;
  background: var(--ink-50);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.form-switch-row {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.form-switch-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.form-switch-label {
  color: var(--el-text-color-regular);
  font-weight: 500;
  white-space: nowrap;
}

.aux-item {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.sync-tip {
  color: var(--mint-700);
  margin-top: 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.form-label-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 4px;
}
</style>
