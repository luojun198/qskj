/**
 * ACD 导出服务 — 出纳 / 固定资产模块可逆还原
 *
 * 将 DB 数据还原为润衡 .acd 中的 GBK+TAB 文本格式。
 * 还原策略：
 *   1. 优先用 acd_raw（JSON 数组）逐字段还原，保留原始数据无损
 *   2. acd_raw 为空时按列顺序从结构化字段重组（仅覆盖已映射列）
 * 列顺序严格按 data_stru.txt（由 acd_reader.py 解析确认）。
 */
import type Database from 'better-sqlite3'
import iconv from 'iconv-lite'

// ── 工具 ──────────────────────────────────────────────────

/** 将一行（string[]）编码为 GBK TAB 分隔行（Buffer） */
function rowToGbkLine(cells: string[]): Buffer {
  return iconv.encode(cells.join('\t') + '\r\n', 'gbk')
}

/** 从 DB 行组装导出列，优先用 acd_raw */
function buildRowFromRaw(
  dbRow: Record<string, any>,
  colsFromRaw: readonly string[],
  overrides: Record<string, (r: Record<string, any>) => string>
): string[] {
  let raw: string[] | null = null
  if (dbRow.acd_raw) {
    try { raw = JSON.parse(dbRow.acd_raw) } catch { /* 忽略 */ }
  }
  return colsFromRaw.map((col, idx) => {
    if (overrides[col]) return overrides[col](dbRow)
    if (raw && idx < raw.length) return raw[idx] ?? ''
    return ''
  })
}

/** null/undefined → 空字符串，数字保留原始精度 */
const s = (v: any) => (v == null ? '' : String(v))
/** 日期 YYYY-MM-DD → YYYY.MM.DD（润衡格式） */
const d = (v: any) => (v ? String(v).replace(/-/g, '.') : '')

// ── 列定义（严格按 data_stru.txt 顺序） ─────────────────────

// cn_mx(26 列)
const CN_MX_COLS = ['kmbm','bz','rq','xh','nf','yf','dd','zy','jf','df','bz1','bz2','gzm','lrr','sm','dfkm','bz3','g_qymc','khyh','yhzh','dwbm','bz4','p_nf','p_yf','p_pzlx','p_pzbh'] as const

// cn_nc(3 列)
const CN_NC_COLS = ['kmbm','bz','ye'] as const

// jslb(2 列)
const JSLB_COLS = ['jslb','jslb_mc'] as const

// yhdzd(11 列)
const YHDZD_COLS = ['dzd_xh','rq','kmbm','jf','df','jslb','pz_ph','dzbz','dzbh','pz_dzd_bz','csh_bz'] as const

// zc_gdzc(50 列)
const ZC_GDZC_COLS = ['bh','mc','sblb','sbzt','sydw','gzrq','yz','czl','yzcz','syrq','zjff','synx','zgzl','bz','ytbh','ygzl','yzje','ljzjy','ljgzl','ljzje','sbbz','zxyy','zxrq','zcjz','zjjt','bjbh','wbbz','wbje','zccm','azdd','zcrq','dw','sl','ckbh','synx_y','syr','bgr','jzmj','fczh','pzhm','ly','tdsyzh','cqjd_bz','cgjz','synx_1','gyzccqzh','fssbsm','zj_bz','jdr','jdrq'] as const

// zc_yzjb(11 列)
const ZC_YZJB_COLS = ['nf','yf','bh','sydw','ytbh','zjff','yzjl','ygzl','yzje','ckbh','ljzje'] as const

// zc_yzzj(10 列)
const ZC_YZZJ_COLS = ['xh','bh','ckbh','rq','yz','yzzje','sm','nf','yf','s1'] as const

// zc_sbbd(6 列)
const ZC_SBBD_COLS = ['bh','bdxm','oldvalue','newvalue','rq','czr'] as const

// zc_sblb(4 列)
const ZC_SBLB_COLS = ['sblb','mc','czl','kmbm'] as const

// zc_sbzt(3 列)
const ZC_SBZT_COLS = ['sbzt','sbzt_mc','zjjt'] as const

// zc_sbyt(3 列)
const ZC_SBYT_COLS = ['ytbh','yt_mc','kmbm'] as const

