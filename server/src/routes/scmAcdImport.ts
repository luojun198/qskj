/**
 * 进销存 ACD 独立导入（润衡 POS 备份 → 当前账套进销存）。
 * 权限：预检 / 导入 / 查看 = scm:import；撤销会清空进销存业务数据，另需 scm:param（同「供应链初始化」）。
 */
import { Router } from 'express'
import multer from 'multer'
import { getDb } from '../db/index.js'
import { authMiddleware, operationLog, requirePermission, type AuthRequest } from '../middleware/index.js'
import { createPreReinitializeBackup } from '../services/systemReinitialize.js'
import { seedDocTypes } from './scmDoc.js'
import {
  executeScmAcdImport, getScmAcdBatch, listScmAcdBatches, previewScmAcd, revertBlocker, revertScmAcdImport,
} from '../services/scmAcdImport/index.js'

const MAX_ACD_BYTES = 200 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ACD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/\.acd$/i.test(file.originalname)) return cb(new Error('仅支持润衡 .acd 备份文件'))
    cb(null, true)
  },
})

const router = Router()
router.use(authMiddleware)
router.use('/scm/acd-import', requirePermission('scm:import'))

const asid = (req: AuthRequest) => req.accountSetId || ''
const userName = (req: AuthRequest) => (req as any).userName || '系统'

/** multer 按 latin1 解中文文件名，转回 UTF-8 */
function fileNameOf(file: Express.Multer.File) {
  try { return Buffer.from(file.originalname, 'latin1').toString('utf8') } catch { return file.originalname }
}

function singleFile(req: any, res: any, next: any) {
  upload.single('file')(req, res, (err: any) => {
    if (err) return res.status(400).json({ code: 400, message: err.code === 'LIMIT_FILE_SIZE' ? '文件过大' : (err.message || '上传失败') })
    if (!req.file) return res.status(400).json({ code: 400, message: '请上传 .acd 文件' })
    if (!req.file.buffer.includes(Buffer.from('rhsj\\'))) {
      return res.status(400).json({ code: 400, message: '不是有效的润衡 .acd 备份文件' })
    }
    next()
  })
}

router.post('/scm/acd-import/preview', singleFile, (req: AuthRequest, res) => {
  try {
    const file = (req as any).file as Express.Multer.File
    res.json({ code: 0, data: previewScmAcd(getDb(), asid(req), file.buffer, fileNameOf(file)) })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: `解析失败：${e?.message || e}` })
  }
})

router.post('/scm/acd-import/execute', singleFile, operationLog('进销存ACD导入', '供应链'), async (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const file = (req as any).file as Express.Multer.File
  let options: any = {}
  try { options = JSON.parse(String(req.body?.options || '{}')) } catch { options = {} }
  // 先做预检，避免无谓备份
  const preview = previewScmAcd(db, aid, file.buffer, fileNameOf(file))
  if (preview.blockers.length) return res.status(400).json({ code: 400, message: preview.blockers.join('；') })
  let backupFile: string | null = null
  try {
    backupFile = (await createPreReinitializeBackup(aid, req.userId)).filename
  } catch (e: any) {
    return res.status(500).json({ code: 500, message: e?.message || '导入前自动备份失败，已中止导入' })
  }
  try {
    seedDocTypes(db, aid)
    const r = executeScmAcdImport(db, aid, file.buffer, { fileName: fileNameOf(file), operator: userName(req), options, backupFile })
    res.json({ code: 0, data: { ...r, backupFile } })
  } catch (e: any) {
    console.error('进销存 ACD 导入失败:', e)
    res.status(500).json({ code: 500, message: `导入失败（已整体回滚，未写入任何数据）：${e?.message || e}` })
  }
})

router.get('/scm/acd-import/batches', (req: AuthRequest, res) => {
  res.json({ code: 0, data: listScmAcdBatches(getDb(), asid(req)) })
})

router.get('/scm/acd-import/batches/:id', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const b = getScmAcdBatch(db, aid, req.params.id)
  if (!b) return res.status(404).json({ code: 404, message: '导入批次不存在' })
  res.json({ code: 0, data: { ...b, revert_blocker: b.status === 'done' ? revertBlocker(db, aid, req.params.id) : null } })
})

router.post('/scm/acd-import/batches/:id/revert', requirePermission('scm:param'), operationLog('撤销进销存ACD导入', '供应链'), async (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const blocker = revertBlocker(db, aid, req.params.id)
  if (blocker) return res.status(400).json({ code: 400, message: blocker })
  let backupFile = ''
  try {
    backupFile = (await createPreReinitializeBackup(aid, req.userId)).filename
  } catch (e: any) {
    return res.status(500).json({ code: 500, message: e?.message || '撤销前自动备份失败，已中止' })
  }
  try {
    const removed = revertScmAcdImport(db, aid, req.params.id)
    res.json({ code: 0, data: { removed, backup: backupFile } })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e?.message || '撤销失败' })
  }
})

export default router
