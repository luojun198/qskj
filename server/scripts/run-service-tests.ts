import assert from 'node:assert/strict'
import {
  applyVoucherPosting,
  applyVoucherUnpost,
  getRequireAuditEnabled,
  getVoucherStatusAfterUnpost,
  loadVoucherEntries,
  validateVoucherCanPost,
  validateVoucherForUnpost,
} from '../src/services/voucherPosting.ts'
import { getBalance, getPeriodSum } from '../src/services/reportBalance.ts'
import { executeTemplateSheets } from '../src/services/reportTemplateExecutor.ts'
import { buildBatchVoucherQuery, buildVoucherListQuery } from '../src/services/voucherQuery.ts'
import { buildChronologicalQuery, buildLedgerDetailQuery } from '../src/services/ledgerQuery.ts'
import { buildSystemLogsQuery, buildSystemUsersQuery } from '../src/services/systemQuery.ts'
import { buildAuxBalanceQuery, getAuxBalanceField } from '../src/services/reportQuery.ts'
import {
  applyVoucherAudit,
  applyVoucherUnAudit,
  attachVoucherEntries,
  auditBatchVouchers,
  buildAiSummaryEntryText,
  buildAiSummaryRequestBody,
  buildAuxItemMap,
  buildBatchAuditPreviewData,
  buildBatchDeletePreviewData,
  buildVoucherEntryPayloads,
  buildVoucherEntriesMap,
  buildVoucherNo,
  calculateNewBalance,
  calculateVoucherTotals,
  closePeriod,
  deleteBatchVouchers,
  deleteVoucherRecords,
  extractAiSummary,
  getAiSummaryApiUrl,
  getPeriodClosingRecord,
  getVoucherBalanceError,
  getVoucherUpdateBalanceError,
  isAiSummaryEnabled,
  findPostedVoucher,
  findSelfMadeVoucher,
  getEffectiveVoucherTypeId,
  getNextVoucherNo,
  getVoucherById,
  getVoucherDetail,
  getVoucherWithTypeById,
  isPeriodClosed,
  isPostedVoucher,
  listPeriodClosingStatus,
  getBatchDraftVouchers,
  getBatchVoucherFilters,
  getBatchVoucherQuery,
  isVoucherBalanced,
  loadBatchDraftVouchers,
  loadBatchFilteredVouchers,
  loadBatchVouchers,
  loadVoucherAuxiliaryData,
  openPeriod,
  replaceVoucherEntries,
  validateBatchVoucherFilters,
  validateVoucherEntriesNoNegativeBalance,
  validateVoucherEntryCount,
  validateVoucherForAudit,
  validateVoucherForUnAudit,
} from '../src/services/voucherEntry.ts'
import {
  AUTO_TRANSFER_TYPE,
  buildAutoTransferPreview,
  buildAutoTransferRemark,
  buildEntriesFromTransferItems,
  createAutoTransferVoucher,
  getAutoTransferRun,
  getAutoTransferStatus,
  getAutoTransferSummary,
  getAutoTransferVoucherDate,
  getAutoTransferVoucherTypeId,
  listTransferConfigItems,
  getPeriodEndBalanceByCode,
  revokeAutoTransferVoucher,
  validateAutoTransferPeriod,
  validateAutoTransferRevoke,
} from '../src/services/autoTransfer.ts'

function createMockDb() {
  const runs: Array<{ sql: string; args: any[] }> = []
  const gets = new Map<string, any>()

  return {
    runs,
    gets,
    prepare(sql: string) {
      return {
        run: (...args: any[]) => {
          runs.push({ sql, args })
        },
        get: (...args: any[]) => gets.get(`${sql}::${JSON.stringify(args)}`),
        all: (...args: any[]) => gets.get(`${sql}::${JSON.stringify(args)}`) || [],
      }
    },
    exec: (sql: string) => {
      runs.push({ sql, args: [] })
    },
    transaction<T extends (...args: any[]) => void>(fn: T) {
      return (...args: Parameters<T>) => fn(...args)
    },
  }
}

function setMockGet(db: ReturnType<typeof createMockDb>, sql: string, args: any[], value: any) {
  db.gets.set(`${sql}::${JSON.stringify(args)}`, value)
}

function testVoucherPostingValidation() {
  assert.equal(getRequireAuditEnabled({ param_value: 'true' }), true)
  assert.equal(getRequireAuditEnabled({ param_value: 'false' }), false)
  assert.equal(getRequireAuditEnabled(undefined), false)
  assert.equal(validateVoucherForUnpost({ id: '1', year: 2026, period: 4, status: 'posted' }), null)
  assert.equal(validateVoucherForUnpost({ id: '1', year: 2026, period: 4, status: 'audited' }), '只有已记账的凭证可以反记账')
  assert.equal(validateVoucherForUnpost(undefined), '只有已记账的凭证可以反记账')

  const entryLoadDb = {
    prepare(sql: string) {
      return {
        all: (...args: any[]) => [{ sql, args, id: 'entry-1' }],
      }
    },
  }
  assert.deepEqual(loadVoucherEntries(entryLoadDb, 'voucher-1'), [
    { sql: 'SELECT * FROM voucher_entries WHERE voucher_id=?', args: ['voucher-1'], id: 'entry-1' },
  ])

  assert.equal(validateVoucherCanPost({ id: '1', year: 2026, period: 4, status: 'draft' }, true, false), '该凭证尚未审核，不能记账')
  assert.equal(validateVoucherCanPost({ id: '1', year: 2026, period: 4, status: 'draft' }, true, true), null)
  assert.equal(validateVoucherCanPost({ id: '1', year: 2026, period: 4, status: 'posted' }, false, false), '该凭证已记账')
  assert.equal(validateVoucherCanPost({ id: '1', year: 2026, period: 4, status: 'audited' }, true, false), null)
  assert.equal(getVoucherStatusAfterUnpost(true), 'audited')
  assert.equal(getVoucherStatusAfterUnpost(false), 'draft')
}

function testVoucherPostingPersistence() {
  const db = createMockDb()
  applyVoucherPosting(
    db,
    { id: 'voucher-1', year: 2026, period: 4, status: 'audited' },
    [
      { account_id: 'a1', account_code: '1001', account_name: '库存现金', direction: 'debit', amount: 100 },
      { account_id: 'a2', account_code: '4001', account_name: '财政拨款收入', direction: 'credit', amount: 100 },
    ],
    { accountSetId: 'set-1', userId: 'u1', userName: 'tester', requireAudit: true }
  )

  const voucherUpdate = db.runs.find(entry => entry.sql.includes('UPDATE vouchers SET status=?'))
  assert.ok(voucherUpdate)
  assert.deepEqual(voucherUpdate?.args, ['posted', 'u1', 'tester', 'voucher-1'])

  const balanceWrites = db.runs.filter(entry => entry.sql.includes('INSERT INTO account_balances'))
  assert.equal(balanceWrites.length, 2)
  assert.equal(balanceWrites[0]?.args[8], 100)
  assert.equal(balanceWrites[0]?.args[9], 0)
  assert.equal(balanceWrites[1]?.args[8], 0)
  assert.equal(balanceWrites[1]?.args[9], 100)
}

function testVoucherUnpostPersistence() {
  const db = createMockDb()
  applyVoucherUnpost(
    db,
    { id: 'voucher-2', year: 2026, period: 4, status: 'posted' },
    [{ account_id: 'a1', account_code: '1001', account_name: '库存现金', direction: 'debit', amount: 88 }],
    { accountSetId: 'set-1', requireAudit: true }
  )

  const balanceRevert = db.runs.find(entry => entry.sql.includes('UPDATE account_balances SET current_debit'))
  assert.ok(balanceRevert)
  assert.deepEqual(balanceRevert?.args, [88, 0, 'set-1', 'a1', 2026, 4])

  const voucherUpdate = db.runs.find(entry => entry.sql.includes('UPDATE vouchers SET status=?'))
  assert.ok(voucherUpdate)
  assert.deepEqual(voucherUpdate?.args, ['audited', 'voucher-2'])
}

