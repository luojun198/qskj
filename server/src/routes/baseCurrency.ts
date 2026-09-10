import { Router } from 'express'
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/index.js'
import {
  createCurrency,
  deleteCurrency,
  deleteExchangeRate,
  getCurrencies,
  getCurrencyByCode,
  getCurrencySettings,
  listExchangeRates,
  resolveExchangeRate,
  saveCurrencySettings,
  updateCurrency,
  upsertExchangeRate,
} from '../services/currencyService.js'

const router = Router()
router.use(authMiddleware)

router.get('/currency-settings', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    res.json({ code: 0, data: getCurrencySettings(accountSetId) })
  } catch (error: any) {
    console.error('获取外币设置失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.put('/currency-settings', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const data = saveCurrencySettings(accountSetId, {
      exchange_gain_account_code: req.body?.exchange_gain_account_code ?? null,
    })
    res.json({ code: 0, data })
  } catch (error: any) {
    console.error('保存外币设置失败:', error)
    res.status(400).json({ code: 400, message: error.message })
  }
})

router.get('/currencies', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const includeDisabled = String(req.query.include_disabled || '') === '1'
    const items = getCurrencies(accountSetId, { includeDisabled })
    res.json({ code: 0, data: items })
  } catch (error: any) {
    console.error('获取币种列表失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.get('/currencies/:code', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const item = getCurrencyByCode(accountSetId, req.params.code)
    if (!item) return res.status(404).json({ code: 404, message: '币种不存在' })
    res.json({ code: 0, data: item })
  } catch (error: any) {
    console.error('获取币种失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.post('/currencies', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const { code, name, is_base, default_rate, begin_rate, end_rate, rate_decimals, is_enabled, sort_order } =
      req.body
    if (!code) return res.status(400).json({ code: 400, message: '币种编码不能为空' })
    const item = createCurrency({
      account_set_id: accountSetId,
      code,
      name,
      is_base: !!is_base,
      default_rate,
      begin_rate,
      end_rate,
      rate_decimals,
      is_enabled,
      sort_order,
    })
    res.json({ code: 0, data: item })
  } catch (error: any) {
    console.error('创建币种失败:', error)
    res.status(400).json({ code: 400, message: error.message })
  }
})

router.put('/currencies/:id', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const { name, is_base, default_rate, begin_rate, end_rate, rate_decimals, is_enabled, sort_order } =
      req.body
    updateCurrency(req.params.id, accountSetId, {
      name,
      is_base,
      default_rate,
      begin_rate,
      end_rate,
      rate_decimals,
      is_enabled,
      sort_order,
    })
    res.json({ code: 0, message: '更新成功' })
  } catch (error: any) {
    console.error('更新币种失败:', error)
    res.status(400).json({ code: 400, message: error.message })
  }
})

router.delete('/currencies/:id', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    deleteCurrency(req.params.id, accountSetId)
    res.json({ code: 0, message: '删除成功' })
  } catch (error: any) {
    console.error('删除币种失败:', error)
    res.status(400).json({ code: 400, message: error.message })
  }
})

router.get('/exchange-rates', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const currencyCode = req.query.currency_code ? String(req.query.currency_code) : undefined
    const year = req.query.year != null ? Number(req.query.year) : undefined
    const items = listExchangeRates(accountSetId, { currencyCode, year })
    res.json({ code: 0, data: items })
  } catch (error: any) {
    console.error('获取汇率失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.get('/exchange-rates/resolve', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const currencyCode = String(req.query.currency_code || '')
    const year = Number(req.query.year)
    const period = Number(req.query.period)
    if (!currencyCode || !Number.isFinite(year) || !Number.isFinite(period)) {
      return res.status(400).json({ code: 400, message: '缺少币种或年/期' })
    }
    const rate = resolveExchangeRate(accountSetId, currencyCode, year, period)
    res.json({ code: 0, data: { rate } })
  } catch (error: any) {
    console.error('解析汇率失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

router.post('/exchange-rates', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    const { currency_code, year, period, rate, closing_rate } = req.body
    const item = upsertExchangeRate({
      account_set_id: accountSetId,
      currency_code,
      year,
      period,
      rate,
      closing_rate,
    })
    res.json({ code: 0, data: item })
  } catch (error: any) {
    console.error('保存汇率失败:', error)
    res.status(400).json({ code: 400, message: error.message })
  }
})

router.delete('/exchange-rates/:id', requirePermission('base:currency'), (req: AuthRequest, res) => {
  try {
    const accountSetId = req.accountSetId || ''
    if (!accountSetId) return res.status(400).json({ code: 400, message: '缺少账套ID' })
    deleteExchangeRate(req.params.id, accountSetId)
    res.json({ code: 0, message: '删除成功' })
  } catch (error: any) {
    console.error('删除汇率失败:', error)
    res.status(400).json({ code: 400, message: error.message })
  }
})

export default router