// zc_sydw(2 列)
const ZC_SYDW_COLS = ['sydw','dw_mc'] as const

// ── 导出函数（各表返回 GBK Buffer） ──────────────────────────

export function exportCnMx(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM cashier_journal WHERE account_set_id=? ORDER BY biz_date,seq,created_at').all(accountSetId) as any[]
  const bufs: Buffer[] = []
  // 静态行序号（ACD dzd_xh 格式）
  for (const r of rows) {
    const cells = buildRowFromRaw(r, CN_MX_COLS, {
      kmbm: r => s(r.account_code),
      bz:   r => s(r.currency) || 'RMB',
      rq:   r => d(r.biz_date),
      xh:   r => s(r.seq),
      nf:   r => r.biz_date ? r.biz_date.slice(0,4) : '',
      yf:   r => r.biz_date ? String(parseInt(r.biz_date.slice(5,7))) : '',
      dd:   r => r.biz_date ? String(parseInt(r.biz_date.slice(8,10))) : '',
      zy:   r => s(r.summary),
      jf:   r => s(r.debit),
      df:   r => s(r.credit),
      gzm:  r => r.reconciled ? '1' : '',
      lrr:  r => s(r.created_by),
      dfkm: r => s(r.counter_account),
      g_qymc: r => s(r.counter_unit),
      khyh: r => s(r.bank_name),
      yhzh: r => s(r.bank_account),
      dwbm: r => s(r.unit_code),
      p_nf: r => s(r.voucher_year),
      p_yf: r => s(r.voucher_month),
      p_pzlx: r => s(r.voucher_type),
      p_pzbh: r => s(r.voucher_no),
    })
    bufs.push(rowToGbkLine(cells))
  }
  return Buffer.concat(bufs)
}

export function exportCnNc(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM cashier_init_balance WHERE account_set_id=? ORDER BY account_code,currency').all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([s(r.account_code), s(r.currency) || 'RMB', s(r.balance)]))
  return Buffer.concat(bufs)
}

export function exportJslb(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM settle_type WHERE account_set_id=? ORDER BY code').all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([s(r.code), s(r.name)]))
  return Buffer.concat(bufs)
}

export function exportYhdzd(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM bank_statement WHERE account_set_id=? ORDER BY biz_date,id').all(accountSetId) as any[]
  let xh = 1
  const bufs: Buffer[] = []
  for (const r of rows) {
    const cells = buildRowFromRaw(r, YHDZD_COLS, {
      dzd_xh: () => String(xh++),
      rq:     r => d(r.biz_date),
      kmbm:   r => s(r.account_code),
      jf:     r => s(r.debit),
      df:     r => s(r.credit),
      jslb:   r => s(r.settle_type),
      pz_ph:  r => s(r.bill_no),
      dzbz:   r => r.matched ? '1' : '',
      dzbh:   r => s(r.match_batch),
    })
    bufs.push(rowToGbkLine(cells))
  }
  return Buffer.concat(bufs)
}

export function exportZcGdzc(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM fixed_asset WHERE account_set_id=? ORDER BY asset_no').all(accountSetId) as any[]
  const bufs: Buffer[] = []
  for (const r of rows) {
    const cells = buildRowFromRaw(r, ZC_GDZC_COLS, {
      bh:    r => s(r.asset_no),
      mc:    r => s(r.asset_name),
      sblb:  r => s(r.category_code),
      sbzt:  r => s(r.status_code),
      sydw:  r => s(r.dept_code),
      gzrq:  r => d(r.acquire_date),
      yz:    r => s(r.original_value),
      czl:   r => s(r.salvage_rate),
      yzcz:  r => s(r.salvage_value),
      syrq:  r => d(r.start_depr_date),
      zjff:  r => s(r.depr_method),
      synx:  r => s(r.use_months),
      zgzl:  r => s(r.total_workload),
      bz:    r => s(r.remark),
      ytbh:  r => s(r.purpose_code),
      ljzjy: r => s(r.depr_months_done),
      ljgzl: r => s(r.workload_done),
      ljzje: r => s(r.accum_depr),
      zxyy:  r => s(r.scrap_reason),
      zxrq:  r => d(r.scrap_date),
      zcjz:  r => s(r.net_value),
      bjbh:  r => s(r.card_no),
      wbbz:  r => r.is_foreign ? '1' : '',
      wbje:  r => s(r.foreign_value),
      azdd:  r => s(r.install_place),
      dw:    r => s(r.unit),
      sl:    r => s(r.qty),
      synx_y: r => s(r.use_years),
      syr:   r => s(r.user_name),
      bgr:   r => s(r.keeper),
      ly:    r => s(r.source),
    })
    bufs.push(rowToGbkLine(cells))
  }
  return Buffer.concat(bufs)
}

