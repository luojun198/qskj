/**
 * ACD 导出路由 — 出纳/固定资产可逆还原
 *
 * GET  /api/acd-export/cashier-asset         → 下载 ZIP，内含各表 GBK txt
 * GET  /api/acd-export/cashier-asset/preview → JSON 预览（行数统计，不下载）
 */
import { Router } from 'express'
import { deflateSync } from 'zlib'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { exportCashierAssetTables } from '../services/acdExportCashierAsset.js'

const router = Router()
router.use(authMiddleware)

/** 预览：返回各表导出行数 */
router.get('/acd-export/cashier-asset/preview', (req: AuthRequest, res) => {
  const db = getDb()
  const asid = req.accountSetId || ''
  const counts = {
    cn_mx:   (db.prepare('SELECT COUNT(*) c FROM cashier_journal WHERE account_set_id=?').get(asid) as any).c,
    cn_nc:   (db.prepare('SELECT COUNT(*) c FROM cashier_init_balance WHERE account_set_id=?').get(asid) as any).c,
    jslb:    (db.prepare('SELECT COUNT(*) c FROM settle_type WHERE account_set_id=?').get(asid) as any).c,
    yhdzd:   (db.prepare('SELECT COUNT(*) c FROM bank_statement WHERE account_set_id=?').get(asid) as any).c,
    zc_gdzc: (db.prepare('SELECT COUNT(*) c FROM fixed_asset WHERE account_set_id=?').get(asid) as any).c,
    zc_yzjb: (db.prepare('SELECT COUNT(*) c FROM fixed_asset_depr WHERE account_set_id=?').get(asid) as any).c,
    zc_yzzj: (db.prepare("SELECT COUNT(*) c FROM fixed_asset_change WHERE account_set_id=? AND change_item='原值增减'").get(asid) as any).c,
    zc_sbbd: (db.prepare("SELECT COUNT(*) c FROM fixed_asset_change WHERE account_set_id=? AND (change_item IS NULL OR change_item!='原值增减')").get(asid) as any).c,
    zc_sblb: (db.prepare('SELECT COUNT(*) c FROM fixed_asset_category WHERE account_set_id=?').get(asid) as any).c,
    zc_sbzt: (db.prepare('SELECT COUNT(*) c FROM fixed_asset_status WHERE account_set_id=?').get(asid) as any).c,
    zc_sbyt: (db.prepare('SELECT COUNT(*) c FROM fixed_asset_purpose WHERE account_set_id=?').get(asid) as any).c,
    zc_sydw: (db.prepare('SELECT COUNT(*) c FROM fixed_asset_dept WHERE account_set_id=?').get(asid) as any).c,
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  res.json({ code: 0, data: { counts, total } })
})

/**
 * 下载：打包为 tar 格式的简单文件包（无依赖实现）
 * 实际使用润衡需要 .acd 格式；这里导出 ZIP（tar），
 * 若需完整 .acd 二进制则用 buildAcdBuffer。
 */
router.get('/acd-export/cashier-asset', (req: AuthRequest, res) => {
  const db = getDb()
  const asid = req.accountSetId || ''
  const accountSet = db.prepare('SELECT name, code FROM account_sets WHERE id=?').get(asid) as any
  const setName = accountSet?.name || 'export'

  const tables = exportCashierAssetTables(db, asid)
  const acdBuf = buildAcdBuffer(tables)

  const filename = encodeURIComponent(`${setName}_出纳固资_${new Date().toISOString().slice(0,10)}.acd`)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
  res.send(acdBuf)
})

/**
 * 将 Map<filename, Buffer> 打包为润衡 .acd 格式（zlib + 定长头）
 * ACD 格式规范（来自 rh备份读取工具/README.md）：
 *   文件名字段: 32字节（null结尾，0x20填充）
 *   元数据: flag(4) + uncompressed_size(4) + compressed_size(4)
 *   压缩数据: zlib.deflate
 */
function buildAcdBuffer(tables: Map<string, Buffer>): Buffer {
  const parts: Buffer[] = []

  for (const [filename, content] of tables) {
    if (content.length === 0) continue

    // 文件名字段：32字节
    const nameBuf = Buffer.alloc(32, 0x20)
    const nameBytes = Buffer.from(filename, 'ascii')
    nameBytes.copy(nameBuf, 0, 0, Math.min(nameBytes.length, 31))
    nameBuf[Math.min(nameBytes.length, 31)] = 0x00

    // zlib 压缩
    const compressed = deflateSync(content)
    const meta = Buffer.alloc(12)
    meta.writeUInt32LE(1, 0)                    // flag = 1
    meta.writeUInt32LE(content.length, 4)       // uncompressed_size
    meta.writeUInt32LE(compressed.length, 8)    // compressed_size

    parts.push(nameBuf, meta, compressed)
  }

  return Buffer.concat(parts)
}

export default router
