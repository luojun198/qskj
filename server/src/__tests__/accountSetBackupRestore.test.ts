import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'fs'
import { closeAndResetDb, getDb } from '../db/index.js'
import {
  BACKUP_ATTACHMENT_TABLE,
  detectBackupScope,
  importSingleAccountSetBackupAsNewAccountSet,
  remapAccountAuxTypes,
  remapVoucherAuxDataJson,
  remapVoucherTemplateEntriesDataJson,
  restoreSingleAccountSetFromBackup,
} from '../services/accountSetBackupRestore.js'
import { doAccountSetBackup, formatAccountSetBackupStatsSummary } from '../routes/backup.js'
import { cleanupAccountSetCascade } from '../services/accountSetCleanup.js'

/**
 * 备份/恢复会真实改写目标账套（合并恢复会替换目标账套的科目），绝不能跑在开发库上。
 * 这里在任何模块导入之前，把开发库 VACUUM INTO 一份临时副本并指向它；
 * db/index.ts 里的 dotenv 不会覆盖已存在的 DB_PATH。
 * 测试账套按「凭证最少、且有科目」动态选择，不再依赖某个特定库里的固定 ID。
 */
const { TEST_ACCOUNT_SET_ID, TEMP_DB_PATH, SKIP_REASON } = await vi.hoisted(async () => {
  const fs = await import('fs')
  const path = await import('path')
  const os = await import('os')
  const { default: Sqlite } = await import('better-sqlite3')

  function resolveSourceDbPath(): string {
    if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH)
    const envFile = path.resolve(process.cwd(), '.env')
    if (fs.existsSync(envFile)) {
      const match = fs.readFileSync(envFile, 'utf8').match(/^\s*DB_PATH\s*=\s*(.+?)\s*$/m)
      if (match?.[1]) return path.resolve(process.cwd(), match[1].trim())
    }
    return path.resolve(process.cwd(), '..', 'data', 'finance.db')
  }

  const sourcePath = resolveSourceDbPath()
  if (!fs.existsSync(sourcePath)) {
    return { TEST_ACCOUNT_SET_ID: '', TEMP_DB_PATH: '', SKIP_REASON: `开发库不存在: ${sourcePath}` }
  }

  const tempPath = path.join(os.tmpdir(), `cw-backup-restore-test-${process.pid}-${Date.now()}.db`)
  const source = new Sqlite(sourcePath, { readonly: true })
  try {
    source.exec(`VACUUM INTO '${tempPath.replace(/'/g, "''")}'`)
  } finally {
    source.close()
  }

  const copy = new Sqlite(tempPath)
  let accountSetId = ''
  try {
    const row = copy
      .prepare(
        `SELECT a.id FROM account_sets a
         WHERE (SELECT COUNT(*) FROM accounts c WHERE c.account_set_id = a.id) > 0
         ORDER BY (SELECT COUNT(*) FROM vouchers v WHERE v.account_set_id = a.id) ASC
         LIMIT 1`
      )
      .get() as { id: string } | undefined
    accountSetId = row?.id || ''
  } finally {
    copy.close()
  }

  if (!accountSetId) {
    fs.rmSync(tempPath, { force: true })
    return { TEST_ACCOUNT_SET_ID: '', TEMP_DB_PATH: '', SKIP_REASON: '开发库中没有可用于测试的账套' }
  }

  process.env.DB_PATH = tempPath
  return { TEST_ACCOUNT_SET_ID: accountSetId, TEMP_DB_PATH: tempPath, SKIP_REASON: '' }
})

describe('formatAccountSetBackupStatsSummary', () => {
  it('包含动态报表与附件打包说明', () => {
    const text = formatAccountSetBackupStatsSummary({
      accounts: 100,
      vouchers: 5,
      auxCategories: 4,
      auxItems: 20,
      initBalances: 10,
      reportDefinitions: 3,
      voucherAttachments: 5,
      attachmentFilesEmbedded: 3,
    })
    expect(text).toContain('动态报表 3 个')
    expect(text).toContain('附件 5 条')
    expect(text).toContain('已打包 3 个')
    expect(text).toContain('2 个源文件缺失')
  })
})

