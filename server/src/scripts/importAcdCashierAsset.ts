/**
 * ACD 出纳 / 固定资产模块数据导入
 *
 * 从 parseAcdTables 解析出的原始行（ParsedTables）导入到 M1 建立的表。
 * 列顺序严格锚定 data_stru.txt（见 docs/2026-06-01-固定资产与出纳模块开发计划.md §1）。
 * 空字段也占位，禁止按列 filter，按固定下标取值。
 */
import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import { normalizeSalvageRate } from '../services/assetVoucherBuilder.js'
import { computeBaseAmounts, getCashierBaseCurrency, normalizeCashierCurrency, resolveCashierRate } from '../services/cashierQuery.js'
import type { ImportStats, ParsedTables, AcdRow } from './importAcdToCurrentAccountSet.js'

// ---- 取值辅助 ----
function s(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  return t.length ? t : null
}
function num(v: string | undefined): number {
  const n = parseFloat((v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
function int(v: string | undefined): number | null {
  const n = parseInt((v ?? '').replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}
/** ACD 日期：YYYY-MM-DD / YYYY.MM.DD / 空，统一为 YYYY-MM-DD */
function normDate(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  if (!t) return null
  const m = t.replace(/\./g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}
/**
 * rq 缺失/非法时，用 cn_mx 的 nf/yf/dd（年/月/日）拼日期。
 * 否则 biz_date 为 NULL 会触发 cashier_journal.biz_date NOT NULL，整批导入回滚。
 */
function dateFromYmd(nf: string | undefined, yf: string | undefined, dd: string | undefined): string | null {
  const y = Number.parseInt((nf ?? '').trim(), 10)
  const m = Number.parseInt((yf ?? '').trim(), 10)
  const d = Number.parseInt((dd ?? '').trim(), 10)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
/**
 * ACD 标志位：空 或 '0' 视为未置位，其余视为已置位。
 * 不能直接用字符串真值判断，否则 '0' 会被误判为 true。
 */
function isFlagSet(v: string | undefined): boolean {
  const t = (v ?? '').trim()
  return t !== '' && t !== '0'
}
/**
 * zc_gdzc 使用年限：synx（下标 11）是「使用年限（年）」，synx_y（下标 34）是「使用月数」。
 * 以 ACD 自带月折旧额 yzje =（原值 − 残值）/ synx_y 验证。此前两列写反，use_months 落成年数，
 * 折旧预览条件 depr_months_done < use_months 恒假，整账套资产静默不计提（评审 P0-1）。
 * synx_y 缺失时按 synx × 12 兜底。
 */
export function acdAssetLife(synx: string | undefined, synxY: string | undefined): { useMonths: number | null; useYears: number | null } {
  const years = int(synx)
  const months = int(synxY)
  const useMonths = months && months > 0 ? months : years && years > 0 ? years * 12 : null
  return { useMonths, useYears: years }
}
/**
 * zc_gdzc 净值 zcjz（下标 23）：ACD 常留空，num('') = 0 会让折旧基数（净值 − 残值）归零（评审 P0-2）。
 * 为空时按「原值 − 累计折旧」补算（ACD 卡片无减值列），并由调用方记 warning。
 */
export function acdAssetNetValue(zcjz: string | undefined, originalValue: number, accumDepr: number): { value: number; fallback: boolean } {
  if ((zcjz ?? '').trim() !== '') return { value: num(zcjz), fallback: false }
  return { value: Math.round((originalValue - accumDepr) * 100) / 100, fallback: true }
}
/** 整行原始数据保存为 JSON，保证可逆还原 */
function rawJson(row: AcdRow): string {
  return JSON.stringify(row)
}

// ============ 出纳模块 ============
export function importCashierTables(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun = false
): void {
  const db = getDb()

  // 结算方式字典（jslb: code, name）
  if (tables.settleTypes.length) {
    const ins = db.prepare(
      `INSERT INTO settle_type (id, account_set_id, code, name)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_set_id, code) DO UPDATE SET name = excluded.name`
    )
    for (const row of tables.settleTypes) {
      const code = s(row[0])
      if (!code) continue
      if (!dryRun) ins.run(uuidv4(), accountSetId, code, s(row[1]))
      stats.cashier.settleTypes++
    }
    stats.importedTables.push('jslb.txt')
  }

  // 出纳期初（cn_nc: kmbm, bz, ye）
  if (tables.cashierInitBalances.length) {
    const ins = db.prepare(
      `INSERT INTO cashier_init_balance (id, account_set_id, account_code, currency, balance)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_set_id, account_code, currency) DO UPDATE SET balance = excluded.balance, updated_at = datetime('now')`
    )
    for (const row of tables.cashierInitBalances) {
      const km = s(row[0])
      if (!km) continue
      if (!dryRun) ins.run(uuidv4(), accountSetId, km, s(row[1]) || 'RMB', num(row[2]))
      stats.cashier.initBalances++
    }
    stats.importedTables.push('cn_nc.txt')
  }

  // 出纳日记账（cn_mx，26 列，下标见计划 §1.1）
  if (tables.cashierJournal.length) {
    const ins = db.prepare(
      `INSERT INTO cashier_journal
        (id, account_set_id, account_code, currency, biz_date, seq, summary,
         debit, credit, counter_account, counter_unit, bank_name, bank_account,
         unit_code, reconciled, voucher_year, voucher_month, voucher_type, voucher_no, acd_raw, created_by,
         exchange_rate, base_debit, base_credit)
       VALUES (@id,@asid,@km,@bz,@rq,@xh,@zy,@jf,@df,@dfkm,@dw,@khyh,@yhzh,@dwbm,@gzm,@pnf,@pyf,@plx,@pbh,@raw,@lrr,
         @rate,@bjf,@bdf)`
    )
    // 评审 P1-10：外币三列（迁移 144）此前未写，base_* 落默认 0，本位币合计 / 调节表恒为 0。
    // 本位币行汇率 1；外币行 cn_mx 无汇率列，按业务日走出纳默认汇率链（resolveCashierRate，取不到回退 1）
    const baseCurrency = getCashierBaseCurrency(db, accountSetId)
    // 幂等：按「科目+日期+序号+借贷+摘要」去重，重复导入同一账套不产生重复行
    const existingJournalKeys = new Set<string>(
      (db.prepare('SELECT account_code, biz_date, seq, debit, credit, summary FROM cashier_journal WHERE account_set_id=?').all(accountSetId) as any[])
        .map(r => `${r.account_code}|${r.biz_date}|${r.seq}|${r.debit}|${r.credit}|${r.summary ?? ''}`)
    )
    let skippedNoDate = 0
    let skippedDup = 0
    for (const row of tables.cashierJournal) {
      const km = s(row[0])
      if (!km) continue
      // biz_date NOT NULL：rq 非法时用 nf/yf/dd 兜底，仍无则跳过，避免整批导入回滚
      const bizDate = normDate(row[2]) ?? dateFromYmd(row[4], row[5], row[6])
      if (!bizDate) { skippedNoDate++; continue }
      const dedupKey = `${km}|${bizDate}|${int(row[3]) ?? 0}|${num(row[8])}|${num(row[9])}|${s(row[7]) ?? ''}`
      if (existingJournalKeys.has(dedupKey)) { skippedDup++; continue }
      existingJournalKeys.add(dedupKey)
      const currency = normalizeCashierCurrency(s(row[1]), baseCurrency)
      const rate = resolveCashierRate(db, accountSetId, currency, bizDate)
      const baseAmt = computeBaseAmounts(num(row[8]), num(row[9]), rate)
      if (!dryRun)
        ins.run({
          id: uuidv4(),
          asid: accountSetId,
          km,
          bz: currency,
          rate,
          bjf: baseAmt.base_debit,
          bdf: baseAmt.base_credit,
          rq: bizDate,
          xh: int(row[3]) ?? 0,
          zy: s(row[7]),
          jf: num(row[8]),
          df: num(row[9]),
          // 评审 P1-10：ACD gzm 是旧「银行对账单勾对」标志；reconciled 自 FIX-262 起表示「已与总账分录匹配」（随 cashier_gl_match 批次维护），
          // 语义不同不能照搬，否则无批次的行被当成已对上、差异清单失真。原值仍保留在 acd_raw[12]
          gzm: 0,
          lrr: s(row[13]),
          dfkm: s(row[15]),
          dw: s(row[17]), // g_qymc 对方单位
          khyh: s(row[18]),
          yhzh: s(row[19]),
          dwbm: s(row[20]),
          pnf: int(row[22]),
          pyf: int(row[23]),
          plx: int(row[24]),
          pbh: int(row[25]),
          raw: rawJson(row),
        })
      stats.cashier.journal++
    }
    if (skippedNoDate > 0) {
      stats.warnings.push(`出纳日记账有 ${skippedNoDate} 行日期缺失或非法，已跳过`)
    }
    if (skippedDup > 0) {
      stats.warnings.push(`出纳日记账有 ${skippedDup} 行与库中重复，已跳过`)
    }
    stats.importedTables.push('cn_mx.txt')
  }

  // 银行对账单（yhdzd，11 列：dzd_xh,rq,kmbm,jf,df,jslb,pz_ph,dzbz,dzbh,pz_dzd_bz,csh_bz）
  if (tables.bankStatements.length) {
    const ins = db.prepare(
      `INSERT INTO bank_statement
        (id, account_set_id, account_code, biz_date, debit, credit, settle_type, bill_no, matched, match_batch, source, acd_raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    // 幂等：按「科目+日期+借贷+票据号」去重，重复导入不产生重复对账单
    const existingStatementKeys = new Set<string>(
      (db.prepare('SELECT account_code, biz_date, debit, credit, bill_no FROM bank_statement WHERE account_set_id=?').all(accountSetId) as any[])
        .map(r => `${r.account_code}|${r.biz_date}|${r.debit}|${r.credit}|${r.bill_no ?? ''}`)
    )
    let skippedDupStmt = 0
    for (const row of tables.bankStatements) {
      const km = s(row[2])
      if (!km) continue
      const bizDate = normDate(row[1])
      const dedupKey = `${km}|${bizDate}|${num(row[3])}|${num(row[4])}|${s(row[6]) ?? ''}`
      if (existingStatementKeys.has(dedupKey)) { skippedDupStmt++; continue }
      existingStatementKeys.add(dedupKey)
      if (!dryRun)
        ins.run(
          uuidv4(),
          accountSetId,
          km,
          bizDate,
          num(row[3]),
          num(row[4]),
          s(row[5]),
          s(row[6]),
          isFlagSet(row[7]) ? 1 : 0,
          int(row[8]),
          'import',
          rawJson(row)
        )
      stats.cashier.bankStatements++
    }
    if (skippedDupStmt > 0) {
      stats.warnings.push(`银行对账单有 ${skippedDupStmt} 行与库中重复，已跳过`)
    }
    stats.importedTables.push('yhdzd.txt')
  }
}

// ============ 固定资产模块 ============
export function importFixedAssetTables(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun = false
): void {
  const db = getDb()

  // 字典：类别 zc_sblb(sblb,mc,czl,kmbm)
  if (tables.fixedAssetCategories.length) {
    const ins = db.prepare(
      `INSERT INTO fixed_asset_category (id, account_set_id, code, name, salvage_rate, account_code)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(account_set_id, code) DO UPDATE SET name=excluded.name, salvage_rate=excluded.salvage_rate, account_code=excluded.account_code`
    )
    for (const row of tables.fixedAssetCategories) {
      const code = s(row[0])
      if (!code) continue
      if (!dryRun) ins.run(uuidv4(), accountSetId, code, s(row[1]), normalizeSalvageRate(num(row[2])) ?? 0, s(row[3]))
      stats.fixedAsset.categories++
    }
    stats.importedTables.push('zc_sblb.txt')
  }

  // 字典：状态 zc_sbzt(sbzt,sbzt_mc,zjjt)
  if (tables.fixedAssetStatuses.length) {
    const ins = db.prepare(
      `INSERT INTO fixed_asset_status (id, account_set_id, code, name, depreciable)
       VALUES (?,?,?,?,?)
       ON CONFLICT(account_set_id, code) DO UPDATE SET name=excluded.name, depreciable=excluded.depreciable`
    )
    for (const row of tables.fixedAssetStatuses) {
      const code = s(row[0])
      if (!code) continue
      if (!dryRun) ins.run(uuidv4(), accountSetId, code, s(row[1]), s(row[2]) === '1' ? 1 : 0)
      stats.fixedAsset.statuses++
    }
    // 评审 P2：处置 / 盘亏统一置 04，ACD 字典通常没有这一项，补「04 已处置」（不计提），已有则不动
    if (!dryRun)
      db.prepare(
        "INSERT INTO fixed_asset_status (id, account_set_id, code, name, depreciable) VALUES (?, ?, '04', '已处置', 0) ON CONFLICT(account_set_id, code) DO NOTHING"
      ).run(uuidv4(), accountSetId)
    stats.importedTables.push('zc_sbzt.txt')
  }

  // 字典：用途 zc_sbyt(ytbh,yt_mc,kmbm)
  if (tables.fixedAssetPurposes.length) {
    const ins = db.prepare(
      `INSERT INTO fixed_asset_purpose (id, account_set_id, code, name, expense_account)
       VALUES (?,?,?,?,?)
       ON CONFLICT(account_set_id, code) DO UPDATE SET name=excluded.name, expense_account=excluded.expense_account`
    )
    for (const row of tables.fixedAssetPurposes) {
      const code = s(row[0])
      if (!code) continue
      if (!dryRun) ins.run(uuidv4(), accountSetId, code, s(row[1]), s(row[2]))
      stats.fixedAsset.purposes++
    }
    stats.importedTables.push('zc_sbyt.txt')
  }

  // 字典：部门 zc_sydw(sydw,dw_mc)
  if (tables.fixedAssetDepts.length) {
    const ins = db.prepare(
      `INSERT INTO fixed_asset_dept (id, account_set_id, code, name)
       VALUES (?,?,?,?)
       ON CONFLICT(account_set_id, code) DO UPDATE SET name=excluded.name`
    )
    for (const row of tables.fixedAssetDepts) {
      const code = s(row[0])
      if (!code) continue
      if (!dryRun) ins.run(uuidv4(), accountSetId, code, s(row[1]))
      stats.fixedAsset.depts++
    }
    stats.importedTables.push('zc_sydw.txt')
  }

  // 卡片主表 zc_gdzc（50 列，下标见计划 §2.2）
  if (tables.fixedAssets.length) {
    const ins = db.prepare(
      `INSERT INTO fixed_asset
        (id, account_set_id, asset_no, asset_name, category_code, status_code, dept_code, purpose_code,
         acquire_date, start_depr_date, original_value, salvage_rate, salvage_value, depr_method,
         use_months, use_years, total_workload, depr_months_done, workload_done, accum_depr, net_value,
         card_no, qty, unit, user_name, keeper, source, install_place, is_foreign, foreign_value,
         scrap_reason, scrap_date, remark, acd_raw)
       VALUES (@id,@asid,@bh,@mc,@sblb,@sbzt,@sydw,@ytbh,@gzrq,@syrq,@yz,@czl,@yzcz,@zjff,
         @synx,@synxy,@zgzl,@ljzjy,@ljgzl,@ljzje,@zcjz,@bjbh,@sl,@dw,@syr,@bgr,@ly,@azdd,@wbbz,@wbje,
         @zxyy,@zxrq,@bz,@raw)
       ON CONFLICT(account_set_id, asset_no) DO UPDATE SET
         asset_name=excluded.asset_name, category_code=excluded.category_code, status_code=excluded.status_code,
         original_value=excluded.original_value, accum_depr=excluded.accum_depr, net_value=excluded.net_value,
         use_months=excluded.use_months, use_years=excluded.use_years,
         acd_raw=excluded.acd_raw, updated_at=datetime('now')`
    )
    let netFallback = 0
    for (const row of tables.fixedAssets) {
      const bh = s(row[0])
      if (!bh) continue
      const life = acdAssetLife(row[11], row[34])
      const net = acdAssetNetValue(row[23], num(row[6]), num(row[19]))
      if (net.fallback) netFallback++
      if (!dryRun)
        ins.run({
          id: uuidv4(),
          asid: accountSetId,
          bh,
          mc: s(row[1]),
          sblb: s(row[2]),
          sbzt: s(row[3]),
          sydw: s(row[4]),
          gzrq: normDate(row[5]),
          yz: num(row[6]),
          // P0-3：ACD 残值率可能为百分数口径，统一归一为 0~1 小数
          czl: normalizeSalvageRate(num(row[7])) ?? 0,
          yzcz: num(row[8]),
          syrq: normDate(row[9]),
          zjff: s(row[10]),
          synx: life.useMonths,
          zgzl: num(row[12]),
          bz: s(row[13]),
          ytbh: s(row[14]),
          ljzjy: int(row[17]) ?? 0,
          ljgzl: num(row[18]),
          ljzje: num(row[19]),
          zxyy: s(row[21]),
          zxrq: normDate(row[22]),
          zcjz: net.value,
          bjbh: s(row[25]),
          wbbz: s(row[26]) ? 1 : 0,
          wbje: num(row[27]),
          azdd: s(row[29]),
          dw: s(row[31]),
          sl: int(row[32]) ?? 1,
          synxy: life.useYears,
          syr: s(row[35]),
          bgr: s(row[36]),
          ly: s(row[40]),
          raw: rawJson(row),
        })
      stats.fixedAsset.assets++
    }
    if (netFallback)
      stats.warnings.push(`固定资产卡片有 ${netFallback} 张净值列为空，已按「原值 − 累计折旧」补算`)
    stats.importedTables.push('zc_gdzc.txt')
  }

  // 月折旧 zc_yzjb(nf,yf,bh,sydw,ytbh,zjff,yzjl,ygzl,yzje,ckbh,ljzje)
  if (tables.fixedAssetDepr.length) {
    const ins = db.prepare(
      `INSERT INTO fixed_asset_depr
        (id, account_set_id, asset_no, year, month, dept_code, purpose_code, depr_method, month_depr, accum_depr)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(account_set_id, asset_no, year, month) DO UPDATE SET
         month_depr=excluded.month_depr, accum_depr=excluded.accum_depr`
    )
    for (const row of tables.fixedAssetDepr) {
      const bh = s(row[2])
      const yr = int(row[0])
      const mo = int(row[1])
      if (!bh || yr == null || mo == null) continue
      if (!dryRun)
        ins.run(
          uuidv4(),
          accountSetId,
          bh,
          yr,
          mo,
          s(row[3]),
          s(row[4]),
          s(row[5]),
          num(row[8]),
          num(row[10])
        )
      stats.fixedAsset.depr++
    }
    stats.importedTables.push('zc_yzjb.txt')
  }

  // 变动流水：合并 zc_yzzj(原值增减) + zc_sbbd(变动)
  const insChange = db.prepare(
    `INSERT INTO fixed_asset_change
      (id, account_set_id, asset_no, change_date, change_item, old_value, new_value, amount, remark, operator)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  // zc_yzzj(xh,bh,ckbh,rq,yz,yzzje,sm,nf,yf,s1)
  for (const row of tables.fixedAssetOrigChanges) {
    const bh = s(row[1])
    if (!bh) continue
    if (!dryRun)
      insChange.run(
        uuidv4(),
        accountSetId,
        bh,
        normDate(row[3]),
        '原值增减',
        null,
        num(row[4]),
        num(row[5]),
        s(row[6]),
        null
      )
    stats.fixedAsset.changes++
  }
  // zc_sbbd(bh,bdxm,oldvalue,newvalue,rq,czr)
  for (const row of tables.fixedAssetMods) {
    const bh = s(row[0])
    if (!bh) continue
    if (!dryRun)
      insChange.run(
        uuidv4(),
        accountSetId,
        bh,
        normDate(row[4]),
        s(row[1]) || '变动',
        num(row[2]),
        num(row[3]),
        null,
        null,
        s(row[5])
      )
    stats.fixedAsset.changes++
  }
  if (tables.fixedAssetOrigChanges.length) stats.importedTables.push('zc_yzzj.txt')
  if (tables.fixedAssetMods.length) stats.importedTables.push('zc_sbbd.txt')
}
