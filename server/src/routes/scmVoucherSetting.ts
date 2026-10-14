/**
 * 进销存凭证设置（基础资料 → 业务凭证设置 → 进销存凭证设置）
 *
 * 集中管理：单据生成凭证的对方科目、辅助核算取值来源、匹配规则，
 * 以及往来单位 / 部门 / 业务员与总账辅助核算项目的对应预览与维护。
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { firstNonLeafError } from '../services/accountReferences.js'
import { resolveScmAccount, SCM_ACCOUNT_SPECS, suggestScmAccounts } from '../services/scmAccountResolver.js'
import {
  SCM_AUX_MATCH_MODE_KEY,
  SCM_AUX_MATCH_MODES,
  SCM_AUX_SOURCE_MAP_KEY,
  SCM_AUX_SOURCES,
  accountAuxCategoryIds,
  buildAuxPreview,
  createAuxItemsForSources,
  deleteAuxMap,
  loadScmAuxContext,
  saveAuxMap,
  type ScmAuxContext,
  type ScmAuxSourceType,
  type ScmPreviewAccounts,
} from '../services/scmVoucherAux.js'
import { buildScmPreset } from '../services/scmVoucherPreset.js'
import {
  IO_CATEGORY_ACCOUNTS_KEY,
  builtinIoCategoryRole,
  listIoCategories,
  loadIoCategoryAccounts,
  normalizeIoCategoryAccounts,
} from '../services/scmIoCategoryAccount.js'
import {
  DEFAULT_SUMMARY_TEMPLATES,
  SAMPLE_SUMMARY_CONTEXT,
  SCM_SUMMARY_TEMPLATES_KEY,
  SUMMARY_DOC_TYPES,
  SUMMARY_PLACEHOLDERS,
  SUMMARY_ROLES,
  buildSummaryContext,
  loadSummarySettings,
  normalizeSummarySettings,
  renderSummary,
} from '../services/scmVoucherSummary.js'
import { normalizePaging } from '../utils/paging.js'
import { normalizeRequestedVoucherTypeId } from '../services/voucherEntry.js'
import { getScmDefaultVoucherTypeId, SCM_DEFAULT_VOUCHER_TYPE_KEY } from '../services/scmVoucherType.js'

const router = Router()
router.use(authMiddleware)

// 与「系统参数 → 供应链」同一权限：scm:param
router.use('/scm/voucher-setting', (req: AuthRequest, res, next) => {
  if (req.permissions?.includes('*') || req.permissions?.includes('scm:param')) return next()
  return res.status(403).json({ code: 403, message: '无此操作权限' })
})

const asid = (req: AuthRequest) => req.accountSetId || ''
const SOURCE_TYPES: ScmAuxSourceType[] = ['partner', 'dept', 'person']

/** 预览用的科目口径：全局应收 / 应付 + 其余对方科目 + 物料存货科目 */
function previewAccounts(ctx: ScmAuxContext): ScmPreviewAccounts {
  const code = (key: string) => resolveScmAccount(ctx.db, ctx.accountSetId, key)?.code || ''
  const others = SCM_ACCOUNT_SPECS
    .filter(s => s.key !== 'scm:acc_ar' && s.key !== 'scm:acc_ap')
    .map(s => code(s.key))
  const inv = (ctx.db.prepare("SELECT DISTINCT inv_account c FROM scm_item WHERE account_set_id=? AND COALESCE(inv_account,'')<>''")
    .all(ctx.accountSetId) as Array<{ c: string }>).map(r => r.c)
  return { ar: code('scm:acc_ar'), ap: code('scm:acc_ap'), others: [...new Set([...others, ...inv].filter(Boolean))] }
}