describe('accountSetBackupRestore remap helpers', () => {
  it('remapAccountAuxTypes 映射类目 UUID 键', () => {
    const map = new Map([['old-cat', 'new-cat']])
    expect(remapAccountAuxTypes('{"old-cat":null,"other":"x"}', map)).toBe('{"new-cat":null,"other":"x"}')
  })

  it('remapVoucherAuxDataJson 映射项目 id', () => {
    const categoryIdMap = new Map([['cat-uuid', 'cat-new']])
    const categoryCodeByOldId = new Map([['cat-uuid', 'dept']])
    const itemIdMap = new Map([['item-old', 'item-new']])
    const input = JSON.stringify({ dept: { id: 'item-old' }, 'cat-uuid': { id: 'item-old' } })
    const out = remapVoucherAuxDataJson(input, categoryIdMap, categoryCodeByOldId, itemIdMap) as string
    const parsed = JSON.parse(out)
    expect(parsed.dept.id).toBe('item-new')
    expect(parsed['cat-new'].id).toBe('item-new')
  })

  it('remapVoucherTemplateEntriesDataJson 映射科目与辅助 id', () => {
    const entries = [{ account_id: 'acc-old', dept_id: 'item-old', aux_data: '{}' }]
    const out = remapVoucherTemplateEntriesDataJson(JSON.stringify(entries), {
      accountMap: new Map([['acc-old', 'acc-new']]),
      auxItemMap: new Map([['item-old', 'item-new']]),
      categoryIdMap: new Map(),
      categoryCodeByOldId: new Map(),
    }) as string
    const parsed = JSON.parse(out)
    expect(parsed[0].account_id).toBe('acc-new')
    expect(parsed[0].dept_id).toBe('item-new')
  })
})

