import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { buildWhereClause, SqlParam } from './baseValidation.js'
import { getAccountReportTemplateBlockReason } from './accountDeleteGuard.js'
import { DEFAULT_LIST_LIMIT, MAX_LIST_ALL, MAX_LIST_LIMIT } from '../utils/listLimits.js'
import {
  findDirectParentCodeByPrefix,
  getParentCodeByLevel,
  inferLevelByCodeLength,
} from '../utils/accountLevel.js'
import { accountHasAuxAccounting } from '../utils/auxItemId.js'

/**
 * 会计科目 Service 层
 * 将 SQL 逻辑从路由层抽离，提高可测试性和可维护性
 */

export interface Account {
  id: string
  account_set_id: string
  code: string
  name: string
  direction: string
  level: number
  parent_id: string | null
  is_aux: number
  aux_types: string | null
  is_enabled: number
  is_cash: number
  is_bank: number
  no_negative: number
  allow_delete: number
  created_at: string
  updated_at: string
}

export interface AccountQueryParams {
  account_set_id: string
  parent_id?: string
  keyword?: string
  direction?: string
  level?: number
  is_enabled?: number
  limit?: number
  offset?: number
  all?: boolean
}

export interface CreateAccountParams {
  account_set_id: string
  code: string
  name: string
  direction: string
  level?: number
  parent_id?: string | null
  is_aux?: boolean
  aux_types?: Record<string, string> | null
  is_enabled?: boolean
  is_cash?: boolean
  is_bank?: boolean
  no_negative?: boolean
  migrate_from_parent?: boolean
}

export interface UpdateAccountParams {
  name: string
  direction: string
  is_aux?: boolean
  aux_types?: Record<string, string> | null
  is_enabled?: boolean
  is_cash?: boolean
  is_bank?: boolean
  no_negative?: boolean
}

export interface AccountUsage {
  voucherCount: number
  balanceYears: number[]
  voucherYears: number[]
  years: number[]
  /** 直接期初记录数（aux_item_id=''） */
  initBalanceCount: number
  /** 辅助期初明细记录数（aux_item_id!=''） */
  auxInitCount: number
}

interface AccountCodeConfig {
  maxLevels: number
  codeLengths: number[]
}

export class AccountService {
  constructor(private db: Database.Database) {}

  /**
   * 获取系统参数
   */
  private getSystemParam(accountSetId: string, paramKey: string): string | null {
    const result = this.db
      .prepare(`
        SELECT param_value
        FROM system_params
        WHERE param_key = ?
          AND (account_set_id = ? OR account_set_id IS NULL)
        ORDER BY CASE WHEN account_set_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `)
      .get(paramKey, accountSetId, accountSetId) as any
    return result?.param_value || null
  }

  private getAccountCodeConfig(accountSetId: string): AccountCodeConfig {
    const accountLevelsStr = this.getSystemParam(accountSetId, 'account_levels')
    const accountCodeLengthsStr = this.getSystemParam(accountSetId, 'account_code_lengths')

    if (!accountCodeLengthsStr) {
      return { maxLevels: 6, codeLengths: [4, 2, 2, 2, 2, 2] }
    }

    try {
      const codeLengths = JSON.parse(accountCodeLengthsStr)
      if (!Array.isArray(codeLengths) || codeLengths.length === 0) {
        throw new Error('account_code_lengths invalid')
      }
      return {
        maxLevels: accountLevelsStr ? (parseInt(accountLevelsStr) || codeLengths.length) : codeLengths.length,
        codeLengths: codeLengths.map((len: any) => Number(len) || 0),
      }
    } catch {
      throw new Error('系统参数配置错误')
    }
  }

  private inferLevelByCodeLength(code: string, config: AccountCodeConfig): number | null {
    return inferLevelByCodeLength(code, config.codeLengths, config.maxLevels)
  }

  private getParentAccount(parentId: string, accountSetId: string): Account | null {
    return (
      (this.db
        .prepare('SELECT * FROM accounts WHERE id = ? AND account_set_id = ?')
        .get(parentId, accountSetId) as Account | undefined) || null
    )
  }

  /**
   * 验证科目编码格式
   */
  validateAccountCode(accountSetId: string, code: string, level: number): { valid: boolean; message?: string } {
    try {
      const config = this.getAccountCodeConfig(accountSetId)
      return this.validateCodeFormat(code, level, config.maxLevels, config.codeLengths)
    } catch (error: any) {
      return { valid: false, message: error.message || '系统参数配置错误' }
    }
  }

