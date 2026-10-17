<template>
  <div class="dec-panel">
    <div class="dec-toolbar">
      <span class="dec-label">统一设置</span>
      <template v-for="k in KEYS" :key="k">
        <span class="dec-sub">{{ DECIMAL_LIMITS[k].label }}</span>
        <el-input-number v-model="unified[k]" size="small" :min="DECIMAL_LIMITS[k].min" :max="DECIMAL_LIMITS[k].max" :controls="false" style="width:56px" />
      </template>
      <el-button size="small" @click="applyAll">套用到全部</el-button>
      <span class="dec-spacer" />
      <el-tag v-if="!configured" size="small" type="info" effect="plain">未设置：数量 / 单价去掉末尾 0、金额两位</el-tag>
      <el-button size="small" :disabled="!configured" @click="clearAll">恢复默认显示</el-button>
      <el-button type="primary" size="small" :loading="saving" @click="save">保存小数位</el-button>
    </div>
    <el-table :data="filteredRows" size="small" border max-height="420" class="dec-table">
      <el-table-column prop="group" width="120">
        <template #header>
          <el-select v-model="groupFilter" size="small" clearable placeholder="按类别过滤" style="width:100px">
            <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column prop="label" min-width="160">
        <template #header>
          <el-input v-model="keyword" size="small" clearable placeholder="按单据类型名称检索" />
        </template>
      </el-table-column>
      <el-table-column v-for="k in KEYS" :key="k" :label="`${DECIMAL_LIMITS[k].label}小数位`" width="120" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row[k]" size="small" :min="DECIMAL_LIMITS[k].min" :max="DECIMAL_LIMITS[k].max" :controls="false" style="width:70px" />
        </template>
      </el-table-column>
      <el-table-column label="示例" min-width="200">
        <template #default="{ row }">
          <span class="dec-sample">数量 {{ sample(12345.6789, row.qty) }}　单价 {{ sample(0.003972, row.price, false) }}　金额 {{ sample(49.03, row.amount) }}</span>
        </template>
      </el-table-column>
    </el-table>
    <div class="dec-hint">只影响单据录入与显示（含打印、另存）；库存成本、往来、凭证仍按原精度计算。金额最多 2 位（凭证按分记账）。</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { DECIMAL_LIMITS, DECIMAL_SCOPES, DEFAULT_DECIMALS, formatDecimal, parseDecimals, resolveDecimals, type DecimalSetting } from '@/utils/scmDecimals'

const KEYS: Array<keyof DecimalSetting> = ['qty', 'price', 'amount']
const store = useScmDecimalsStore()
const configured = ref(false)
const saving = ref(false)
const unified = reactive<DecimalSetting>({ ...DEFAULT_DECIMALS })
const rows = ref<Array<{ key: string; label: string; group: string } & DecimalSetting>>([])

const groupFilter = ref('')
const keyword = ref('')
const groups = computed(() => Array.from(new Set(rows.value.map(r => r.group))))
const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return rows.value.filter(r => (!groupFilter.value || r.group === groupFilter.value) && (!kw || r.label.toLowerCase().includes(kw)))
})

const sample =(v: number, d: number, grouping = true) => formatDecimal(v, Number(d) || 0, { fixed: true, grouping })

async function load() {
  const r = await scmApi.getParams()
  const p = (r.data as any[]).find(x => x.param_key === 'scm:decimals')
  const cfg = parseDecimals(p?.param_value)
  configured.value = !!cfg
  Object.assign(unified, cfg?.default || DEFAULT_DECIMALS)
  rows.value = DECIMAL_SCOPES.map(s => ({ ...s, ...resolveDecimals(cfg, s.key) }))
}

function applyAll() {
  for (const r of rows.value) Object.assign(r, { qty: unified.qty, price: unified.price, amount: unified.amount })
}

async function save() {
  // 与统一设置相同的范围不单独存，统一设置改动时自动跟随
  const types: Record<string, Partial<DecimalSetting>> = {}
  for (const r of rows.value) {
    const diff: Partial<DecimalSetting> = {}
    for (const k of KEYS) if (Number(r[k]) !== Number(unified[k])) diff[k] = Number(r[k])
    if (Object.keys(diff).length) types[r.key] = diff
  }
  saving.value = true
  try {
    await scmApi.saveParams([{ param_key: 'scm:decimals', param_value: JSON.stringify({ default: { ...unified }, types }) }])
    configured.value = true
    await store.load(true)
    ElMessage.success('小数位已保存，重新打开单据 / 报表页生效')
  } finally { saving.value = false }
}

async function clearAll() {
  try { await ElMessageBox.confirm('清除小数位设置，恢复为默认显示（数量 / 单价去掉末尾 0、金额两位）？', '恢复默认', { type: 'warning' }) } catch { return }
  await scmApi.saveParams([{ param_key: 'scm:decimals', param_value: '' }])
  await store.load(true)
  await load()
  ElMessage.success('已恢复默认显示')
}

onMounted(load)
</script>

<style scoped>
.dec-panel { display: flex; flex-direction: column; gap: 8px; }
.dec-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dec-label { font-weight: 600; }
.dec-sub { color: var(--el-text-color-secondary); font-size: 12px; margin-left: 6px; }
.dec-spacer { flex: 1; }
.dec-sample { color: var(--el-text-color-secondary); font-size: 12px; }
.dec-hint { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
