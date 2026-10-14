<template>
  <div class="page vd-page">
    <!-- 顶部导航：返回 + 标题 + 关键信息 + 操作 -->
    <div class="vd-header">
      <div class="vd-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="vd-header__sep">/</span>
        <span class="vd-header__title">核销单</span>
        <el-tag v-if="detail" size="small" effect="plain">{{ detail.verify_no }}</el-tag>
        <el-tag v-if="detail" size="small" effect="plain" :type="detail.gen_mode === 'auto' ? 'info' : 'success'">
          {{ detail.gen_mode === 'auto' ? '收付款自动' : '手动核销' }}
        </el-tag>
      </div>
      <div class="vd-header__right">
        <el-button size="small" @click="load">刷新</el-button>
        <el-button v-if="detail && detail.gen_mode === 'auto' && sourceDoc" size="small" type="primary" plain @click="openDoc(sourceDoc)">
          打开{{ detail.source_doc_type === 'RCV' ? '收款单' : '付款单' }} {{ detail.source_doc_no }}
        </el-button>
        <el-button v-if="detail && detail.gen_mode === 'manual' && canDelete" size="small" type="danger" plain :loading="deleting" @click="remove">删除核销单</el-button>
      </div>
    </div>

    <div v-loading="loading" class="vd-body">
      <el-empty v-if="!loading && !detail" description="核销单不存在或已删除" />
      <template v-else-if="detail">
        <el-descriptions :column="4" border size="small" class="vd-info">
          <el-descriptions-item label="业务类型">{{ detail.biz_type }}</el-descriptions-item>
          <el-descriptions-item :label="detail.side === 'ar' ? '客户' : '供应商'">{{ detail.partner_code }} {{ detail.partner_name }}</el-descriptions-item>
          <el-descriptions-item label="单据日期">{{ detail.verify_date }}</el-descriptions-item>
          <el-descriptions-item label="核销金额"><b>{{ fmt(detail.total_amount) }}</b></el-descriptions-item>
          <el-descriptions-item label="制单人">{{ detail.created_by || '—' }}</el-descriptions-item>
          <el-descriptions-item label="制单时间">{{ detail.created_at }}</el-descriptions-item>
          <el-descriptions-item label="说明" :span="2">
            <span v-if="detail.gen_mode === 'auto'" class="text-muted">由{{ detail.source_doc_type === 'RCV' ? '收款单' : '付款单' }}「{{ detail.source_doc_no }}」选源单审核时自动生成，反审核该单据即撤销</span>
            <span v-else class="text-muted">在「往来核销」页手工核销生成；删除即取消核销</span>
          </el-descriptions-item>
        </el-descriptions>

        <div class="vd-section-hd">{{ detail.side === 'ar' ? '收款 / 预收单据' : '付款 / 预付单据' }}<span>{{ detail.out_items.length }} 张</span></div>
        <el-table :data="detail.out_items" border stripe size="small" show-summary :summary-method="sum">
          <el-table-column type="index" label="序号" width="55" align="center" />
          <el-table-column label="源单编号" min-width="150">
            <template #default="{ row }"><el-link type="primary" :underline="false" @click="openDoc(row)">{{ row.doc_no }}</el-link></template>
          </el-table-column>
          <el-table-column label="业务类别" width="100"><template #default="{ row }">{{ typeName(row.doc_type) }}</template></el-table-column>
          <el-table-column label="单据日期" prop="doc_date" width="105" />
          <el-table-column label="单据金额" prop="doc_amount" width="120" align="right"><template #default="{ row }">{{ fmt(row.doc_amount) }}</template></el-table-column>
          <el-table-column label="已核销金额" prop="verified_amount" width="120" align="right"><template #default="{ row }">{{ fmt(row.verified_amount) }}</template></el-table-column>
          <el-table-column label="未核销金额" prop="open_amount" width="120" align="right"><template #default="{ row }">{{ fmt(row.open_amount) }}</template></el-table-column>
          <el-table-column label="本次核销金额" prop="this_amount" width="130" align="right"><template #default="{ row }"><b>{{ fmt(row.this_amount) }}</b></template></el-table-column>
          <el-table-column label="源单备注" prop="remark" min-width="160" show-overflow-tooltip />
        </el-table>

        <div class="vd-section-hd">{{ detail.side === 'ar' ? '应收单据' : '应付单据' }}<span>{{ detail.in_items.length }} 张</span></div>
        <el-table :data="detail.in_items" border stripe size="small" show-summary :summary-method="sum">
          <el-table-column type="index" label="序号" width="55" align="center" />
          <el-table-column label="源单编号" min-width="150">
            <template #default="{ row }"><el-link type="primary" :underline="false" @click="openDoc(row)">{{ row.doc_no }}</el-link></template>
          </el-table-column>
          <el-table-column label="业务类别" width="100"><template #default="{ row }">{{ typeName(row.doc_type) }}</template></el-table-column>
          <el-table-column label="单据日期" prop="doc_date" width="105" />
          <el-table-column label="单据金额" prop="doc_amount" width="120" align="right"><template #default="{ row }">{{ fmt(row.doc_amount) }}</template></el-table-column>
          <el-table-column label="已核销金额" prop="verified_amount" width="120" align="right"><template #default="{ row }">{{ fmt(row.verified_amount) }}</template></el-table-column>
          <el-table-column label="未核销金额" prop="open_amount" width="120" align="right"><template #default="{ row }">{{ fmt(row.open_amount) }}</template></el-table-column>
          <el-table-column label="本次核销金额" prop="this_amount" width="130" align="right"><template #default="{ row }"><b>{{ fmt(row.this_amount) }}</b></template></el-table-column>
          <el-table-column label="源单备注" prop="remark" min-width="160" show-overflow-tooltip />
        </el-table>
        <div class="text-muted vd-note">已核销 / 未核销金额为源单当前累计数（含其它核销单），本次核销金额为本核销单分配到该源单的金额。</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi, type ArapVerifyDetail, type ArapVerifyDetailItem } from '@/api/scm'
