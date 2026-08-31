import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { getVoucherDetail } from '../services/voucherEntry.js'

const router = Router()
router.use(authMiddleware)

// ===================== 凭证模版管理 =====================

// 获取凭证模版列表
router.get('/', (req: AuthRequest, res) => {
  const db = getDb()
  const { keyword } = req.query

  let sql = `
    SELECT vt.id, vt.template_no, vt.template_name, vt.voucher_type_id,
           vt.total_amount, vt.remark, vt.entries_data, vt.created_by, vt.created_at,
           vtype.name as voucher_type_name
    FROM voucher_templates vt
    LEFT JOIN voucher_types vtype ON vt.voucher_type_id = vtype.id
    WHERE vt.account_set_id = ?
  `
  const params: any[] = [req.accountSetId || '']

  if (keyword) {
    sql += ` AND (vt.template_no LIKE ? OR vt.template_name LIKE ?)`
    params.push(`%${keyword}%`, `%${keyword}%`)
  }

  sql += ` ORDER BY vt.created_at DESC`

  const templates = db.prepare(sql).all(...params) as any[]

  // 解析 entries_data 并计算分录数量
  const result = templates.map(t => {
    let entriesCount = 0
    try {
      const entries = JSON.parse(t.entries_data || '[]')
      entriesCount = entries.length
    } catch (e) {
      console.error('解析分录数据失败:', e)
    }
    return {
      id: t.id,
      template_no: t.template_no,
      template_name: t.template_name,
      voucher_type_id: t.voucher_type_id,
      voucher_type_name: t.voucher_type_name,
      total_amount: t.total_amount,
      remark: t.remark,
      entries_count: entriesCount,
      created_at: t.created_at,
    }
  })

  res.json({ code: 0, data: result })
})

// 获取单个凭证模版详情
router.get('/:id', (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()

  const template = db
    .prepare(
      `SELECT vt.id, vt.template_no, vt.template_name, vt.voucher_type_id,
              vt.total_amount, vt.remark, vt.entries_data, vt.created_by, vt.created_at,
              vtype.name as voucher_type_name
       FROM voucher_templates vt
       LEFT JOIN voucher_types vtype ON vt.voucher_type_id = vtype.id
       WHERE vt.id = ? AND vt.account_set_id = ?`
    )
    .get(id, req.accountSetId || '') as any

  if (!template) {
    return res.status(404).json({ code: 404, message: '凭证模版不存在' })
  }

  // 解析 entries_data
  let entries = []
  try {
    entries = JSON.parse(template.entries_data || '[]')
  } catch (e) {
    console.error('解析分录数据失败:', e)
  }

  res.json({
    code: 0,
    data: {
      id: template.id,
      template_no: template.template_no,
      template_name: template.template_name,
      voucher_type_id: template.voucher_type_id,
      voucher_type_name: template.voucher_type_name,
      total_amount: template.total_amount,
      remark: template.remark,
      entries,
      created_at: template.created_at,
    },
  })
})

