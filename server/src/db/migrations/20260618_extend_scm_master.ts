import type Database from 'better-sqlite3'

/**
 * Phase 5：主数据补全（对齐 ACD 源 ERP 全字段）
 *
 * scm_item（← cpda）、scm_partner（← khda）、scm_warehouse（← ckda）补齐生产型 ERP 常用档案字段。
 * 全部可空带默认，老数据天然兼容。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
}

export function up(db: Database.Database) {
  // ── 物料档案 scm_item（← cpda） ──
  addColumn(db, 'scm_item', "volume REAL DEFAULT 0")              // tj 体积
  addColumn(db, 'scm_item', "min_order_qty REAL DEFAULT 0")       // zxdhl 最小订货量
  addColumn(db, 'scm_item', "lead_time_days INTEGER DEFAULT 0")   // dh_ts 订货提前期(天)
  addColumn(db, 'scm_item', "shelf_life_days INTEGER DEFAULT 0")  // bzq 保质期(天)
  addColumn(db, 'scm_item', "buyer TEXT")                         // s_cgy 采购员
  addColumn(db, 'scm_item', "work_station TEXT")                  // s_gw 工位
  addColumn(db, 'scm_item', "transfer_price REAL DEFAULT 0")      // dbdj 调拨价
  addColumn(db, 'scm_item', "sale_price2 REAL DEFAULT 0")         // yddj2 二级售价
  addColumn(db, 'scm_item', "sale_price3 REAL DEFAULT 0")         // yddj3 三级售价
  addColumn(db, 'scm_item', "safety_stock REAL DEFAULT 0")        // jwsl 安全库存

  // ── 往来单位 scm_partner（← khda） ──
  addColumn(db, 'scm_partner', "ship_address TEXT")               // shdz 收货地址
  addColumn(db, 'scm_partner', "ship_phone TEXT")                 // shdh 收货电话
  addColumn(db, 'scm_partner', "ship_contact TEXT")               // shlxr 收货联系人
  addColumn(db, 'scm_partner', "province TEXT")                   // shen 省
  addColumn(db, 'scm_partner', "city TEXT")                       // shi 市
  addColumn(db, 'scm_partner', "county TEXT")                     // xian 县
  addColumn(db, 'scm_partner', "country TEXT")                    // gj 国家
  addColumn(db, 'scm_partner', "payment_type TEXT")               // fklx 付款方式
  addColumn(db, 'scm_partner', "credit_days INTEGER DEFAULT 0")   // ts 账期天数
  addColumn(db, 'scm_partner', "qq TEXT")                         // qq
  addColumn(db, 'scm_partner', "email TEXT")                      // email
  addColumn(db, 'scm_partner', "wechat TEXT")                     // wx 微信

  // ── 仓库 scm_warehouse（← ckda） ──
  addColumn(db, 'scm_warehouse', "address TEXT")                  // txdz 地址
  addColumn(db, 'scm_warehouse', "phone TEXT")                    // lxdh 电话
  addColumn(db, 'scm_warehouse', "partner_code TEXT")             // khbh 外仓对应往来单位

  console.log('✓ scm_item / scm_partner / scm_warehouse 主数据字段已补全')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列即可（无害）
}