function testReportBalanceHelpers() {
  const db = createMockDb()
  const initSql = `
      SELECT SUM(ib.init_balance) as init_balance, a.direction FROM init_balances ib
      JOIN accounts a ON a.id = ib.account_id
      WHERE ib.account_set_id=? AND (a.code=? OR a.code LIKE ?) AND ib.year=?
      GROUP BY a.direction
    `
  const periodSql = `
      SELECT SUM(ab.current_debit) as current_debit, SUM(ab.current_credit) as current_credit, a.direction FROM account_balances ab
      JOIN accounts a ON a.id = ab.account_id
      WHERE ab.account_set_id=? AND (a.code=? OR a.code LIKE ?) AND ab.year=? AND ab.period<=?
      GROUP BY a.direction
    `
  const sumSql = `
      SELECT
        SUM(ab.current_debit) as total_debit,
        SUM(ab.current_credit) as total_credit
      FROM account_balances ab
      JOIN accounts a ON a.id = ab.account_id
      WHERE ab.account_set_id=? AND a.code LIKE ? AND ab.year=? AND ab.period<=?
    `

  setMockGet(db, initSql, ['set-1', '1001', '1001%', 2026], { init_balance: 50, direction: 'debit' })
  setMockGet(db, periodSql, ['set-1', '1001', '1001%', 2026, 4], { current_debit: 120, current_credit: 20, direction: 'debit' })
  setMockGet(db, sumSql, ['set-1', '1001%', 2026, 4], { total_debit: 120, total_credit: 20 })

  assert.equal(getBalance(db, 'set-1', '1001', 2026, 4), 150)
  assert.deepEqual(getPeriodSum(db, 'set-1', '1001', 2026, 4), { debit: 120, credit: 20 })
  assert.equal(getBalance(db, 'set-1', '9999', 2026, 4), 0)
}

function testQueryBuilders() {
  const voucherListQuery = buildVoucherListQuery({
    accountSetId: 'set-1',
    page: 2,
    pageSize: 25,
    year: '2026',
    period: '4',
    status: 'audited',
    keyword: '办公',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    accountId: 'acc-1',
    auditorId: 'auditor-1',
  })
  assert.match(voucherListQuery.countSql, /COUNT\(DISTINCT v\.id\)/)
  assert.match(voucherListQuery.listSql, /ORDER BY v\.voucher_date DESC, v\.voucher_no ASC/)
  assert.deepEqual(voucherListQuery.countParams, [
    'set-1',
    2026,
    4,
    'audited',
    '2026-04-01',
    '2026-04-30',
    'auditor-1',
    '%办公%',
    '%办公%',
    '%办公%',
    'acc-1',
  ])
  assert.deepEqual(voucherListQuery.listParams, [...voucherListQuery.countParams, 25, 25])

  const batchVoucherQuery = buildBatchVoucherQuery({
    voucherTypeIds: ['type-1', 'type-2'],
    accountSetId: 'set-1',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    startNo: '10',
    endNo: '99',
  })
  assert.match(batchVoucherQuery.sql, /voucher_type_id IN \(\?,\?\)/)
  assert.match(batchVoucherQuery.sql, /ORDER BY voucher_date ASC, voucher_no ASC/)
  assert.deepEqual(batchVoucherQuery.params, ['set-1', 'type-1', 'type-2', '2026-04-01', '2026-04-30', 10, 99])

  const ledgerDetailQuery = buildLedgerDetailQuery({
    accountSetId: 'set-1',
    year: '2026',
    period: '4',
    accountId: 'acc-1',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    auxType: 'project',
    auxId: 'proj-9',
    page: 3,
    pageSize: 50,
  })
  assert.match(ledgerDetailQuery.initBalanceSql, /FROM init_balances ib/)
  assert.match(ledgerDetailQuery.listSql, /ve\.project_id = \?/)
  assert.match(ledgerDetailQuery.listSql, /LIMIT \? OFFSET \?/)
  assert.deepEqual(ledgerDetailQuery.initBalanceParams, [
    'set-1',
    'acc-1',
    2026,
    'set-1',
    'set-1',
    '2026-01-01',
    '2026-04-01',
    'acc-1',
  ])
  assert.deepEqual(ledgerDetailQuery.listParams, ['set-1', 'acc-1', '2026-04-01', '2026-04-30', 'proj-9', 50, 100])

  const chronologicalQuery = buildChronologicalQuery({
    accountSetId: 'set-1',
    year: 2026,
    period: 4,
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    page: 2,
    pageSize: 30,
  })
  assert.match(chronologicalQuery.countSql, /SELECT COUNT\(\*\) as count FROM vouchers v WHERE/)
  assert.match(chronologicalQuery.listSql, /LEFT JOIN voucher_types vt/)
  assert.deepEqual(chronologicalQuery.countParams, ['set-1', 2026, 4, '2026-04-01', '2026-04-30'])
  assert.deepEqual(chronologicalQuery.listParams, ['set-1', 2026, 4, '2026-04-01', '2026-04-30', 30, 30])
}

function testSystemQueryBuilders() {
  const usersQuery = buildSystemUsersQuery({
    currentAccountSetId: 'set-current',
    accountSetId: 'set-target',
  })
  assert.match(usersQuery.sql, /FROM users u/)
  assert.match(usersQuery.sql, /WHERE u\.account_set_id = \?/)
  assert.deepEqual(usersQuery.params, ['set-target'])

  const logsQuery = buildSystemLogsQuery({
    accountSetId: 'set-1',
    page: 3,
    pageSize: 20,
    userId: 'user-9',
    action: '删除',
    module: '系统管理',
    ipAddress: '192.168',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
  })
  assert.match(logsQuery.countSql, /SELECT COUNT\(\*\) as count FROM operation_logs WHERE/)
  assert.match(logsQuery.listSql, /ORDER BY created_at DESC/)
  assert.match(logsQuery.listSql, /LIMIT \? OFFSET \?/)
  assert.deepEqual(logsQuery.countParams, [
    'set-1',
    'user-9',
    '%删除%',
    '系统管理',
    '%192.168%',
    '2026-04-01',
    '2026-04-30 23:59:59',
  ])
  assert.deepEqual(logsQuery.listParams, [...logsQuery.countParams, 20, 40])
}

function testReportQueryBuilders() {
  const aiSummaryEntries = [
    { account_name: '库存现金', direction: 'debit' as const, amount: 100 },
    { account_name: '财政拨款收入', direction: 'credit' as const, amount: 100 },
  ]

  assert.equal(getAuxBalanceField('dept'), 've.dept_id')
  assert.equal(getAuxBalanceField('project'), 've.project_id')
  assert.equal(getAuxBalanceField('unknown'), undefined)
  assert.equal(isAiSummaryEnabled({ enabled: 1, api_key: 'key-1' }), true)
  assert.equal(isAiSummaryEnabled({ enabled: 0, api_key: 'key-1' }), false)
  assert.equal(isAiSummaryEnabled({ enabled: 1, api_key: '' }), false)
  assert.equal(
    buildAiSummaryEntryText(aiSummaryEntries),
    '库存现金: 借 100\n财政拨款收入: 贷 100'
  )
  assert.deepEqual(buildAiSummaryRequestBody({ model: null, entryText: '库存现金: 借 100' }), {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: '你是一个财务助手，根据凭证分录生成简洁的中文业务摘要（10个字以内）。',
      },
      { role: 'user', content: '根据以下凭证分录生成摘要：\n库存现金: 借 100' },
    ],
    max_tokens: 50,
    temperature: 0.3,
  })
  assert.equal(getAiSummaryApiUrl({ api_url: 'https://example.com/chat' }), 'https://example.com/chat')
  assert.equal(getAiSummaryApiUrl({}), 'https://api.openai.com/v1/chat/completions')
  assert.equal(extractAiSummary({ choices: [{ message: { content: ' 收款业务 ' } }] }), '收款业务')
  assert.equal(extractAiSummary({}), '业务发生')
  assert.equal(validateVoucherEntryCount(aiSummaryEntries), null)
  assert.equal(validateVoucherEntryCount([]), '凭证日期和分录不能为空')
  assert.equal(getVoucherBalanceError(aiSummaryEntries as any), null)
  assert.equal(
    getVoucherBalanceError([
      ...aiSummaryEntries,
      { account_name: '业务活动费用', direction: 'debit' as const, amount: 1, account_id: 'a3', account_code: '5001' },
    ] as any),
    '借贷不平衡: 借方101 != 贷方100'
  )
  assert.equal(getVoucherUpdateBalanceError(aiSummaryEntries as any), null)
  assert.equal(
    getVoucherUpdateBalanceError([
      ...aiSummaryEntries,
      { account_name: '业务活动费用', direction: 'debit' as const, amount: 1, account_id: 'a3', account_code: '5001' },
    ] as any),
    '借贷不平衡'
  )

  const auxBalanceQuery = buildAuxBalanceQuery({
    accountSetId: 'set-1',
    year: 2026,
    period: 4,
    auxField: 've.func_class_id',
  })
  assert.match(auxBalanceQuery.sql, /ve\.func_class_id as aux_id/)
  assert.match(auxBalanceQuery.sql, /AND ve\.func_class_id IS NOT NULL/)
  assert.match(auxBalanceQuery.sql, /GROUP BY ve\.func_class_id, ve\.account_code/)
  assert.deepEqual(auxBalanceQuery.params, ['set-1', 2026, 4])
}

