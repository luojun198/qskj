/**
 * 进销存 ACD 独立导入：用合成的小型润衡 POS 备份跑通 预检 → 导入 → 核对 → 撤销。
 * 临时新库（与服务启动同一套 initDatabase + 兼容升级 + 默认账套），不碰开发库。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { rmSync } from 'fs'
import zlib from 'zlib'
import iconv from 'iconv-lite'

const { TEMP_DB_PATH } = await vi.hoisted(async () => {
  const path = await import('path')
  const os = await import('os')
  const p = path.join(os.tmpdir(), `cw-scm-acd-import-${process.pid}-${Date.now()}.db`)
  process.env.DB_PATH = p
  process.env.SCHEMA_DIR = process.env.SCHEMA_DIR || 'src/db'
  return { TEMP_DB_PATH: p }
})

import { closeAndResetDb, getDb, initDatabase } from '../db/index.js'
import { upgradeDatabaseCompatibility } from '../db/databaseCompatibility.js'
import { initDefaultAccountSet } from '../scripts/seedAccounts.js'
import { seedDocTypes } from '../routes/scmDoc.js'
import { parseAcdDate, parseCreateTable } from '../services/scmAcdImport/acdTables.js'
import { splitTax } from '../services/scmAcdImport/documents.js'
import { partnerTypeFromAcd } from '../services/scmAcdImport/master.js'
import {
  executeScmAcdImport, previewScmAcd, revertBlocker, revertScmAcdImport,
} from '../services/scmAcdImport/index.js'

// ── 合成 .acd：rhsj\<表>.txt\0 + 空格补齐 32 字节 + 12 字节头（第 3 个 uint32 = 压缩长度）+ zlib(GBK TSV) ──
const STRU: Record<string, string> = {
  xt: '"mc" char(11),"nr" varchar(40)',
  ckda: '"ckbh" char(10),"ckmc" char(20),"sx" char(1),"khbh" char(20),"txdz" varchar(255),"lxdh" varchar(255),"fax" varchar(255),"lxr" char(10)',
  cpsx: '"sx" char(1) not null ,"sx_mc" char(10),primary key (sx)',
  cpda: '"cpbh" char(20),"cpmc" char(50),"gg" char(100),"jldw" char(4),"rkdj" double,"xsdj" double,"sx" char(1),"kmbm" char(20),"kmbm_xs" char(20),"ph_bz" char(1),"ty_bz" char(1)',
  khda: '"dwbh" char(20),"dwmc" char(50),"sx" char(1),"yskm" char(20),"yfkm" char(20),"slv" double,"ts" integer',
  dj_lx: '"pjlb" char(2),"lb_jc" char(10)',
  pjnr1: '"pjlb" char(2),"pjdh" char(20),rq date,"htbh" char(20),"khbh" char(20),"ckbh" char(10),"jbr" char(10),"kpr" char(10),"drck" char(10),"sm" varchar(255),slv double,"bz_zf" char(1)',
  pjnr2: '"pjlb" char(2),"pjdh" char(20),xh smallint,ny integer,"cpbh" char(20),sl double,dj double,dwcb double,"ckbh" char(10),"htbh" char(20),je double,dj_hs double,"ph" char(20),jc_int smallint,"htlb" char(1),"sm" char(100)',
  ht1: '"htlb" char(1),"htbh" char(20),"ckbh" char(10),rq date,"khbh" char(20),slv double,"qxbz" char(1),rq1 date',
  ht2: '"htlb" char(1),"htbh" char(20),"cpbh" char(20),sl0 double,dj double,je double,dj_n double,xh integer',
  wldj: '"lx" char(6),"dh" char(10),rq date,"khbh" char(20),jf double,df double,"pjlb" char(2),"pjdh" char(20),"zy" char(20),xh integer,fpjf double,fpdf double',
  wldj_lx: '"lx" char(6) not null ,"kmbm" char(20),"sm" char(100),"bz" char(10),primary key (lx)',
  wl_dzd: '"lx" char(2),"dzdbh" char(10),"khbh" char(20),dzrq date,je0 double,"sm1" varchar(200),"lrr" char(10)',
  pdk: '"pddh" char(10),rq date,"ckbh" char(10),"cpbh" char(20),zmsl double,sjsl double,"ph" char(20),xh integer',
  kcb: '"ckbh" char(10),"cpbh" char(20),dqkc double,je double',
}

const DATA: Record<string, string[][]> = {
  xt: [['xt_dwmc', '测试电子科技有限公司']],
  ckda: [['10', '材料仓', '0'], ['20', '车间仓', '1'], ['50', '成品仓', '0']],
  cpsx: [['1', '原材料'], ['5', '成品'], ['4', '低值易耗品']],
  cpda: [
    ['M1', '铝箔', '0.1mm', '公斤', '3', '0', '1', '', '', '0', '0'],
    ['P1', '电容', '10uF', '支', '0', '10', '5', '', '', '0', '0'],
  ],
  khda: [['G1', '供应商甲', '1', '', '2202', '13', '30'], ['K1', '客户乙', '2', '1122', '', '13', '0'], ['999999', '内部', '0', '', '', '0', '0']],
  dj_lx: [['1', '期初入库'], ['2', '采购入库'], ['3', '成品入库'], ['A', '销售出库'], ['E', '调拨'], ['X', '未知类型']],
  pjnr1: [
    ['1', '2605310001', '26.5.31', '', '', '10', '', '刘总', '', '期初', '0', ''],
    ['2', '2606010001', '26.6.1', '', 'G1', '10', '采购员', '刘总', '', '', '13', ''],
    ['3', '2606020001', '26.6.2', '', '999999', '50', '', '刘总', '', '', '0', ''],
    ['A', '2606030001', '26.6.3', '', 'K1', '50', '业务员', '刘总', '', '', '13', ''],
    ['A', '2606040001', '26.6.4', '', 'K1', '50', '业务员', '刘总', '2606270001', '现款', '13', ''],
    ['E', '2606050001', '26.6.5', '', '', '10', '', '刘总', '20', '调车间', '0', ''],
    ['X', '2606060001', '26.6.6', '', '', '10', '', '', '', '', '0', ''],
  ],
  pjnr2: [
    ['1', '2605310001', '1', '20260531', 'M1', '100', '2', '2', '10', '', '200', '2', '', '1', '1', ''],
    ['2', '2606010001', '1', '20260601', 'M1', '50', '3', '3', '10', 'PO001', '169.5', '3.39', '', '1', '1', ''],
    ['3', '2606020001', '1', '20260602', 'P1', '10', '5', '5', '50', '', '50', '5', '', '1', '1', ''],
    ['A', '2606030001', '1', '20260603', 'P1', '4', '8.849557522', '4.5', '50', 'SO001', '40', '10', '', '-1', '2', '发货'],
    ['A', '2606040001', '1', '20260604', 'P1', '1', '8.849557522', '4.5', '50', '', '10', '10', '', '-1', '2', ''],
    ['E', '2606050001', '1', '20260605', 'M1', '30', '', '', '10', '', '', '', '', '-1', '2', ''],
    ['E', '2606050001', '2', '20260605', 'M1', '30', '', '', '20', '', '', '', '', '1', '2', ''],
    ['PK', '2606300001', '1', '20260630', 'M1', '2', '0', '2.5', '10', '', '', '0', '', '-1', '', ''],
  ],
  ht1: [['1', 'PO001', '10', '26.5.30', 'G1', '13', '0', '26.6.5'], ['2', 'SO001', '50', '26.6.1', 'K1', '13', '0', '26.6.3']],
  ht2: [['1', 'PO001', 'M1', '50', '3.39', '169.5', '3', '1'], ['2', 'SO001', 'P1', '5', '10', '50', '8.849557522', '1']],
  wldj: [
    ['', '', '26.6.1', 'G1', '0', '169.5', '2', '2606010001', '', '1', '0', '0'],
    ['', '', '26.6.3', 'K1', '40', '0', 'A', '2606030001', '', '2', '0', '0'],
    ['', '', '26.6.4', 'K1', '0', '0', 'A', '2606040001', '', '3', '0', '0'],
    // 付款 100（部分付清采购入库）、收款 40（收清销售出库）、付一张润衡已删除的单据 30
    ['2', 'FK001', '26.6.10', 'G1', '100', '0', '2', '2606010001', '', '4', '0', '0'],
    ['2', 'FK001', '26.6.10', 'G1', '30', '0', '2', '2605010009', '', '5', '0', '0'],
    ['1', 'SK001', '26.6.12', 'K1', '0', '40', 'A', '2606030001', '', '6', '0', '0'],
    // 销售发票开一半；采购发票全额
    ['增值税', '00001', '26.6.15', 'K1', '0', '0', 'A', '2606030001', '12345678901234567890', '7', '0', '20'],
    ['增值税', '00002', '26.6.16', 'G1', '0', '0', '2', '2606010001', '', '8', '169.5', '0'],
  ],
  wldj_lx: [['1', '1001', '现金', ''], ['2', '1002', '银行', '']],
  wl_dzd: [['xs', 'D001', 'K1', '26.6.30', '40', '对上了', '刘总'], ['cg', 'D001', 'G1', '26.6.30', '169.5', '', '刘总']],
  pdk: [['2606300001', '26.6.30', '10', 'M1', '120', '118', '', '1']],
  kcb: [['10', 'M1', '118', '0'], ['20', 'M1', '30', '0'], ['50', 'P1', '5', '22.5']],
}

function buildAcd(): Buffer {
  const parts: Buffer[] = []
  const add = (name: string, text: string) => {
    const nameBuf = iconv.encode(`rhsj\\${name}`, 'gbk')
    const field = Buffer.alloc(32, 0x20)
    nameBuf.copy(field)
    field[nameBuf.length] = 0x00
    const raw = iconv.encode(text, 'gbk')
    const z = zlib.deflateSync(raw)
    const head = Buffer.alloc(12)
    head.writeUInt32LE(1, 0); head.writeUInt32LE(raw.length, 4); head.writeUInt32LE(z.length, 8)
    parts.push(field, head, z)
  }
  add('data_stru.txt', Object.entries(STRU).map(([t, cols]) => `Create table ${t} (${cols})`).join('\r\n'))
  for (const [t, rows] of Object.entries(DATA)) add(`${t}.txt`, rows.map(r => r.join('\t')).join('\r\n'))
  add('pz.txt', '')
  return Buffer.concat(parts)
}

let db: Database.Database
let A = ''
const acd = buildAcd()

beforeAll(() => {
  initDatabase()
  upgradeDatabaseCompatibility()
  initDefaultAccountSet('企业会计准则账套')
  db = getDb()
  A = (db.prepare('SELECT id FROM account_sets LIMIT 1').get() as { id: string }).id
  seedDocTypes(db as any, A)
})

afterAll(() => {
  closeAndResetDb()
  for (const s of ['', '-wal', '-shm']) rmSync(`${TEMP_DB_PATH}${s}`, { force: true })
})

describe('进销存 ACD 解析工具', () => {
  it('润衡日期 yy.m.d / yyyymmdd 转 ISO', () => {
    expect(parseAcdDate('26.10.5')).toBe('2026-10-05')
    expect(parseAcdDate('2026.5.31')).toBe('2026-05-31')
    expect(parseAcdDate('20260531')).toBe('2026-05-31')
    expect(parseAcdDate('')).toBeNull()
    expect(parseAcdDate('26.13.1')).toBeNull()
  })

  it('从 data_stru 建表语句取列名，忽略主键子句', () => {
    expect(parseCreateTable('Create table cpsx ("sx" char(1) not null ,"sx_mc" char(10),primary key (sx) )'))
      .toEqual({ table: 'cpsx', columns: ['sx', 'sx_mc'] })
  })

  it('往来属性：1 供应商、2 客户、其它客户兼供应商', () => {
    expect(partnerTypeFromAcd('1')).toBe('supplier')
    expect(partnerTypeFromAcd('2')).toBe('customer')
    expect(partnerTypeFromAcd('0')).toBe('both')
  })

  it('含税金额拆分：行金额 = 数量 × 不含税单价，税额 = 含税 − 行金额', () => {
    expect(splitTax(50, 3, 169.5, 13)).toEqual({ amount: 150, tax: 19.5 })
    expect(splitTax(10, 5, 50, 0)).toEqual({ amount: 50, tax: 0 })
  })
})

describe('进销存 ACD 导入全流程', { timeout: 60000 }, () => {
  let batchId = ''

  it('预检：识别单据类型映射，未知类型给出提示，无阻断', () => {
    const p = previewScmAcd(db, A, acd, 'test.acd')
    expect(p.blockers).toEqual([])
    expect(p.meta.company).toBe('测试电子科技有限公司')
    expect(p.dateRange).toEqual({ from: '2026-05-31', to: '2026-06-06' })
    const map = Object.fromEntries(p.docTypes.map(d => [d.acd, d.target]))
    expect(map).toMatchObject({ 1: 'IS', 2: 'PI', 3: 'OI', A: 'SO', E: 'TR', X: null })
    expect(p.warnings.some(w => w.includes('未知类型'))).toBe(true)
    expect(p.countDocs).toBe(1)
  })

  it('导入：档案、订单、单据数量正确，全部已审核且标记原系统已制证', () => {
    const r = executeScmAcdImport(db, A, acd, { fileName: 'test.acd', operator: '测试员' })
    batchId = r.batchId
    expect(r.stats.master.items.inserted).toBe(2)
    expect(r.stats.master.partners.inserted).toBe(3)
    expect(r.stats.documents.orders).toEqual({ PO: 1, SOa: 1 })
    expect(r.stats.documents.docs).toEqual({ IS: 1, PI: 1, OI: 1, SO: 2, TR: 1, CK: 1 })
    expect(r.stats.documents.skipped).toEqual({ '单据类别 X': 1 })
    const docs = db.prepare('SELECT status, external_voucher, import_batch_id FROM scm_doc WHERE account_set_id=?').all(A) as any[]
    expect(docs).toHaveLength(13)   // 出入库 / 盘点 7 + 订单 2 + 收付款 2 + 发票 2
    expect(docs.every(d => d.status === 'audited' && d.external_voucher === 1 && d.import_batch_id === batchId)).toBe(true)
    const partner = (code: string) => (db.prepare('SELECT partner_type FROM scm_partner WHERE account_set_id=? AND code=?').get(A, code) as any).partner_type
    expect(partner('G1')).toBe('supplier')
    expect(partner('K1')).toBe('customer')
    const oi = db.prepare("SELECT io_category FROM scm_doc WHERE account_set_id=? AND doc_type='OI'").get(A) as any
    expect(oi.io_category).toBe('成品入库')
  })

  it('库存：数量与润衡一致；出库成本沿用润衡 dwcb，调拨按调出仓均价', () => {
    const s = (wh: string, item: string) => db.prepare('SELECT qty, amount FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?').get(A, wh, item) as any
    // M1：期初 100@2 + 采购 50@3 → 均价 2.3333；调车间 30；盘亏 2@2.5
    expect(s('10', 'M1').qty).toBe(118)
    expect(s('20', 'M1').qty).toBe(30)
    expect(s('20', 'M1').amount).toBeCloseTo(70, 2)            // 30 × 均价 2.3333
    // P1：成品入库 10@5，出库 5 件按润衡 dwcb 4.5 → 50 − 22.5 = 27.5
    expect(s('50', 'P1')).toMatchObject({ qty: 5, amount: 27.5 })
    const soCost = db.prepare("SELECT l.unit_cost FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id WHERE d.account_set_id=? AND d.doc_no='2606030001'").get(A) as any
    expect(soCost.unit_cost).toBe(4.5)
  })

  it('出入库单回填来源订单行；往来以润衡流水为准（现款单不挂账）', () => {
    const link = db.prepare(`SELECT o.doc_no FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
      JOIN scm_doc_line ol ON ol.id=l.source_line_id JOIN scm_doc o ON o.id=ol.doc_id
      WHERE d.account_set_id=? AND d.doc_no='2606010001'`).get(A) as any
    expect(link.doc_no).toBe('PO001')
    const arap = db.prepare("SELECT partner_code, doc_no, amount FROM scm_ar_ap_log WHERE account_set_id=? AND direction='in' ORDER BY doc_no").all(A) as any[]
    expect(arap).toEqual([
      { partner_code: 'G1', doc_no: '2606010001', amount: 169.5 },
      { partner_code: 'K1', doc_no: '2606030001', amount: 40 },
    ])
  })

  it('收付款：按单号合并、核销来源单据；源单不存在的按未核销挂账；不写出纳日记账', () => {
    const b = db.prepare('SELECT stats FROM scm_acd_import_batch WHERE id=?').get(batchId) as any
    const f = JSON.parse(b.stats).finance
    expect(f.payments).toMatchObject({ docs: 1, lines: 2, amount: 130, verified: 100, unverified: 30 })
    expect(f.receipts).toMatchObject({ docs: 1, lines: 1, amount: 40, verified: 40, unverified: 0 })
    const pay = db.prepare("SELECT settle_account, payment_type, external_voucher, status FROM scm_doc WHERE account_set_id=? AND doc_type='PAY'").get(A) as any
    expect(pay).toEqual({ settle_account: '1002', payment_type: 'transfer', external_voucher: 1, status: 'audited' })
    const open = (doc: string) => db.prepare("SELECT amount - verified_amount AS o FROM scm_ar_ap_log WHERE account_set_id=? AND doc_no=? AND direction='in'").get(A, doc) as any
    expect(open('2606010001').o).toBeCloseTo(69.5, 2)
    expect(open('2606030001').o).toBeCloseTo(0, 2)
    expect((db.prepare('SELECT COUNT(*) c FROM cashier_journal WHERE account_set_id=?').get(A) as any).c).toBe(0)
  })

  it('发票：按开票比例折算来源行，不调整往来；对账单导为已审核历史单据，编号冲突加后缀', () => {
    const rs = db.prepare("SELECT d.id, d.invoice_no, d.source_doc_id, d.total_amount + d.total_tax AS gross FROM scm_doc d WHERE d.account_set_id=? AND d.doc_type='RS'").get(A) as any
    expect(rs).toMatchObject({ invoice_no: '12345678901234567890', source_doc_id: null })
    expect(rs.gross).toBeCloseTo(20, 2)
    const line = db.prepare(`SELECT l.qty, sd.doc_no FROM scm_doc_line l JOIN scm_doc_line sl ON sl.id=l.source_line_id
      JOIN scm_doc sd ON sd.id=sl.doc_id WHERE l.doc_id=?`).get(rs.id) as any
    expect(line).toEqual({ qty: 2, doc_no: '2606030001' })
    const stmts = db.prepare('SELECT stmt_no, direction, net_amount, status FROM scm_statement WHERE account_set_id=? ORDER BY stmt_no').all(A) as any[]
    expect(stmts).toEqual([
      { stmt_no: 'D001', direction: 'ar', net_amount: 40, status: 'audited' },
      { stmt_no: 'D001-CG', direction: 'ap', net_amount: 169.5, status: 'audited' },
    ])
  })

  it('核对报告：库存数量全部一致，往来全部一致', () => {
    const b = db.prepare('SELECT report FROM scm_acd_import_batch WHERE id=?').get(batchId) as any
    const rep = JSON.parse(b.report)
    expect(rep.stock.qtyMatched).toBe(rep.stock.compared)
    expect(rep.arap.matched).toBe(rep.arap.partners)
    expect(rep.arap.total).toEqual({ ar: 0, ap: 39.5 })     // 169.5 − 100 − 30
    expect(rep.invoices.ours).toEqual(rep.invoices.acd)
    // 车间仓 20 润衡不核算金额，差异归因 no_cost_wh；成品仓金额 27.5 vs 润衡 22.5 归因 amount
    const reasons = Object.fromEntries(rep.stock.diffs.map((d: any) => [`${d.warehouse_code}|${d.item_code}`, d.reason]))
    expect(reasons['20|M1']).toBe('no_cost_wh')
  })

  it('已有单据时再次导入被阻断', () => {
    const p = previewScmAcd(db, A, acd)
    expect(p.blockers.some(b => b.includes('已有进销存单据'))).toBe(true)
    expect(() => executeScmAcdImport(db, A, acd, { operator: 'x' })).toThrow(/已有进销存单据/)
  })

  it('撤销：清空本批单据与库存，删除本批新建档案', () => {
    expect(revertBlocker(db, A, batchId)).toBeNull()
    revertScmAcdImport(db, A, batchId)
    const n = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE account_set_id=?`).get(A) as any).c
    expect(n('scm_doc')).toBe(0)
    expect(n('scm_stock')).toBe(0)
    expect(n('scm_ar_ap_log')).toBe(0)
    expect(n('scm_item')).toBe(0)
    expect(n('scm_partner')).toBe(0)
    expect(n('scm_statement')).toBe(0)
    expect(n('scm_ar_ap_verify')).toBe(0)
    expect((db.prepare('SELECT status FROM scm_acd_import_batch WHERE id=?').get(batchId) as any).status).toBe('reverted')
    expect(revertBlocker(db, A, batchId)).toMatch(/已撤销/)
  })
})