router.get('/scm/voucher-setting', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ctx = loadScmAuxContext(db, aid)
  const catBrief = (code: string) => (accountAuxCategoryIds(ctx, code)?.catIds || [])
    .map(id => ({ id, name: ctx.catById.get(id)?.name || '', source: ctx.sourceMap[id] || 'none' }))

  const accounts = SCM_ACCOUNT_SPECS.map(spec => {
    const resolved = resolveScmAccount(db, aid, spec.key)
    const configured = (db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
      .get(aid, spec.key) as { param_value?: string } | undefined)?.param_value || ''
    return {
      param_key: spec.key,
      label: spec.label,
      default_code: spec.codes[0],
      value: configured,
      resolved_code: resolved?.code || '',
      resolved_name: resolved?.name || '',
      parent_code: resolved?.parent_code || '',
      source: resolved?.source || '',
      candidates: suggestScmAccounts(db, aid, spec.key),
      aux_categories: resolved?.code ? catBrief(resolved.code) : [],
    }
  })

  // 进销存实际会用到的科目（含往来单位自带应收 / 应付、物料存货科目）各挂了哪些类别
  const pa = previewAccounts(ctx)
  const partnerAccs = db.prepare(
    "SELECT ar_account a FROM scm_partner WHERE account_set_id=? AND COALESCE(ar_account,'')<>'' UNION SELECT ap_account FROM scm_partner WHERE account_set_id=? AND COALESCE(ap_account,'')<>''",
  ).all(aid, aid) as Array<{ a: string }>
  const usedCodes = [...new Set([pa.ar, pa.ap, ...pa.others, ...partnerAccs.map(r => r.a)].filter(Boolean))]
  const usedBy = new Map<string, string[]>()
  for (const code of usedCodes) {
    for (const id of accountAuxCategoryIds(ctx, code)?.catIds || []) {
      usedBy.set(id, [...(usedBy.get(id) || []), code])
    }
  }
  const categories = ctx.categories.map(c => ({
    id: c.id,
    code: c.code,
    name: c.name,
    source: ctx.sourceMap[c.id] || 'none',
    used_by: (usedBy.get(c.id) || []).sort(),
  }))

  // 结算账户检查：收付款单用过的结算科目
  const settle = (db.prepare(
    "SELECT settle_account code, COUNT(*) n FROM scm_doc WHERE account_set_id=? AND doc_type IN ('RCV','PAY') AND COALESCE(settle_account,'')<>'' GROUP BY settle_account ORDER BY settle_account",
  ).all(aid) as Array<{ code: string; n: number }>).map(r => {
    // 出纳独立账户：结算账户是出纳账户编码，生成凭证时记到其关联的总账科目
    const cashier = db.prepare('SELECT name, gl_account_code, is_enabled FROM v_cashier_account WHERE account_set_id=? AND code=? LIMIT 1')
      .get(aid, r.code) as { name: string; gl_account_code: string | null; is_enabled: number } | undefined
    const glCode = cashier ? cashier.gl_account_code : r.code
    const acc = glCode ? db.prepare(
      'SELECT a.name, a.is_cash, a.is_bank, a.is_enabled, EXISTS(SELECT 1 FROM accounts c WHERE c.parent_id=a.id) has_child FROM accounts a WHERE a.account_set_id=? AND a.code=? LIMIT 1',
    ).get(aid, glCode) as { name: string; is_cash: number; is_bank: number; is_enabled: number; has_child: number } | undefined : undefined
    const issues: string[] = []
    if (cashier && cashier.is_enabled === 0) issues.push('出纳账户已停用')
    if (cashier && !cashier.gl_account_code) issues.push('出纳账户未关联总账科目')
    else if (!acc) issues.push('关联科目不存在')
    else {
      if (acc.has_child) issues.push('关联科目非末级')
      if (acc.is_enabled === 0) issues.push('关联科目已停用')
    }
    return { code: r.code, name: cashier?.name || acc?.name || '', gl_account_code: glCode, doc_count: r.n, aux_categories: acc && glCode ? catBrief(glCode) : [], issues }
  })

  // 各来源未对应数（导航徽标用）
  const pending: Record<string, number> = {}
  for (const t of SOURCE_TYPES) pending[t] = buildAuxPreview(ctx, t, pa).rows.filter(r => r.status !== 'matched').length

  res.json({
    code: 0,
    data: {
      accounts,
      match_mode: ctx.matchMode,
      categories,
      settle_accounts: settle,
      // 进销存生成凭证的默认凭证类型（空 = 本期最近使用 / 编码最小的类型）
      default_voucher_type_id: getScmDefaultVoucherTypeId(db, aid) || '',
      pending,
      // 其他入库 / 其他出库按收发类别取对方科目（第五份反馈：无生产模块时用其他出入库做领料、成品入库）
      io_category_accounts: (() => {
        const mapping = loadIoCategoryAccounts(db, aid)
        const prod = resolveScmAccount(db, aid, 'scm:acc_production')
        const other = resolveScmAccount(db, aid, 'scm:acc_other')
        const nameOf = db.prepare('SELECT name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
        return listIoCategories(db, aid).map(({ category, dir }) => {
          const def = builtinIoCategoryRole(category) === 'production' ? prod : other
          const code = mapping[category] || ''
          return {
            category,
            dir,
            account: code,
            account_name: code ? ((nameOf.get(aid, code) as { name?: string } | undefined)?.name || '') : '',
            default_code: def?.code || '',
            default_name: def?.name || '',
            default_label: builtinIoCategoryRole(category) === 'production' ? '生产成本' : '其他出入库对方科目',
          }
        })
      })(),
      summary: {
        doc_types: SUMMARY_DOC_TYPES,
        roles: SUMMARY_ROLES,
        placeholders: SUMMARY_PLACEHOLDERS,
        defaults: DEFAULT_SUMMARY_TEMPLATES,
        custom: loadSummarySettings(db, aid),
      },
    },
  })
})