function testVoucherEntryHelpers() {
  const entries = [
    { account_id: 'a1', account_code: '1001', account_name: '库存现金', direction: 'debit' as const, amount: 120, summary: '收款', dept_id: 'dept-1' },
    { account_id: 'a2', account_code: '4001', account_name: '财政拨款收入', direction: 'credit' as const, amount: 120, summary: '收款' },
  ]

  assert.deepEqual(calculateVoucherTotals(entries), { debitTotal: 120, creditTotal: 120 })
  assert.equal(isVoucherBalanced(entries), true)
  assert.equal(
    isVoucherBalanced([
      ...entries,
      { account_id: 'a3', account_code: '5001', account_name: '业务活动费用', direction: 'debit' as const, amount: 1 },
    ]),
    false
  )

  const payloads = buildVoucherEntryPayloads({
    accountSetId: 'set-1',
    voucherId: 'voucher-1',
    entries: [
      {
        account_id: 'a1',
        account_code: '1001',
        account_name: '库存现金',
        direction: 'debit',
        amount: 120,
        summary: '收款',
        dept_id: 'dept-1',
        _project_id: 'proj-1',
      },
    ],
    categories: [
      { id: 'cat-1', code: 'project' },
      { id: 'cat-2', code: 'dept' },
    ],
    itemMap: {
      'proj-1': { id: 'proj-1', name: '项目一' },
      'dept-1': { id: 'dept-1', name: '办公室' },
    },
  })

  assert.equal(payloads.length, 1)
  assert.equal(payloads[0][1], 'set-1')
  assert.equal(payloads[0][2], 'voucher-1')
  assert.equal(payloads[0][10], 'dept-1')
  assert.equal(payloads[0][20], '{"project":{"id":"proj-1","name":"项目一"}}')

  const replaceDb = createMockDb()
  replaceVoucherEntries({
    db: replaceDb,
    accountSetId: 'set-1',
    voucherId: 'voucher-2',
    entries: [
      {
        account_id: 'a1',
        account_code: '1001',
        account_name: '库存现金',
        direction: 'debit',
        amount: 88,
        summary: '更新分录',
        dept_id: 'dept-1',
        _project_id: 'proj-1',
      },
    ],
    categories: [
      { id: 'cat-1', code: 'project' },
      { id: 'cat-2', code: 'dept' },
    ],
    itemMap: {
      'proj-1': { id: 'proj-1', name: '项目一' },
      'dept-1': { id: 'dept-1', name: '办公室' },
    },
  })
  assert.deepEqual(replaceDb.runs[0], {
    sql: 'DELETE FROM voucher_entries WHERE voucher_id=?',
    args: ['voucher-2'],
  })
  assert.match(replaceDb.runs[1]?.sql, /INSERT INTO voucher_entries/)
  assert.equal(replaceDb.runs[1]?.args[1], 'set-1')
  assert.equal(replaceDb.runs[1]?.args[2], 'voucher-2')
  assert.equal(replaceDb.runs[1]?.args[20], '{"project":{"id":"proj-1","name":"项目一"}}')

  assert.deepEqual(buildVoucherEntriesMap([
    { voucher_id: 'v1', id: 'e1', amount: 10 },
    { voucher_id: 'v1', id: 'e2', amount: 20 },
    { voucher_id: 'v2', id: 'e3', amount: 30 },
  ]), {
    v1: [
      { voucher_id: 'v1', id: 'e1', amount: 10 },
      { voucher_id: 'v1', id: 'e2', amount: 20 },
    ],
    v2: [{ voucher_id: 'v2', id: 'e3', amount: 30 }],
  })
  assert.deepEqual(
    attachVoucherEntries(
      [{ id: 'v1', voucher_no: '记-001' }, { id: 'v3', voucher_no: '记-003' }],
      { v1: [{ id: 'e1' }] }
    ),
    [
      { id: 'v1', voucher_no: '记-001', entries: [{ id: 'e1' }] },
      { id: 'v3', voucher_no: '记-003', entries: [] },
    ]
  )

  assert.equal(calculateNewBalance({ currentBalance: 100, amount: 30, accountDirection: 'debit' }), 70)
  assert.equal(calculateNewBalance({ currentBalance: 100, amount: 30, accountDirection: 'credit' }), 130)
  assert.match(
    validateVoucherEntriesNoNegativeBalance({
      entries: [{ account_id: 'a1', account_code: '1001', account_name: '库存现金', direction: 'credit', amount: 120 }],
      getAccountById: accountId =>
        accountId === 'a1' ? { no_negative: 1, direction: 'debit' } : null,
      getBalanceByAccountId: accountId => (accountId === 'a1' ? 100 : 0),
    })?.message || '',
    /库存现金/
  )
  assert.equal(
    validateVoucherEntriesNoNegativeBalance({
      entries: [{ account_id: 'a1', account_code: '1001', account_name: '库存现金', direction: 'credit', amount: 50 }],
      getAccountById: accountId =>
        accountId === 'a1' ? { no_negative: 1, direction: 'debit' } : null,
      getBalanceByAccountId: () => 100,
    }),
    null
  )

  assert.deepEqual(buildAuxItemMap([{ id: 'item-1', name: '项目一' }, { id: 'item-2', name: '部门A' }]), {
    'item-1': { id: 'item-1', name: '项目一' },
    'item-2': { id: 'item-2', name: '部门A' },
  })

  const auxiliaryDb = {
    prepare(sql: string) {
      return {
        all: (...args: any[]) => {
          if (sql === 'SELECT id, code FROM aux_categories WHERE account_set_id=?') {
            return [{ id: 'cat-1', code: 'project' }]
          }
          if (sql === 'SELECT id, type, name FROM aux_items WHERE account_set_id=?') {
            return [{ id: 'item-1', type: 'project', name: '项目一' }]
          }
          return [{ sql, args }]
        },
      }
    },
  }
  assert.deepEqual(loadVoucherAuxiliaryData({ db: auxiliaryDb, accountSetId: 'set-1' }), {
    categories: [{ id: 'cat-1', code: 'project' }],
    itemMap: {
      'item-1': { id: 'item-1', type: 'project', name: '项目一' },
    },
  })

  assert.equal(validateVoucherForAudit(null, 'u1'), '凭证不存在')
  assert.equal(validateVoucherForAudit({ status: 'audited', maker_id: 'u2' }, 'u1'), '只能审核草稿状态的凭证')
  assert.equal(validateVoucherForAudit({ status: 'draft', maker_id: 'u1' }, 'u1'), '制单人和审核人不能为同一人')
  assert.equal(validateVoucherForAudit({ status: 'draft', maker_id: 'u2' }, 'u1'), null)

  const singleAuditDb = createMockDb()
  applyVoucherAudit({ db: singleAuditDb, voucherId: 'voucher-10', userId: 'u1', userName: '审核员A' })
  assert.match(singleAuditDb.runs[0]?.sql, /UPDATE vouchers SET status=\?, auditor_id=\?, auditor_name=\?, updated_at=datetime\('now'\) WHERE id=\?/)
  assert.deepEqual(singleAuditDb.runs[0]?.args, ['audited', 'u1', '审核员A', 'voucher-10'])

  assert.equal(validateVoucherForUnAudit({ status: 'posted' }), '已记账凭证无法反审核')
  assert.equal(validateVoucherForUnAudit({ status: 'audited' }), null)
  assert.equal(validateVoucherForUnAudit(undefined), null)

  const singleUnAuditDb = createMockDb()
  applyVoucherUnAudit({ db: singleUnAuditDb, voucherId: 'voucher-11' })
  assert.match(singleUnAuditDb.runs[0]?.sql, /UPDATE vouchers SET status=\?, auditor_id=NULL, auditor_name=NULL, updated_at=datetime\('now'\) WHERE id=\?/)
  assert.deepEqual(singleUnAuditDb.runs[0]?.args, ['draft', 'voucher-11'])

  const voucherTypeDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => ({ sql, args, id: 'type-default' }),
      }
    },
  }
  assert.equal(getEffectiveVoucherTypeId({ db: voucherTypeDb, accountSetId: 'set-1', voucherTypeId: 'type-1' }), 'type-1')
  assert.equal(getEffectiveVoucherTypeId({ db: voucherTypeDb, accountSetId: 'set-1' }), 'type-default')
  assert.equal(buildVoucherNo({ maxNo: 9 }), '10')
  assert.equal(buildVoucherNo({ maxNo: undefined }), '1')

  const nextVoucherNoDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql.includes('SELECT id FROM voucher_types')) {
            return { id: 'type-default' }
          }
          return { max_no: 15, sql, args }
        },
      }
    },
  }
  assert.deepEqual(getNextVoucherNo({
    db: nextVoucherNoDb,
    accountSetId: 'set-1',
    year: 2026,
    period: 4,
    voucherTypeId: null,
  }), {
    effectiveTypeId: 'type-default',
    typeName: null,
    voucherNo: '202604-0016',
  })

  assert.equal(isPostedVoucher({ status: 'posted' }), true)
  assert.equal(isPostedVoucher({ status: 'draft' }), false)
  assert.equal(isPostedVoucher(undefined), false)

  const voucherGetDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => ({ sql, args, id: 'voucher-77' }),
      }
    },
  }
  assert.deepEqual(getVoucherById({ db: voucherGetDb, voucherId: 'voucher-77' }), {
    sql: 'SELECT * FROM vouchers WHERE id=?',
    args: ['voucher-77'],
    id: 'voucher-77',
  })

  const voucherDetailDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql.includes('LEFT JOIN voucher_types')) {
            return { sql, args, id: 'voucher-88', voucher_type_name: '记账凭证' }
          }
          return null
        },
        all: (...args: any[]) => [{ sql, args, id: 'entry-88', seq: 1 }],
      }
    },
  }
  assert.deepEqual(getVoucherDetail({ db: voucherDetailDb, voucherId: 'voucher-88' }), {
    sql: 'SELECT v.*, vt.name as voucher_type_name FROM vouchers v LEFT JOIN voucher_types vt ON v.voucher_type_id=vt.id WHERE v.id=?',
    args: ['voucher-88'],
    id: 'voucher-88',
    voucher_type_name: '记账凭证',
    entries: [{ sql: 'SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq', args: ['voucher-88'], id: 'entry-88', seq: 1 }],
  })
  assert.equal(getVoucherDetail({
    db: {
      prepare() {
        return {
          get: () => null,
          all: () => [],
        }
      },
    },
    voucherId: 'missing',
  }), null)

  const voucherWithTypeDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => ({ sql, args, id: 'voucher-89', voucher_type_name: '收款凭证' }),
      }
    },
  }
  assert.deepEqual(getVoucherWithTypeById({ db: voucherWithTypeDb, voucherId: 'voucher-89' }), {
    sql: 'SELECT v.*, vt.name as voucher_type_name FROM vouchers v LEFT JOIN voucher_types vt ON v.voucher_type_id=vt.id WHERE v.id=?',
    args: ['voucher-89'],
    id: 'voucher-89',
    voucher_type_name: '收款凭证',
  })

  const periodDb = createMockDb()
  const periodSql = 'SELECT * FROM period_closing WHERE account_set_id=? AND year=? AND period=?'
  setMockGet(periodDb, periodSql, ['set-1', 2026, 4], { id: 'pc-1', status: 'closed' })
  assert.deepEqual(getPeriodClosingRecord({
    db: periodDb,
    accountSetId: 'set-1',
    year: 2026,
    period: 4,
  }), { id: 'pc-1', status: 'closed' })
  assert.equal(isPeriodClosed({ status: 'closed' }), true)
  assert.equal(isPeriodClosed({ status: 'open' }), false)
  assert.equal(isPeriodClosed(undefined), false)

  const closeDb = createMockDb()
  closePeriod({
    db: closeDb,
    id: 'pc-2',
    accountSetId: 'set-1',
    year: 2026,
    period: 5,
    userId: 'u1',
  })
  assert.match(closeDb.runs[0]?.sql, /INSERT OR REPLACE INTO period_closing/)
  assert.deepEqual(closeDb.runs[0]?.args, ['pc-2', 'set-1', 2026, 5, 'u1'])

  const openDb = createMockDb()
  openPeriod({
    db: openDb,
    accountSetId: 'set-1',
    year: 2026,
    period: 5,
  })
  assert.equal(openDb.runs[0]?.sql, `UPDATE period_closing SET status='open' WHERE account_set_id=? AND year=? AND period=?`)
  assert.deepEqual(openDb.runs[0]?.args, ['set-1', 2026, 5])

  const periodStatusDb = {
    prepare(sql: string) {
      return {
        all: (...args: any[]) => [{ sql, args, period: 1, status: 'closed' }],
      }
    },
  }
  assert.deepEqual(listPeriodClosingStatus({
    db: periodStatusDb,
    accountSetId: 'set-1',
    year: 2026,
  }), [{
    sql: 'SELECT * FROM period_closing WHERE account_set_id=? AND year=? ORDER BY period',
    args: ['set-1', 2026],
    period: 1,
    status: 'closed',
  }])

  const batchFilters = getBatchVoucherFilters({
    voucher_type_ids: ['type-1', 'type-2'],
    start_date: '2026-04-01',
    end_date: '2026-04-30',
    start_no: '10',
    end_no: '20',
  })
  assert.deepEqual(batchFilters, {
    voucherTypeIds: ['type-1', 'type-2'],
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    startNo: '10',
    endNo: '20',
  })
  assert.equal(validateBatchVoucherFilters(batchFilters), true)
  assert.equal(validateBatchVoucherFilters({ voucherTypeIds: [], startDate: '2026-04-01', endDate: '2026-04-30' }), false)

  const batchQuery = getBatchVoucherQuery({
    voucherTypeIds: ['type-1', 'type-2'],
    accountSetId: 'set-1',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    startNo: '10',
    endNo: '20',
  })
  assert.match(batchQuery.sql, /voucher_type_id IN \(\?,\?\)/)
  assert.deepEqual(batchQuery.params, ['set-1', 'type-1', 'type-2', '2026-04-01', '2026-04-30', 10, 20])

  const loadBatchDraftDb = {
    prepare(sql: string) {
      return {
        all: (...args: any[]) => [
          { sql, args, id: 'v1', status: 'draft' },
          { sql, args, id: 'v2', status: 'posted' },
        ],
      }
    },
  }
  assert.deepEqual(
    loadBatchDraftVouchers({
      db: loadBatchDraftDb,
      accountSetId: 'set-1',
      filters: batchFilters,
    }).map(v => v.id),
    ['v1']
  )

  const loadBatchFilteredDb = {
    prepare(sql: string) {
      return {
        all: (...args: any[]) => [{ sql, args, id: 'voucher-2' }],
      }
    },
  }
  assert.deepEqual(loadBatchFilteredVouchers({
    db: loadBatchFilteredDb,
    accountSetId: 'set-1',
    filters: batchFilters,
  }), [{
    sql: batchQuery.sql,
    args: batchQuery.params,
    id: 'voucher-2',
  }])

  const batchLoadDb = {
    prepare(sql: string) {
      return {
        all: (...args: any[]) => [{ sql, args, id: 'voucher-1' }],
      }
    },
  }
  assert.deepEqual(loadBatchVouchers({
    db: batchLoadDb,
    query: { sql: 'SELECT * FROM vouchers WHERE account_set_id=?', params: ['set-1'] },
  }), [{ sql: 'SELECT * FROM vouchers WHERE account_set_id=?', args: ['set-1'], id: 'voucher-1' }])

  const draftQueryDb = createMockDb()
  const draftQuerySql = 'SELECT * FROM vouchers WHERE account_set_id=?'
  draftQueryDb.prepare = (sql: string) => ({
    run: (...args: any[]) => {
      draftQueryDb.runs.push({ sql, args })
    },
    get: (...args: any[]) => draftQueryDb.gets.get(`${sql}::${JSON.stringify(args)}`),
    all: (...args: any[]) => {
      if (sql === draftQuerySql && JSON.stringify(args) === JSON.stringify(['set-1'])) {
        return [
          { id: 'v1', status: 'draft', voucher_no: '记-001' },
          { id: 'v2', status: 'audited', voucher_no: '记-002' },
          { id: 'v3', status: 'draft', voucher_no: '记-003' },
        ]
      }
      return []
    },
  })
  assert.deepEqual(
    getBatchDraftVouchers({
      db: draftQueryDb,
      sql: draftQuerySql,
      params: ['set-1'],
    }).map(v => v.id),
    ['v1', 'v3']
  )

  assert.equal(findSelfMadeVoucher([{ maker_id: 'u1', voucher_no: '记-001' }, { maker_id: 'u2', voucher_no: '记-002' }], 'u2')?.voucher_no, '记-002')
  assert.equal(findSelfMadeVoucher([{ maker_id: 'u1', voucher_no: '记-001' }], 'u3'), undefined)

  assert.deepEqual(buildBatchAuditPreviewData([{ maker_id: 'u1', voucher_no: '记-001' }, { maker_id: 'u2', voucher_no: '记-002' }], 'u2'), {
    count: 2,
    blocked: true,
    blockedVoucherNo: '记-002',
    firstVoucherNo: '记-001',
    lastVoucherNo: '记-002',
  })

  const batchAuditDb = createMockDb()
  auditBatchVouchers({
    db: batchAuditDb,
    vouchers: [{ id: 'voucher-5' }, { id: 'voucher-6' }],
    userId: 'auditor-1',
    userName: '审核员',
  })
  assert.equal(batchAuditDb.runs.length, 2)
  assert.match(batchAuditDb.runs[0]?.sql, /UPDATE vouchers SET status=\?, auditor_id=\?, auditor_name=\?, updated_at=datetime\('now'\) WHERE id=\?/)
  assert.deepEqual(batchAuditDb.runs[0]?.args, ['audited', 'auditor-1', '审核员', 'voucher-5'])
  assert.deepEqual(batchAuditDb.runs[1]?.args, ['audited', 'auditor-1', '审核员', 'voucher-6'])

  assert.equal(findPostedVoucher([{ id: '1', status: 'draft' }, { id: '2', status: 'posted', voucher_no: '记-002' }])?.voucher_no, '记-002')
  assert.equal(findPostedVoucher([{ id: '1', status: 'draft' }]), undefined)

  assert.deepEqual(buildBatchDeletePreviewData([{ status: 'draft', voucher_no: '记-001' }, { status: 'posted', voucher_no: '记-002' }]), {
    count: 2,
    blocked: true,
    blockedVoucherNo: '记-002',
    firstVoucherNo: '记-001',
    lastVoucherNo: '记-002',
  })

  const batchDeleteDb = createMockDb()
  deleteBatchVouchers({
    db: batchDeleteDb,
    vouchers: [{ id: 'voucher-3' }, { id: 'voucher-4' }],
  })
  assert.deepEqual(batchDeleteDb.runs.map(entry => entry.sql), [
    'DELETE FROM voucher_entries WHERE voucher_id=?',
    'DELETE FROM vouchers WHERE id=?',
    'DELETE FROM voucher_entries WHERE voucher_id=?',
    'DELETE FROM vouchers WHERE id=?',
  ])
  assert.deepEqual(batchDeleteDb.runs.map(entry => entry.args), [['voucher-3'], ['voucher-3'], ['voucher-4'], ['voucher-4']])

  const deleteDb = createMockDb()
  deleteVoucherRecords(deleteDb, 'voucher-9')
  assert.deepEqual(deleteDb.runs.map(entry => entry.sql), [
    'DELETE FROM voucher_entries WHERE voucher_id=?',
    'DELETE FROM vouchers WHERE id=?',
  ])
  assert.deepEqual(deleteDb.runs.map(entry => entry.args), [['voucher-9'], ['voucher-9']])
}

