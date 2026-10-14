import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import {
  getCashFlowItems,
  getCashFlowTree,
  getCashFlowItemByCode,
  createCashFlowItem,
  updateCashFlowItem,
  deleteCashFlowItem,
  initDefaultCashFlowItems,
} from '../services/cashFlowService.js'

const router = Router()
router.use(authMiddleware)

router.get('/', (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) {
      return res.status(400).json({ error: '缺少账套ID' })
    }
    const items = getCashFlowItems(accountSetId)
    res.json({ code: 0, data: items })
  } catch (error: any) {
    console.error('获取现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.get('/tree', (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) {
      return res.status(400).json({ error: '缺少账套ID' })
    }
    const tree = getCashFlowTree(accountSetId)
    res.json({ code: 0, data: tree })
  } catch (error: any) {
    console.error('获取现金流量项目树失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.get('/code/:code', (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    const { code } = req.params
    if (!accountSetId) {
      return res.status(400).json({ error: '缺少账套ID' })
    }
    const item = getCashFlowItemByCode(accountSetId, code)
    if (!item) {
      return res.status(404).json({ code: 404, message: '现金流量项目不存在' })
    }
    res.json({ code: 0, data: item })
  } catch (error: any) {
    console.error('获取现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.post('/', (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    const { code, name, direction, parent_code, level, sort_order } = req.body
    if (!accountSetId || !code || !name || !direction) {
      return res.status(400).json({ code: 400, message: '缺少必填字段' })
    }
    const existing = getCashFlowItemByCode(accountSetId, code)
    if (existing) {
      return res.status(400).json({ code: 400, message: '现金流量项目编码已存在' })
    }
    const item = createCashFlowItem({
      account_set_id: accountSetId,
      code,
      name,
      direction,
      parent_code: parent_code || null,
      level: level || 1,
      is_leaf: 1,
      sort_order: sort_order || 0,
      is_active: 1,
    })
    res.json({ code: 0, data: item })
  } catch (error: any) {
    console.error('创建现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.put('/:id', (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { code, name, direction, parent_code, level, sort_order, is_active } = req.body
    updateCashFlowItem(id, {
      code,
      name,
      direction,
      parent_code,
      level,
      sort_order,
      is_active,
    }, req.accountSetId)
    res.json({ code: 0, message: '更新成功' })
  } catch (error: any) {
    console.error('更新现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.delete('/:id', (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    deleteCashFlowItem(id, req.accountSetId)
    res.json({ code: 0, message: '删除成功' })
  } catch (error: any) {
    console.error('删除现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.post('/init', (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) {
      return res.status(400).json({ code: 400, message: '缺少账套ID' })
    }
    // 附表（补充资料）项目由系统维护，不算「已有主表项目」
    const existing = getCashFlowItems(accountSetId).filter(i => i.kind !== 'supplement')
    if (existing.length > 0) {
      return res.status(400).json({ code: 400, message: '现金流量项目已存在，无需初始化' })
    }
    const count = initDefaultCashFlowItems(accountSetId)
    res.json({ code: 0, message: '初始化成功', data: { count } })
  } catch (error: any) {
    console.error('初始化现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

export default router