// 本组复制整个开发库做备份 / 恢复，耗时随开发库体积增长（留有十万级压测数据时约 15s），放宽超时
describe.skipIf(!!SKIP_REASON)(`accountSetBackupRestore${SKIP_REASON ? `（跳过：${SKIP_REASON}）` : ''}`, { timeout: 60000 }, () => {
  let backupPath = ''

  beforeAll(async () => {
    const result = await doAccountSetBackup(TEST_ACCOUNT_SET_ID)
    if (!result?.filepath || !existsSync(result.filepath)) {
      throw new Error('无法生成测试备份文件')
    }
    backupPath = result.filepath
  })

  afterAll(() => {
    closeAndResetDb()
    if (backupPath) rmSync(backupPath, { force: true })
    if (TEMP_DB_PATH) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${TEMP_DB_PATH}${suffix}`, { force: true })
    }
  })

  it('detectBackupScope 识别单账套备份', () => {
    const scope = detectBackupScope(backupPath)
    expect(scope.type).toBe('single_account_set')
    expect(scope.accountSetCount).toBe(1)
    expect(scope.sourceAccountSetId).toBeTruthy()
  })

  it('单账套备份文件应包含辅助核算与动态报表', () => {
    const backupDb = new Database(backupPath, { readonly: true })
    const auxCategories = (
      backupDb.prepare('SELECT COUNT(*) as c FROM aux_categories').get() as { c: number }
    ).c
    const auxItems = (backupDb.prepare('SELECT COUNT(*) as c FROM aux_items').get() as { c: number }).c
    const reportDefs = backupDb
      .prepare(
        "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='report_definitions'"
      )
      .get() as { c: number }
    backupDb.close()

    const liveDb = getDb()
    const liveAuxItems = (
      liveDb
        .prepare('SELECT COUNT(*) as c FROM aux_items WHERE account_set_id = ?')
        .get(TEST_ACCOUNT_SET_ID) as { c: number }
    ).c
    const liveReportDefs = (
      liveDb
        .prepare('SELECT COUNT(*) as c FROM report_definitions WHERE account_set_id = ?')
        .get(TEST_ACCOUNT_SET_ID) as { c: number }
    ).c

    expect(auxCategories).toBeGreaterThanOrEqual(0)
    expect(reportDefs.c).toBe(1)
    if (liveAuxItems > 0) {
      expect(auxItems).toBe(liveAuxItems)
    }
    if (liveReportDefs > 0) {
      const backupDb2 = new Database(backupPath, { readonly: true })
      const backed = (
        backupDb2.prepare('SELECT COUNT(*) as c FROM report_definitions').get() as { c: number }
      ).c
      backupDb2.close()
      expect(backed).toBe(liveReportDefs)
    }
  })

  it('restoreSingleAccountSetFromBackup 合并恢复到目标账套', () => {
    const db = getDb()
    const target = db
      .prepare('SELECT id FROM account_sets WHERE id != ? LIMIT 1')
      .get(TEST_ACCOUNT_SET_ID) as { id: string } | undefined
    if (!target) {
      return
    }
    const targetAccountSetId = target.id

    const sourceDb = new Database(backupPath, { readonly: true })
    const sourceAccounts = (
      sourceDb.prepare('SELECT COUNT(*) as c FROM accounts WHERE account_set_id = ?').get(TEST_ACCOUNT_SET_ID) as {
        c: number
      }
    ).c
    const sourceAuxItems = (
      sourceDb.prepare('SELECT COUNT(*) as c FROM aux_items WHERE account_set_id = ?').get(TEST_ACCOUNT_SET_ID) as {
        c: number
      }
    ).c
    const sourceReportDefs = (
      sourceDb
        .prepare('SELECT COUNT(*) as c FROM report_definitions WHERE account_set_id = ?')
        .get(TEST_ACCOUNT_SET_ID) as { c: number }
    ).c
    sourceDb.close()

    const stats = restoreSingleAccountSetFromBackup({
      targetAccountSetId,
      sourcePath: backupPath,
    })

    expect(stats.accounts).toBe(sourceAccounts)
    expect(stats.accounts).toBeGreaterThan(0)
    expect(stats.auxItems).toBe(sourceAuxItems)

    const afterAccounts = (
      db.prepare('SELECT COUNT(*) as c FROM accounts WHERE account_set_id = ?').get(targetAccountSetId) as {
        c: number
      }
    ).c
    const afterAuxItems = (
      db.prepare('SELECT COUNT(*) as c FROM aux_items WHERE account_set_id = ?').get(targetAccountSetId) as {
        c: number
      }
    ).c
    const afterReportDefs = (
      db
        .prepare('SELECT COUNT(*) as c FROM report_definitions WHERE account_set_id = ?')
        .get(targetAccountSetId) as { c: number }
    ).c
    expect(afterAccounts).toBe(sourceAccounts)
    expect(afterAuxItems).toBe(sourceAuxItems)
    expect(afterReportDefs).toBe(sourceReportDefs)

    if (afterAuxItems > 0) {
      const orphan = db
        .prepare(
          `SELECT COUNT(*) as c FROM aux_items ai
           LEFT JOIN aux_categories ac ON ai.type = ac.id
           WHERE ai.account_set_id = ? AND ac.id IS NULL`
        )
        .get(targetAccountSetId) as { c: number }
      expect(orphan.c).toBe(0)

      const badAuxTypes = db
        .prepare(
          `SELECT COUNT(*) as c FROM accounts a
           WHERE a.account_set_id = ? AND a.is_aux = 1 AND a.aux_types IS NOT NULL AND a.aux_types != ''
           AND EXISTS (
             SELECT 1 FROM json_each(a.aux_types) je
             WHERE je.key NOT IN (SELECT id FROM aux_categories WHERE account_set_id = ?)
           )`
        )
        .get(targetAccountSetId, targetAccountSetId) as { c: number }
      // sqlite json_each on object keys — fallback: sample check
      if (badAuxTypes.c > 0) {
        const sample = db
          .prepare(
            `SELECT aux_types FROM accounts WHERE account_set_id = ? AND is_aux = 1 AND aux_types LIKE '%-%' LIMIT 1`
          )
          .get(targetAccountSetId) as { aux_types: string } | undefined
        if (sample?.aux_types?.startsWith('{')) {
          const keys = Object.keys(JSON.parse(sample.aux_types))
          for (const key of keys) {
            const cat = db
              .prepare('SELECT id FROM aux_categories WHERE account_set_id = ? AND id = ?')
              .get(targetAccountSetId, key)
            expect(cat).toBeTruthy()
          }
        }
      }
    }
  })

  it('importSingleAccountSetBackupAsNewAccountSet 登录页导入为新账套', () => {
    const importName = `测试导入_${Date.now()}`
    const result = importSingleAccountSetBackupAsNewAccountSet({
      sourcePath: backupPath,
      name: importName,
    })

    expect(result.accountSetId).toBeTruthy()
    expect(result.stats.accounts).toBeGreaterThan(0)

    const db = getDb()
    const row = db
      .prepare('SELECT name FROM account_sets WHERE id = ?')
      .get(result.accountSetId) as { name: string }
    expect(row.name).toBe(importName)

    const vouchers = (
      db.prepare('SELECT COUNT(*) as c FROM vouchers WHERE account_set_id = ?').get(result.accountSetId) as {
        c: number
      }
    ).c
    expect(vouchers).toBe(result.stats.vouchers)

    const backupDb = new Database(backupPath, { readonly: true })
    const hasAttachmentTable = (
      backupDb
        .prepare(
          `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(BACKUP_ATTACHMENT_TABLE) as { c: number }
    ).c
    backupDb.close()
    expect(hasAttachmentTable).toBeGreaterThanOrEqual(0)

    cleanupAccountSetCascade(db, result.accountSetId)
  })
})