router.put('/scm/voucher-setting', operationLog('保存进销存凭证设置', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { accounts, match_mode, source_map, item_accounts, partner_accounts, summary_templates, default_voucher_type_id, io_category_accounts } = req.body || {}
  const toSave: Array<[string, string]> = []
  if (io_category_accounts !== undefined) {
    const clean = normalizeIoCategoryAccounts(io_category_accounts)
    const leafErr = firstNonLeafError(db, aid, Object.entries(clean).map(([cat, code]) => [code, `收发类别「${cat}」对方科目`] as [string, string]))
    if (leafErr) return res.status(400).json({ code: 400, message: leafErr })
    toSave.push([IO_CATEGORY_ACCOUNTS_KEY, JSON.stringify(clean)])
  }
  if (default_voucher_type_id !== undefined) {
    try {
      toSave.push([SCM_DEFAULT_VOUCHER_TYPE_KEY, normalizeRequestedVoucherTypeId(db, aid, default_voucher_type_id) || ''])
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }
  }
  if (accounts && typeof accounts === 'object') {
    for (const spec of SCM_ACCOUNT_SPECS) {
      if (!(spec.key in accounts)) continue
      const val = String(accounts[spec.key] ?? '').trim()
      const leafErr = firstNonLeafError(db, aid, [[val, spec.label]])
      if (leafErr) return res.status(400).json({ code: 400, message: leafErr })
      toSave.push([spec.key, val])
    }
  }
  if (match_mode !== undefined) {
    if (!SCM_AUX_MATCH_MODES.includes(match_mode)) return res.status(400).json({ code: 400, message: '匹配规则无效' })
    toSave.push([SCM_AUX_MATCH_MODE_KEY, match_mode])
  }
  if (source_map !== undefined) {
    if (!source_map || typeof source_map !== 'object' || Array.isArray(source_map)) {
      return res.status(400).json({ code: 400, message: '辅助核算来源格式错误' })
    }
    const clean: Record<string, string> = {}
    const catIds = new Set((db.prepare('SELECT id FROM aux_categories WHERE account_set_id=?').all(aid) as Array<{ id: string }>).map(r => r.id))
    for (const [k, v] of Object.entries(source_map)) {
      if (!catIds.has(k)) continue
      if (!SCM_AUX_SOURCES.includes(v as any)) return res.status(400).json({ code: 400, message: '辅助核算来源无效' })
      clean[k] = String(v)
    }
    toSave.push([SCM_AUX_SOURCE_MAP_KEY, JSON.stringify(clean)])
  }
  if (summary_templates !== undefined) {
    const clean = normalizeSummarySettings(summary_templates)
    const accCodes = clean.accounts.map(r => r.account)
    if (accCodes.length) {
      const exist = new Set((db.prepare(`SELECT code FROM accounts WHERE account_set_id=? AND code IN (${accCodes.map(() => '?').join(',')})`)
        .all(aid, ...accCodes) as Array<{ code: string }>).map(r => r.code))
      const bad = accCodes.find(c => !exist.has(c))
      if (bad) return res.status(400).json({ code: 400, message: `摘要规则的科目不存在：${bad}` })
    }
    toSave.push([SCM_SUMMARY_TEMPLATES_KEY, JSON.stringify(clean)])
  }
  // 一键预设带来的物料存货科目 / 往来单位应收应付：同样只收末级科目
  const itemUpdates: Array<[string, string]> = []
  for (const it of Array.isArray(item_accounts) ? item_accounts : []) {
    const code = String(it?.code || '').trim(); const acc = String(it?.inv_account || '').trim()
    if (!code || !acc) continue
    const leafErr = firstNonLeafError(db, aid, [[acc, `物料 ${code} 存货科目`]])
    if (leafErr) return res.status(400).json({ code: 400, message: leafErr })
    itemUpdates.push([code, acc])
  }
  const partnerUpdates: Array<[string, 'ar_account' | 'ap_account', string]> = []
  for (const pt of Array.isArray(partner_accounts) ? partner_accounts : []) {
    const code = String(pt?.code || '').trim()
    if (!code) continue
    for (const [field, label] of [['ar_account', '应收科目'], ['ap_account', '应付科目']] as const) {
      const acc = String(pt?.[field] || '').trim()
      if (!acc) continue
      const leafErr = firstNonLeafError(db, aid, [[acc, `往来单位 ${code} ${label}`]])
      if (leafErr) return res.status(400).json({ code: 400, message: leafErr })
      partnerUpdates.push([code, field, acc])
    }
  }
  const find = db.prepare('SELECT id FROM system_params WHERE account_set_id=? AND param_key=?')
  const upsert = db.prepare('INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    for (const [key, val] of toSave) {
      const ex = find.get(aid, key) as { id?: string } | undefined
      upsert.run(ex?.id || uuidv4(), aid, key, val)
    }
    const updItem = db.prepare("UPDATE scm_item SET inv_account=?, updated_at=datetime('now') WHERE account_set_id=? AND code=?")
    for (const [code, acc] of itemUpdates) updItem.run(acc, aid, code)
    for (const [code, field, acc] of partnerUpdates) {
      db.prepare(`UPDATE scm_partner SET ${field}=?, updated_at=datetime('now') WHERE account_set_id=? AND code=?`).run(acc, aid, code)
    }
  })()
  res.json({ code: 0, message: '保存成功', data: { items: itemUpdates.length, partners: partnerUpdates.length } })
})

