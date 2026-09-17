<template>
  <div class="page page-cashier-initbal">
    <div class="page-header">
      <h3>出纳期初余额</h3>
      <div class="filter-row">
        <el-button type="primary" :loading="saving" :disabled="locked" @click="handleSaveAll">
          <el-icon><Check /></el-icon>
          保存
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
      </div>
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
import { ElMessage } from 'element-plus'
import { Check, Download, Upload, Document } from '@element-plus/icons-vue'
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
const initDate = ref<string | null>(null)
const locked = ref(false)
let dateDirty = false

function markDateDirty() { dateDirty = true }

onMounted(async () => {
  const [ibRes, acRes] = await Promise.all([
    cashierApi.getInitBalances(),
    cashierApi.getAccounts(),
  ])
  const acMap = new Map((acRes.data ?? []).map((a: any) => [a.code, a.name]))
  const { rows: ibRows, init_date, locked: isLocked } = ibRes.data as any
  initDate.value = init_date ?? null
  locked.value = !!isLocked

  const existing = new Map((ibRows ?? []).map((r: any) => [`${r.account_code}::${r.currency}`, r.balance]))
  // 每个科目至少一行 RMB；已在库中存在的非本位币期初也一并列出，避免外币出纳期初导入后不可见/不可改
  const currenciesByCode = new Map<string, Set<string>>()
  for (const r of (ibRows ?? []) as any[]) {
    if (!currenciesByCode.has(r.account_code)) currenciesByCode.set(r.account_code, new Set())
    currenciesByCode.get(r.account_code)!.add(r.currency)
  }
  const built: Row[] = []
  for (const a of (acRes.data ?? [])) {
    const set = currenciesByCode.get(a.code) ?? new Set<string>()
    set.add('RMB')
    for (const cur of set) {
      built.push({
        account_code: a.code,
        account_name: acMap.get(a.code) as string | undefined,
        currency: cur,
        balance: (existing.get(`${a.code}::${cur}`) as number) ?? 0,
        _dirty: false,
      })
    }
  }
  rows.value = built.sort((x, y) => x.account_code.localeCompare(y.account_code) || x.currency.localeCompare(y.currency))
})

async function handleSaveAll() {
  const dirty = rows.value.filter(r => r._dirty)
  if (!dirty.length && !dateDirty) return ElMessage.info('没有修改')
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
.table-container { flex: 1; overflow: hidden; padding: 0 16px 8px; }
</style>
