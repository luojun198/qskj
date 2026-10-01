<template>
  <div class="page page-cashier-initbal">
    <div class="page-header">
      <h3>出纳期初余额</h3>
      <div class="filter-row">
        <el-button type="primary" :loading="saving" :disabled="locked" @click="handleSaveAll">
          <el-icon><Check /></el-icon>
          保存
        </el-button>
        <el-button plain :disabled="locked" :loading="glLoading" @click="handleLoadFromGl"
          title="按出纳启用月之前的总账科目余额（只计已记账凭证）回填「期初余额」">
          <el-icon><Coin /></el-icon>读入总账余额
        </el-button>
        <el-button plain :disabled="locked" @click="handleDownloadTemplate">
          <el-icon><Document /></el-icon>下载模板
        </el-button>
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :disabled="locked"
          :on-change="handleImport"
        >
          <el-button plain :disabled="locked"><el-icon><Upload /></el-icon>导入</el-button>
        </el-upload>
        <el-button plain @click="handleExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
        <span class="label">出纳启用日期</span>
        <el-date-picker
          v-model="initDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择启用日期"
          :disabled="locked"
          :clearable="false"
          class="filter-ctl--md"
          title="出纳期初 = 启用日之前的总账余额；差异清单总账侧也从启用日起算"
          @change="dateDirty = true"
        />
      </div>
    </div>
    <div class="tips">
      <el-alert v-if="locked" type="warning" :closable="false" show-icon
        :title="lockedReason || '出纳已结账，期初余额已锁定，请先全部反结账'" />
      <el-alert v-else type="info" :closable="false" show-icon
        title="出纳期初应等于出纳启用日之前的总账余额（只计已记账凭证），可用「读入总账余额」回填后核对保存" />
    </div>
    <div ref="tableContainerRef" class="table-container">
      <el-table ref="tableRef" :data="rows" :height="tableHeight" border size="small" class="compact-data-table" @header-dragend="onDragEnd">
        <el-table-column label="科目编码" prop="account_code" :width="cw('account_code', 120)" />
        <el-table-column label="科目名称" prop="account_name" min-width="160" :width="widths.account_name" />
        <el-table-column label="币别" prop="currency" :width="cw('currency', 80)" />
        <el-table-column label="期初余额" column-key="balance" :width="cw('balance', 160)" align="right">
          <template #default="{ row }">
            <el-input-number
              v-model="row.balance"
              :precision="2"
              :controls="false"
              style="width:100%"
              size="small"
              :disabled="locked"
              @change="row._dirty = true"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Coin, Download, Upload, Document } from '@element-plus/icons-vue'
import { cashierApi } from '@/api/cashier'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'

const { tableRef, containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const { colWidth, onDragEnd, widths, bindTable } = useColumnWidthMemory('cashier_init_balance')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }
bindTable(tableRef)

interface Row {
  account_code: string
  account_name?: string
  currency: string
  balance: number
  _dirty?: boolean
}

const rows = ref<Row[]>([])
const saving = ref(false)
const glLoading = ref(false)
const initDate = ref<string | null>(null)
/** FIX-263：只有出纳已结账才锁定期初（对账逐笔匹配，与期初无关） */
const locked = ref(false)
const lockedReason = ref('')
/** 评审 P1-6：启用日期可编辑，改动后「保存」写回（此前无输入控件，dateDirty 恒 false） */
let dateDirty = false

const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