// 创建凭证模版（从凭证转换或直接从表单数据）
router.post('/', operationLog('创建凭证模版', '凭证管理'), (req: AuthRequest, res) => {
  const { template_no, template_name, voucher_id, entries, voucher_type_id, remark } = req.body

  if (!template_no || !template_name) {
    return res.status(400).json({ code: 400, message: '模版编号和模版说明不能为空' })
  }

  // 必须提供 voucher_id 或 entries
  if (!voucher_id && (!entries || !Array.isArray(entries) || entries.length === 0)) {
    return res.status(400).json({ code: 400, message: '必须提供凭证ID或分录数据' })
  }

  const db = getDb()

  // 1. 验证模版编号唯一性
  const existing = db
    .prepare('SELECT id FROM voucher_templates WHERE account_set_id = ? AND template_no = ?')
    .get(req.accountSetId || '', template_no)

  if (existing) {
    return res.status(400).json({ code: 400, message: `模版编号「${template_no}」已存在` })
  }

  let entriesData: any[]
  let voucherTypeId: string | null
  let totalAmount: number
  let voucherRemark: string

  if (voucher_id) {
    // 方式1：从现有凭证创建模版
    const voucher = getVoucherDetail({ db, voucherId: voucher_id })
    if (!voucher) {
      return res.status(404).json({ code: 404, message: '源凭证不存在' })
    }

    if (voucher.account_set_id !== req.accountSetId) {
      return res.status(403).json({ code: 403, message: '无权访问该凭证' })
    }

    // 序列化分录数据为 JSON（不含凭证日期、凭证号）
    entriesData = voucher.entries.map((entry: any) => ({
      seq: entry.seq,
      account_id: entry.account_id,
      account_code: entry.account_code,
      account_name: entry.account_name,
      direction: entry.direction,
      amount: entry.amount,
      summary: entry.summary,
      dept_id: entry.dept_id,
      dept_name: entry.dept_name,
      project_id: entry.project_id,
      project_name: entry.project_name,
      supplier_id: entry.supplier_id,
      supplier_name: entry.supplier_name,
      person_id: entry.person_id,
      person_name: entry.person_name,
      func_class_id: entry.func_class_id,
      func_class_name: entry.func_class_name,
      aux_data: entry.aux_data,
    }))

    voucherTypeId = voucher.voucher_type_id
    totalAmount = voucher.total_amount
    voucherRemark = voucher.remark || ''
  } else {
    // 方式2：直接从表单数据创建模版
    entriesData = entries.map((entry: any, index: number) => ({
      seq: index + 1,
      account_id: entry.account_id,
      account_code: entry.account_code,
      account_name: entry.account_name,
      direction: entry.direction,
      amount: entry.amount,
      summary: entry.summary,
      dept_id: entry.dept_id,
      dept_name: entry.dept_name,
      project_id: entry.project_id,
      project_name: entry.project_name,
      supplier_id: entry.supplier_id,
      supplier_name: entry.supplier_name,
      person_id: entry.person_id,
      person_name: entry.person_name,
      func_class_id: entry.func_class_id,
      func_class_name: entry.func_class_name,
      aux_data: entry.aux_data,
    }))

    voucherTypeId = voucher_type_id || null
    totalAmount = entries
      .filter((e: any) => e.direction === 'debit')
      .reduce((sum: number, e: any) => sum + (e.amount || 0), 0)
    voucherRemark = remark || ''
  }

  // 2. 插入 voucher_templates 表
  const templateId = uuidv4()
  db.prepare(
    `INSERT INTO voucher_templates
     (id, account_set_id, template_no, template_name, voucher_type_id, total_amount, remark, entries_data, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    templateId,
    req.accountSetId,
    template_no,
    template_name,
    voucherTypeId,
    totalAmount,
    voucherRemark,
    JSON.stringify(entriesData),
    req.userId
  )

  res.json({ code: 0, message: '凭证模版创建成功', data: { id: templateId } })
})

// 更新凭证模版
router.put('/:id', operationLog('更新凭证模版', '凭证管理'), (req: AuthRequest, res) => {
  const { id } = req.params
  const { template_no, template_name, voucher_type_id, remark, entries } = req.body

  if (!template_no || !template_name) {
    return res.status(400).json({ code: 400, message: '模版编号和模版说明不能为空' })
  }

  const db = getDb()

  // 1. 验证模版是否存在
  const template = db
    .prepare('SELECT id FROM voucher_templates WHERE id = ? AND account_set_id = ?')
    .get(id, req.accountSetId || '')

  if (!template) {
    return res.status(404).json({ code: 404, message: '凭证模版不存在' })
  }

  // 2. 验证模版编号唯一性（排除当前模版）
  const existing = db
    .prepare('SELECT id FROM voucher_templates WHERE account_set_id = ? AND template_no = ? AND id != ?')
    .get(req.accountSetId || '', template_no, id)

  if (existing) {
    return res.status(400).json({ code: 400, message: `模版编号「${template_no}」已被其他模版使用` })
  }

  // 3. 计算总金额
  let totalAmount = 0
  if (entries && Array.isArray(entries)) {
    totalAmount = entries
      .filter((e: any) => e.direction === 'debit')
      .reduce((sum: number, e: any) => sum + (e.amount || 0), 0)
  }

  // 4. 序列化分录数据
  const entriesData = entries.map((entry: any, index: number) => ({
    seq: index + 1,
    account_id: entry.account_id,
    account_code: entry.account_code,
    account_name: entry.account_name,
    direction: entry.direction,
    amount: entry.amount,
    summary: entry.summary,
    dept_id: entry.dept_id,
    dept_name: entry.dept_name,
    project_id: entry.project_id,
    project_name: entry.project_name,
    supplier_id: entry.supplier_id,
    supplier_name: entry.supplier_name,
    person_id: entry.person_id,
    person_name: entry.person_name,
    func_class_id: entry.func_class_id,
    func_class_name: entry.func_class_name,
    aux_data: entry.aux_data,
  }))

  // 5. 更新模版
  db.prepare(
    `UPDATE voucher_templates
     SET template_no = ?, template_name = ?, voucher_type_id = ?, total_amount = ?, remark = ?, entries_data = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    template_no,
    template_name,
    voucher_type_id || null,
    totalAmount,
    remark || '',
    JSON.stringify(entriesData),
    id
  )

  res.json({ code: 0, message: '凭证模版更新成功' })
})

// 删除凭证模版
router.delete('/:id', operationLog('删除凭证模版', '凭证管理'), (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()

  const template = db
    .prepare('SELECT id FROM voucher_templates WHERE id = ? AND account_set_id = ?')
    .get(id, req.accountSetId || '')

  if (!template) {
    return res.status(404).json({ code: 404, message: '凭证模版不存在' })
  }

  db.prepare('DELETE FROM voucher_templates WHERE id = ?').run(id)

  res.json({ code: 0, message: '凭证模版删除成功' })
})

export default router