import { hasPermission } from '@/utils/permission'
import { typeName } from '@/utils/scmDoc'
import { scmDownstreamDocRoute } from '@/utils/scmDocNavigation'

const route = useRoute()
const router = useRouter()
const canDelete = computed(() => hasPermission('scm:verify-delete'))
const detail = ref<ArapVerifyDetail | null>(null)
const loading = ref(false)
const deleting = ref(false)
const verifyNo = computed(() => String(route.params.verifyNo || ''))
const sourceDoc = computed(() => detail.value?.out_items.find(o => o.doc_no === detail.value?.source_doc_no) || null)

const fmt = (v: number) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const SUM_PROPS = new Set(['this_amount'])
function sum({ columns, data }: { columns: any[]; data: ArapVerifyDetailItem[] }) {
  return columns.map((c, i) => (i === 0 ? '合计' : SUM_PROPS.has(c.property) ? fmt(data.reduce((s, r) => s + (Number((r as any)[c.property]) || 0), 0)) : ''))
}

async function load() {
  if (!verifyNo.value) return
  loading.value = true
  try {
    const r = await scmApi.getArapVerifyDetail(verifyNo.value)
    detail.value = r.code === 0 ? r.data : null
  } catch {
    detail.value = null
  } finally { loading.value = false }
}
function openDoc(row: ArapVerifyDetailItem) {
  if (!row.doc_id) return ElMessage.warning('源单已不存在')
  router.push(scmDownstreamDocRoute(row.doc_id, row.doc_status, undefined, row.doc_type))
}
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push({ name: 'ScmArApVerifyRecords' })
}
async function remove() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm(`删除核销单「${detail.value.verify_no}」（${fmt(detail.value.total_amount)}）？删除后两侧单据恢复为未核销。`, '删除核销单', { type: 'warning' })
  } catch { return }
  deleting.value = true
  try {
    await scmApi.cancelArapVerify(detail.value.verify_no, { skipErrorToast: true })
    ElMessage.success('核销单已删除')
    router.push({ name: 'ScmArApVerifyRecords' })
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '删除失败')
  } finally { deleting.value = false }
}

onMounted(load)
watch(verifyNo, (v, old) => { if (v && v !== old && route.name === 'ScmArApVerifyRecord') load() })
</script>

<style scoped>
.vd-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.vd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0;
}
.vd-header__left { display: flex; align-items: center; gap: 6px; font-size: var(--cw-text-base); }
.vd-header__sep { color: var(--el-text-color-placeholder); }
.vd-header__title { font-weight: 600; color: var(--el-text-color-primary); }
.vd-header__right { display: flex; gap: 8px; }
.vd-body { flex: 1; overflow: auto; padding: 14px 16px; }
.vd-info { margin-bottom: 14px; }
.vd-section-hd { display: flex; align-items: baseline; gap: 8px; margin: 14px 0 8px; font-weight: 600; }
.vd-section-hd span { font-weight: normal; font-size: 12px; color: var(--el-text-color-secondary); }
.vd-note { margin-top: 8px; font-size: 12px; }
.text-muted { color: var(--el-text-color-secondary); }
</style>