onMounted(async () => {
  const [ibRes, acRes] = await Promise.all([
    cashierApi.getInitBalances(),
    cashierApi.getAccounts(),
  ])
  const acMap = new Map((acRes.data ?? []).map((a: any) => [a.code, a.name]))
  const { rows: ibRows, init_date, locked: isLocked, locked_reason } = ibRes.data as any
  initDate.value = init_date ?? null
  locked.value = !!isLocked
  lockedReason.value = locked_reason || ''

  const existing = new Map((ibRows ?? []).map((r: any) => [`${r.account_code}::${r.currency}`, r]))
  // 每个科目至少一行 RMB；已在库中存在的非本位币期初也一并列出，避免外币出纳期初导入后不可见/不可改
  const currenciesByCode = new Map<string, Set<string>>()
  for (const r of (ibRows ?? []) as any[]) {
    if (!currenciesByCode.has(r.account_code)) currenciesByCode.set(r.account_code, new Set())
    currenciesByCode.get(r.account_code)!.add(r.currency)
  }
  const built: Row[] = []
  for (const a of (acRes.data ?? [])) {
    const set = currenciesByCode.get(a.code) ?? new Set<string>()
    // FIX-260：币种跟科目走——外币科目默认生成其核算币种（如 USD）一行，本位币科目生成 RMB 一行
    const accCur = Number(a.is_foreign || 0) === 1 && a.currency_code ? String(a.currency_code).toUpperCase() : ''
    set.add(accCur && accCur !== 'CNY' ? accCur : 'RMB')
    for (const cur of set) {
      const ex = existing.get(`${a.code}::${cur}`) as any
      built.push({
        account_code: a.code,
        account_name: acMap.get(a.code) as string | undefined,
        currency: cur,
        balance: ex?.balance ?? 0,
        _dirty: false,
      })
    }
  }
  rows.value = built.sort((x, y) => x.account_code.localeCompare(y.account_code) || x.currency.localeCompare(y.currency))
})

async function handleSaveAll() {
  const dirty = rows.value.filter(r => r._dirty)
  if (!dirty.length && !dateDirty) return ElMessage.info('没有修改')
  if (dirty.length) {
    const names = dirty.slice(0, 6).map(r => `${r.account_code} ${r.account_name ?? ''}（${r.currency}）：${fmt(r.balance || 0)}`).join('<br>')
    try {
      await ElMessageBox.confirm(
        `将修改 ${dirty.length} 个科目的期初余额：<br>${names}${dirty.length > 6 ? '<br>…' : ''}<br><br>`
        + '修改后出纳日记账各月余额、差异清单会随之变化；已完成的对账不受影响。确认保存？',
        '修改期初余额', { type: 'warning', dangerouslyUseHTMLString: true, confirmButtonText: '保存', cancelButtonText: '取消' })
    } catch { return }
  }
  saving.value = true
  try {
    for (const r of dirty) {
      await cashierApi.upsertInitBalance({
        account_code: r.account_code,
        currency: r.currency,
        balance: r.balance,
        init_date: initDate.value ?? undefined,
      })
      r._dirty = false
    }
    if (!dirty.length && dateDirty && rows.value.length) {
      const r = rows.value[0]
      await cashierApi.upsertInitBalance({
        account_code: r.account_code,
        currency: r.currency,
        balance: r.balance,
        init_date: initDate.value ?? undefined,
      })
    }
    dateDirty = false
    ElMessage.success('保存成功')
  } finally {
    saving.value = false
  }
}

/** 读入总账余额：按出纳启用月之前的总账余额回填「期初余额」，确认后标记为待保存 */
async function handleLoadFromGl() {
  glLoading.value = true
  let data: { init_date: string; rows: Array<{ account_code: string; currency: string; balance: number }> }
  try {
    if (!initDate.value) {
      ElMessage.warning('请先选择出纳启用日期')
      return
    }
    const res = await cashierApi.getInitBalanceFromGl(initDate.value)
    if (res.code !== 0) return
    data = res.data
  } finally {
    glLoading.value = false
  }
  const byKey = new Map(rows.value.map(r => [`${r.account_code}::${r.currency}`, r]))
  const hits = data.rows.filter(g => byKey.has(`${g.account_code}::${g.currency}`))
  if (!hits.length) return ElMessage.warning('总账里没有找到对应的出纳科目')
  const changed = hits.filter(g => Math.abs((byKey.get(`${g.account_code}::${g.currency}`)!.balance || 0) - g.balance) > 0.005)
  if (!changed.length) return ElMessage.success(`各科目期初余额与总账（${data.init_date} 之前）一致，无需回填`)
  const lines = changed.slice(0, 8).map(g => {
    const r = byKey.get(`${g.account_code}::${g.currency}`)!
    return `${g.account_code} ${r.account_name ?? ''}（${g.currency}）：${fmt(r.balance || 0)} → ${fmt(g.balance)}`
  })
  try {
    await ElMessageBox.confirm(
      `按总账 ${data.init_date} 之前的余额，有 ${changed.length} 个科目的期初余额不同：<br>${lines.join('<br>')}${changed.length > 8 ? '<br>…' : ''}<br><br>回填到「期初余额」？回填后需点「保存」才生效。`,
      '读入总账余额', { type: 'info', dangerouslyUseHTMLString: true, confirmButtonText: '回填', cancelButtonText: '取消' })
  } catch { return }
  for (const g of changed) {
    const r = byKey.get(`${g.account_code}::${g.currency}`)!
    r.balance = g.balance
    r._dirty = true
  }
  ElMessage.success(`已回填 ${changed.length} 个科目，请核对后点击保存`)
}

