<template>
  <div class="print-template-page">
    <div class="page-header">
      <div>
        <h2>凭证打印设置</h2>
        <p class="page-sub">用预设快速开一张凭证纸，再点字段、叠底图即可套打。</p>
      </div>
      <div class="header-actions">
        <el-button v-if="legacyCount > 0" :loading="upgradingAll" @click="handleUpgradeAll">
          升级全部旧模板（{{ legacyCount }}）
        </el-button>
        <el-dropdown @command="createFromPreset">
          <el-button type="primary">
            从预设新建
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="standard">标准记账凭证（210×148）</el-dropdown-item>
              <el-dropdown-item command="blank">套打底图模板</el-dropdown-item>
              <el-dropdown-item command="a4">A4 竖版凭证</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="page-content" v-loading="loading">
      <el-empty v-if="!loading && templates.length === 0" description="还没有打印模板，先从预设新建一张">
        <el-button type="primary" @click="createFromPreset('standard')">新建标准凭证</el-button>
      </el-empty>
      <div v-else class="template-grid">
        <article v-for="row in templates" :key="row.id" class="template-card" :class="{ 'is-default': row.is_default }">
          <div class="card-top">
            <div class="card-title">{{ row.name }}</div>
            <div class="card-tags">
              <el-tag size="small" :type="templateTypeTag(row)">{{ templateTypeLabel(row) }}</el-tag>
              <el-tag v-if="row.is_default" size="small" type="success">默认</el-tag>
              <el-tag v-if="isLegacy(row)" size="small" type="warning">待升级</el-tag>
            </div>
          </div>
          <div class="card-meta">
            <span>{{ paperLabel(row) }}</span>
            <span>{{ row.paper_width }}×{{ row.paper_height }}mm</span>
          </div>
          <p v-if="isLegacy(row)" class="card-note">旧版画布模板，升级后即可在新设计器中编辑和套打。</p>
          <div class="card-actions">
            <el-button v-if="isLegacy(row)" type="warning" size="small" :loading="upgradingId === row.id" @click="handleUpgrade(row)">
              升级
            </el-button>
            <el-button v-else type="primary" size="small" @click="handleEdit(row)">设计</el-button>
            <el-button v-if="!row.is_default" size="small" @click="handleSetDefault(row)">设为默认</el-button>
            <el-button v-if="!row.is_default" type="danger" size="small" plain @click="handleDelete(row)">删除</el-button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import type { PrintTemplate } from '@/types/print'
import { useUserStore } from '@/stores/user'
import {
  getPrintTemplates,
  setDefaultPrintTemplate,
  deletePrintTemplate,
  updatePrintTemplate,
} from '@/api/printTemplate'
import { isHiprintTemplate, isLegacyPrintTemplate, buildUpgradedTemplatePayload } from '@/utils/printTemplateMigrate'
import type { VoucherPanelPreset } from '@/utils/printTemplateDefaultsHiprint'

const router = useRouter()
const userStore = useUserStore()
const loading = ref(false)
const templates = ref<PrintTemplate[]>([])
const upgradingId = ref('')
const upgradingAll = ref(false)
const legacyCount = computed(() => templates.value.filter(isLegacyPrintTemplate).length)

const TYPE_LABELS: Record<string, string> = { voucher: '凭证', ledger: '账册', report: '报表' }
const templateTypeLabel = (row: PrintTemplate) => TYPE_LABELS[row.template_type || 'voucher'] || '凭证'
const templateTypeTag = (row: PrintTemplate) => {
  const t = row.template_type || 'voucher'
  return t === 'report' ? 'success' : t === 'ledger' ? 'warning' : 'primary'
}

const isLegacy = (row: PrintTemplate) => isLegacyPrintTemplate(row)

const paperLabel = (row: PrintTemplate) => {
  const size = String(row.paper_size || '').toUpperCase()
  if (size === 'A4') return 'A4'
  if (size === 'A5') return 'A5'
  if (row.paper_width === 210 && row.paper_height === 148) return '凭证纸'
  return '自定义'
}

const loadTemplates = async () => {
  loading.value = true
  try {
    if (!userStore.accountSetId) {
      ElMessage.error('未选择账套')
      return
    }
    const response = await getPrintTemplates()
    templates.value = response.data || []
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载模版列表失败')
  } finally {
    loading.value = false
  }
}

const createFromPreset = (preset: VoucherPanelPreset | string) => {
  router.push({ path: '/base/print-template/design', query: { preset } })
}

const handleEdit = (template: PrintTemplate) => {
  if (!isHiprintTemplate(template)) {
    ElMessage.warning('请先升级为套打模板')
    return
  }
  router.push(`/base/print-template/design/${template.id}`)
}

async function upgradeTemplate(template: PrintTemplate, openDesigner = true) {
  const { payload, warnings } = buildUpgradedTemplatePayload(template)
  await updatePrintTemplate(template.id, payload)
  if (openDesigner) {
    if (warnings.length) ElMessage.warning(warnings[0])
    else ElMessage.success('已升级，可在设计器中核对分录表')
    await loadTemplates()
    router.push(`/base/print-template/design/${template.id}`)
  }
  return warnings
}

const handleUpgrade = async (template: PrintTemplate) => {
  upgradingId.value = template.id
  try {
    await upgradeTemplate(template, true)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '升级失败')
  } finally {
    upgradingId.value = ''
  }
}

const handleUpgradeAll = async () => {
  const legacy = templates.value.filter(isLegacyPrintTemplate)
  if (!legacy.length) return
  try {
    await ElMessageBox.confirm(`将升级 ${legacy.length} 张旧模板，升级后可在新设计器中编辑。原 elements 会保留作备份。`, '升级旧模板', {
      confirmButtonText: '全部升级',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  upgradingAll.value = true
  try {
    let warnCount = 0
    for (const row of legacy) {
      const warnings = await upgradeTemplate(row, false)
      if (warnings.length) warnCount += 1
    }
    await loadTemplates()
    ElMessage.success(warnCount ? `已升级 ${legacy.length} 张，其中 ${warnCount} 张需核对辅助核算列` : `已升级 ${legacy.length} 张旧模板`)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '升级失败')
  } finally {
    upgradingAll.value = false
  }
}

const handleSetDefault = async (template: PrintTemplate) => {
  try {
    await ElMessageBox.confirm(`确定将“${template.name}”设为默认打印模版吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await setDefaultPrintTemplate(template.id)
    ElMessage.success('设置成功')
    await loadTemplates()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '设置失败')
    }
  }
}

const handleDelete = async (template: PrintTemplate) => {
  try {
    await ElMessageBox.confirm(`确定删除模版“${template.name}”吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await deletePrintTemplate(template.id)
    ElMessage.success('删除成功')
    await loadTemplates()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

onMounted(() => {
  loadTemplates()
})
</script>

<style scoped>
.print-template-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.page-header h2 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
}

.page-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: #909399;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.page-content {
  flex: 1;
  min-height: 0;
  padding: 16px 20px;
  overflow: auto;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.template-card {
  border: 1px solid #e6ebee;
  border-radius: 10px;
  padding: 16px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(15, 35, 40, 0.04);
}

.template-card.is-default {
  border-color: #b3d8c5;
  background: #f7fbf8;
}

.card-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.card-meta {
  margin-top: 10px;
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #909399;
}

.card-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: #e6a23c;
}

.card-actions {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
