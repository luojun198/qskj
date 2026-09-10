<template>
  <div class="page cd-page" v-loading="loading">
    <!-- 顶部导航 -->
    <div class="cd-header">
      <div class="cd-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="cd-header__sep">/</span>
        <span class="cd-header__title">成本明细</span>
        <el-tag v-if="doc?.doc_no" size="small" style="margin-left:8px">{{ doc.doc_no }}</el-tag>
        <el-tag v-if="doc" type="info" size="small" effect="plain" style="margin-left:4px">
          {{ doc.doc_type === 'WI' ? '委外入库' : '完工入库' }}
        </el-tag>
        <el-tag v-if="doc?.plan_code" type="warning" size="small" effect="plain" style="margin-left:4px">
          工单 {{ doc.plan_code }}
        </el-tag>
      </div>
    </div>

    <div class="cd-body">
      <el-empty v-if="!loading && !applicable" description="仅已审核的完工/委外入库单可查看成本明细" />

      <template v-else-if="applicable">
        <!-- 汇总卡 -->
        <div class="sum-cards">
          <div class="card"><div class="lbl">料成本</div><div class="val">{{ fmt(summary.material_cost) }}</div></div>
          <div class="card" :class="{ muted: !summary.labor }"><div class="lbl">人工</div><div class="val">{{ fmt(summary.labor) }}</div></div>
          <div class="card" :class="{ muted: !summary.overhead }"><div class="lbl">制费</div><div class="val">{{ fmt(summary.overhead) }}</div></div>
          <div class="card" :class="{ muted: !summary.fee_total }"><div class="lbl">加工费</div><div class="val">{{ fmt(summary.fee_total) }}</div></div>
          <div class="card total"><div class="lbl">入库成本合计</div><div class="val">{{ fmt(summary.total_cost) }}</div></div>
        </div>
        <div class="cd-hint">入库单位成本 = 料成本（各成品 BOM 每件用量×(1+损耗) × 该料净领单价，按在制吸收系数还原实际结转）{{ doc?.doc_type === 'WI' ? '+ 加工费' : '+ 人工/制费' }}；成本在审核时归集写定。</div>

        <!-- 逐成品 -->
        <section v-for="line in lines" :key="line.seq" class="cd-prod">
          <div class="cd-prod__hd">
            <div class="cd-prod__title">
              <b>{{ line.item_code }}</b> {{ line.item_name }}
              <span class="cd-prod__sub">完工数 {{ num(line.qty) }}　入库单位成本 {{ fmt(line.unit_cost) }}　本行合计 {{ fmt(line.total_cost) }}</span>
            </div>
            <div class="cd-prod__seg">
              <span class="seg">料 <b>{{ fmt(line.material_cost) }}</b></span>
              <span class="seg" :class="{ muted: !line.labor }">人工 <b>{{ fmt(line.labor) }}</b></span>
              <span class="seg" :class="{ muted: !line.overhead }">制费 <b>{{ fmt(line.overhead) }}</b></span>
              <span class="seg" :class="{ muted: !line.fee_total }">加工费 <b>{{ fmt(line.fee_total) }}</b></span>
            </div>
          </div>
          <el-table v-if="line.materials.length" :data="line.materials" size="small" border stripe show-summary :summary-method="(p:any) => matSummary(p, line)">
            <el-table-column type="index" label="序号" width="54" align="center" />
            <el-table-column label="物料编号" prop="item_code" width="120" show-overflow-tooltip />
            <el-table-column label="物料名称" prop="item_name" min-width="160" show-overflow-tooltip />
            <el-table-column label="规格" prop="spec" min-width="120" show-overflow-tooltip />
            <el-table-column label="每件用量" width="110" align="right"><template #default="{ row }">{{ num(row.per_unit) }}</template></el-table-column>
            <el-table-column label="损耗率%" prop="scrap_rate" width="90" align="right" />
            <el-table-column label="净领单价" width="120" align="right"><template #default="{ row }">{{ fmt(row.issue_unit_price) }}</template></el-table-column>
            <el-table-column label="单件小计" width="120" align="right"><template #default="{ row }">{{ fmt(row.unit_subtotal) }}</template></el-table-column>
            <el-table-column label="本次料成本" width="130" align="right"><template #default="{ row }"><b>{{ fmt(row.actual_cost) }}</b></template></el-table-column>
          </el-table>
          <el-empty v-else :image-size="50" :description="`未匹配到工单用料明细，料成本合计 ${fmt(line.material_cost)}`" />
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmDownstreamDocRoute } from '@/utils/scmDocNavigation'

const route = useRoute()
const router = useRouter()
const docId = computed(() => route.params.id as string)

const loading = ref(false)
const applicable = ref(false)
const doc = ref<any>(null)
const summary = ref<any>({ material_cost: 0, labor: 0, overhead: 0, fee_total: 0, total_cost: 0 })
const lines = ref<any[]>([])

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }

// 料明细表合计行：仅「本次料成本」列显示（=该成品料成本），其余留空
function matSummary({ columns }: any, line: any) {
  return columns.map((_: any, i: number) => (i === 0 ? '合计' : i === columns.length - 1 ? fmt(line.material_cost) : ''))
}

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getDocCostDetail(docId.value)
    if (r.code === 0) {
      applicable.value = !!r.data?.applicable
      if (applicable.value) {
        doc.value = r.data.doc
        summary.value = r.data.summary
        lines.value = r.data.lines || []
      }
    }
  } finally { loading.value = false }
}

function goBack() { router.push(scmDownstreamDocRoute(docId.value, doc.value?.status, undefined, doc.value?.doc_type)) }

onMounted(load)
</script>

<style scoped>
.cd-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.cd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.cd-header__left { display: flex; align-items: center; }
.cd-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.cd-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.cd-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px 16px; }
.cd-hint { font-size: 12px; color: var(--el-text-color-secondary); margin: 8px 0 12px; line-height: 1.6; }
.sum-cards { display: flex; gap: 10px; flex-wrap: wrap; }
.sum-cards .card { flex: 1; min-width: 120px; padding: 8px 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-light); }
.sum-cards .card.total { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-5); }
.sum-cards .card.muted { opacity: .55; }
.sum-cards .card .lbl { font-size: 12px; color: var(--el-text-color-secondary); }
.sum-cards .card .val { font-size: 18px; font-weight: 600; margin-top: 2px; }
.cd-prod { margin-bottom: 18px; }
.cd-prod__hd { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.cd-prod__title { font-size: var(--cw-text-base); }
.cd-prod__sub { margin-left: 10px; font-size: 12px; color: var(--el-text-color-secondary); }
.cd-prod__seg { display: flex; gap: 14px; font-size: var(--cw-text-base); color: var(--el-text-color-regular); }
.cd-prod__seg .seg.muted { opacity: .5; }
.cd-prod__seg .seg b { color: var(--el-text-color-primary); }
</style>
