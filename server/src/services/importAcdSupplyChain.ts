import type Database from 'better-sqlite3'
import zlib from 'zlib'
import iconv from 'iconv-lite'
import { splitAcdLine } from '../utils/acdSplitLine.js'
import { v4 as uuidv4 } from 'uuid'
import { partnerTypeFromAcd } from './scmAcdImport/types.js'

/**
 * 供应链 ACD 导入：从润衡 .acd 备份读取 cpda(物料)/khda(往来)/ckda(仓库) 等，
 * 映射写入 scm_item / scm_partner / scm_warehouse（按账套隔离，存 acd_raw 兜底）。
 *
 * 自带精简 ACD 解析（镜像 rh备份读取工具/acd_reader.py），与现有 importAcdToAccountSet 解耦。
 */

export interface ScmImportResult {
  items: number
  partners: number
  warehouses: number
}

/** 解析 .acd buffer → { 短文件名(小写): 行[列[]] }（GBK 解码、TSV 切分） */
export function parseAcdEntries(buffer: Buffer): Map<string, string[][]> {
  const result = new Map<string, string[][]>()
  let pos = 0
  while (pos < buffer.length) {
    // 文件名：从 pos 起读到 0x00（32 字节字段内）
    let nameEnd = pos
    while (nameEnd < pos + 32 && nameEnd < buffer.length && buffer[nameEnd] !== 0x00) nameEnd++
    const nameBytes = buffer.subarray(pos, nameEnd)
    if (nameBytes.length < 3) break
    const filename = iconv.decode(nameBytes, 'gbk')

    const nullPos = buffer.indexOf(0x00, pos)
    if (nullPos < 0) break
    let fieldEnd = nullPos + 1
    while (fieldEnd < buffer.length && buffer[fieldEnd] === 0x20) fieldEnd++
    if (fieldEnd + 12 > buffer.length) break

    const comp = buffer.readUInt32LE(fieldEnd + 8)
    const zstart = fieldEnd + 12
    if (zstart + comp > buffer.length) break
    const zdata = buffer.subarray(zstart, zstart + comp)

    let decompressed: Buffer
    try {
      decompressed = zlib.inflateSync(zdata)
    } catch {
      break
    }
    const text = iconv.decode(decompressed, 'gbk')
    const rows = text
      .split(/\r?\n/)
      .map(l => l.replace(/\r$/, ''))
      .filter(l => l.trim().length > 0)
      .map(splitAcdLine)

    const short = filename.replace(/^.*[\\/]/, '').toLowerCase()
    result.set(short, rows)
    pos = zstart + comp
  }
  return result
}

const num = (v: any) => {
  const n = parseFloat(String(v ?? '').trim())
  return Number.isFinite(n) ? n : 0
}
const str = (v: any) => String(v ?? '').trim() || null

/** 从已解析的 ACD 表导入供应链档案到指定账套 */
export function importSupplyChainTables(
  db: Database.Database,
  accountSetId: string,
  tables: Map<string, string[][]>
): ScmImportResult {
  const result: ScmImportResult = { items: 0, partners: 0, warehouses: 0 }

  const tx = db.transaction(() => {
    // ── 仓库 ckda: ckbh,ckmc,sx,khbh,txdz,lxdh,fax,lxr ──
    const ckda = tables.get('ckda.txt') || []
    const insWh = db.prepare(
      `INSERT OR IGNORE INTO scm_warehouse (id, account_set_id, code, name, attr, keeper)
       VALUES (?,?,?,?,?,?)`
    )
    for (const r of ckda) {
      if (!r[0]) continue
      insWh.run(uuidv4(), accountSetId, str(r[0]), str(r[1]), str(r[2]), str(r[7]))
      result.warehouses++
    }

    // ── 往来 khda: dwbh,dwmc,txdz,yzbm,lxdh,lxr,khyh,yhzh,nsh,dqbh,bz,sx,yskm,yfkm,xyed,fax,ywy,...,slv(20) ──
    const khda = tables.get('khda.txt') || []
    const insP = db.prepare(
      `INSERT OR IGNORE INTO scm_partner
        (id, account_set_id, code, name, partner_type, partner_attr, ar_account, ap_account,
         credit_limit, tax_rate, region_code, contact, phone, address, bank_name, bank_account,
         tax_no, salesman, acd_raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    for (const r of khda) {
      if (!r[0]) continue
      const sx = str(r[11]) || ''
      // 润衡 khda.sx：1 供应商、2 客户（以真实备份核对：sx=1 只挂应付科目、sx=2 只挂应收科目），其它为双向
      const partnerType = partnerTypeFromAcd(sx)
      insP.run(
        uuidv4(), accountSetId, str(r[0]), str(r[1]), partnerType, sx,
        str(r[12]), str(r[13]), num(r[14]), num(r[20]), str(r[9]),
        str(r[5]), str(r[4]), str(r[2]), str(r[6]), str(r[7]),
        str(r[8]), str(r[16]), JSON.stringify(r)
      )
      result.partners++
    }

    // ── 物料 cpda: cpbh,cpmc,gg,txm,jm,jldw,...,rkdj(8),xsdj(9),ckdj(10),...,dlm(16),xlm(17),sx(19),...,kmbm(23),kmbm_xs(24),ph_bz(25),khbh(26) ──
    const cpda = tables.get('cpda.txt') || []
    const insI = db.prepare(
      `INSERT OR IGNORE INTO scm_item
        (id, account_set_id, code, name, spec, barcode, short_code, unit,
         category_code, subcategory_code, item_type, purchase_price, sale_price, ref_cost,
         inv_account, sale_account, batch_flag, supplier_code, acd_raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    for (const r of cpda) {
      if (!r[0]) continue
      insI.run(
        uuidv4(), accountSetId, str(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]), str(r[5]),
        str(r[16]), str(r[17]), str(r[19]), num(r[8]), num(r[9]), num(r[10]),
        str(r[23]), str(r[24]), str(r[25]) === '1' ? 1 : 0, str(r[26]), JSON.stringify(r)
      )
      result.items++
    }
  })
  tx()
  // 从润衡带过来的档案是在用的历史数据，直接置为已审核（迁移 168 起新增档案默认未审核）
  for (const t of ['scm_item', 'scm_partner']) {
    try { db.prepare(`UPDATE ${t} SET audit_status='audited' WHERE account_set_id=? AND acd_raw IS NOT NULL AND audit_status<>'audited'`).run(accountSetId) } catch { /* 旧库无此列 */ }
  }
  return result
}

/** 直接从 .acd buffer 导入供应链档案到账套 */
export function importSupplyChainFromAcd(
  db: Database.Database,
  accountSetId: string,
  acdBuffer: Buffer
): ScmImportResult {
  const tables = parseAcdEntries(acdBuffer)
  return importSupplyChainTables(db, accountSetId, tables)
}