  /**
   * 验证编码格式
   */
  private validateCodeFormat(code: string, level: number, maxLevels: number, codeLengths: number[]): { valid: boolean; message?: string } {
    // 检查级数是否超过最大级数
    if (level > maxLevels) {
      return { valid: false, message: `科目级数不能超过${maxLevels}级` }
    }

    // 计算该级别科目应有的编码长度
    let expectedLength = 0
    for (let i = 0; i < level; i++) {
      expectedLength += codeLengths[i] || 0
    }

    // 检查编码长度
    if (code.length !== expectedLength) {
      const lengthDesc = codeLengths.slice(0, level).join('-')
      return { valid: false, message: `第${level}级科目编码长度应为${expectedLength}位（${lengthDesc}）` }
    }

    // 检查编码是否全为数字
    if (!/^\d+$/.test(code)) {
      return { valid: false, message: '科目编码只能包含数字' }
    }

    return { valid: true }
  }

  /**
   * 查询会计科目列表
   */
  getAccounts(params: AccountQueryParams): Account[] {
    const conditions = ['account_set_id = ?']
    const sqlParams: SqlParam[] = [params.account_set_id]

    if (params.parent_id) {
      conditions.push('parent_id = ?')
      sqlParams.push(params.parent_id)
    }

    if (params.keyword) {
      conditions.push('(name LIKE ? OR code LIKE ?)')
      const keywordPattern = `%${params.keyword}%`
      sqlParams.push(keywordPattern, `${params.keyword}%`)
    }

    if (params.direction) {
      conditions.push('direction = ?')
      sqlParams.push(params.direction)
    }

    if (params.level !== undefined) {
      conditions.push('level = ?')
      sqlParams.push(params.level)
    }

    if (params.is_enabled !== undefined) {
      conditions.push('is_enabled = ?')
      sqlParams.push(params.is_enabled)
    }

    const where = buildWhereClause(conditions)
    let limitClause = ''
    if (!params.all) {
      const limit = Math.min(params.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      const offset = Math.max(0, params.offset ?? 0)
      if (params.limit === undefined && !params.keyword && !params.parent_id) {
        // 未指定 limit 且无筛选：允许较大上限供树形科目页（仍 capped）
        limitClause = ` LIMIT ${MAX_LIST_ALL} OFFSET ${offset}`
      } else {
        limitClause = ` LIMIT ${limit} OFFSET ${offset}`
      }
    } else {
      limitClause = ` LIMIT ${MAX_LIST_ALL}`
    }
    const sql = `SELECT * FROM accounts${where} GROUP BY id ORDER BY code${limitClause}`
    return this.db.prepare(sql).all(...sqlParams) as Account[]
  }

  countAccounts(params: Omit<AccountQueryParams, 'limit' | 'offset' | 'all'>): number {
    const conditions = ['account_set_id = ?']
    const sqlParams: SqlParam[] = [params.account_set_id]

    if (params.parent_id) {
      conditions.push('parent_id = ?')
      sqlParams.push(params.parent_id)
    }
    if (params.keyword) {
      conditions.push('(name LIKE ? OR code LIKE ?)')
      const keywordPattern = `%${params.keyword}%`
      sqlParams.push(keywordPattern, `${params.keyword}%`)
    }
    if (params.direction) {
      conditions.push('direction = ?')
      sqlParams.push(params.direction)
    }
    if (params.level !== undefined) {
      conditions.push('level = ?')
      sqlParams.push(params.level)
    }
    if (params.is_enabled !== undefined) {
      conditions.push('is_enabled = ?')
      sqlParams.push(params.is_enabled)
    }

    const where = buildWhereClause(conditions)
    const row = this.db
      .prepare(`SELECT COUNT(DISTINCT id) as count FROM accounts${where}`)
      .get(...sqlParams) as { count: number }
    return row?.count ?? 0
  }

  /**
   * 根据 ID 获取科目
   */
  getAccountById(id: string): Account | null {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | null
  }

  /**
   * 检查科目编码是否存在
   */
  isCodeExists(accountSetId: string, code: string, excludeId?: string): boolean {
    if (excludeId) {
      const result = this.db
        .prepare('SELECT id FROM accounts WHERE account_set_id = ? AND code = ? AND id != ?')
        .get(accountSetId, code, excludeId)
      return !!result
    }
    const result = this.db
      .prepare('SELECT id FROM accounts WHERE account_set_id = ? AND code = ?')
      .get(accountSetId, code)
    return !!result
  }

  /**
   * 获取科目使用情况
   */
  getAccountUsage(accountId: string): AccountUsage {
    const voucherCount =
      (
        this.db
          .prepare('SELECT COUNT(*) as cnt FROM voucher_entries WHERE account_id = ?')
          .get(accountId) as any
      )?.cnt || 0

    const balanceYears = this.db
      .prepare('SELECT DISTINCT year FROM init_balances WHERE account_id = ? ORDER BY year DESC')
      .all(accountId) as any[]

    const voucherYearRows = this.db
      .prepare(
        'SELECT DISTINCT v.year FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ve.account_id = ? ORDER BY v.year DESC'
      )
      .all(accountId) as any[]

    const years = [
      ...new Set([...balanceYears.map(r => r.year), ...voucherYearRows.map(r => r.year)]),
    ].sort((a, b) => b - a)

    const initBalanceCount =
      (
        this.db
          .prepare(
            `SELECT COUNT(*) as cnt FROM init_balances WHERE account_id = ? AND aux_item_id = ''`
          )
          .get(accountId) as any
      )?.cnt || 0
    const auxInitCount =
      (
        this.db
          .prepare(
            `SELECT COUNT(*) as cnt FROM init_balances WHERE account_id = ? AND aux_item_id != ''`
          )
          .get(accountId) as any
      )?.cnt || 0

    return {
      voucherCount,
      balanceYears: balanceYears.map(r => r.year),
      voucherYears: voucherYearRows.map(r => r.year),
      years,
      initBalanceCount,
      auxInitCount,
    }
  }

  /**
   * 判断科目是否持有任何记账/期初数据或启用了辅助核算
   * 用于「新增第一个子科目时是否需要把父科目数据迁移到子科目」的判定
   */
  private accountHasMigratableData(account: Account): boolean {
    if (accountHasAuxAccounting(account)) return true
    const ve = this.db
      .prepare('SELECT COUNT(*) as cnt FROM voucher_entries WHERE account_id = ?')
      .get(account.id) as { cnt: number } | undefined
    if ((ve?.cnt || 0) > 0) return true
    const ib = this.db
      .prepare('SELECT COUNT(*) as cnt FROM init_balances WHERE account_id = ?')
      .get(account.id) as { cnt: number } | undefined
    if ((ib?.cnt || 0) > 0) return true
    const ab = this.db
      .prepare('SELECT COUNT(*) as cnt FROM account_balances WHERE account_id = ?')
      .get(account.id) as { cnt: number } | undefined
    if ((ab?.cnt || 0) > 0) return true
    return false
  }

  /**
   * 统计科目的所有子科目数量（递归）
   */
  countAllChildren(accountId: string): number {
    const children = this.db
      .prepare('SELECT id FROM accounts WHERE parent_id = ?')
      .all(accountId) as { id: string }[]

    let count = children.length
    for (const child of children) {
      count += this.countAllChildren(child.id)
    }
    return count
  }

  /**
   * 创建会计科目
   */
  createAccount(params: CreateAccountParams): string {
    const config = this.getAccountCodeConfig(params.account_set_id)
    const parent = params.parent_id
      ? this.getParentAccount(params.parent_id, params.account_set_id)
      : null

    if (params.parent_id && !parent) {
      throw new Error('上级科目不存在')
    }
    if (parent && !params.code.startsWith(parent.code)) {
      throw new Error('科目编码必须以上级科目编码开头')
    }

    const inferredLevel = parent ? Number(parent.level || 1) + 1 : this.inferLevelByCodeLength(params.code, config)
    if (!inferredLevel) {
      const lengthDesc = config.codeLengths.slice(0, config.maxLevels).join('-')
      throw new Error(`科目编码长度不符合当前科目长度设置（${lengthDesc}）`)
    }
    // 未选上级时，编码长度必须对应顶级科目；否则会产生“无父的非顶级科目”，导致分级混乱
    if (!parent && inferredLevel !== 1) {
      const topLength = config.codeLengths[0] || 0
      throw new Error(
        `该编码长度对应第${inferredLevel}级科目，必须选择上级科目（顶级科目编码应为${topLength}位）`
      )
    }
    const actualLevel = inferredLevel

    // 验证科目编码格式
    const validation = this.validateAccountCode(params.account_set_id, params.code, actualLevel)
    if (!validation.valid) {
      throw new Error(validation.message || '科目编码格式错误')
    }

    const id = uuidv4()
    const auxTypesJson =
      params.aux_types &&
      typeof params.aux_types === 'object' &&
      Object.keys(params.aux_types).length > 0
        ? JSON.stringify(params.aux_types)
        : null
    const hasAux = auxTypesJson ? 1 : 0
    const noNegative = params.no_negative ? 1 : 0

    // 判定是否需要把父科目数据迁移到本次新建的「第一个子科目」：
    // 父科目从末级变为非末级后不能再记账/挂期初，其数据/会计属性应由第一个子科目继承。
    let shouldMigrateFromParent = false
    if (parent) {
      const existingChildCount =
        (
          this.db
            .prepare('SELECT COUNT(*) as cnt FROM accounts WHERE parent_id = ?')
            .get(parent.id) as { cnt: number } | undefined
        )?.cnt || 0
      const isFirstChild = existingChildCount === 0
      shouldMigrateFromParent =
        isFirstChild && (params.migrate_from_parent === true || this.accountHasMigratableData(parent))
    }

    const doCreate = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, is_aux, aux_types, is_enabled, is_cash, is_bank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.account_set_id,
          params.code,
          params.name,
          params.direction,
          actualLevel,
          params.parent_id || null,
          hasAux,
          auxTypesJson,
          params.is_enabled !== false ? 1 : 0,
          params.is_cash ? 1 : 0,
          params.is_bank ? 1 : 0
        )

      if (params.no_negative !== undefined) {
        this.db.prepare('UPDATE accounts SET no_negative = ? WHERE id = ?').run(noNegative, id)
      }

      // 新增第一个子科目时，把父科目的数据与会计属性迁移/继承到该子科目
      if (parent && shouldMigrateFromParent) {
        this.migrateFromParent(id, parent, params.code, params.name)
      }
    })
    doCreate()

    return id
  }

  /**
   * 从父科目迁移数据到（第一个）子科目
   * 父科目变为非末级后不能再记账/挂期初，故子科目需继承：
   * 会计属性（辅助核算/方向/现金银行/不允许负数）、凭证分录、科目余额、年初与辅助年初记录。
   */
  private migrateFromParent(
    newAccountId: string,
    parent: Account,
    code: string,
    name: string
  ): void {
    const parentId = parent.id

    // 1. 会计属性：子科目继承父科目（覆盖创建时的默认值）
    this.db
      .prepare(
        `UPDATE accounts
         SET is_aux = ?, aux_types = ?, direction = ?, is_cash = ?, is_bank = ?, no_negative = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        parent.is_aux ?? 0,
        parent.aux_types ?? null,
        parent.direction,
        parent.is_cash ?? 0,
        parent.is_bank ?? 0,
        parent.no_negative ?? 0,
        newAccountId
      )

    // 2. 迁移凭证分录
    const veCount = this.db
      .prepare('SELECT COUNT(*) as cnt FROM voucher_entries WHERE account_id = ?')
      .get(parentId) as any

    if (veCount?.cnt > 0) {
      this.db
        .prepare(
          'UPDATE voucher_entries SET account_id = ?, account_code = ?, account_name = ? WHERE account_id = ?'
        )
        .run(newAccountId, code, name, parentId)
    }

    // 3. 迁移科目余额（过账汇总）
    this.db
      .prepare('UPDATE account_balances SET account_id = ? WHERE account_id = ?')
      .run(newAccountId, parentId)

    // 4. 迁移年初余额与辅助年初明细（aux_item_id='' 与 !='' 全部）
    this.db
      .prepare('UPDATE init_balances SET account_id = ? WHERE account_id = ?')
      .run(newAccountId, parentId)
  }

  /**
   * 更新会计科目
   * 如果科目被禁用，则递归禁用所有下级科目
   * 如果科目被启用，则递归启用所有下级科目
   * 属性设置（is_cash/is_bank/no_negative）和辅助核算（is_aux/aux_types）"实际发生变化"时才同步到所有下级科目
   */
  updateAccount(id: string, params: UpdateAccountParams): void {
    // 获取修改前的状态，用于判断是否需要级联
    const oldAccount = this.getAccountById(id)
    const oldEnabled = oldAccount?.is_enabled

    const auxTypesJson =
      params.aux_types &&
      typeof params.aux_types === 'object' &&
      Object.keys(params.aux_types).length > 0
        ? JSON.stringify(params.aux_types)
        : null
    const hasAux = auxTypesJson ? 1 : 0

    // 守卫：若原本启用辅助核算、现在关闭，但仍存在辅助期初明细，则阻断，
    // 避免产生“被清理统计到却在辅助期初看不见”的孤立数据
    if (oldAccount && accountHasAuxAccounting(oldAccount) && hasAux === 0) {
      const auxInit = this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM init_balances WHERE account_id = ? AND aux_item_id != ''`
        )
        .get(id) as { cnt: number } | undefined
      if ((auxInit?.cnt || 0) > 0) {
        throw new Error('该科目存在辅助期初明细，请先到「辅助期初」清空后再关闭辅助核算')
      }
    }

    // 将 is_enabled 转换为数字 0 或 1
    const newEnabled = params.is_enabled ? 1 : 0
    const newIsCash = params.is_cash ? 1 : 0
    const newIsBank = params.is_bank ? 1 : 0
    const newNoNegative = params.no_negative !== undefined ? (params.no_negative ? 1 : 0) : (oldAccount?.no_negative ?? 0)

    // 计算哪些字段相对旧值实际发生了变化，只级联变化的字段
    const changedProps: Partial<{
      is_cash: number
      is_bank: number
      no_negative: number
      is_aux: number
      aux_types: string | null
    }> = {}
    if (oldAccount) {
      if ((oldAccount.is_cash ?? 0) !== newIsCash) changedProps.is_cash = newIsCash
      if ((oldAccount.is_bank ?? 0) !== newIsBank) changedProps.is_bank = newIsBank
      if ((oldAccount.no_negative ?? 0) !== newNoNegative) changedProps.no_negative = newNoNegative
      if ((oldAccount.is_aux ?? 0) !== hasAux) changedProps.is_aux = hasAux
      if ((oldAccount.aux_types ?? null) !== auxTypesJson) {
        changedProps.is_aux = hasAux
        changedProps.aux_types = auxTypesJson
      }
    }

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE accounts
           SET name = ?, direction = ?, is_aux = ?, aux_types = ?, is_enabled = ?, is_cash = ?, is_bank = ?, no_negative = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          params.name,
          params.direction,
          hasAux,
          auxTypesJson,
          newEnabled,
          newIsCash,
          newIsBank,
          newNoNegative,
          id
        )

      // 级联启用/禁用子科目
      if (oldEnabled !== newEnabled) {
        if (newEnabled === 0) {
          this.cascadeDisableChildren(id)
        } else {
          this.cascadeEnableChildren(id)
        }
      }

      // 仅当属性设置/辅助核算实际发生变化时才级联到下级科目
      if (Object.keys(changedProps).length > 0) {
        this.cascadePropertyToChildren(id, changedProps)
      }
    })()
  }

  /**
   * 递归同步属性设置和辅助核算到所有下级科目（仅同步传入的字段）
   */
  private cascadePropertyToChildren(
    parentId: string,
    props: Partial<{ is_cash: number; is_bank: number; no_negative: number; is_aux: number; aux_types: string | null }>
  ): void {
    const fields: string[] = []
    const values: (number | string | null)[] = []
    if (props.is_cash !== undefined) {
      fields.push('is_cash = ?')
      values.push(props.is_cash)
    }
    if (props.is_bank !== undefined) {
      fields.push('is_bank = ?')
      values.push(props.is_bank)
    }
    if (props.no_negative !== undefined) {
      fields.push('no_negative = ?')
      values.push(props.no_negative)
    }
    if (props.is_aux !== undefined) {
      fields.push('is_aux = ?')
      values.push(props.is_aux)
    }
    if (props.aux_types !== undefined) {
      fields.push('aux_types = ?')
      values.push(props.aux_types)
    }
    if (fields.length === 0) return

    const setClause = fields.join(', ') + ", updated_at = datetime('now')"
    const updateStmt = this.db.prepare(`UPDATE accounts SET ${setClause} WHERE id = ?`)

    const children = this.db
      .prepare('SELECT id FROM accounts WHERE parent_id = ?')
      .all(parentId) as { id: string }[]

    for (const child of children) {
      updateStmt.run(...values, child.id)
      // 递归处理更深层的子科目
      this.cascadePropertyToChildren(child.id, props)
    }
  }

  /**
   * 递归禁用所有下级科目
   */
  private cascadeDisableChildren(parentId: string): void {
    const children = this.db
      .prepare('SELECT id, code, name FROM accounts WHERE parent_id = ?')
      .all(parentId) as { id: string; code: string; name: string }[]

    console.log(`禁用父科目的 ${children.length} 个子科目:`, children.map(c => c.code).join(', '))

    for (const child of children) {
      this.db
        .prepare('UPDATE accounts SET is_enabled = 0, updated_at = datetime(\'now\') WHERE id = ?')
        .run(child.id)
      // 递归处理下级的下级
      this.cascadeDisableChildren(child.id)
    }
  }

  /**
   * 递归启用所有下级科目
   */
  private cascadeEnableChildren(parentId: string): void {
    const children = this.db
      .prepare('SELECT id, code, name FROM accounts WHERE parent_id = ?')
      .all(parentId) as { id: string; code: string; name: string }[]

    console.log(`启用父科目的 ${children.length} 个子科目:`, children.map(c => c.code).join(', '))

    for (const child of children) {
      this.db
        .prepare('UPDATE accounts SET is_enabled = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(child.id)
      // 递归处理下级的下级
      this.cascadeEnableChildren(child.id)
    }
  }

  /**
   * 删除会计科目
   */
  deleteAccount(id: string): void {
    const account = this.getAccountById(id)
    if (!account) {
      throw new Error('科目不存在')
    }

    if (!account.allow_delete) {
      throw new Error('系统内置科目无法删除')
    }

    // 检查是否有子科目
    const children = this.db
      .prepare('SELECT COUNT(*) as count FROM accounts WHERE parent_id = ?')
      .get(id) as any

    if (children?.count > 0) {
      throw new Error('该科目有子科目，请先删除子科目')
    }

    // 检查是否有期初余额
    const initBalance = this.db
      .prepare('SELECT COUNT(*) as count FROM init_balances WHERE account_id = ?')
      .get(id) as any

    if (initBalance?.count > 0) {
      throw new Error('该科目有期初余额，请先清除期初余额')
    }

    // 检查是否被凭证使用
    const used = this.db
      .prepare('SELECT COUNT(*) as count FROM voucher_entries WHERE account_id = ?')
      .get(id) as any

    if (used?.count > 0) {
      throw new Error('该科目已被凭证使用，无法删除')
    }

    const reportBlock = getAccountReportTemplateBlockReason(
      this.db,
      account.account_set_id,
      account.code
    )
    if (reportBlock) {
      throw new Error(reportBlock)
    }

    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  }

  /**
   * 检查并补充缺失的父科目
   * 根据科目编码和配置的科目长度，自动创建缺失的上级科目
   */
  fillMissingParentAccounts(accountSetId: string): {
    checked: number
    created: number
    details: Array<{ code: string; name: string; level: number }>
  } {
    // 获取科目长度配置
    const accountCodeLengthsStr = this.getSystemParam(accountSetId, 'account_code_lengths')
    let codeLengths: number[]
    if (!accountCodeLengthsStr) {
      codeLengths = [4, 2, 2, 2, 2, 2] // 默认配置
    } else {
      try {
        codeLengths = JSON.parse(accountCodeLengthsStr)
      } catch {
        throw new Error('系统参数配置错误')
      }
    }

    // 获取所有科目
    const accounts = this.getAccounts({ account_set_id: accountSetId })
    const accountMap = new Map<string, Account>()
    accounts.forEach(acc => accountMap.set(acc.code, acc))

    const created: Array<{ code: string; name: string; level: number }> = []
    const toCreate: Array<{ code: string; level: number; direction: string }> = []

    // 检查每个科目的父科目是否存在
    for (const account of accounts) {
      const level = this.calculateLevel(account.code, codeLengths)
      if (!level || level === 1) continue

      // 计算所有上级科目编码
      const parentCodes = this.getParentCodes(account.code, codeLengths, level)

      for (const parentCode of parentCodes) {
        if (!accountMap.has(parentCode) && !toCreate.some(t => t.code === parentCode)) {
          const parentLevel = this.calculateLevel(parentCode, codeLengths)
          if (!parentLevel) continue
          toCreate.push({
            code: parentCode,
            level: parentLevel,
            direction: account.direction, // 继承子科目的方向
          })
        }
      }
    }

    // 按级别和编码排序，确保先创建上级科目
    toCreate.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level
      return a.code.localeCompare(b.code)
    })

    // 创建缺失的父科目
    this.db.transaction(() => {
      for (const item of toCreate) {
        const parentId = this.findParentId(item.code, codeLengths, accountMap)
        const id = uuidv4()

        this.db
          .prepare(
            `INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, is_aux, aux_types, is_enabled, is_cash, is_bank, allow_delete)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            accountSetId,
            item.code,
            '-', // 名称用\"-\"占位
            item.direction,
            item.level,
            parentId,
            0, // is_aux
            null, // aux_types
            1, // is_enabled
            0, // is_cash
            0, // is_bank
            1  // allow_delete
          )

        // 添加到 map 中，供后续科目查找父科目
        accountMap.set(item.code, {
          id,
          account_set_id: accountSetId,
          code: item.code,
          name: '-',
          direction: item.direction,
          level: item.level,
          parent_id: parentId,
          is_aux: 0,
          aux_types: null,
          is_enabled: 1,
          is_cash: 0,
          is_bank: 0,
          no_negative: 0,
          allow_delete: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })

        created.push({
          code: item.code,
          name: '-',
          level: item.level,
        })
      }
    })()

    return {
      checked: accounts.length,
      created: created.length,
      details: created,
    }
  }

  /**
   * 根据编码和长度配置计算科目级数（无法匹配时返回 null，避免误判为 1 级）
   */
  private calculateLevel(code: string, codeLengths: number[]): number | null {
    return inferLevelByCodeLength(code, codeLengths)
  }

  /**
   * 获取所有上级科目编码
   */
  private getParentCodes(code: string, codeLengths: number[], level: number): string[] {
    const parentCodes: string[] = []
    for (let lv = 2; lv <= level; lv++) {
      const parentCode = getParentCodeByLevel(code, lv, codeLengths)
      if (parentCode) parentCodes.push(parentCode)
    }
    return parentCodes
  }

  /**
   * 按科目编码规则重新校验并修复 level / parent_id
   */
  repairAccountHierarchy(accountSetId: string): {
    total: number
    updated: number
    skipped: number
    details: Array<{ code: string; level: number; parent_code: string | null }>
  } {
    const config = this.getAccountCodeConfig(accountSetId)
    const accounts = this.getAccounts({ account_set_id: accountSetId, all: true })
    const accountByCode = new Map<string, Account>()
    for (const account of accounts) {
      accountByCode.set(account.code, account)
    }

    const details: Array<{ code: string; level: number; parent_code: string | null }> = []
    let updated = 0
    let skipped = 0

    const updateStmt = this.db.prepare(`
      UPDATE accounts
      SET level = ?, parent_id = ?
      WHERE id = ?
    `)

    this.db.transaction(() => {
      for (const account of accounts) {
        const level = this.inferLevelByCodeLength(account.code, config)
        if (!level) {
          skipped++
          continue
        }

        let parentId: string | null = null
        let parentCode: string | null = null
        if (level > 1) {
          parentCode = getParentCodeByLevel(account.code, level, config.codeLengths)
          if (parentCode) {
            parentId = accountByCode.get(parentCode)?.id || null
          }
          if (!parentId) {
            const fallbackCode = findDirectParentCodeByPrefix(
              account.code,
              accounts.map(row => row.code)
            )
            if (fallbackCode) {
              parentCode = fallbackCode
              parentId = accountByCode.get(fallbackCode)?.id || null
            }
          }
        }

        if (account.level !== level || account.parent_id !== parentId) {
          updateStmt.run(level, parentId, account.id)
          account.level = level
          account.parent_id = parentId
          updated++
          details.push({ code: account.code, level, parent_code: parentCode })
        }
      }
    })()

    return { total: accounts.length, updated, skipped, details }
  }

  /**
   * 查找父科目ID
   */
  private findParentId(code: string, codeLengths: number[], accountMap: Map<string, Account>): string | null {
    const level = this.calculateLevel(code, codeLengths)
    if (!level || level === 1) return null

    const parentCodes = this.getParentCodes(code, codeLengths, level)
    const immediateParentCode = parentCodes[parentCodes.length - 1]

    const parent = accountMap.get(immediateParentCode)
    return parent ? parent.id : null
  }
}