// ── 导出 ──────────────────────────────────────────────────
async function handleExport() {
  const XLSX = await import('xlsx')
  const data = [
    ['科目编码', '科目名称', '币别', '期初余额'],
    ...rows.value.map(r => [r.account_code, r.account_name ?? '', r.currency, r.balance]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '出纳期初余额')
  XLSX.writeFile(wb, `出纳期初余额_${initDate.value ?? '未设置'}.xlsx`)
}

// ── 下载模版 ───────────────────────────────────────────────
async function handleDownloadTemplate() {
  const XLSX = await import('xlsx')
  const data = [
    ['科目编码', '科目名称', '币别', '期初余额'],
    ['1001', '库存现金', 'RMB', 0],
    ['1002', '银行存款', 'RMB', 0],
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '出纳期初余额')
  XLSX.writeFile(wb, '出纳期初余额导入模版.xlsx')
}

// ── 导入 ──────────────────────────────────────────────────
async function handleImport(file: any) {
  const XLSX = await import('xlsx')
  const raw: File = file.raw
  if (!raw) return
  const buf = await raw.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  // 找表头行（含"科目编码"的行）
  const headerIdx = data.findIndex(r => String(r[0]).includes('科目编码'))
  if (headerIdx < 0) return ElMessage.error('未找到表头行（需包含"科目编码"列）')
  const dataRows = data.slice(headerIdx + 1).filter(r => r[0])

  // P2-8：按「科目编码 + 币别」定位（此前只按编码，同科目多币别时后一行覆盖前一行，外币期初写到错误币别）；
  // 币别列缺失或为空按本位币 RMB；文件里出现表上没有的币别行则新增一行
  const header = data[headerIdx].map((h: any) => String(h ?? ''))
  const curIdx = header.findIndex(h => h.includes('币别') || h.includes('币种'))
  const balIdx = header.findIndex(h => h.includes('余额'))
  const codeMap = new Map(rows.value.map(r => [`${r.account_code}::${r.currency}`, r]))
  const nameMap = new Map(rows.value.map(r => [r.account_code, r.account_name]))
  let updated = 0
  let added = 0
  for (const r of dataRows) {
    const code = String(r[0]).trim()
    const currency = (curIdx >= 0 ? String(r[curIdx] ?? '').trim().toUpperCase() : '') || 'RMB'
    const balance = Number(r[balIdx >= 0 ? balIdx : 3]) || 0
    const key = `${code}::${currency === 'CNY' ? 'RMB' : currency}`
    const row = codeMap.get(key)
    if (row) {
      row.balance = balance
      row._dirty = true
      updated++
    } else if (nameMap.has(code)) {
      const newRow: Row = { account_code: code, account_name: nameMap.get(code), currency: key.split('::')[1], balance, _dirty: true }
      rows.value.push(newRow)
      codeMap.set(key, newRow)
      added++
    }
  }
  if (!updated && !added) return ElMessage.warning('未匹配到任何科目编码，请检查文件格式')
  if (added) rows.value.sort((x, y) => x.account_code.localeCompare(y.account_code) || x.currency.localeCompare(y.currency))
  ElMessage.success(`已导入 ${updated + added} 条${added ? `（新增 ${added} 个币别行）` : ''}，请点击保存`)
}
</script>

<style scoped>
.page-cashier-initbal { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.label { font-size: var(--cw-text-base); color: var(--el-text-color-regular); }
.tips { padding: 0 0 var(--block-gap); }
.table-container { flex: 1; overflow: hidden; padding: 0; }
</style>