function testReportTemplateExecutorFunctions() {
  const executed = executeTemplateSheets(
    [
      {
        id: 'sheet-1',
        report_definition_id: 'def-1',
        sheet_key: 'sheet1',
        sheet_name: '表1',
        sheet_index: 0,
        cells: [
          { id: 'n1', report_sheet_id: 'sheet-1', row_index: 0, col_index: 0, cell_type: 'number', text_value: '10', formula_text: null, format_text: null, style_key: null, side: null },
          { id: 'n2', report_sheet_id: 'sheet-1', row_index: 0, col_index: 1, cell_type: 'number', text_value: '3', formula_text: null, format_text: null, style_key: null, side: null },
          { id: 't1', report_sheet_id: 'sheet-1', row_index: 0, col_index: 2, cell_type: 'text', text_value: '=A1-B1', formula_text: null, format_text: null, style_key: null, side: null },
          { id: 't2', report_sheet_id: 'sheet-1', row_index: 0, col_index: 3, cell_type: 'text', text_value: '＝A1+B1', formula_text: null, format_text: null, style_key: null, side: null },
          { id: 'c3', report_sheet_id: 'sheet-1', row_index: 0, col_index: 4, cell_type: 'formula', text_value: null, formula_text: '=ye(1001,4)', format_text: null, style_key: null, side: null },
          { id: 'c4', report_sheet_id: 'sheet-1', row_index: 0, col_index: 5, cell_type: 'formula', text_value: null, formula_text: '=mjy(1001,4)+mdy(1001,4)', format_text: null, style_key: null, side: null },
          { id: 'c5', report_sheet_id: 'sheet-1', row_index: 0, col_index: 6, cell_type: 'formula', text_value: null, formula_text: '=mnj(1001)+mnd(1001)', format_text: null, style_key: null, side: null },
          { id: 'c6', report_sheet_id: 'sheet-1', row_index: 0, col_index: 7, cell_type: 'formula', text_value: null, formula_text: '=ye(1001,4)+nc(1001)', format_text: null, style_key: null, side: null },
          { id: 'c7', report_sheet_id: 'sheet-1', row_index: 0, col_index: 8, cell_type: 'formula', text_value: null, formula_text: '=Z99+1', format_text: null, style_key: null, side: null },
        ],
      },
    ],
    {
      db: {
        prepare(sql: string) {
          return {
            get: (...args: any[]) => {
              if (sql.includes('FROM accounts') && sql.includes('code = ?') && args[1] === '1001') {
                return { direction: 'debit' }
              }
              if (sql.includes('SUM(ib.init_balance)') && args[1] === '1001' && args[3] === 2026) {
                return { init_balance: 100, direction: 'debit' }
              }
              if (sql.includes('SUM(ab.current_debit) as current_debit') && args[1] === '1001' && args[4] === 4) {
                return { current_debit: 80, current_credit: 20, direction: 'debit' }
              }
              if (sql.includes('SUM(ab.current_debit) as current_debit') && args[1] === '1001' && args[4] === 0) {
                return { current_debit: 0, current_credit: 0, direction: 'debit' }
              }
              return null
            },
          }
        },
      },
      accountSetId: 'set-1',
      year: 2026,
      period: 4,
    }
  )

  const [sheet] = executed
  assert.ok(sheet)
  assert.equal(sheet.cells[2]?.status, 'ok')
  assert.equal(sheet.cells[2]?.numeric_value, 7)
  assert.equal(sheet.cells[3]?.numeric_value, 13)
  assert.equal(sheet.cells[4]?.numeric_value, 160)
  assert.equal(sheet.cells[5]?.numeric_value, 160)
  assert.equal(sheet.cells[6]?.numeric_value, 100)
  assert.equal(sheet.cells[7]?.numeric_value, 260)
  assert.equal(sheet.cells[8]?.numeric_value, 1)
}

