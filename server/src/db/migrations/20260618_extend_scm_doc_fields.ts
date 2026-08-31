import type Database from 'better-sqlite3'

/**
 * Phase 2：单据头/明细结构化列扩展
 *
 * 为 scm_doc(头) 与 scm_doc_line(明细) 补齐生产型 ERP 常用字段，
 * 兼容 ACD 源 ERP（润衡 pjnr1/pjnr2）的字段映射。
 * 全部可空带默认，老数据天然兼容；长尾字段沿用 field_values JSON。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  // ── 单据头 scm_doc（← pjnr1） ──
  addColumn(db, 'scm_doc', "biz_person TEXT")                       // jbr 业务员/经办人
  addColumn(db, 'scm_doc', "maker TEXT")                            // 制单人
  addColumn(db, 'scm_doc', "auditor TEXT")                          // 审核人
  addColumn(db, 'scm_doc', "audited_at TEXT")                       // 审核时间
  addColumn(db, 'scm_doc', "payment_type TEXT")                     // fklx 付款方式
  addColumn(db, 'scm_doc', "settle_account TEXT")                   // 结算账户(收付款)
  addColumn(db, 'scm_doc', "invoice_type TEXT")                     // fpzl 发票种类
  addColumn(db, 'scm_doc', "invoice_no TEXT")                       // fpdh 发票号
  addColumn(db, 'scm_doc', "invoice_date TEXT")                     // fprq 发票日期
  addColumn(db, 'scm_doc', "contract_no TEXT")                      // htbh 合同号
  addColumn(db, 'scm_doc', "currency TEXT DEFAULT 'CNY'")           // bz 币别
  addColumn(db, 'scm_doc', "exchange_rate REAL DEFAULT 1")          // 汇率
  addColumn(db, 'scm_doc', "discount_rate REAL DEFAULT 0")          // zkl 整单折扣率
  addColumn(db, 'scm_doc', "expect_date TEXT")                      // 预计到货/交货日期
  addColumn(db, 'scm_doc', "dest_warehouse_code TEXT")             // drck 调入仓(调拨语义化)
  addColumn(db, 'scm_doc', "credit_days INTEGER DEFAULT 0")         // ts 账期天数
  addColumn(db, 'scm_doc', "due_date TEXT")                         // 到期日
  addColumn(db, 'scm_doc', "cancel_flag INTEGER DEFAULT 0")         // bz_zf 作废标志
  addColumn(db, 'scm_doc', "print_count INTEGER DEFAULT 0")         // dycs 打印次数
  addColumn(db, 'scm_doc', "field_values TEXT NOT NULL DEFAULT '{}'") // 自定义字段 JSON

  // ── 单据明细 scm_doc_line（← pjnr2） ──
  addColumn(db, 'scm_doc_line', "spec TEXT")                        // gg 规格快照
  addColumn(db, 'scm_doc_line', "unit TEXT")                        // jldw 单位快照
  addColumn(db, 'scm_doc_line', "price_with_tax REAL DEFAULT 0")    // dj_hs 含税单价
  addColumn(db, 'scm_doc_line', "discount_rate REAL DEFAULT 0")     // zkl 行折扣率
  addColumn(db, 'scm_doc_line', "discount_amount REAL DEFAULT 0")   // 行折扣额
  addColumn(db, 'scm_doc_line', "expire_date TEXT")                 // sxq 保质期/失效期
  addColumn(db, 'scm_doc_line', "produce_date TEXT")                // 生产日期
  addColumn(db, 'scm_doc_line', "gift_flag INTEGER DEFAULT 0")      // 赠品标志
  addColumn(db, 'scm_doc_line', "ref_no TEXT")                      // dfbh 对方编号
  addColumn(db, 'scm_doc_line', "scrap_rate REAL DEFAULT 0")        // shl 损耗率(生产/委外)
  addColumn(db, 'scm_doc_line', "process_fee REAL DEFAULT 0")       // 委外加工费
  addColumn(db, 'scm_doc_line', "field_values TEXT NOT NULL DEFAULT '{}'") // 自定义字段 JSON

  console.log('✓ scm_doc / scm_doc_line 已扩展生产型 ERP 常用字段')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列即可（无害）
}