export function exportZcYzjb(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM fixed_asset_depr WHERE account_set_id=? ORDER BY year,month,asset_no').all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([
    s(r.year), s(r.month), s(r.asset_no), s(r.dept_code), s(r.purpose_code),
    s(r.depr_method), '', '', s(r.month_depr), '', s(r.accum_depr),
  ]))
  return Buffer.concat(bufs)
}

export function exportZcYzzj(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare("SELECT * FROM fixed_asset_change WHERE account_set_id=? AND change_item='原值增减' ORDER BY change_date,id").all(accountSetId) as any[]
  let xh = 1
  const bufs = rows.map(r => rowToGbkLine([
    String(xh++), s(r.asset_no), '', d(r.change_date),
    s(r.new_value), s(r.amount), s(r.remark),
    r.change_date ? r.change_date.slice(0,4) : '',
    r.change_date ? String(parseInt(r.change_date.slice(5,7))) : '',
    '',
  ]))
  return Buffer.concat(bufs)
}

export function exportZcSbbd(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare("SELECT * FROM fixed_asset_change WHERE account_set_id=? AND (change_item IS NULL OR change_item != '原值增减') ORDER BY change_date,id").all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([
    s(r.asset_no), s(r.change_item), s(r.old_value), s(r.new_value),
    d(r.change_date), s(r.operator),
  ]))
  return Buffer.concat(bufs)
}

export function exportZcSblb(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM fixed_asset_category WHERE account_set_id=? ORDER BY code').all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([s(r.code), s(r.name), s(r.salvage_rate), s(r.account_code)]))
  return Buffer.concat(bufs)
}

export function exportZcSbzt(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM fixed_asset_status WHERE account_set_id=? ORDER BY code').all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([s(r.code), s(r.name), r.depreciable ? '1' : '0']))
  return Buffer.concat(bufs)
}

export function exportZcSbyt(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM fixed_asset_purpose WHERE account_set_id=? ORDER BY code').all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([s(r.code), s(r.name), s(r.expense_account)]))
  return Buffer.concat(bufs)
}

export function exportZcSydw(db: Database, accountSetId: string): Buffer {
  const rows = db.prepare('SELECT * FROM fixed_asset_dept WHERE account_set_id=? ORDER BY code').all(accountSetId) as any[]
  const bufs = rows.map(r => rowToGbkLine([s(r.code), s(r.name)]))
  return Buffer.concat(bufs)
}

// ── 主导出函数：返回所有表的 Map<filename, Buffer> ────────────

export function exportCashierAssetTables(db: Database, accountSetId: string): Map<string, Buffer> {
  return new Map([
    ['rhsj\\cn_mx.txt',   exportCnMx(db, accountSetId)],
    ['rhsj\\cn_nc.txt',   exportCnNc(db, accountSetId)],
    ['rhsj\\jslb.txt',    exportJslb(db, accountSetId)],
    ['rhsj\\yhdzd.txt',   exportYhdzd(db, accountSetId)],
    ['rhsj\\zc_gdzc.txt', exportZcGdzc(db, accountSetId)],
    ['rhsj\\zc_yzjb.txt', exportZcYzjb(db, accountSetId)],
    ['rhsj\\zc_yzzj.txt', exportZcYzzj(db, accountSetId)],
    ['rhsj\\zc_sbbd.txt', exportZcSbbd(db, accountSetId)],
    ['rhsj\\zc_sblb.txt', exportZcSblb(db, accountSetId)],
    ['rhsj\\zc_sbzt.txt', exportZcSbzt(db, accountSetId)],
    ['rhsj\\zc_sbyt.txt', exportZcSbyt(db, accountSetId)],
    ['rhsj\\zc_sydw.txt', exportZcSydw(db, accountSetId)],
  ])
}