function testAutoTransferHelpers() {
  assert.equal(AUTO_TRANSFER_TYPE, 'income-expense')
  assert.equal(getAutoTransferVoucherDate(2026, 4), '2026-04-30')
  assert.equal(buildAutoTransferRemark(2026, 4), '2026年4期自动结转')
  assert.equal(getAutoTransferSummary(4, 'income'), '4月收入结转')
  assert.equal(getAutoTransferSummary(4, 'expense'), '4月费用结转')
  assert.equal(getAutoTransferSummary(4, 'balance'), '4月结转平衡')
  assert.equal(validateAutoTransferPeriod(2026, 4), null)
  assert.equal(validateAutoTransferPeriod(1999, 4), '年度必须为 2000-2100 之间的整数')
  assert.equal(validateAutoTransferPeriod(2101, 4), '年度必须为 2000-2100 之间的整数')
  assert.equal(validateAutoTransferPeriod(2026.5, 4), '年度必须为 2000-2100 之间的整数')
  assert.equal(validateAutoTransferPeriod(2026, 0), '期间必须为 1-12 月')
  assert.equal(validateAutoTransferPeriod(2026, 13), '期间必须为 1-12 月')
  assert.equal(validateAutoTransferPeriod(2026, 2.5), '期间必须为 1-12 月')

  const transferItemsDb = {
    prepare(sql: string) {
      return {
        all: (...args: any[]) => {
          if (sql.includes('FROM transfer_items')) {
            return [
              {
                id: 'ti-1',
                type_code: '01',
                summary: '结转6401',
                from_code: '6401',
                from_name: '业务活动费用',
                to_code: '3301',
                to_name: '本期盈余',
                transfer_type: 'all',
                ratio: null,
                sort_order: 1,
              },
            ]
          }
          return []
        },
      }
    },
  }
  assert.deepEqual(listTransferConfigItems({ db: transferItemsDb, accountSetId: 'set-1' }), [
    {
      id: 'ti-1',
      type_code: '01',
      summary: '结转6401',
      from_code: '6401',
      from_name: '业务活动费用',
      to_code: '3301',
      to_name: '本期盈余',
      transfer_type: 'all',
      ratio: null,
      sort_order: 1,
    },
  ])

  const balanceByCodeDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql.includes('FROM account_balances') && args[3] === '6401') {
            return {
              account_id: 'a1',
              account_code: '6401',
              account_name: '业务活动费用',
              end_balance: 321.35,
            }
          }
          return null
        },
      }
    },
  }
  assert.deepEqual(
    getPeriodEndBalanceByCode({
      db: balanceByCodeDb,
      accountSetId: 'set-1',
      year: 2026,
      period: 4,
      accountCode: '6401',
    }),
    {
      account_id: 'a1',
      account_code: '6401',
      account_name: '业务活动费用',
      end_balance: 321.35,
    }
  )

  const itemDrivenEntries = buildEntriesFromTransferItems({
    period: 4,
    items: [
      {
        id: 'ti-1',
        type_code: '01',
        summary: '结转6401',
        from_code: '6401',
        from_name: '业务活动费用',
        to_code: '3301',
        to_name: '本期盈余',
        transfer_type: 'all',
        ratio: null,
        sort_order: 1,
      },
      {
        id: 'ti-2',
        type_code: '01',
        summary: '按比例结转6402',
        from_code: '6402',
        from_name: '管理费用',
        to_code: '3301',
        to_name: '本期盈余',
        transfer_type: 'partial',
        ratio: 50,
        sort_order: 2,
      },
    ],
    accounts: [
      { id: 'a1', code: '6401', name: '业务活动费用', direction: 'debit' },
      { id: 'a2', code: '6402', name: '管理费用', direction: 'debit' },
      { id: 'a3', code: '3301', name: '本期盈余', direction: 'credit' },
    ],
    getBalanceByCode: (code: string) => {
      if (code === '6401') return { end_balance: 200 }
      if (code === '6402') return { end_balance: 80 }
      return null
    },
  })
  assert.equal(itemDrivenEntries.entries.length, 4)
  assert.equal(itemDrivenEntries.entries[0]?.account_code, '6401')
  assert.equal(itemDrivenEntries.entries[0]?.direction, 'credit')
  assert.equal(itemDrivenEntries.entries[0]?.amount, 200)
  assert.equal(itemDrivenEntries.entries[1]?.account_code, '3301')
  assert.equal(itemDrivenEntries.entries[1]?.direction, 'debit')
  assert.equal(itemDrivenEntries.entries[2]?.amount, 40)
  assert.equal(itemDrivenEntries.transferredOutTotal, 240)
  assert.equal(itemDrivenEntries.transferredInTotal, 240)

  const runDb = createMockDb()
  const runSql = `SELECT atr.*, v.voucher_no, v.status, v.voucher_date
       FROM auto_transfer_runs atr
       LEFT JOIN vouchers v ON v.id = atr.voucher_id
       WHERE atr.account_set_id=? AND atr.year=? AND atr.period=? AND atr.transfer_type=?`
  setMockGet(runDb, runSql, ['set-1', 2026, 4, 'income-expense'], { id: 'run-1', voucher_no: '202604-0001' })
  assert.deepEqual(getAutoTransferRun({ db: runDb, accountSetId: 'set-1', year: 2026, period: 4 }), {
    id: 'run-1',
    voucher_no: '202604-0001',
  })

  const statusDb = createMockDb()
  const periodSql = 'SELECT * FROM period_closing WHERE account_set_id=? AND year=? AND period=?'
  setMockGet(statusDb, periodSql, ['set-1', 2026, 4], { id: 'pc-1', status: 'closed' })
  setMockGet(statusDb, runSql, ['set-1', 2026, 4, 'income-expense'], { id: 'run-2' })
  assert.deepEqual(getAutoTransferStatus({ db: statusDb, accountSetId: 'set-1', year: 2026, period: 4 }), {
    closed: true,
    existingRun: { id: 'run-2' },
    alreadyGenerated: true,
    canRevoke: false,
  })

  const revocableStatusDb = createMockDb()
  setMockGet(revocableStatusDb, periodSql, ['set-1', 2026, 5], null)
  setMockGet(revocableStatusDb, runSql, ['set-1', 2026, 5, 'income-expense'], {
    id: 'run-revocable',
    voucher_id: 'voucher-1',
    voucher_no: '记-001',
    status: 'draft',
    voucher_date: '2026-05-31',
  })
  assert.deepEqual(getAutoTransferStatus({ db: revocableStatusDb, accountSetId: 'set-1', year: 2026, period: 5 }), {
    closed: false,
    existingRun: {
      id: 'run-revocable',
      voucher_id: 'voucher-1',
      voucher_no: '记-001',
      status: 'draft',
      voucher_date: '2026-05-31',
    },
    alreadyGenerated: true,
    canRevoke: true,
  })

  const postedStatusDb = createMockDb()
  setMockGet(postedStatusDb, periodSql, ['set-1', 2026, 6], null)
  setMockGet(postedStatusDb, runSql, ['set-1', 2026, 6, 'income-expense'], {
    id: 'run-posted',
    voucher_id: 'voucher-2',
    voucher_no: '记-002',
    status: 'posted',
    voucher_date: '2026-06-30',
  })
  assert.equal(getAutoTransferStatus({ db: postedStatusDb, accountSetId: 'set-1', year: 2026, period: 6 }).canRevoke, true)

  const configuredTypeDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql.includes("param_key='auto_transfer:voucher_type_id'")) {
            return { param_value: 'type-configured' }
          }
          if (sql === 'SELECT id FROM voucher_types WHERE id=? AND (account_set_id=? OR account_set_id IS NULL)') {
            return { id: 'type-configured', args }
          }
          if (sql.includes('ORDER BY account_set_id DESC, sort_order ASC LIMIT 1')) {
            return { id: 'type-fallback', args }
          }
          return null
        },
      }
    },
  }
  assert.equal(getAutoTransferVoucherTypeId({ db: configuredTypeDb, accountSetId: 'set-1' }), 'type-configured')

  const invalidConfiguredTypeDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql.includes("param_key='auto_transfer:voucher_type_id'")) {
            return { param_value: 'type-missing' }
          }
          if (sql === 'SELECT id FROM voucher_types WHERE id=? AND (account_set_id=? OR account_set_id IS NULL)') {
            return null
          }
          if (sql.includes('ORDER BY account_set_id DESC, sort_order ASC LIMIT 1')) {
            return { id: 'type-fallback', args }
          }
          return null
        },
      }
    },
  }
  assert.equal(getAutoTransferVoucherTypeId({ db: invalidConfiguredTypeDb, accountSetId: 'set-1' }), 'type-fallback')

  const emptyConfiguredTypeDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql.includes("param_key='auto_transfer:voucher_type_id'")) {
            return null
          }
          if (sql.includes('ORDER BY account_set_id DESC, sort_order ASC LIMIT 1')) {
            return { id: 'type-default', args }
          }
          return null
        },
      }
    },
  }
  assert.equal(getAutoTransferVoucherTypeId({ db: emptyConfiguredTypeDb, accountSetId: 'set-1' }), 'type-default')

  const duplicateRunDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql === periodSql) return null
          if (sql === runSql) {
            if (args[0] === 'set-duplicate' && args[1] === 2026 && args[2] === 4 && args[3] === AUTO_TRANSFER_TYPE) {
              return { id: 'run-existing', voucher_no: '202604-0099', voucher_date: '2026-04-30' }
            }
            return null
          }
          if (sql.includes("param_key='auto_transfer:voucher_type_id'")) {
            return null
          }
          if (sql.includes('ORDER BY account_set_id DESC, sort_order ASC LIMIT 1')) {
            return { id: 'type-default' }
          }
          if (sql.includes('SELECT MAX(CAST(SUBSTR(voucher_no')) {
            return { max_no: 0 }
          }
          if (sql.includes('FROM account_balances') && args[3] === '6401') {
            return { account_id: 'a1', account_code: '6401', account_name: '业务活动费用', end_balance: 300 }
          }
          return null
        },
        all: (...args: any[]) => {
          if (sql === 'SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1 ORDER BY code ASC') {
            return [
              { id: 'a1', code: '6401', name: '业务活动费用', direction: 'debit' },
              { id: 'a3', code: '3301', name: '本期盈余', direction: 'credit' },
            ]
          }
          if (sql.includes('FROM transfer_items')) {
            return [
              {
                id: 'ti-1',
                type_code: '01',
                summary: '结转6401',
                from_code: '6401',
                from_name: '业务活动费用',
                to_code: '3301',
                to_name: '本期盈余',
                transfer_type: 'all',
                ratio: null,
                sort_order: 1,
              },
            ]
          }
          if (sql === 'SELECT id, code FROM aux_categories WHERE account_set_id=?') {
            return []
          }
          if (sql === 'SELECT id, type, name FROM aux_items WHERE account_set_id=?') {
            return []
          }
          return []
        },
        run: (...args: any[]) => {
          if (sql.includes('INSERT INTO auto_transfer_runs')) {
            const error = new Error('UNIQUE constraint failed: auto_transfer_runs.account_set_id, auto_transfer_runs.year, auto_transfer_runs.period, auto_transfer_runs.transfer_type') as Error & {
              code?: string
            }
            error.code = 'SQLITE_CONSTRAINT_UNIQUE'
            throw error
          }
        },
      }
    },
    transaction<T extends (...args: any[]) => any>(fn: T) {
      return (...args: Parameters<T>) => fn(...args)
    },
  }
  const duplicateRunResult = createAutoTransferVoucher({
    db: duplicateRunDb,
    accountSetId: 'set-duplicate',
    userId: 'u1',
    userName: 'tester',
    year: 2026,
    period: 4,
  })
  assert.equal(duplicateRunResult.error, '本期自动结转凭证已生成')
  assert.equal(duplicateRunResult.preview?.alreadyGenerated, true)
  assert.equal(duplicateRunResult.preview?.blockedReason, '本期自动结转凭证已生成')
  assert.equal(duplicateRunResult.preview?.existingRun?.id, 'run-existing')
  assert.equal(duplicateRunResult.preview?.entries.length, 0)

  const nonConstraintDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql === periodSql) return null
          if (sql === runSql) return null
          if (sql.includes("param_key='auto_transfer:voucher_type_id'")) {
            return null
          }
          if (sql.includes('ORDER BY account_set_id DESC, sort_order ASC LIMIT 1')) {
            return { id: 'type-default' }
          }
          if (sql.includes('SELECT MAX(CAST(SUBSTR(voucher_no')) {
            return { max_no: 0 }
          }
          if (sql.includes('FROM account_balances') && args[3] === '6401') {
            return { account_id: 'a1', account_code: '6401', account_name: '业务活动费用', end_balance: 300 }
          }
          return null
        },
        all: (...args: any[]) => {
          if (sql === 'SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1 ORDER BY code ASC') {
            return [
              { id: 'a1', code: '6401', name: '业务活动费用', direction: 'debit' },
              { id: 'a3', code: '3301', name: '本期盈余', direction: 'credit' },
            ]
          }
          if (sql.includes('FROM transfer_items')) {
            return [
              {
                id: 'ti-1',
                type_code: '01',
                summary: '结转6401',
                from_code: '6401',
                from_name: '业务活动费用',
                to_code: '3301',
                to_name: '本期盈余',
                transfer_type: 'all',
                ratio: null,
                sort_order: 1,
              },
            ]
          }
          if (sql === 'SELECT id, code FROM aux_categories WHERE account_set_id=?') {
            return []
          }
          if (sql === 'SELECT id, type, name FROM aux_items WHERE account_set_id=?') {
            return []
          }
          return []
        },
        run: (...args: any[]) => {
          if (sql.includes('INSERT INTO auto_transfer_runs')) {
            const error = new Error('boom') as Error & { code?: string }
            error.code = 'SQLITE_BUSY'
            throw error
          }
        },
      }
    },
    transaction<T extends (...args: any[]) => any>(fn: T) {
      return (...args: Parameters<T>) => fn(...args)
    },
  }
  assert.throws(
    () =>
      createAutoTransferVoucher({
        db: nonConstraintDb,
        accountSetId: 'set-busy',
        userId: 'u1',
        userName: 'tester',
        year: 2026,
        period: 4,
      }),
    /boom/
  )

  const previewDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql === periodSql) return null
          if (sql === runSql) return null
          if (sql.includes('FROM account_balances') && args[3] === '6401') {
            return { account_id: 'a1', account_code: '6401', account_name: '业务活动费用', end_balance: 300 }
          }
          return null
        },
        all: (...args: any[]) => {
          if (sql === 'SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1 ORDER BY code ASC') {
            return [
              { id: 'a1', code: '6401', name: '业务活动费用', direction: 'debit' },
              { id: 'a3', code: '3301', name: '本期盈余', direction: 'credit' },
            ]
          }
          if (sql.includes('FROM transfer_items')) {
            return [
              {
                id: 'ti-1',
                type_code: '01',
                summary: '结转6401',
                from_code: '6401',
                from_name: '业务活动费用',
                to_code: '3301',
                to_name: '本期盈余',
                transfer_type: 'all',
                ratio: null,
                sort_order: 1,
              },
            ]
          }
          return []
        },
      }
    },
  }
  const preview = buildAutoTransferPreview({ db: previewDb, accountSetId: 'set-1', year: 2026, period: 4 })
  assert.equal(preview.alreadyGenerated, false)
  assert.equal(preview.blockedReason, null)
  assert.equal(preview.entries.length, 2)
  assert.equal(preview.totals.debitTotal, 300)
  assert.equal(preview.totals.creditTotal, 300)
  assert.equal(preview.totals.incomeTotal, 300)
  assert.equal(preview.totals.expenseTotal, 300)

  const noConfigPreviewDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql === periodSql) return null
          if (sql === runSql) return null
          return null
        },
        all: (...args: any[]) => {
          if (sql === 'SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1 ORDER BY code ASC') {
            return [{ id: 'a1', code: '6401', name: '业务活动费用', direction: 'debit' }]
          }
          if (sql.includes('FROM transfer_items')) {
            return []
          }
          return []
        },
      }
    },
  }
  const noConfigPreview = buildAutoTransferPreview({
    db: noConfigPreviewDb,
    accountSetId: 'set-1',
    year: 2026,
    period: 4,
  })
  assert.equal(noConfigPreview.blockedReason, '未配置可执行的结转规则（请在结转类型维护中设置转出/转入科目）')
  assert.equal(noConfigPreview.entries.length, 0)

  const noDataPreviewDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql === periodSql) return null
          if (sql === runSql) return null
          if (sql.includes('FROM account_balances') && args[3] === '6401') {
            return { account_id: 'a1', account_code: '6401', account_name: '业务活动费用', end_balance: 0 }
          }
          return null
        },
        all: (...args: any[]) => {
          if (sql === 'SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1 ORDER BY code ASC') {
            return [
              { id: 'a1', code: '6401', name: '业务活动费用', direction: 'debit' },
              { id: 'a3', code: '3301', name: '本期盈余', direction: 'credit' },
            ]
          }
          if (sql.includes('FROM transfer_items')) {
            return [
              {
                id: 'ti-1',
                type_code: '01',
                summary: '结转6401',
                from_code: '6401',
                from_name: '业务活动费用',
                to_code: '3301',
                to_name: '本期盈余',
                transfer_type: 'all',
                ratio: null,
                sort_order: 1,
              },
            ]
          }
          return []
        },
      }
    },
  }
  const noDataPreview = buildAutoTransferPreview({ db: noDataPreviewDb, accountSetId: 'set-1', year: 2026, period: 4 })
  assert.equal(noDataPreview.blockedReason, '当前期间没有可结转的数据')
  assert.equal(noDataPreview.entries.length, 0)

  // ---- validateAutoTransferRevoke ----
  assert.equal(validateAutoTransferRevoke({ existingRun: null, closed: false }), '本期未生成自动结转凭证，无需撤销')
  assert.equal(validateAutoTransferRevoke({ existingRun: null, closed: true }), '本期未生成自动结转凭证，无需撤销')
  assert.equal(validateAutoTransferRevoke({ existingRun: { id: 'run-1', status: 'draft' }, closed: true }), '该期间已结账，不能撤销自动结转凭证')
  assert.equal(validateAutoTransferRevoke({ existingRun: { id: 'run-1', status: 'posted' }, closed: false }), null)
  assert.equal(validateAutoTransferRevoke({ existingRun: { id: 'run-1', status: 'draft' }, closed: false }), null)
  assert.equal(validateAutoTransferRevoke({ existingRun: { id: 'run-1', status: 'audited' }, closed: false }), null)

  // ---- revokeAutoTransferVoucher: no existing run ----
  const noRunRevokeDb = {
    prepare(sql: string) {
      return {
        get: (...args: any[]) => {
          if (sql === periodSql) return null
          if (sql === runSql) return null
          return null
        },
        all: () => [],
        run: () => {},
      }
    },
    transaction<T extends (...args: any[]) => any>(fn: T) {
      return (...args: Parameters<T>) => fn(...args)
    },
  }
  const noRunResult = revokeAutoTransferVoucher({ db: noRunRevokeDb, accountSetId: 'set-1', year: 2026, period: 4 })
  assert.equal(noRunResult.error, '本期未生成自动结转凭证，无需撤销')

  // ---- revokeAutoTransferVoucher: period closed ----
  const closedRevokeDb = createMockDb()
  setMockGet(closedRevokeDb, periodSql, ['set-1', 2026, 4], { id: 'pc-1', status: 'closed' })
  setMockGet(closedRevokeDb, runSql, ['set-1', 2026, 4, AUTO_TRANSFER_TYPE], { id: 'run-1', voucher_id: 'v-1', status: 'draft' })
  const closedResult = revokeAutoTransferVoucher({ db: closedRevokeDb, accountSetId: 'set-1', year: 2026, period: 4 })
  assert.equal(closedResult.error, '该期间已结账，不能撤销自动结转凭证')

  // ---- revokeAutoTransferVoucher: voucher already posted ----
  const postedRevokeDb = createMockDb()
  setMockGet(postedRevokeDb, periodSql, ['set-1', 2026, 4], null)
  setMockGet(postedRevokeDb, runSql, ['set-1', 2026, 4, AUTO_TRANSFER_TYPE], { id: 'run-1', voucher_id: 'v-1', status: 'posted', voucher_no: '202604-0001' })
  const postedResult = revokeAutoTransferVoucher({ db: postedRevokeDb, accountSetId: 'set-1', year: 2026, period: 4 })
  assert.equal(postedResult.error, null)

  // ---- revokeAutoTransferVoucher: success ----
  const successRevokeDb = createMockDb()
  setMockGet(successRevokeDb, periodSql, ['set-1', 2026, 4], null)
  setMockGet(successRevokeDb, runSql, ['set-1', 2026, 4, AUTO_TRANSFER_TYPE], { id: 'run-1', voucher_id: 'v-1', status: 'draft', voucher_no: '202604-0001' })
  const successResult = revokeAutoTransferVoucher({ db: successRevokeDb, accountSetId: 'set-1', year: 2026, period: 4 })
  assert.equal(successResult.error, null)
  assert.equal(successResult.voucherId, 'v-1')
  assert.equal(successResult.voucherNo, '202604-0001')
  const revokeRuns = successRevokeDb.runs
  assert.equal(revokeRuns.length, 6)
  assert.equal(revokeRuns[0].sql, 'BEGIN')
  assert.equal(revokeRuns[1].sql, 'DELETE FROM voucher_attachments WHERE voucher_id=?')
  assert.deepEqual(revokeRuns[1].args, ['v-1'])
  assert.equal(revokeRuns[2].sql, 'DELETE FROM voucher_entries WHERE voucher_id=?')
  assert.deepEqual(revokeRuns[2].args, ['v-1'])
  assert.equal(revokeRuns[3].sql, 'DELETE FROM auto_transfer_runs WHERE voucher_id=?')
  assert.deepEqual(revokeRuns[3].args, ['v-1'])
  assert.equal(revokeRuns[4].sql, 'DELETE FROM vouchers WHERE id=?')
  assert.deepEqual(revokeRuns[4].args, ['v-1'])
  assert.equal(revokeRuns[5].sql, 'COMMIT')
}

function run() {
  testVoucherPostingValidation()
  testVoucherPostingPersistence()
  testVoucherUnpostPersistence()
  testReportBalanceHelpers()
  testQueryBuilders()
  testSystemQueryBuilders()
  testReportQueryBuilders()
  testVoucherEntryHelpers()
  testReportTemplateExecutorFunctions()
  testAutoTransferHelpers()
  console.log('voucher/report/query service tests passed')
}

run()