/**
 * 摘要预览：templates 为 [{ key, template, doc_type }]，用该单据类型最近一张单据（没有则示例数据）渲染。
 * 只读，不落库。
 */
router.post('/scm/voucher-setting/summary-preview', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const list = Array.isArray(req.body?.templates) ? req.body.templates.slice(0, 200) : []
  const ctxCache = new Map<string, ReturnType<typeof buildSummaryContext>>()
  const ctxFor = (docType: string) => {
    if (ctxCache.has(docType)) return ctxCache.get(docType)!
    const realType = docType === 'RPD' ? 'RP' : docType === 'RSD' ? 'RS' : docType
    const doc = db.prepare('SELECT * FROM scm_doc WHERE account_set_id=? AND doc_type=? ORDER BY doc_date DESC, doc_no DESC LIMIT 1').get(aid, realType) as any
    let ctx = { ...SAMPLE_SUMMARY_CONTEXT, doc_type_name: SUMMARY_DOC_TYPES.find(t => t.code === docType)?.name || docType }
    if (doc) {
      const lines = db.prepare('SELECT * FROM scm_doc_line WHERE doc_id=?').all(doc.id) as any[]
      ctx = buildSummaryContext(db, aid, doc, lines, ctx.doc_type_name)
    }
    ctxCache.set(docType, ctx)
    return ctx
  }
  const data = list.map((t: any) => ({
    key: String(t?.key ?? ''),
    text: renderSummary(String(t?.template ?? ''), ctxFor(String(t?.doc_type ?? '')), String(t?.account_name ?? '')),
  }))
  res.json({ code: 0, data })
})

/** 一键自动预设：只算建议（全部预设到最底层末级），不写库；前端填到页面核对后随保存提交 */
router.get('/scm/voucher-setting/preset', (req: AuthRequest, res) => {
  res.json({ code: 0, data: buildScmPreset(getDb(), asid(req)) })
})

