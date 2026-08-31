/**
 * ACD 出纳 / 固定资产模块数据导入
 *
 * 从 parseAcdTables 解析出的原始行（ParsedTables）导入到 M1 建立的表。
 * 列顺序严格锚定 data_stru.txt（见 docs/2026-06-01-固定资产与出纳模块开发计划.md §1）。
 * 空字段也占位，禁止按列 filter，按固定下标取值。
 */
import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
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
         unit_code, reconciled, voucher_year, voucher_month, voucher_type, voucher_no, acd_raw, created_by)
       VALUES (@id,@asid,@km,@bz,@rq,@xh,@zy,@jf,@df,@dfkm,@dw,@khyh,@yhzh,@dwbm,@gzm,@pnf,@pyf,@plx,@pbh,@raw,@lrr)`
    )
    for (const row of tables.cashierJournal) {
      const km = s(row[0])
      if (!km) continue
      if (!dryRun)
        ins.run({
          id: uuidv4(),
          asid: accountSetId,
          km,
          bz: s(row[1]) || 'RMB',
          rq: normDate(row[2]),
          xh: int(row[3]) ?? 0,
          zy: s(row[7]),
          jf: num(row[8]),
          df: num(row[9]),
          gzm: s(row[12]) ? 1 : 0,
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
    stats.importedTables.push('cn_mx.txt')
  }

  // 银行对账单（yhdzd，11 列：dzd_xh,rq,kmbm,jf,df,jslb,pz_ph,dzbz,dzbh,pz_dzd_bz,csh_bz）
  if (tables.bankStatements.length) {
    const ins = db.prepare(
      `INSERT INTO bank_statement
        (id, account_set_id, account_code, biz_date, debit, credit, settle_type, bill_no, matched, match_batch, source, acd_raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    for (const row of tables.bankStatements) {
      const km = s(row[2])
      if (!km) continue
      if (!dryRun)
        ins.run(
          uuidv4(),
          accountSetId,
          km,
          normDate(row[1]),
          num(row[3]),
          num(row[4]),
          s(row[5]),
          s(row[6]),
          s(row[7]) ? 1 : 0,
          int(row[8]),
          'import',
          rawJson(row)
        )
      stats.cashier.bankStatements++
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
      if (!dryRun) ins.run(uuidv4(), accountSetId, code, s(row[1]), num(row[2]), s(row[3]))
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
         acd_raw=excluded.acd_raw, updated_at=datetime('now')`
    )
    for (const row of tables.fixedAssets) {
      const bh = s(row[0])
      if (!bh) continue
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
          czl: num(row[7]),
          yzcz: num(row[8]),
          syrq: normDate(row[9]),
          zjff: s(row[10]),
          synx: int(row[11]),
          zgzl: num(row[12]),
          bz: s(row[13]),
          ytbh: s(row[14]),
          ljzjy: int(row[17]) ?? 0,
          ljgzl: num(row[18]),
          ljzje: num(row[19]),
          zxyy: s(row[21]),
          zxrq: normDate(row[22]),
          zcjz: num(row[23]),
          bjbh: s(row[25]),
          wbbz: s(row[26]) ? 1 : 0,
          wbje: num(row[27]),
          azdd: s(row[29]),
          dw: s(row[31]),
          sl: int(row[32]) ?? 1,
          synxy: int(row[34]),
          syr: s(row[35]),
          bgr: s(row[36]),
          ly: s(row[40]),
          raw: rawJson(row),
        })
      stats.fixedAsset.assets++
    }
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