router.get('/scm/voucher-setting/aux-preview', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const q = req.query as Record<string, string>
  const sourceType = (SOURCE_TYPES.includes(q.source_type as ScmAuxSourceType) ? q.source_type : 'partner') as ScmAuxSourceType
  const ctx = loadScmAuxContext(db, aid)
  const { rows, notRequired } = buildAuxPreview(ctx, sourceType, previewAccounts(ctx))
  const keyword = String(q.keyword || '').trim().toLowerCase()
  const byKeyword = keyword
    ? rows.filter(r => [r.source_code, r.source_name, r.item_code, r.item_name].some(v => String(v || '').toLowerCase().includes(keyword)))
    : rows
  const counts = {
    all: byKeyword.length,
    matched: byKeyword.filter(r => r.status === 'matched').length,
    suggested: byKeyword.filter(r => r.status === 'suggested').length,
    unmatched: byKeyword.filter(r => r.status === 'unmatched').length,
  }
  const status = String(q.status || '')
  const filtered = status === 'pending'
    ? byKeyword.filter(r => r.status !== 'matched')
    : ['matched', 'suggested', 'unmatched'].includes(status) ? byKeyword.filter(r => r.status === status) : byKeyword
  // 未对应的排前面，便于逐条处理
  const rank = { unmatched: 0, suggested: 1, matched: 2 } as const
  filtered.sort((a, b) => rank[a.status] - rank[b.status] || a.source_code.localeCompare(b.source_code))
  const { page, pageSize, offset } = normalizePaging(q.page, q.page_size, 50, 500)
  res.json({
    code: 0,
    data: {
      rows: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      page,
      page_size: pageSize,
      counts,
      not_required: notRequired,
      match_mode: ctx.matchMode,
    },
  })
})

/** 某类别下的辅助项目（手工指定用的轻量选择器），不要求 base 权限 */
router.get('/scm/voucher-setting/aux-items', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { category_id, keyword } = req.query as Record<string, string>
  if (!category_id) return res.status(400).json({ code: 400, message: '缺少辅助核算类别' })
  const kw = `%${String(keyword || '').trim()}%`
  const rows = db.prepare(
    "SELECT id, code, name FROM aux_items WHERE account_set_id=? AND type=? AND COALESCE(status,'active')<>'closed' AND (code LIKE ? OR name LIKE ?) ORDER BY code LIMIT 200",
  ).all(aid, category_id, kw, kw)
  res.json({ code: 0, data: rows })
})

/** 手工指定 / 采纳近似建议（可批量） */
router.put('/scm/voucher-setting/aux-map', operationLog('指定进销存辅助核算对应', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body]
  try {
    db.transaction(() => {
      for (const it of items) {
        saveAuxMap(db, aid, {
          sourceType: it?.source_type,
          sourceCode: it?.source_code,
          categoryId: it?.category_id,
          auxItemId: it?.aux_item_id,
          matchSource: it?.match_source,
        })
      }
    })()
  } catch (e: any) {
    return res.status(400).json({ code: 400, message: e?.message || '保存失败' })
  }
  res.json({ code: 0, message: '已保存', data: { count: items.length } })
})

router.delete('/scm/voucher-setting/aux-map/:id', operationLog('清除进销存辅助核算对应', '供应链'), (req: AuthRequest, res) => {
  const ok = deleteAuxMap(getDb(), asid(req), req.params.id)
  if (!ok) return res.status(404).json({ code: 404, message: '对应关系不存在' })
  res.json({ code: 0, message: '已清除' })
})

/** 按进销存资料自动新建总账辅助项目并对应 */
router.post('/scm/voucher-setting/aux-create', operationLog('自动新建辅助核算项目', '供应链'), (req: AuthRequest, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
  if (!rows.length) return res.status(400).json({ code: 400, message: '没有要新建的项目' })
  const results = createAuxItemsForSources(getDb(), asid(req), rows.map((r: any) => ({
    sourceType: String(r?.source_type || ''),
    sourceCode: String(r?.source_code || ''),
    categoryId: String(r?.category_id || ''),
  })))
  res.json({ code: 0, data: { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length } })
})

export default router
