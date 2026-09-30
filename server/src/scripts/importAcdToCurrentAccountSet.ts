import { getDb } from '../db/index.js'
import { isPlaceholderUnitName } from '../services/reportUnitName.js'
import { v4 as uuidv4 } from 'uuid'
import iconv from 'iconv-lite'
import * as fs from 'fs'
import * as zlib from 'zlib'
import bcrypt from 'bcryptjs'
import {
  ACD_TO_CW,
  ACD_UNSUPPORTED,
  ACD_SILENT_CODES,
  ACD_IMPORT_BASE_PERMISSIONS,
} from '../db/permissions.js'
import { mapAcdCashFlowJd } from '../utils/acdCashFlow.js'
import { parseKmbmRow } from '../utils/acdKmbmParse.js'
import { buildAuxItemId } from '../utils/auxItemId.js'
import { calcForeignInitBalance } from '../utils/initBalanceForeign.js'
import { buildVoucherNo, getMaxVoucherNoSeqInPeriod } from '../services/voucherEntry.js'
import {
  applyAccountCodeConfigToDb,
  bootstrapNewAccountSetDefaults,
  syncAccountSetStartDate,
  isValidAccountSetStartDate,
  resolveAccountSetStartDate,
  upsertAccountSetSystemParam,
} from '../services/accountSetDefaults.js'
import {
  getCurrencyByCode,
  upsertCurrencyRow,
  upsertExchangeRate,
} from '../services/currencyService.js'
import { rebuildAccountBalances } from '../services/accountBalanceRebuild.js'
import { normalizeNonLeafReferences } from '../services/accountReferences.js'
import { importCashierTables, importFixedAssetTables } from './importAcdCashierAsset.js'
import { importSupplyChainFromAcd } from '../services/importAcdSupplyChain.js'

type AcdRow = string[]

type AcdUser = {
  code: string
  username: string
  fullName: string
  password: string
}

type AcdRight = {
  userCode: string // 用户代码
  rightCode: string // 权限代码（如 '401', 'A03'）
  rightName: string // 权限名称
  status: string // 状态标志
}

type ParsedTables = {
  xt: Map<string, string>
  voucherTypes: AcdRow[]
  accounts: AcdRow[]
  initBalances: AcdRow[]
  transferTypes: AcdRow[]
  voucherEntries: AcdRow[]
  voucherHeaders: AcdRow[]
  voucherTemplateHeaders: AcdRow[] // pzmb - 凭证模板
  voucherTemplateEntries: AcdRow[] // pzmb_pz - 凭证模板分录
  budgetSurplusAdjustments: AcdRow[]
  reportCatalog: AcdRow[]
  reportFormulaCatalog: AcdRow[]
  reportTemplates: Map<string, string>
  reportTemplateBuffers: Map<string, Buffer>
  users: AcdUser[]
  rights: AcdRight[] // 用户权限数据
  // 辅助核算主数据表
  auxProjects: AcdRow[] // xmk - 项目
  auxCustomers: AcdRow[] // dwk - 往来单位
  auxDepts: AcdRow[] // bmk - 部门
  auxPersons: AcdRow[] // grk - 个人
  auxCashFlows: AcdRow[] // xjll_xm - 现金流量项目
  auxFundSources: AcdRow[] // zjly - 资金来源
  // 辅助核算期初表（科目 × 辅助项目 × 年份）
  auxCustomerInitBalances: AcdRow[] // dwnc - 往来单位期初
  auxDeptInitBalances: AcdRow[] // bmnc - 部门期初
  auxPersonInitBalances: AcdRow[] // grnc - 个人期初
  auxProjectInitBalances: AcdRow[] // xmnc - 项目期初
  auxFundSourceInitBalances: AcdRow[] // zjnc - 资金来源期初
  /** fbgl - 外币汇率 */
  currencies: AcdRow[]
  /** bzk - 币种档案（bz/hl/bwbz/qtbz） */
  currencyArchives: AcdRow[]
  // 出纳模块原始表
  cashierJournal: AcdRow[] // cn_mx - 出纳日记账明细
  cashierInitBalances: AcdRow[] // cn_nc - 出纳期初
  bankStatements: AcdRow[] // yhdzd - 银行对账单
  settleTypes: AcdRow[] // jslb - 结算方式
  // 固定资产模块原始表
  fixedAssets: AcdRow[] // zc_gdzc - 卡片主表
  fixedAssetDepr: AcdRow[] // zc_yzjb - 月折旧
  fixedAssetOrigChanges: AcdRow[] // zc_yzzj - 原值增减
  fixedAssetMods: AcdRow[] // zc_sbbd - 变动流水
  fixedAssetCategories: AcdRow[] // zc_sblb - 类别
  fixedAssetStatuses: AcdRow[] // zc_sbzt - 状态
  fixedAssetPurposes: AcdRow[] // zc_sbyt - 用途
  fixedAssetDepts: AcdRow[] // zc_sydw - 使用部门
}

type ReportDefinitionSeed = {
  code: string
  name: string
  sourceFile: string
  sortOrder: number
}

type ParsedVtsCell = {
  rowIndex: number
  colIndex: number
  cellType: 'text' | 'formula' | 'number'
  textValue: string | null
  formulaText: string | null
  formatText: string | null
}

type ParsedVtsSheet = {
  key: string
  name: string
  index: number
  cells: ParsedVtsCell[]
}

type ParsedVtsTemplate = {
  sheets: ParsedVtsSheet[]
  formulas: string[]
}

type VtsStringMatch = {
  index: number
  value: string
}

type ImportStats = {
  accountSetId: string
  accountSetName: string
  importedTables: string[]
  systemParams: {
    upserted: number
  }
  voucherTypes: {
    inserted: number
    updated: number
    skipped: number
  }
  accounts: {
    inserted: number
    updated: number
    skipped: number
  }
  /** 外币核算科目数量（is_foreign=1） */
  foreignAccounts: number
  currencies: {
    inserted: number
    updated: number
  }
  initBalances: {
    inserted: number
    skipped: number
  }
  auxInitBalances: {
    inserted: number
    skipped: number
  }
  transferTypes: {
    types: number
    items: number
  }
  vouchers: {
    vouchers: number
    entries: number
  }
  voucherTemplates: number
  accountBalanceRows: number
  budgetSurplusAdjustments: {
    inserted: number
    skipped: number
  }
  users: number // 导入的用户数量
  periodClosing: {
    closedCount: number
    from: string // "YYYY-MM"
    to: string // "YYYY-MM"（最后一个 closed 期间）
  }
  reportTemplates: {
    definitions: number
    sheets: number
    cells: number
    formulas: number
  }
  auxiliaryData: {
    totalItems: number
    projects: number
    customers: number
    depts: number
    persons: number
    cashFlows: number
    fundSources: number
  }
  cashier: {
    journal: number
    initBalances: number
    bankStatements: number
    settleTypes: number
  }
  fixedAsset: {
    assets: number
    depr: number
    changes: number
    categories: number
    statuses: number
    purposes: number
    depts: number
  }
  warnings: string[]
}

type Options = {
  acdFilePath?: string
  acdBuffer?: Buffer
  dryRun: boolean
}

type AcdParseAudit = {
  totalEntries: number
  successfulEntries: number
  emptyEntries: number
  skippedPosVts: number
  failedEntries: number
  warnings: string[]
}

function decodeTableContent(content: string): string {
  // Content is already decoded from GBK in parseAcdFileTables
  return content
}

function splitTableRows(content: string): AcdRow[] {
  return decodeTableContent(content)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split('\t'))
}

/**
 * 严格的 ACD 文件解析器 - 基于定长头结构迭代
 *
 * ACD 格式规范：
 * - 文件名字段：32字节（null结尾，0x20填充）
 * - 元数据头：12字节
 *   - flag: 4字节 (uint32 LE, 通常为1)
 *   - uncompressed_size: 4字节 (uint32 LE)
 *   - compressed_size: 4字节 (uint32 LE)
 * - zlib压缩数据：compressed_size字节
 */
function parseAcdFileTables(filePath: string): {
  texts: Map<string, string>
  buffers: Map<string, Buffer>
  audit: AcdParseAudit
}
function parseAcdFileTables(buffer: Buffer): {
  texts: Map<string, string>
  buffers: Map<string, Buffer>
  audit: AcdParseAudit
}
function parseAcdFileTables(input: string | Buffer): {
  texts: Map<string, string>
  buffers: Map<string, Buffer>
  audit: AcdParseAudit
} {
  const buffer = typeof input === 'string' ? fs.readFileSync(input) : input
  const texts = new Map<string, string>()
  const buffers = new Map<string, Buffer>()
  const audit: AcdParseAudit = {
    totalEntries: 0,
    successfulEntries: 0,
    emptyEntries: 0,
    skippedPosVts: 0,
    failedEntries: 0,
    warnings: [],
  }

  let pos = 0

  while (pos < buffer.length) {
    // 读取文件名字段（32字节，null结尾，0x20填充）
    let nameBytes = Buffer.alloc(0)
    let i = pos
    while (i < pos + 32 && i < buffer.length) {
      const b = buffer[i]
      if (b === 0x00) break
      nameBytes = Buffer.concat([nameBytes, Buffer.from([b])])
      i++
    }

    // 文件名太短或已到文件尾
    if (nameBytes.length < 3 || i >= buffer.length) {
      break
    }

    // 解码文件名（GBK编码）
    let fileName: string
    try {
      fileName = iconv.decode(nameBytes, 'gbk').trim()
    } catch {
      audit.warnings.push(`文件名解码失败 at offset ${pos}`)
      audit.failedEntries++
      break
    }

    // 跳过 null 和填充空格，找到元数据头起始位置
    const nullPos = buffer.indexOf(0x00, pos)
    if (nullPos === -1) break

    let fieldEnd = nullPos + 1
    while (fieldEnd < buffer.length && buffer[fieldEnd] === 0x20) {
      fieldEnd++
    }

    // 读取元数据头（12字节）
    if (fieldEnd + 12 > buffer.length) {
      break
    }

    const flag = buffer.readUInt32LE(fieldEnd)
    const uncompressedSize = buffer.readUInt32LE(fieldEnd + 4)
    const compressedSize = buffer.readUInt32LE(fieldEnd + 8)

    const zlibStart = fieldEnd + 12
    if (zlibStart + compressedSize > buffer.length) {
      audit.warnings.push(`${fileName}: 压缩数据超出文件边界`)
      audit.failedEntries++
      break
    }

    audit.totalEntries++

    // 跳过 pos*.vts（PB二进制格式，不支持解析）
    if (/^pos.*\.vts$/i.test(fileName)) {
      audit.skippedPosVts++
      pos = zlibStart + compressedSize
      continue
    }

    // 空文件（合法）
    if (compressedSize === 0 || uncompressedSize === 0) {
      audit.emptyEntries++
      texts.set(fileName.toLowerCase(), '')
      pos = zlibStart + compressedSize
      continue
    }

    // 解压缩
    const zlibData = buffer.subarray(zlibStart, zlibStart + compressedSize)
    try {
      const decompressed = zlib.inflateSync(zlibData)

      // 验证解压后大小
      if (decompressed.length !== uncompressedSize) {
        audit.warnings.push(
          `${fileName}: 解压后大小不匹配 (期望 ${uncompressedSize}, 实际 ${decompressed.length})`
        )
      }

      // 文本文件解码为 GBK
      const decoded = iconv.decode(decompressed, 'gbk')
      texts.set(fileName.toLowerCase(), decoded)

      // VTS 文件保留原始 buffer
      if (/\.vts$/i.test(fileName)) {
        buffers.set(fileName.toLowerCase(), decompressed)
      }

      audit.successfulEntries++
    } catch (err) {
      audit.warnings.push(`${fileName}: 解压失败 - ${(err as Error).message}`)
      audit.failedEntries++
    }

    pos = zlibStart + compressedSize
  }

  return { texts, buffers, audit }
}

/**
 * 解析 data_stru.txt 获取表结构定义
 * 返回 Map<表名, 列定义数组>
 */
function parseDataStru(content: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  if (!content) return result

  // data_stru.txt 格式：每行一个 CREATE TABLE 语句
  const lines = content.split(/\r?\n/).filter(line => line.trim())

  for (const line of lines) {
    const match = line.match(/Create table (\w+) \((.*)\)/)
    if (!match) continue

    const tableName = match[1].toLowerCase()
    const columnDefs = match[2]
      .split(',')
      .map(col => col.trim().split(/\s+/)[0].replace(/"/g, ''))
      .filter(Boolean)

    result.set(tableName, columnDefs)
  }

  return result
}

function parseXtTable(content: string): Map<string, string> {
  const rows = splitTableRows(content)
  const result = new Map<string, string>()

  for (const row of rows) {
    if (!row[0]) continue
    result.set(row[0].trim(), (row[1] || '').trim())
  }

  return result
}

/**
 * 动态发现 ACD 中的所有可用表
 * 返回表名 -> 内容的映射
 */
function discoverAcdTables(tables: Map<string, string>): {
  availableTables: Set<string>
  tableContents: Map<string, string>
  voucherTables: Set<string>
  auxTables: Set<string>
} {
  const availableTables = new Set<string>()
  const tableContents = new Map<string, string>()
  const voucherTables = new Set(['pz', 'pzdj', 'pz_fj', 'pzmb_pz', 'slz', 'wlxx', 'wlxx_nc'])
  const auxTables = new Set(['xmk', 'dwk', 'bmk', 'grk', 'xjll_xm', 'zjly'])

  for (const [fileName, content] of tables.entries()) {
    if (!fileName.endsWith('.txt')) continue
    // 去掉路径前缀和扩展名，提取纯表名
    const tableName = fileName
      .replace(/^.*[\\\/]/, '') // 去掉路径前缀（支持 \ 和 /）
      .replace('.txt', '')
      .toLowerCase()
    if (content && content.trim()) {
      availableTables.add(tableName)
      tableContents.set(tableName, content)
    }
  }

  console.log('[ACD] 动态发现表:', {
    总数: availableTables.size,
    辅助核算表: Array.from(auxTables).filter(t => availableTables.has(t)),
    凭证表: Array.from(voucherTables).filter(t => availableTables.has(t)),
  })

  return { availableTables, tableContents, voucherTables, auxTables }
}

function parseAcdTables(acdFilePath: string): ParsedTables
function parseAcdTables(acdBuffer: Buffer): ParsedTables
function parseAcdTables(acdFilePathOrBuffer: string | Buffer, acdBuffer?: Buffer): ParsedTables {
  const {
    texts: tables,
    buffers: tableBuffers,
    audit,
  } = typeof acdFilePathOrBuffer === 'string' && !acdBuffer
    ? parseAcdFileTables(acdFilePathOrBuffer)
    : parseAcdFileTables(acdBuffer || (acdFilePathOrBuffer as Buffer))

  // 输出解析审计报告
  // 解析审计（仅在有失败时输出）
  if (audit.failedEntries > 0 || audit.warnings.length > 0) {
    console.warn('[ACD] 解析警告:', audit.warnings)
  }

  // 动态发现所有可用表
  const discovery = discoverAcdTables(tables)

  // 解析 data_stru.txt 做结构校验
  const dataStruContent = tables.get('data_stru.txt') || tables.get('rhsj\\data_stru.txt') || ''
  const dataStruTables = parseDataStru(dataStruContent)

  // 对核心表做列数校验
  const getTable = (name: string) => {
    // 尝试多种可能的键格式
    const lowerName = name.toLowerCase()
    return (
      tables.get(lowerName) ||
      tables.get(`rhsj\\${lowerName}`) ||
      tables.get(`rhsj/${lowerName}`) ||
      ''
    )
  }
  const validateTableColumns = (tableName: string, content: string) => {
    if (!content || dataStruTables.size === 0) return
    const expectedCols = dataStruTables.get(tableName.toLowerCase())
    if (!expectedCols) return

    const rows = splitTableRows(content)
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const row = rows[i]
      if (row.length !== expectedCols.length) {
        // 列数不符可能是 \t 切分错位，必须告警而非静默丢弃
        audit.warnings.push(
          `表 ${tableName} 第 ${i + 1} 行列数为 ${row.length}，data_stru 预期 ${expectedCols.length}，可能字段错位`
        )
        break
      }
    }
  }

  const xtContent = getTable('xt.txt')
  const voucherTypeContent = getTable('pzlx.txt')
  const accountContent = getTable('kmbm.txt')
  const initBalanceContent = getTable('nc.txt')
  const transferTypeContent = getTable('jzlx.txt')
  const voucherEntryContent = getTable('pz.txt')
  const voucherHeaderContent = getTable('pzdj.txt')
  const voucherTemplateHeaderContent = getTable('pzmb.txt')
  const voucherTemplateEntryContent = getTable('pzmb_pz.txt')
  const budgetSurplusAdjustmentContent = getTable('ysda.txt')
  const reportCatalogContent = getTable('bbml.txt')
  const reportFormulaCatalogContent = getTable('bbml_gs.txt')
  const userContent = getTable('b_user.txt')
  const reportTemplates = new Map(
    Array.from(tables.entries()).filter(([fileName]) =>
      /^bb[\w]+\.vts$/i.test(fileName.replace(/^.*[\\\/]/, ''))
    )
  )
  const reportTemplateBuffers = new Map(
    Array.from(tableBuffers.entries()).filter(([fileName]) =>
      /^bb[\w]+\.vts$/i.test(fileName.replace(/^.*[\\\/]/, ''))
    )
  )

  // Parse b_user.txt: format is code\tusername\tfullName\t[password]\t...
  const parsedUsers: AcdUser[] = []
  if (userContent) {
    const rows = splitTableRows(userContent)
    for (const row of rows) {
      if (row.length >= 2 && row[0] && row[1]) {
        parsedUsers.push({
          code: row[0].trim(),
          username: row[1].trim(),
          fullName: (row[2] || '').trim(),
          password: (row[3] || '').trim(),
        })
      }
    }
    console.log('[ACD] b_user.txt parsed:', parsedUsers.length, 'users')
  }

  // Parse b_rights.txt: format is userCode\trightCode\trightName\tstatus
  const rightsContent = getTable('b_rights.txt')
  const parsedRights: AcdRight[] = []
  if (rightsContent) {
    const rows = splitTableRows(rightsContent)
    for (const row of rows) {
      // 只要有「用户代码 + 权限代码」就算数：权限名称（第 3 列）在 ACD 里可能为空，
      // 而 splitTableRows 会把整行 trim 掉行尾的制表符，这类行拆出来只有 2 段。
      // 早先要求 length >= 3，等于把「权限名称为空」的授权整条丢掉——某个用户
      // 若全部授权都没写名称，就会被导成零权限，进而被登录门禁拦下。
      if (row.length >= 2 && row[0] && row[1]) {
        parsedRights.push({
          userCode: row[0].trim(),
          rightCode: row[1].trim(),
          rightName: (row[2] || '').trim(),
          status: (row[3] || '').trim(),
        })
      }
    }
    console.log('[ACD] b_rights.txt parsed:', parsedRights.length, 'rights')
  }

  console.log('[ACD] key tables', {
    xt: xtContent.length,
    pzlx: voucherTypeContent.length,
    kmbm: accountContent.length,
    nc: initBalanceContent.length,
    jzlx: transferTypeContent.length,
    pz: voucherEntryContent.length,
    pzdj: voucherHeaderContent.length,
    bbml: reportCatalogContent.length,
    bbml_gs: reportFormulaCatalogContent.length,
    reportTemplates: reportTemplates.size,
    b_user: parsedUsers.length,
    b_rights: parsedRights.length,
    available: Array.from(tables.keys()).filter(key =>
      [
        'xt.txt',
        'pzlx.txt',
        'kmbm.txt',
        'nc.txt',
        'jzlx.txt',
        'pz.txt',
        'pzdj.txt',
        'bbml.txt',
        'bbml_gs.txt',
        'b_user.txt',
        'b_rights.txt',
      ].includes(key)
    ),
  })

  // 对核心表做列数校验（与 data_stru.txt 对比）
  validateTableColumns('kmbm', accountContent)
  validateTableColumns('pz', voucherEntryContent)
  validateTableColumns('pzdj', voucherHeaderContent)
  validateTableColumns('nc', initBalanceContent)
  validateTableColumns('pzlx', voucherTypeContent)
  validateTableColumns('jzlx', transferTypeContent)

  const auxProjectsContent = getTable('xmk.txt')
  const auxCustomersContent = getTable('dwk.txt')
  const auxDeptsContent = getTable('bmk.txt')
  const auxPersonsContent = getTable('grk.txt')
  const auxCashFlowsContent = getTable('xjll_xm.txt')
  const auxFundSourcesContent = getTable('zjly.txt')
  const auxCustomerInitBalanceContent = getTable('dwnc.txt')
  const auxDeptInitBalanceContent = getTable('bmnc.txt')
  const auxPersonInitBalanceContent = getTable('grnc.txt')
  const auxProjectInitBalanceContent = getTable('xmnc.txt')
  const auxFundSourceInitBalanceContent = getTable('zjnc.txt')
  const currenciesContent = getTable('fbgl.txt')
  const currencyArchiveContent = getTable('bzk.txt')

  // 出纳模块表
  const cashierJournalContent = getTable('cn_mx.txt')
  const cashierInitBalanceContent = getTable('cn_nc.txt')
  const bankStatementContent = getTable('yhdzd.txt')
  const settleTypeContent = getTable('jslb.txt')
  // 固定资产模块表
  const fixedAssetContent = getTable('zc_gdzc.txt')
  const fixedAssetDeprContent = getTable('zc_yzjb.txt')
  const fixedAssetOrigChangeContent = getTable('zc_yzzj.txt')
  const fixedAssetModContent = getTable('zc_sbbd.txt')
  const fixedAssetCategoryContent = getTable('zc_sblb.txt')
  const fixedAssetStatusContent = getTable('zc_sbzt.txt')
  const fixedAssetPurposeContent = getTable('zc_sbyt.txt')
  const fixedAssetDeptContent = getTable('zc_sydw.txt')

  // 列数校验（对照 data_stru.txt，防止 \t 切分错位）
  validateTableColumns('cn_mx', cashierJournalContent)
  validateTableColumns('zc_gdzc', fixedAssetContent)
  validateTableColumns('zc_yzjb', fixedAssetDeprContent)

  return {
    xt: parseXtTable(xtContent),
    voucherTypes: splitTableRows(voucherTypeContent),
    accounts: splitTableRows(accountContent),
    initBalances: splitTableRows(initBalanceContent),
    transferTypes: splitTableRows(transferTypeContent),
    voucherEntries: splitTableRows(voucherEntryContent),
    voucherHeaders: splitTableRows(voucherHeaderContent),
    voucherTemplateHeaders: splitTableRows(voucherTemplateHeaderContent),
    voucherTemplateEntries: splitTableRows(voucherTemplateEntryContent),
    budgetSurplusAdjustments: splitTableRows(budgetSurplusAdjustmentContent),
    reportCatalog: splitTableRows(reportCatalogContent),
    reportFormulaCatalog: splitTableRows(reportFormulaCatalogContent),
    reportTemplates,
    reportTemplateBuffers,
    users: parsedUsers,
    rights: parsedRights,
    auxProjects: splitTableRows(auxProjectsContent),
    auxCustomers: splitTableRows(auxCustomersContent),
    auxDepts: splitTableRows(auxDeptsContent),
    auxPersons: splitTableRows(auxPersonsContent),
    auxCashFlows: splitTableRows(auxCashFlowsContent),
    auxFundSources: splitTableRows(auxFundSourcesContent),
    auxCustomerInitBalances: splitTableRows(auxCustomerInitBalanceContent),
    auxDeptInitBalances: splitTableRows(auxDeptInitBalanceContent),
    auxPersonInitBalances: splitTableRows(auxPersonInitBalanceContent),
    auxProjectInitBalances: splitTableRows(auxProjectInitBalanceContent),
    auxFundSourceInitBalances: splitTableRows(auxFundSourceInitBalanceContent),
    currencies: splitTableRows(currenciesContent),
    currencyArchives: splitTableRows(currencyArchiveContent),
    cashierJournal: splitTableRows(cashierJournalContent),
    cashierInitBalances: splitTableRows(cashierInitBalanceContent),
    bankStatements: splitTableRows(bankStatementContent),
    settleTypes: splitTableRows(settleTypeContent),
    fixedAssets: splitTableRows(fixedAssetContent),
    fixedAssetDepr: splitTableRows(fixedAssetDeprContent),
    fixedAssetOrigChanges: splitTableRows(fixedAssetOrigChangeContent),
    fixedAssetMods: splitTableRows(fixedAssetModContent),
    fixedAssetCategories: splitTableRows(fixedAssetCategoryContent),
    fixedAssetStatuses: splitTableRows(fixedAssetStatusContent),
    fixedAssetPurposes: splitTableRows(fixedAssetPurposeContent),
    fixedAssetDepts: splitTableRows(fixedAssetDeptContent),
  }
}

/**
 * @deprecated 已废弃 - 使用ACD文件中的级别字段
 */
function getAccountLevel(code: string): number {
  const normalized = code.replace(/\./g, '')
  if (normalized.length <= 4) return 1
  if (normalized.length <= 6) return 2
  return 3
}

/**
 * @deprecated 已废弃 - 使用getParentCodeByConfig代替
 */
function getParentCode(code: string, knownCodes: Set<string>): string | null {
  const normalized = code.replace(/\./g, '')
  const candidates: string[] = []

  if (normalized.length > 6) {
    candidates.push(normalized.slice(0, 6))
  }
  if (normalized.length > 4) {
    candidates.push(normalized.slice(0, 4))
  }

  for (const candidate of candidates) {
    if (knownCodes.has(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * 构建辅助核算类型字符串
 */
/**
 * 按系统口径生成 accounts.aux_types：JSON 对象，键为辅助类目 ID（非 code），值为默认项目 ID（无则 null）。
 * 期初辅助、凭证录入、辅助账都用 parseAccountAuxCategoryIds(aux_types) 取「类目 ID」再去 aux_categories 反查 code；
 * 旧实现写的是 "customer,dept" 这种 code 串，被当成类目 ID 后一律查不到，导致辅助科目期初页面只读且辅助期初无法打开。
 * 润衡只有一张往来单位表（dwk），wls（往来）标志并入 customer 类目。
 */
export function buildAuxTypes(
  item: {
    isDeptAux?: boolean
    isProjectAux?: boolean
    isCustomerAux?: boolean
    isSupplierAux?: boolean
    isPersonAux?: boolean
  },
  categoryIdByCode: Map<string, string>
): string | null {
  const codes: string[] = []
  if (item.isDeptAux) codes.push('dept')
  if (item.isProjectAux) codes.push('project')
  if (item.isCustomerAux || item.isSupplierAux) codes.push('customer')
  if (item.isPersonAux) codes.push('person')

  const auxTypes: Record<string, null> = {}
  for (const code of codes) {
    const categoryId = categoryIdByCode.get(code)
    if (categoryId) auxTypes[categoryId] = null
  }
  return Object.keys(auxTypes).length > 0 ? JSON.stringify(auxTypes) : null
}

/**
 * 从 ACD 的 xt.txt 中提取科目编码长度配置
 * 返回 [xt_len1, xt_len2, ..., xt_len10]
 */
export function extractAccountCodeLengthsFromXt(xt: Map<string, string>): number[] | null {
  const lengths: number[] = []

  for (let i = 1; i <= 10; i++) {
    const key = `xt_len${i}`
    const value = xt.get(key)

    if (!value) {
      // 如果某一级没有配置，返回 null 表示配置不完整
      if (i === 1) return null // 至少要有第1级
      break
    }

    const len = Number.parseInt(value.trim(), 10)
    if (isNaN(len) || len < 0) {
      return null // 配置无效
    }
    // 润衡把未启用的级次写成 xt_lenN=0（例如 4,3,3,2,2,2,0,0,0,0），0 表示到此为止
    if (len === 0) {
      if (i === 1) return null
      break
    }

    lengths.push(len)
  }

  // 补充到10级（如果不足）
  while (lengths.length < 10) {
    lengths.push(2) // 默认每级2位
  }

  if (lengths.length > 0) {
    console.log(`[ACD] 从 xt.txt 读取科目编码长度: [${lengths.join(',')}]`)
    return lengths
  }

  return null
}

/**
 * 从科目数据推断科目编码长度配置
 * 返回每级的长度数组，例如 [4,2,2,2,2,2]
 */
function inferAccountCodeLengths(rows: AcdRow[]): number[] {
  if (rows.length === 0) return [4, 2, 2, 2, 2, 2, 2, 2, 2, 2] // 默认值

  // 按级别分组，收集每级的编码长度
  const lengthsByLevel = new Map<number, Set<number>>()

  for (const row of rows) {
    const code = (row[0] || '').trim()
    const level = Number.parseInt((row[2] || '0').trim(), 10)

    if (!code || level <= 0) continue

    if (!lengthsByLevel.has(level)) {
      lengthsByLevel.set(level, new Set())
    }
    lengthsByLevel.get(level)!.add(code.length)
  }

  // 找出最大级数
  const maxLevel = Math.max(...Array.from(lengthsByLevel.keys()))
  if (maxLevel === 0) return [4, 2, 2, 2, 2, 2, 2, 2, 2, 2]

  // 计算每级的长度
  const codeLengths: number[] = []
  let prevTotalLength = 0

  for (let level = 1; level <= maxLevel; level++) {
    const lengths = lengthsByLevel.get(level)
    if (!lengths || lengths.size === 0) {
      // 如果某级没有数据，使用默认值2
      codeLengths.push(2)
      prevTotalLength += 2
      continue
    }

    // 取该级最常见的长度
    const lengthArray = Array.from(lengths)
    const mostCommonLength = lengthArray.sort(
      (a, b) => lengthArray.filter(x => x === b).length - lengthArray.filter(x => x === a).length
    )[0]

    // 计算该级的增量长度
    const incrementLength = mostCommonLength - prevTotalLength
    codeLengths.push(incrementLength > 0 ? incrementLength : 2)
    prevTotalLength = mostCommonLength
  }

  // 补充到至少10级
  while (codeLengths.length < 10) {
    codeLengths.push(2)
  }

  console.log(`[ACD] 推断科目编码长度: [${codeLengths.join(',')}]`)
  return codeLengths
}

function inferAccountLevelsFromAccounts(rows: AcdRow[]): number {
  let maxLevel = 0
  for (const row of rows) {
    const level = Number.parseInt((row[2] || '0').trim(), 10)
    if (level > maxLevel) maxLevel = level
  }
  return maxLevel > 0 ? Math.min(10, maxLevel) : 6
}

/**
 * 基于配置计算父科目编码
 */
function getParentCodeByConfig(code: string, level: number, codeLengths: number[]): string | null {
  if (level <= 1) return null

  // 计算父级的长度（当前级别-1的累加长度）
  let parentLength = 0
  for (let i = 0; i < level - 1; i++) {
    parentLength += codeLengths[i]
  }

  return code.substring(0, parentLength)
}

function sanitizeReportName(name: string, fallback: string) {
  const trimmed = name.trim()
  return trimmed || fallback
}

function decodeVtsContent(content: string): string {
  return decodeTableContent(content)
}

function isReadableVtsText(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.length > 120) return false
  if (/^[\x00-\x1f\x7f]+$/.test(trimmed)) return false

  const printable = Array.from(trimmed).filter(char => {
    const code = char.charCodeAt(0)
    return code >= 0x20 || /[\u4e00-\u9fff]/.test(char)
  }).length

  return printable / trimmed.length >= 0.7
}

function isSheetMarker(value: string): boolean {
  return /^Sheet\d+$/i.test(value.trim())
}

function isFormulaToken(value: string): boolean {
  return /^@\w+\([^\)]*\)$/i.test(value.trim())
}

function isMeaningfulChineseToken(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (!/[\u4e00-\u9fff]/.test(trimmed)) return false
  if (/[\ue000-\uf8ff]/.test(trimmed)) return false
  if (/^(宋体|仿宋|黑体|楷体|华文[\u4e00-\u9fff]+)$/u.test(trimmed)) return false
  if (trimmed.length <= 1) return false
  if (/^[\u4e00-\u9fff]{2,}$/.test(trimmed)) return true
  if (/^[\u4e00-\u9fff][\u4e00-\u9fff\s：:、，（）()\-]*$/.test(trimmed)) return true
  if (/^[一二三四五六七八九十]+[、，.．].+/.test(trimmed)) return true
  if (/^[（(][一二三四五六七八九十]+[）)].+/.test(trimmed)) return true
  if (/^[0-9]+[.．、].+/.test(trimmed) && /[\u4e00-\u9fff]/.test(trimmed)) return true
  return false
}

function isLikelyVtsNoise(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (trimmed.length <= 1 && !/[\u4e00-\u9fff]/.test(trimmed)) return true
  if (/^[A-Za-z]:\\/.test(trimmed)) return true
  if (
    /^(Arial|Times New Roman|MS Sans Serif|System|Fixedsys|Courier New|宋体|仿宋|黑体|楷体|华文[\u4e00-\u9fff]+)\d*$/i.test(
      trimmed
    )
  )
    return true
  if (/^(True|False|Printer|Print|Preview|Setup|System|Object|VB\.|Begin|End)$/i.test(trimmed))
    return true
  if (/^(Left|Right|Top|Bottom|Center|General|Landscape|Portrait)$/i.test(trimmed)) return true
  if (/^(mm|cm|pt|inch|inches|dpi)$/i.test(trimmed)) return true
  if (/^[A-Za-z0-9_\-]{1,3}$/.test(trimmed) && !/\d/.test(trimmed)) return true
  if (/^[A-Za-z0-9_\-]{20,}$/.test(trimmed) && !/[\u4e00-\u9fff]/.test(trimmed)) return true
  if (/^[0-9.,:;\/\\\-]+$/.test(trimmed)) return true
  if (/^[#"$%\\()\[\],.;:_\-]+/.test(trimmed)) return true
  if (/\\\(|\\\)|_\)/.test(trimmed)) return true
  if (/�/.test(trimmed)) return true
  return false
}

function normalizeVtsToken(value: string): string {
  return value
    .replace(/[~&]+$/g, '')
    .replace(/�+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolvePreferredSheetName(
  tokens: string[],
  fallbackSheetName: string,
  sheetIndex: number
): string {
  const preferred = tokens.find(token => {
    if (isSheetMarker(token) || isFormulaToken(token)) return false
    if (token === fallbackSheetName || token === `${fallbackSheetName}(定义)`) return false
    if (!/表/.test(token)) return false
    if (/^(制表[:：]?|单位负责人[:：]?|财务负责人[:：]?)$/.test(token)) return false
    if (/^请根据.+填写此表的公式$/.test(token)) return false
    if (/^说明[:：]?/.test(token)) return false
    if (token.length > 24) return false
    return true
  })

  if (preferred) return preferred
  return sheetIndex === 0 ? fallbackSheetName : `${fallbackSheetName}-${sheetIndex + 1}`
}

function shouldKeepVtsToken(value: string, fallbackSheetName: string): boolean {
  const normalized = normalizeVtsToken(value)
  if (!normalized) return false
  if (normalized === fallbackSheetName || normalized === `${fallbackSheetName}(定义)`) return false
  if (isSheetMarker(normalized) || isFormulaToken(normalized)) return true
  if (isLikelyVtsNoise(normalized)) return false
  if (isMeaningfulChineseToken(normalized)) return true
  return /^(单位[:：]?元|本月数|本年累计数|本期发生额|累计发生额|累计完成数|项 目|项目|合 计|总 计)$/u.test(
    normalized
  )
}

function extractVtsStrings(content: string, fallbackSheetName: string): VtsStringMatch[] {
  const matches: VtsStringMatch[] = []
  let current = ''
  let start = -1

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const code = char.charCodeAt(0)
    const isReadable = (code >= 0x20 && code !== 0x7f) || /[\u4e00-\u9fff]/.test(char)

    if (isReadable) {
      if (current.length === 0) {
        start = index
      }
      current += char
      continue
    }

    if (current.length > 0 && isReadableVtsText(current)) {
      const normalized = normalizeVtsToken(current)
      if (shouldKeepVtsToken(normalized, fallbackSheetName)) {
        matches.push({ index: start, value: normalized })
      }
    }
    current = ''
    start = -1
  }

  if (current.length > 0 && isReadableVtsText(current)) {
    const normalized = normalizeVtsToken(current)
    if (shouldKeepVtsToken(normalized, fallbackSheetName)) {
      matches.push({ index: start, value: normalized })
    }
  }

  return matches
}

function normalizeSheetName(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed
}

function buildVtsCellsFromStrings(
  matches: VtsStringMatch[],
  fallbackSheetName: string
): ParsedVtsSheet[] {
  const sheets: ParsedVtsSheet[] = []
  let pendingSheetMarker: string | null = null
  let pendingSheetMarkerIndex = -1
  let currentSheet: ParsedVtsSheet = {
    key: 'sheet1',
    name: fallbackSheetName,
    index: 0,
    cells: [],
  }
  let currentSheetTokens: string[] = []
  let rowIndex = 0
  let lastWasHeaderPair = false
  let pendingColumnLabels: string[] = []
  let pendingColumnLabelGroups: string[][] = []

  const isDefinitionOnlySheet = (sheet: ParsedVtsSheet) => {
    if (sheet.cells.length !== 1) return false
    const [cell] = sheet.cells
    return cell.cellType === 'text' && /\(定义\)$/.test(cell.textValue || '')
  }

  const isHeaderValue = (value: string) =>
    /^(单位[:：]?元|本月数|本年累计数|本期发生额|累计发生额|累计完成数|上年数|本年数)$/u.test(value)
  const isSectionTitle = (value: string) => /^[一二三四五六七八九十]+[、，.．].+/u.test(value)
  const isIndentedProject = (value: string) => /^[（(][一二三四五六七八九十]+[）)].+/u.test(value)
  const isProjectLabel = (value: string) => isSectionTitle(value) || isIndentedProject(value)
  const isEnumeratedLabel = (value: string) => /^[0-9]+[.．、].+/u.test(value)
  const isColumnHeaderFragment = (value: string) =>
    /^(调整年初|本年|本年归|单位内部|本年财政|年末财政拨款|结转结余|财政拨款|归集|集上缴|调剂|拨款收入|拨款支出|结转|结余|调入|或调出)$/u.test(
      value
    )
  const isColumnHeaderGroupBoundary = (value: string) =>
    /^(结转结余|财政拨款|拨款收入|拨款支出|结转|调入|调整年初|年末财政拨款)$/u.test(value)
  const mergeColumnHeaderGroup = (group: string[]): string[] => {
    const merged: string[] = []
    for (const token of group) {
      const previous = merged[merged.length - 1] || ''
      if (!previous) {
        merged.push(token)
        continue
      }

      const combine = (() => {
        if (previous === '本年' && token === '归') return '本年归'
        if (previous === '本年归' && token === '单位内部') return '本年归还单位内部款'
        if (previous === '本年财政' && token === '本年财政') return '本年财政拨款'
        if (previous === '本年财政拨款' && token === '年末财政拨款')
          return '本年财政拨款和年末财政拨款'
        if (previous === '财政拨款' && token === '归集') return '财政拨款归集'
        if (previous === '财政拨款归集' && token === '集上缴') return '财政拨款归集上缴'
        if (previous === '结转' && token === '结余') return '结转结余'
        if (previous === '调入' && token === '或调出') return '调入或调出'
        return null
      })()

      if (combine) {
        merged[merged.length - 1] = combine
      } else {
        merged.push(token)
      }
    }

    return merged.filter((label, index, array) => {
      if (label !== '结转结余') return true
      const previous = array[index - 1] || ''
      return previous !== '结转结余'
    })
  }
  const isContinuationLabel = (value: string) => /^(其中[:：]|从.+提取|设置专用基金)$/u.test(value)

  const pushCurrentSheet = () => {
    if (currentSheet.cells.length === 0) return
    if (isDefinitionOnlySheet(currentSheet)) {
      currentSheet = {
        key: currentSheet.key,
        name: fallbackSheetName,
        index: currentSheet.index,
        cells: [],
      }
      currentSheetTokens = []
      rowIndex = 0
      lastWasHeaderPair = false
      pendingColumnLabels = []
      pendingColumnLabelGroups = []
      return
    }

    sheets.push({
      ...currentSheet,
      name: resolvePreferredSheetName(currentSheetTokens, fallbackSheetName, currentSheet.index),
      cells: [...currentSheet.cells],
    })
  }

  const startNextSheet = (marker: string, markerIndex: number) => {
    const nextIndex = sheets.length
    currentSheet = {
      key: `sheet${nextIndex + 1}`,
      name: normalizeSheetName(marker, `${fallbackSheetName}-${nextIndex + 1}`),
      index: nextIndex,
      cells: [],
    }
    currentSheetTokens = []
    rowIndex = 0
    lastWasHeaderPair = false
    pendingColumnLabels = []
    pendingColumnLabelGroups = []
    pendingSheetMarker = marker
    pendingSheetMarkerIndex = markerIndex
  }

  const rowHasCol = (targetRowIndex: number, targetColIndex: number) =>
    currentSheet.cells.some(
      cell => cell.rowIndex === targetRowIndex && cell.colIndex === targetColIndex
    )

  const pushCell = (
    value: string,
    cellType: ParsedVtsCell['cellType'],
    targetColIndex: number,
    targetRowIndex = rowIndex
  ) => {
    currentSheetTokens.push(value)
    currentSheet.cells.push({
      rowIndex: targetRowIndex,
      colIndex: targetColIndex,
      cellType,
      textValue: cellType === 'formula' ? null : value,
      formulaText: cellType === 'formula' ? value : null,
      formatText: null,
    })
  }

  const startNextRow = () => {
    rowIndex += 1
    lastWasHeaderPair = false
  }

  const flushPendingColumnLabels = () => {
    if (pendingColumnLabels.length > 0) {
      pendingColumnLabelGroups.push([...pendingColumnLabels])
      pendingColumnLabels = []
    }

    if (pendingColumnLabelGroups.length === 0) return

    const headerStartRowIndex = rowIndex
    pendingColumnLabelGroups.forEach((group, groupIndex) => {
      const targetRowIndex = headerStartRowIndex + groupIndex
      const mergedGroup = mergeColumnHeaderGroup(group)
      mergedGroup.forEach((label, index) => {
        pushCell(label, 'text', index + 1, targetRowIndex)
      })
    })

    rowIndex = headerStartRowIndex + pendingColumnLabelGroups.length
    pendingColumnLabelGroups = []
    lastWasHeaderPair = true
  }

  for (const match of matches) {
    const value = match.value
    if (isSheetMarker(value)) {
      pendingSheetMarker = value
      pendingSheetMarkerIndex = match.index
      continue
    }

    if (pendingSheetMarker && match.index - pendingSheetMarkerIndex <= 12) {
      continue
    }

    if (pendingSheetMarker) {
      flushPendingColumnLabels()
      pushCurrentSheet()
      startNextSheet(pendingSheetMarker, pendingSheetMarkerIndex)
      pendingSheetMarker = null
      pendingSheetMarkerIndex = -1
    }

    if (/\(定义\)$/.test(value)) {
      if (currentSheet.cells.length === 0) {
        currentSheetTokens.push(value)
      }
      continue
    }

    const cellType: ParsedVtsCell['cellType'] = isFormulaToken(value) ? 'formula' : 'text'

    if (cellType === 'formula') {
      flushPendingColumnLabels()
      pushCell(value, cellType, 1)
      startNextRow()
      continue
    }

    if (value === '项 目' || value === '项目') {
      flushPendingColumnLabels()
      const targetRowIndex = rowHasCol(rowIndex, 0) ? rowIndex : Math.max(rowIndex - 1, 0)
      pushCell(value, cellType, 1, targetRowIndex)
      if (targetRowIndex === rowIndex) {
        startNextRow()
      }
      lastWasHeaderPair = true
      continue
    }

    if (isHeaderValue(value)) {
      flushPendingColumnLabels()
      const targetColIndex = rowHasCol(rowIndex, 0) ? 1 : 0
      pushCell(value, cellType, targetColIndex)
      if (targetColIndex === 1) {
        lastWasHeaderPair = true
        startNextRow()
      }
      continue
    }

    if (isColumnHeaderFragment(value)) {
      if (isColumnHeaderGroupBoundary(value) && pendingColumnLabels.length > 0) {
        pendingColumnLabelGroups.push([...pendingColumnLabels])
        pendingColumnLabels = []
      }
      pendingColumnLabels.push(value)
      continue
    }

    if (isContinuationLabel(value)) {
      flushPendingColumnLabels()
      pushCell(value, cellType, 1)
      startNextRow()
      continue
    }

    flushPendingColumnLabels()

    if (isProjectLabel(value) || isEnumeratedLabel(value)) {
      pushCell(value, cellType, 0)
      startNextRow()
      continue
    }

    if (lastWasHeaderPair) {
      pushCell(value, cellType, 1)
      startNextRow()
      continue
    }

    pushCell(value, cellType, 0)
    startNextRow()
  }

  flushPendingColumnLabels()
  pushCurrentSheet()
  return sheets
}

function extractQuotedVtsValue(segment: string): string {
  const match = segment.match(/"((?:[^"]|"")*)"/)
  if (!match) return ''
  return match[1].replace(/""/g, '"').trim()
}

function parseVtsCellLine(line: string): ParsedVtsCell | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const cellMatch = trimmed.match(/^CELL\s+([A-Z]+)(\d+)(.*)$/i)
  if (!cellMatch) return null

  const columnLabel = cellMatch[1].toUpperCase()
  const rowIndex = Number.parseInt(cellMatch[2], 10)
  const remainder = cellMatch[3] || ''

  if (!Number.isInteger(rowIndex) || rowIndex <= 0) {
    return null
  }

  let colIndex = 0
  for (const char of columnLabel) {
    colIndex = colIndex * 26 + (char.charCodeAt(0) - 64)
  }

  const formulaText = (() => {
    const formulaMatch = remainder.match(/\b(?:FORMULA|FX)\s+"((?:[^"]|"")*)"/i)
    if (!formulaMatch) return null
    return formulaMatch[1].replace(/""/g, '"').trim() || null
  })()

  const formatText = (() => {
    const formatMatch = remainder.match(/\bFORMAT\s+"((?:[^"]|"")*)"/i)
    if (!formatMatch) return null
    return formatMatch[1].replace(/""/g, '"').trim() || null
  })()

  let textValue = extractQuotedVtsValue(remainder)
  if (formulaText && textValue === formulaText) {
    textValue = ''
  }

  const numericCandidate = textValue.replace(/,/g, '')
  const isNumeric = numericCandidate !== '' && /^-?\d+(?:\.\d+)?$/.test(numericCandidate)
  const cellType: ParsedVtsCell['cellType'] = formulaText
    ? 'formula'
    : isNumeric
      ? 'number'
      : 'text'

  return {
    rowIndex: rowIndex - 1,
    colIndex: colIndex - 1,
    cellType,
    textValue: textValue || null,
    formulaText,
    formatText,
  }
}

/**
 * Parse VTS content as a full-table paste grid.
 * Rules:
 * - Cell starts with '=' or '@' => formula
 * - Other non-empty cells => text
 * - Empty cells are ignored
 */
function parsePastedGridTemplate(content: string, fallbackSheetName: string): ParsedVtsTemplate {
  const normalizePunctuation = (input: string) =>
    input
      .replace(/\u3000/g, ' ') // full-width space
      .replace(/[：]/g, ':')
      .replace(/[，]/g, ',')
      .replace(/[。]/g, '.')
      .replace(/[；]/g, ';')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')

  const normalized = normalizePunctuation(decodeTableContent(content))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  const rawRows = normalized.split('\n').map(row => row.replace(/[\t ]+$/g, ''))

  // Trim leading/trailing fully-empty rows
  let startRow = 0
  let endRow = rawRows.length - 1
  while (startRow <= endRow && rawRows[startRow].trim() === '') startRow += 1
  while (endRow >= startRow && rawRows[endRow].trim() === '') endRow -= 1

  const slicedRows = startRow <= endRow ? rawRows.slice(startRow, endRow + 1) : []
  const splitRows = slicedRows.map(row => row.split('\t'))

  // Determine effective max column (drop trailing fully-empty columns)
  let maxCol = -1
  splitRows.forEach(cols => {
    for (let i = cols.length - 1; i >= 0; i -= 1) {
      const value = cols[i].replace(/\u00a0/g, ' ').trim()
      if (value !== '') {
        if (i > maxCol) maxCol = i
        break
      }
    }
  })

  // Hard anchors for top header rows (especially balance sheet templates)
  const headerAnchors: Array<{ key: string; pattern: RegExp; targetRow: number }> = [
    { key: 'title', pattern: /资产负债表|利润表|现金流量表/, targetRow: 0 },
    { key: 'org', pattern: /编制单位[:：]|单位[:：]/, targetRow: 2 },
    { key: 'date', pattern: /日期[:：]|会计期间/, targetRow: 3 },
  ]

  const detectHeaderAnchor = (rowText: string) => {
    const text = rowText.replace(/\s+/g, '')
    return headerAnchors.find(anchor => anchor.pattern.test(text)) || null
  }

  const isNoiseRow = (cols: string[]) => {
    const compact = cols
      .map(v => v.replace(/\u00a0/g, ' ').trim())
      .filter(Boolean)
      .join('')

    if (!compact) return true
    // Entire row is only punctuation/noise symbols
    if (/^[#"$%\\()\[\],.;:_\-~`!@^&*+=|/<>?]+$/.test(compact)) return true
    // OCR-like dense garbage
    if (/^[^\u4e00-\u9fa5A-Za-z0-9]{8,}$/.test(compact)) return true

    return false
  }

  type RowPlacement = {
    sourceRowIndex: number
    targetRowIndex: number
    cols: string[]
    isHeader: boolean
  }

  const occupiedRows = new Set<number>()
  const placements: RowPlacement[] = []

  // 1) place anchored header rows first (hard anchors in top N rows)
  splitRows.forEach((cols, sourceRowIndex) => {
    const rowText = cols.join('')
    const anchor = detectHeaderAnchor(rowText)
    if (!anchor) return

    let targetRowIndex = anchor.targetRow
    while (occupiedRows.has(targetRowIndex)) {
      targetRowIndex += 1
    }

    occupiedRows.add(targetRowIndex)
    placements.push({ sourceRowIndex, targetRowIndex, cols, isHeader: true })
  })

  // 2) place body rows in original order, skipping occupied rows
  let bodyCursor = 0
  splitRows.forEach((cols, sourceRowIndex) => {
    const rowText = cols.join('')
    const anchor = detectHeaderAnchor(rowText)
    if (anchor) return
    if (isNoiseRow(cols)) return

    while (occupiedRows.has(bodyCursor)) {
      bodyCursor += 1
    }

    placements.push({ sourceRowIndex, targetRowIndex: bodyCursor, cols, isHeader: false })
    occupiedRows.add(bodyCursor)
    bodyCursor += 1
  })

  placements.sort(
    (a, b) => a.targetRowIndex - b.targetRowIndex || a.sourceRowIndex - b.sourceRowIndex
  )

  const cells: ParsedVtsCell[] = []
  const formulas = new Set<string>()

  placements.forEach(({ targetRowIndex, cols, isHeader }) => {
    if (maxCol < 0) return

    for (let colIndex = 0; colIndex <= maxCol; colIndex += 1) {
      const rawCell = cols[colIndex] ?? ''
      const value = normalizePunctuation(rawCell.replace(/\u00a0/g, ' ').trim())
      if (!value) continue

      // Skip obvious OCR/garbled noise chunks for non-header rows
      if (!isHeader && /^[#"$%\\()\[\],.;:_\-~`!@^&*+=|/<>?]+$/.test(value)) continue

      const isFormula = value.startsWith('=') || value.startsWith('@')
      const cellType: ParsedVtsCell['cellType'] = isFormula ? 'formula' : 'text'

      cells.push({
        rowIndex: targetRowIndex,
        colIndex,
        cellType,
        textValue: isFormula ? null : value,
        formulaText: isFormula ? value : null,
        formatText: null,
      })

      if (isFormula) {
        formulas.add(value)
      }
    }
  })

  const sheet: ParsedVtsSheet = {
    key: 'sheet1',
    name: fallbackSheetName,
    index: 0,
    cells,
  }

  return {
    sheets: cells.length > 0 ? [sheet] : [],
    formulas: Array.from(formulas),
  }
}

function parseBinaryVtsTemplate(buffer: Buffer, fallbackSheetName: string): ParsedVtsTemplate {
  const decoded = iconv.decode(buffer, 'gb18030')
  return parsePastedGridTemplate(decoded, fallbackSheetName)
}

function parseVtsTemplate(content: string, fallbackSheetName: string): ParsedVtsTemplate {
  const decoded = decodeVtsContent(content)
  return parsePastedGridTemplate(decoded, fallbackSheetName)
}

function extractFormulaFunctionNames(formulas: string[]): string[] {
  const functions = new Set<string>()

  for (const formula of formulas) {
    const matches = formula.matchAll(/@([a-zA-Z_][\w]*)/g)
    for (const match of matches) {
      functions.add(match[1].toLowerCase())
    }
  }

  return Array.from(functions).sort((a, b) => a.localeCompare(b))
}

function buildReportDefinitionSeeds(
  rows: AcdRow[],
  reportTemplates: Map<string, string>
): ReportDefinitionSeed[] {
  const seeds: ReportDefinitionSeed[] = []

  rows.forEach((row, index) => {
    const code = (row[0] || '').trim()
    if (!code) return

    const sourceFile = `bb${code.padStart(5, '0')}.vts`
    if (!reportTemplates.has(sourceFile.toLowerCase())) {
      return
    }

    const rawName = (row[1] || '').trim()
    // bbml 中名称为空的条目视为占位，不导入
    if (!rawName) return

    seeds.push({
      code,
      name: sanitizeReportName(rawName, `报表${code}`),
      sourceFile,
      sortOrder: index,
    })
  })

  return seeds
}

function importReportTemplates(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  const reportSeeds = buildReportDefinitionSeeds(tables.reportCatalog, tables.reportTemplates)

  if (tables.reportCatalog.length === 0) {
    stats.warnings.push('bbml.txt 没有可导入数据')
    return
  }

  stats.importedTables.push('bbml.txt')
  if (tables.reportFormulaCatalog.length > 0) {
    stats.importedTables.push('bbml_gs.txt')
  }
  for (const fileName of tables.reportTemplates.keys()) {
    stats.importedTables.push(fileName)
  }

  if (reportSeeds.length === 0) {
    stats.warnings.push('未匹配到可导入的报表模板文件')
    return
  }

  const parsedTemplates = new Map<string, ParsedVtsTemplate>()
  const allFormulaTexts: string[] = []
  for (const reportSeed of reportSeeds) {
    const rawBuffer = tables.reportTemplateBuffers.get(reportSeed.sourceFile.toLowerCase())
    const rawTemplate = tables.reportTemplates.get(reportSeed.sourceFile.toLowerCase()) || ''

    // Use binary parsing if buffer is available, otherwise fall back to string parsing
    const parsedTemplate = rawBuffer
      ? parseBinaryVtsTemplate(rawBuffer, reportSeed.name)
      : parseVtsTemplate(rawTemplate, reportSeed.name)

    const cellCount = parsedTemplate.sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0)
    if (cellCount === 0) {
      stats.warnings.push(`跳过空报表模板: ${reportSeed.name} (${reportSeed.sourceFile})`)
      continue
    }

    parsedTemplates.set(reportSeed.code, parsedTemplate)
    stats.reportTemplates.definitions += 1
    stats.reportTemplates.sheets += parsedTemplate.sheets.length
    stats.reportTemplates.cells += parsedTemplate.sheets.reduce(
      (sum, sheet) => sum + sheet.cells.length,
      0
    )
    allFormulaTexts.push(...parsedTemplate.formulas)
  }

  const formulaFunctionNames = extractFormulaFunctionNames(allFormulaTexts)
  stats.reportTemplates.formulas = formulaFunctionNames.length

  if (dryRun) return

  const existingDefinitions = db
    .prepare('SELECT id, code FROM report_definitions WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; code: string }>
  const definitionIdByCode = new Map(existingDefinitions.map(item => [String(item.code), item.id]))

  const upsertDefinition = db.prepare(`
    INSERT INTO report_definitions (id, account_set_id, code, name, source, source_file, sort_order, is_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'acd', ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(account_set_id, code)
    DO UPDATE SET name = excluded.name, source = excluded.source, source_file = excluded.source_file, sort_order = excluded.sort_order, updated_at = datetime('now')
  `)
  const deleteSheets = db.prepare(`DELETE FROM report_sheets WHERE report_definition_id = ?`)
  const deleteSources = db.prepare(
    `DELETE FROM report_template_sources WHERE report_definition_id = ?`
  )
  const deleteFormulaFunctions = db.prepare(
    `DELETE FROM report_formula_functions WHERE account_set_id = ?`
  )
  const insertSheet = db.prepare(
    `INSERT INTO report_sheets (id, report_definition_id, sheet_key, sheet_name, sheet_index, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`
  )
  const insertSource = db.prepare(
    `INSERT INTO report_template_sources (id, report_definition_id, source_file, source_type, raw_content, content_encoding, parse_version, created_at) VALUES (?, ?, ?, 'vts', ?, 'gb18030', 'grid-paste-v2', datetime('now'))`
  )
  const insertCell = db.prepare(
    `INSERT INTO report_cells (id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, datetime('now'), datetime('now'))`
  )
  const insertFormulaFunction = db.prepare(
    `INSERT INTO report_formula_functions (id, account_set_id, function_name, handler_key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )

  deleteFormulaFunctions.run(accountSetId)
  for (const functionName of formulaFunctionNames) {
    insertFormulaFunction.run(
      uuidv4(),
      accountSetId,
      functionName,
      `acd:${functionName}`,
      'ACD 报表公式函数（待实现执行器）'
    )
  }

  for (const reportSeed of reportSeeds) {
    const parsedTemplate = parsedTemplates.get(reportSeed.code)
    if (!parsedTemplate) continue

    const definitionId = definitionIdByCode.get(reportSeed.code) || uuidv4()
    const rawTemplate = tables.reportTemplates.get(reportSeed.sourceFile.toLowerCase()) || ''

    upsertDefinition.run(
      definitionId,
      accountSetId,
      reportSeed.code,
      reportSeed.name,
      reportSeed.sourceFile,
      reportSeed.sortOrder
    )
    definitionIdByCode.set(reportSeed.code, definitionId)

    deleteSheets.run(definitionId)
    deleteSources.run(definitionId)

    insertSource.run(uuidv4(), definitionId, reportSeed.sourceFile, rawTemplate)

    if (parsedTemplate.sheets.length === 0) {
      insertSheet.run(uuidv4(), definitionId, 'sheet1', reportSeed.name, 0)
      continue
    }

    for (const sheet of parsedTemplate.sheets) {
      const sheetId = uuidv4()
      const dedupedCells = sheet.cells.filter((cell, index, allCells) => {
        const firstIndex = allCells.findIndex(
          candidate => candidate.rowIndex === cell.rowIndex && candidate.colIndex === cell.colIndex
        )
        return firstIndex === index
      })
      insertSheet.run(sheetId, definitionId, sheet.key, sheet.name, sheet.index)
      for (const cell of dedupedCells) {
        insertCell.run(
          uuidv4(),
          sheetId,
          cell.rowIndex,
          cell.colIndex,
          cell.cellType,
          cell.textValue,
          cell.formulaText,
          cell.formatText
        )
      }
    }
  }
}

function resolveCurrentAccountSet() {
  const db = getDb()
  const accountSet = db.prepare('SELECT * FROM account_sets LIMIT 1').get() as any
  if (!accountSet) {
    throw new Error('没有找到账套，请先初始化数据库')
  }
  return accountSet
}

export function buildStats(accountSetId: string, accountSetName: string): ImportStats {
  return {
    accountSetId,
    accountSetName,
    importedTables: [],
    systemParams: { upserted: 0 },
    voucherTypes: { inserted: 0, updated: 0, skipped: 0 },
    accounts: { inserted: 0, updated: 0, skipped: 0 },
    foreignAccounts: 0,
    currencies: { inserted: 0, updated: 0 },
    initBalances: { inserted: 0, skipped: 0 },
    auxInitBalances: { inserted: 0, skipped: 0 },
    transferTypes: { types: 0, items: 0 },
    vouchers: { vouchers: 0, entries: 0 },
    voucherTemplates: 0,
    accountBalanceRows: 0,
    budgetSurplusAdjustments: { inserted: 0, skipped: 0 },
    users: 0,
    periodClosing: { closedCount: 0, from: '', to: '' },
    reportTemplates: { definitions: 0, sheets: 0, cells: 0, formulas: 0 },
    auxiliaryData: {
      totalItems: 0,
      projects: 0,
      customers: 0,
      depts: 0,
      persons: 0,
      cashFlows: 0,
      fundSources: 0,
    },
    cashier: { journal: 0, initBalances: 0, bankStatements: 0, settleTypes: 0 },
    fixedAsset: {
      assets: 0,
      depr: 0,
      changes: 0,
      categories: 0,
      statuses: 0,
      purposes: 0,
      depts: 0,
    },
    warnings: [],
  }
}

/**
 * 确保辅助核算类别存在
 * 返回 Map<code, categoryId>
 */
function ensureAuxCategories(accountSetId: string, db: any): Map<string, string> {
  const categories = [
    { code: 'project', name: '项目', sortOrder: 1 },
    { code: 'customer', name: '往来单位', sortOrder: 2 },
    { code: 'dept', name: '部门', sortOrder: 3 },
    { code: 'person', name: '个人', sortOrder: 4 },
    { code: 'cash_flow', name: '现金流量项目', sortOrder: 5 },
    { code: 'fund_source', name: '资金来源', sortOrder: 6 },
  ]

  const categoryMap = new Map<string, string>()

  for (const cat of categories) {
    // 查找或创建类别
    const existing = db
      .prepare('SELECT id FROM aux_categories WHERE account_set_id = ? AND code = ?')
      .get(accountSetId, cat.code) as { id: string } | undefined

    if (!existing) {
      const id = uuidv4()
      db.prepare(
        `INSERT INTO aux_categories (id, account_set_id, code, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run(id, accountSetId, cat.code, cat.name, cat.sortOrder)
      categoryMap.set(cat.code, id)
    } else {
      categoryMap.set(cat.code, existing.id)
    }
  }

  return categoryMap
}

/** 现金流量类别：确保「流向」自定义字段存在（核算项目页展示） */
function ensureCashFlowCategoryFields(accountSetId: string, categoryId: string, db: any) {
  const existing = db
    .prepare(
      `SELECT id FROM aux_category_fields
       WHERE category_id = ? AND field_key = 'direction'`
    )
    .get(categoryId) as { id: string } | undefined
  if (existing) return

  db.prepare(
    `INSERT INTO aux_category_fields (
      id, category_id, field_key, field_name, field_type, options_json,
      show_in_voucher, required_in_voucher, required_in_archive, sort_order, is_enabled,
      created_at, updated_at
    ) VALUES (?, ?, 'direction', '流向', 'select', ?, 0, 0, 0, 0, 1, datetime('now'), datetime('now'))`
  ).run(uuidv4(), categoryId, JSON.stringify(['流入', '流出', '中性']))
}

/**
 * 导入现金流量项目（xjll_xm）：含 jd 流向，双写 aux_items + cash_flow_items
 */
function cashFlowItemsTableExists(db: {
  prepare: (sql: string) => { get: () => unknown }
}): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cash_flow_items'")
    .get() as { name: string } | undefined
  return row?.name === 'cash_flow_items'
}

function importCashFlowAuxItems(
  accountSetId: string,
  categoryId: string,
  rows: AcdRow[],
  stats: ImportStats,
  dryRun: boolean
): number {
  if (rows.length === 0) return 0

  const db = getDb()
  const syncCashFlowTable = cashFlowItemsTableExists(db)
  if (!syncCashFlowTable) {
    stats.warnings.push('数据库缺少 cash_flow_items 表，现金流量仅写入核算项目')
  }
  ensureCashFlowCategoryFields(accountSetId, categoryId, db)

  const existingAux = db
    .prepare('SELECT code FROM aux_items WHERE account_set_id = ? AND type = ?')
    .all(accountSetId, categoryId) as Array<{ code: string }>
  const existingAuxCodes = new Set(existingAux.map(item => item.code))

  const existingCfCodes = new Set<string>()
  let insertCfStmt: any = null
  if (syncCashFlowTable) {
    const existingCf = db
      .prepare('SELECT code FROM cash_flow_items WHERE account_set_id = ?')
      .all(accountSetId) as Array<{ code: string }>
    existingCf.forEach(item => existingCfCodes.add(item.code))
    insertCfStmt = db.prepare(`
      INSERT INTO cash_flow_items (
        id, account_set_id, code, name, direction, parent_code,
        level, is_leaf, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 1, 1, 0, 1, datetime('now'), datetime('now'))
    `)
  }

  const insertAuxStmt = db.prepare(`
    INSERT INTO aux_items (id, account_set_id, type, code, name, status, field_values, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
  `)

  let imported = 0
  let neutralJdCount = 0

  for (const row of rows) {
    const code = (row[0] || '').trim()
    const name = (row[1] || '').trim()
    const jd = (row[2] || '').trim()
    if (!code || !name) continue

    const direction = mapAcdCashFlowJd(jd)
    if (direction === 'neutral' && jd) {
      neutralJdCount++
    }

    const skipAux = existingAuxCodes.has(code)
    const skipCf = syncCashFlowTable && existingCfCodes.has(code)
    if (skipAux && (!syncCashFlowTable || skipCf)) continue

    if (!dryRun) {
      const fieldValues = JSON.stringify({ direction })
      if (!skipAux) {
        insertAuxStmt.run(uuidv4(), accountSetId, categoryId, code, name, fieldValues)
        existingAuxCodes.add(code)
      }
      if (syncCashFlowTable && insertCfStmt && !skipCf) {
        insertCfStmt.run(uuidv4(), accountSetId, code, name, direction)
        existingCfCodes.add(code)
      }
    }
    imported++
  }

  if (neutralJdCount > 0) {
    stats.warnings.push(`现金流量项目有 ${neutralJdCount} 条 jd 无法识别，已设为中性流向`)
  }

  if (imported > 0) {
    console.log(`[ACD] 导入 cash_flow（含流向）: ${imported} 项`)
  }
  return imported
}

/**
 * 导入辅助核算项目
 * @param categoryCode 类别代码（如 'project'）
 * @param categoryId 类别ID
 * @param rows ACD 表行数据
 * @param codeIndex 编码列索引
 * @param nameIndex 名称列索引
 */
function importAuxItems(
  accountSetId: string,
  categoryCode: string,
  categoryId: string,
  rows: AcdRow[],
  codeIndex: number,
  nameIndex: number,
  stats: ImportStats,
  dryRun: boolean,
  extra?: (
    row: AcdRow
  ) => { field_values?: Record<string, string>; remark?: string } | undefined
): number {
  if (rows.length === 0) return 0

  const db = getDb()
  const existing = db
    .prepare('SELECT code FROM aux_items WHERE account_set_id = ? AND type = ?')
    .all(accountSetId, categoryId) as Array<{ code: string }>
  const existingCodes = new Set(existing.map(item => item.code))

  const insertStmt = db.prepare(`
    INSERT INTO aux_items (id, account_set_id, type, code, name, status, remark, field_values, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
  `)

  let imported = 0

  for (const row of rows) {
    const code = (row[codeIndex] || '').trim()
    const name = (row[nameIndex] || '').trim()

    if (!code || !name) continue
    if (existingCodes.has(code)) continue

    const ext = extra?.(row)
    const fieldValues =
      ext?.field_values && Object.keys(ext.field_values).length > 0
        ? JSON.stringify(ext.field_values)
        : '{}'
    if (!dryRun) {
      insertStmt.run(uuidv4(), accountSetId, categoryId, code, name, ext?.remark || null, fieldValues)
    }
    imported++
  }

  if (imported > 0) {
    console.log(`[ACD] 导入 ${categoryCode}: ${imported} 项`)
  }
  return imported
}

/**
 * 批量导入所有辅助核算主数据
 */
function importAuxiliaryData(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()

  // 确保辅助核算类别存在
  const categoryMap = ensureAuxCategories(accountSetId, db)

  let totalImported = 0

  // 导入项目（xmk）
  if (tables.auxProjects.length > 0) {
    const count = importAuxItems(
      accountSetId,
      'project',
      categoryMap.get('project')!,
      tables.auxProjects,
      0, // xmbm
      1, // xm_mc
      stats,
      dryRun
    )
    totalImported += count
    stats.auxiliaryData.projects = count
    if (count > 0) stats.importedTables.push('xmk.txt')
  }

  // 导入往来单位（dwk）：额外保留地址/联系人/电话/开户行/账号/税号（列 2..8、11），
  // 写入 field_values（供自定义字段展示），并拼一段可读 remark。
  if (tables.auxCustomers.length > 0) {
    const dwkExtra = (row: AcdRow) => {
      const fv: Record<string, string> = {}
      const put = (key: string, idx: number) => {
        const v = (row[idx] || '').trim()
        if (v) fv[key] = v
      }
      put('address', 2)
      put('postal_code', 3)
      put('contact', 4)
      put('phone', 5)
      put('bank_name', 6)
      put('bank_account', 7)
      put('tax_no', 8)
      put('short_name', 11)
      if (Object.keys(fv).length === 0) return undefined
      const remark = [
        fv.address && `地址:${fv.address}`,
        fv.contact && `联系人:${fv.contact}`,
        fv.phone && `电话:${fv.phone}`,
        fv.bank_name && `开户行:${fv.bank_name}`,
        fv.bank_account && `账号:${fv.bank_account}`,
        fv.tax_no && `税号:${fv.tax_no}`,
      ]
        .filter(Boolean)
        .join('；')
      return { field_values: fv, remark: remark || undefined }
    }
    const count = importAuxItems(
      accountSetId,
      'customer',
      categoryMap.get('customer')!,
      tables.auxCustomers,
      0, // dwbm
      1, // dw_mc
      stats,
      dryRun,
      dwkExtra
    )
    totalImported += count
    stats.auxiliaryData.customers = count
    if (count > 0) stats.importedTables.push('dwk.txt')
  }

  // 导入部门（bmk）
  if (tables.auxDepts.length > 0) {
    const count = importAuxItems(
      accountSetId,
      'dept',
      categoryMap.get('dept')!,
      tables.auxDepts,
      0, // bmbm
      1, // bm_mc
      stats,
      dryRun
    )
    totalImported += count
    stats.auxiliaryData.depts = count
    if (count > 0) stats.importedTables.push('bmk.txt')
  }

  // 导入个人（grk）
  if (tables.auxPersons.length > 0) {
    const count = importAuxItems(
      accountSetId,
      'person',
      categoryMap.get('person')!,
      tables.auxPersons,
      0, // grbm
      1, // gr_mc
      stats,
      dryRun
    )
    totalImported += count
    stats.auxiliaryData.persons = count
    if (count > 0) stats.importedTables.push('grk.txt')
  }

  // 导入现金流量项目（xjll_xm，含 jd 流向）
  if (tables.auxCashFlows.length > 0) {
    const count = importCashFlowAuxItems(
      accountSetId,
      categoryMap.get('cash_flow')!,
      tables.auxCashFlows,
      stats,
      dryRun
    )
    totalImported += count
    stats.auxiliaryData.cashFlows = count
    if (count > 0) stats.importedTables.push('xjll_xm.txt')
  }

  // 导入资金来源（zjly）
  if (tables.auxFundSources.length > 0) {
    const count = importAuxItems(
      accountSetId,
      'fund_source',
      categoryMap.get('fund_source')!,
      tables.auxFundSources,
      0, // lybm
      1, // ly_mc
      stats,
      dryRun
    )
    totalImported += count
    stats.auxiliaryData.fundSources = count
    if (count > 0) stats.importedTables.push('zjly.txt')
  }

  stats.auxiliaryData.totalItems = totalImported

  if (totalImported > 0) {
    console.log(`[ACD] 辅助核算主数据导入完成: 共 ${totalImported} 项`)
  }
}

function importSystemParams(
  accountSetId: string,
  xt: Map<string, string>,
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  const candidates = [
    { key: 'import_acd:version', value: xt.get('xt_bbh') || '' },
    { key: 'import_acd:source_fiscal_year', value: xt.get('xt_jzyf') || '' },
    { key: 'import_acd:unit_name', value: xt.get('xt_dwmc') || '' },
    { key: 'import_acd:base_currency', value: xt.get('xt_bwb') || '' },
  ].filter(item => item.value)

  if (candidates.length === 0) {
    stats.warnings.push('xt.txt 未解析出可导入的系统参数')
    return
  }

  stats.importedTables.push('xt.txt')
  stats.systemParams.upserted += candidates.length

  if (dryRun) return

  const upsert = db.prepare(`
    INSERT INTO system_params (id, account_set_id, param_key, param_value, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(account_set_id, param_key)
    DO UPDATE SET param_value = excluded.param_value, updated_at = datetime('now')
  `)

  for (const item of candidates) {
    upsert.run(uuidv4(), accountSetId, item.key, item.value, 'ACD 导入元数据')
  }

  // 税号 nsh → 账套统一社会信用代码（用户已填则不覆盖）
  const taxNo = (xt.get('nsh') || '').trim()
  if (taxNo) {
    const row = db
      .prepare('SELECT credit_code FROM account_sets WHERE id = ?')
      .get(accountSetId) as { credit_code?: string | null } | undefined
    if (row && !String(row.credit_code || '').trim()) {
      db.prepare('UPDATE account_sets SET credit_code = ? WHERE id = ?').run(taxNo, accountSetId)
    }
  }

  // 顺带把使用单位落到系统真正读取的 unit_name 上。
  // 早先只写进 import_acd:unit_name，而那个 key 全库没有任何地方读，
  // 结果报表抬头只能退回账套名（形如「zw06广州东汇食品有限公司20260827」）。
  const acdUnitName = (xt.get('xt_dwmc') || '').trim()
  if (acdUnitName && !isPlaceholderUnitName(acdUnitName)) {
    const existing = db
      .prepare(
        `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'unit_name' LIMIT 1`
      )
      .get(accountSetId) as { param_value: string | null } | undefined
    // 用户已经自己填过就不覆盖，只补空缺
    if (!existing?.param_value?.trim()) {
      upsert.run(uuidv4(), accountSetId, 'unit_name', acdUnitName, '使用单位（ACD 导入）')
      stats.systemParams.upserted += 1
    }
  }
}

/**
 * 从 xt.txt 推导本系统的业务参数：
 *   xt_xjll_sz=1 → enable_cash_flow（现金流量核算已启用，凭证分录带 xjbm）
 *   xt_pzsh_sz=1 → require_audit（凭证须审核后记账）
 * 未出现的键不返回，交给 bootstrapNewAccountSetDefaults 用默认值。
 */
export function deriveAcdBusinessParams(xt: Map<string, string>): Record<string, string> {
  const params: Record<string, string> = {}
  const flag = (key: string): boolean | null => {
    const raw = (xt.get(key) || '').trim()
    if (!raw) return null
    return raw === '1' || raw.toLowerCase() === 'true'
  }
  const cashFlow = flag('xt_xjll_sz')
  if (cashFlow !== null) params.enable_cash_flow = String(cashFlow)
  const audit = flag('xt_pzsh_sz')
  if (audit !== null) params.require_audit = String(audit)
  return params
}

/**
 * 凭证模板：pzmb（模板编号、名称）+ pzmb_pz（模板分录，列位同 pz 去掉 nf/yf 前缀）
 *   0 mbbh, 1 pzlx, 2 pzbh, 3 pz_xh, 4 kmbm, 5 pz_zy, 6 pz_jf, 7 pz_df, 8 pz_wb, 9 pz_hl,
 *   10 pz_sl, 11 pz_dj, 12 jslb, 13 pz_ph, 14 jzbz, 15 xmbm, 16 dwbm, 17 bmbm, 18 grbm, 19 bz, 20 dw, … 25 xjbm
 * 写入 voucher_templates.entries_data（与 routes/voucherTemplate 的 JSON 结构一致）。
 */
function importVoucherTemplates(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun: boolean
) {
  const headers = tables.voucherTemplateHeaders
  if (headers.length === 0) return
  const db = getDb()

  const accounts = db
    .prepare('SELECT id, code, name, is_foreign, currency_code FROM accounts WHERE account_set_id = ?')
    .all(accountSetId) as Array<{
    id: string
    code: string
    name: string
    is_foreign: number
    currency_code: string | null
  }>
  const accountByCode = new Map(accounts.map(a => [a.code.trim(), a]))
  const voucherTypes = db
    .prepare('SELECT id, code FROM voucher_types WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; code: string }>
  const voucherTypeIdByCode = new Map(voucherTypes.map(vt => [vt.code.trim(), vt.id]))
  const auxCategories = db
    .prepare('SELECT id, code FROM aux_categories WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; code: string }>
  const auxCategoryIdByCode = new Map(auxCategories.map(c => [c.code, c.id]))
  const auxItems = db
    .prepare('SELECT id, type, code, name FROM aux_items WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; type: string; code: string; name: string }>
  const auxItemByTypeAndCode = new Map(
    auxItems.map(item => [`${item.type}|${String(item.code || '').trim()}`, item])
  )
  const lookupAux = (categoryCode: string, itemCode: string) => {
    const categoryId = auxCategoryIdByCode.get(categoryCode)
    if (!categoryId || !itemCode) return null
    return auxItemByTypeAndCode.get(`${categoryId}|${itemCode}`) || null
  }
  const auxColumns: Array<{ index: number; code: string; idKey: string; nameKey: string }> = [
    { index: 15, code: 'project', idKey: 'project_id', nameKey: 'project_name' },
    { index: 16, code: 'customer', idKey: 'supplier_id', nameKey: 'supplier_name' },
    { index: 17, code: 'dept', idKey: 'dept_id', nameKey: 'dept_name' },
    { index: 18, code: 'person', idKey: 'person_id', nameKey: 'person_name' },
  ]

  const entriesByTemplate = new Map<string, AcdRow[]>()
  for (const row of tables.voucherTemplateEntries) {
    const code = (row[0] || '').trim()
    if (!code) continue
    if (!entriesByTemplate.has(code)) entriesByTemplate.set(code, [])
    entriesByTemplate.get(code)!.push(row)
  }

  const existing = new Set(
    (
      db
        .prepare('SELECT template_no FROM voucher_templates WHERE account_set_id = ?')
        .all(accountSetId) as Array<{ template_no: string }>
    ).map(row => row.template_no)
  )
  const insert = db.prepare(`
    INSERT INTO voucher_templates
      (id, account_set_id, template_no, template_name, voucher_type_id, total_amount, remark, entries_data, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `)

  let imported = 0
  let skippedEntries = 0
  for (const header of headers) {
    const templateNo = (header[0] || '').trim()
    const templateName = (header[1] || '').trim() || templateNo
    if (!templateNo || existing.has(templateNo)) continue
    const rows = (entriesByTemplate.get(templateNo) || []).sort(
      (a, b) => (Number.parseInt(a[3] || '0', 10) || 0) - (Number.parseInt(b[3] || '0', 10) || 0)
    )
    if (rows.length === 0) continue

    let voucherTypeId: string | null = null
    let totalAmount = 0
    const entries: Array<Record<string, unknown>> = []
    for (const row of rows) {
      const account = accountByCode.get((row[4] || '').trim())
      if (!account) {
        skippedEntries += 1
        continue
      }
      const mapped = mapAcdEntryAmount(parseAcdNumber(row[6]), parseAcdNumber(row[7]))
      const direction = mapped?.direction ?? 'debit'
      const amount = mapped?.amount ?? 0
      if (!voucherTypeId) voucherTypeId = voucherTypeIdByCode.get((row[1] || '').trim()) || null
      if (direction === 'debit') totalAmount += amount

      const entry: Record<string, unknown> = {
        seq: entries.length + 1,
        account_id: account.id,
        account_code: account.code,
        account_name: account.name,
        direction,
        amount,
        summary: (row[5] || '').trim(),
        cash_flow_code: (row[25] || '').trim() || null,
      }
      // pzmb_pz: 8 pz_wb, 9 pz_hl, 19 bz
      const pzWb = parseAcdNumber(row[8])
      if (Number(account.is_foreign) === 1 && pzWb !== 0) {
        const bz = (row[19] || '').trim().toUpperCase()
        entry.currency_code = bz || account.currency_code || null
        entry.exchange_rate = parseAcdNumber(row[9]) || null
        entry.foreign_amount = pzWb
      }
      const auxData: Record<string, { id: string; name: string }> = {}
      for (const column of auxColumns) {
        const item = lookupAux(column.code, (row[column.index] || '').trim())
        if (!item) continue
        entry[column.idKey] = item.id
        entry[column.nameKey] = item.name
        auxData[column.code] = { id: item.id, name: item.name }
      }
      if (Object.keys(auxData).length > 0) entry.aux_data = JSON.stringify(auxData)
      entries.push(entry)
    }
    if (entries.length === 0) continue

    imported += 1
    if (!dryRun) {
      insert.run(
        uuidv4(),
        accountSetId,
        templateNo,
        templateName,
        voucherTypeId,
        Math.round(totalAmount * 100) / 100,
        'ACD 导入',
        JSON.stringify(entries)
      )
    }
  }

  stats.voucherTemplates += imported
  if (imported > 0) {
    stats.importedTables.push('pzmb.txt', 'pzmb_pz.txt')
    console.log(`[ACD] 导入凭证模板: ${imported} 个`)
  }
  if (skippedEntries > 0) {
    stats.warnings.push(`凭证模板有 ${skippedEntries} 行分录科目在账套中不存在，已跳过`)
  }
}

/**
 * 解析 ACD 的"年.月"形式字符串。
 * 支持 "2026.01"、"2026.01.01"、"2026-01"、"2026-01-01"、"2026/01"。
 */
export function parseAcdYearMonth(
  s: string | undefined | null
): { year: number; month: number } | null {
  if (!s) return null
  const m = String(s)
    .trim()
    .match(/^(\d{4})[.\-\/](\d{1,2})/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!Number.isInteger(year) || year < 1900 || year > 2999) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  return { year, month }
}

/**
 * 解析 ACD xt_kzrq（开账/建账日期），返回 YYYY-MM-DD。
 * 支持 "2026.01.01"、"2026-01-01"、"2026.01"、"2026-01" 等格式。
 */
export function parseAcdStartDate(s: string | undefined | null): string | null {
  if (!s) return null
  const m = String(s)
    .trim()
    .match(/^(\d{4})[.\-\/](\d{1,2})(?:[.\-\/](\d{1,2}))?$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = m[3] ? Number(m[3]) : 1
  if (!Number.isInteger(year) || year < 1900 || year > 2999) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * 从 ACD xt.txt 的 xt_kzrq 更新账套建账日期。
 *
 * - 默认（模板导入）：账套已有有效建账日期则保留（用户创建账套时填写的值优先）。
 * - preferXt=true（完整导入，账套本身就是由这个 ACD 生成的）：xt_kzrq 优先，
 *   同时把 fiscal_year 同步为建账年度。完整导入的路由层拿不到用户输入的日期，
 *   只会填一个「当年 1 月 1 日」的占位值，如果保留它，年中开账（如 2025.12.01）
 *   的账套会被记成次年 1 月开账，期初页面的年度、账前累计列、期间状态全都对不上。
 */
export function updateAccountSetStartDateFromXt(
  db: { prepare: (sql: string) => any },
  accountSetId: string,
  xt: Map<string, string>,
  options: { preferXt?: boolean } = {}
): string | null {
  const accountSet = db
    .prepare('SELECT start_date, fiscal_year FROM account_sets WHERE id = ?')
    .get(accountSetId) as { start_date?: string; fiscal_year?: number } | undefined
  const existing = String(accountSet?.start_date || '').trim()
  const startDateFromXt = parseAcdStartDate(xt.get('xt_kzrq'))

  if (options.preferXt && startDateFromXt) {
    console.log(`[ACD] 以 xt_kzrq 为准设置建账日期: ${startDateFromXt}`)
    syncAccountSetStartDate(db as any, accountSetId, startDateFromXt)
    const fiscalYear = Number(startDateFromXt.slice(0, 4))
    if (accountSet?.fiscal_year !== fiscalYear) {
      db.prepare('UPDATE account_sets SET fiscal_year = ? WHERE id = ?').run(fiscalYear, accountSetId)
    }
    return startDateFromXt
  }

  if (isValidAccountSetStartDate(existing)) {
    console.log(`[ACD] 保留账套已有建账日期: ${existing}`)
    syncAccountSetStartDate(db as any, accountSetId, existing)
    return existing
  }

  if (!startDateFromXt) {
    console.log('[ACD] xt.txt 中未找到有效的 xt_kzrq（建账日期），保持账套原有建账日期')
    if (existing) {
      const fallback = resolveAccountSetStartDate(existing, accountSet?.fiscal_year)
      syncAccountSetStartDate(db as any, accountSetId, fallback)
      return fallback
    }
    return null
  }
  console.log(`[ACD] 从 xt_kzrq 读取到建账日期: ${startDateFromXt}`)
  syncAccountSetStartDate(db as any, accountSetId, startDateFromXt)
  return startDateFromXt
}

/**
 * 根据 ACD 的 xt.txt 推导出"已结账期间"集合，写入 period_closing 表。
 *
 * 规则：用友 ACD 中
 *   - xt_kzrq（开账日期）= 账套起始期
 *   - xt_jzyf（当前未结期间）= 此期之前的所有期间都已结账
 *
 * 半开区间 [xt_kzrq, xt_jzyf) 内所有 (year, period) 写入 status='closed'。
 * closed_by / closed_at 留空（NULL），表示"由 ACD 导入回填，无明确结账人"。
 *
 * 幂等：ON CONFLICT DO UPDATE 不覆盖已有的 closed_by / closed_at。
 */
export function importPeriodClosing(
  accountSetId: string,
  xt: Map<string, string>,
  stats: ImportStats,
  dryRun: boolean,
  injectedDb?: any
): { closedCount: number; from: string; to: string } {
  const db = injectedDb ?? getDb()
  const current = parseAcdYearMonth(xt.get('xt_jzyf'))
  if (!current) {
    stats.warnings.push('xt.txt 缺少有效 xt_jzyf，跳过期间结账状态导入')
    return { closedCount: 0, from: '', to: '' }
  }

  // 起始期：优先 xt_kzrq，缺失则 fallback 到 xt_jzyf 同年 1 月
  const startFromKzrq = parseAcdYearMonth(xt.get('xt_kzrq'))
  const start = startFromKzrq ?? { year: current.year, month: 1 }

  // 生成 [start, current) 半开区间所有 (year, period)
  const periods: Array<{ year: number; month: number }> = []
  let y = start.year
  let m = start.month
  while (y < current.year || (y === current.year && m < current.month)) {
    periods.push({ year: y, month: m })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
    // 防止配置错乱导致死循环
    if (periods.length > 12 * 200) break
  }

  const fmt = (p: { year: number; month: number }) =>
    `${p.year}-${String(p.month).padStart(2, '0')}`

  const from = periods.length > 0 ? fmt(periods[0]) : ''
  const to = periods.length > 0 ? fmt(periods[periods.length - 1]) : ''

  stats.periodClosing.closedCount = periods.length
  stats.periodClosing.from = from
  stats.periodClosing.to = to

  if (periods.length === 0 || dryRun) {
    return { closedCount: periods.length, from, to }
  }

  const upsert = db.prepare(`
    INSERT INTO period_closing (id, account_set_id, year, period, status, closed_by, closed_at, created_at)
    VALUES (?, ?, ?, ?, 'closed', NULL, NULL, datetime('now'))
    ON CONFLICT(account_set_id, year, period) DO UPDATE SET
      status = 'closed',
      closed_by = COALESCE(period_closing.closed_by, excluded.closed_by),
      closed_at = COALESCE(period_closing.closed_at, excluded.closed_at)
  `)

  for (const p of periods) {
    upsert.run(uuidv4(), accountSetId, p.year, p.month)
  }

  stats.importedTables.push('period_closing(@xt)')

  return { closedCount: periods.length, from, to }
}

function importVoucherTypes(
  accountSetId: string,
  rows: AcdRow[],
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  if (rows.length === 0) {
    stats.warnings.push('pzlx.txt 没有可导入数据')
    return
  }

  stats.importedTables.push('pzlx.txt')

  const existing = db
    .prepare('SELECT * FROM voucher_types WHERE account_set_id = ?')
    .all(accountSetId) as Array<any>
  const existingByCode = new Map(existing.map(item => [String(item.code || '').trim(), item]))

  // FIX-143：ACD 的「结转」「结转结余」等类型名自动打 is_closing 标志
  const insertStmt = db.prepare(
    'INSERT INTO voucher_types (id, account_set_id, name, code, description, sort_order, is_closing) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const updateStmt = db.prepare(
    'UPDATE voucher_types SET name=?, description=?, sort_order=?, is_closing=? WHERE id=?'
  )

  rows.forEach((row, index) => {
    const code = (row[0] || '').trim()
    const name = (row[1] || '').trim()

    if (!code || !name) {
      stats.voucherTypes.skipped += 1
      return
    }

    const existingRow = existingByCode.get(code)

    if (!existingRow) {
      stats.voucherTypes.inserted += 1
      if (!dryRun) {
        insertStmt.run(uuidv4(), accountSetId, name, code, 'ACD 导入', index, name.includes('结转') ? 1 : 0)
      }
      return
    }

    stats.voucherTypes.updated += 1
    if (!dryRun) {
      updateStmt.run(name, 'ACD 导入', index, name.includes('结转') ? 1 : existingRow.is_closing ? 1 : 0, existingRow.id)
    }
  })
}

function importAccounts(accountSetId: string, rows: AcdRow[], stats: ImportStats, dryRun: boolean) {
  const db = getDb()
  if (rows.length === 0) {
    stats.warnings.push('kmbm.txt 没有可导入数据')
    return
  }

  stats.importedTables.push('kmbm.txt')

  // 读取科目编码长度配置
  const codeLengthsParam = db
    .prepare(
      `
    SELECT param_value FROM system_params
    WHERE account_set_id = ? AND param_key = 'account_code_lengths'
  `
    )
    .get(accountSetId) as { param_value: string } | undefined

  let codeLengths = [4, 3, 3, 2, 2, 2] // 默认值
  if (codeLengthsParam) {
    try {
      codeLengths = JSON.parse(codeLengthsParam.param_value)
    } catch (e) {
      console.warn('[ACD] 解析 account_code_lengths 失败，使用默认值')
    }
  }

  console.log(`[ACD] 使用科目编码长度配置: [${codeLengths.join(',')}]`)

  const baseCurrency = (
    (
      db
        .prepare(
          `SELECT param_value FROM system_params
           WHERE account_set_id = ? AND param_key = 'base_currency' LIMIT 1`
        )
        .get(accountSetId) as { param_value?: string } | undefined
    )?.param_value || 'RMB'
  )
    .trim()
    .toUpperCase()

  const filtered = rows
    .map(row => parseKmbmRow(row))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))

  // aux_types 需要引用类目 ID，先保证标准类目存在（幂等）
  const auxCategoryIdByCode = dryRun
    ? new Map<string, string>()
    : ensureAuxCategories(accountSetId, db)

  const knownCodes = new Set(filtered.map(item => item.code))
  const existing = db
    .prepare('SELECT * FROM accounts WHERE account_set_id = ?')
    .all(accountSetId) as Array<any>
  const existingByCode = new Map(existing.map(item => [String(item.code || '').trim(), item]))
  const accountIdByCode = new Map(
    existing.map(item => [String(item.code || '').trim(), String(item.id)])
  )

  const insertStmt = db.prepare(`
    INSERT INTO accounts (
      id, account_set_id, code, name, direction, level, parent_id,
      is_cash, is_bank, is_aux, aux_types, require_cash_flow,
      is_foreign, currency_code, is_quantity, quantity_unit,
      is_enabled, allow_delete, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
  `)
  const updateStmt = db.prepare(`
    UPDATE accounts
    SET name=?, direction=?, level=?, parent_id=?,
        is_cash=?, is_bank=?, is_aux=?, aux_types=?, require_cash_flow=?,
        is_foreign=?, currency_code=?, is_quantity=?, quantity_unit=?,
        updated_at=datetime('now')
    WHERE id=?
  `)

  let foreignCount = 0
  for (const item of filtered) {
    // 直接使用ACD的级别，不再fallback到错误的getAccountLevel
    const level = item.level

    // 使用配置化的父科目计算
    const parentCode = getParentCodeByConfig(item.code, level, codeLengths)
    const parentId = parentCode ? accountIdByCode.get(parentCode) || null : null

    // 构建辅助核算类型
    const auxTypes = buildAuxTypes(item, auxCategoryIdByCode)
    const isAux = auxTypes ? 1 : 0
    const isForeign = item.isForeign ? 1 : 0
    const currencyCode = resolveImportedAccountCurrencyCode(
      item.isForeign,
      item.currencyCode,
      baseCurrency
    )
    if (isForeign) foreignCount += 1

    const existingRow = existingByCode.get(item.code)

    if (!existingRow) {
      const id = uuidv4()
      stats.accounts.inserted += 1
      accountIdByCode.set(item.code, id)
      if (!dryRun) {
        insertStmt.run(
          id,
          accountSetId,
          item.code,
          item.name,
          item.direction,
          level,
          parentId,
          item.isCash ? 1 : 0,
          item.isBank ? 1 : 0,
          isAux,
          auxTypes,
          item.isCash || item.isBank ? 1 : 0,
          isForeign,
          currencyCode,
          item.isQuantity ? 1 : 0,
          item.quantityUnit
        )
      }
      continue
    }

    stats.accounts.updated += 1
    accountIdByCode.set(item.code, String(existingRow.id))
    if (!dryRun) {
      updateStmt.run(
        item.name,
        item.direction,
        level,
        parentId,
        item.isCash ? 1 : 0,
        item.isBank ? 1 : 0,
        isAux,
        auxTypes,
        item.isCash || item.isBank ? 1 : 0,
        isForeign,
        currencyCode,
        item.isQuantity ? 1 : 0,
        item.quantityUnit,
        existingRow.id
      )
    }
  }

  stats.foreignAccounts = foreignCount
  if (!dryRun && foreignCount > 0) {
    upsertAccountSetSystemParam(db, accountSetId, 'enable_foreign_currency', 'true', '启用外币核算')
  }
}

/**
 * 科目币种写入规则：fbs=1 时优先保留 kmbm.bz；
 * 空值、伪编码 BWB/SL、以及本位币别名（BWB/RMB 等）不写入 currency_code。
 */
export function resolveImportedAccountCurrencyCode(
  isForeign: boolean,
  currencyCode: string | null | undefined,
  baseCurrency = 'RMB'
): string | null {
  if (!isForeign) return null
  const code = String(currencyCode || '')
    .trim()
    .toUpperCase()
  if (!code) return null
  if (code === 'BWB' || code === 'SL') return null
  const base = String(baseCurrency || 'RMB')
    .trim()
    .toUpperCase() || 'RMB'
  if (code === base) return null
  if ((code === 'RMB' || code === 'CNY') && (base === 'RMB' || base === 'CNY')) return null
  return code
}

/**
 * fbgl：外币定义与期初/期末汇率。
 * 列：0 bz, 1 nchl, 2 qchl, 3 qmhl, 4 sykm, 5 bwbz（1=本位币, 2=外币）
 */
export function importCurrencies(
  accountSetId: string,
  fbglRows: AcdRow[],
  xt: Map<string, string>,
  stats: ImportStats,
  dryRun: boolean
) {
  if (!fbglRows || fbglRows.length === 0) return

  const db = getDb()
  stats.importedTables.push('fbgl.txt')

  const baseFromXt = (xt.get('xt_bwb') || 'RMB').trim().toUpperCase() || 'RMB'
  if (!dryRun) {
    upsertAccountSetSystemParam(db, accountSetId, 'base_currency', baseFromXt, '本位币')
  }

  const startDate =
    (
      db
        .prepare('SELECT start_date FROM account_sets WHERE id = ?')
        .get(accountSetId) as { start_date?: string } | undefined
    )?.start_date ||
    parseAcdStartDate(xt.get('xt_kzrq')) ||
    ''
  const opening = parseAcdYearMonth(startDate) || parseAcdYearMonth(xt.get('xt_kzrq')) || {
    year: new Date().getFullYear(),
    month: 1,
  }

  for (const row of fbglRows) {
    const code = (row[0] || '').trim().toUpperCase()
    if (!code || code === 'BWB' || code === 'SL') continue

    const nchl = parseAcdNumber(row[1])
    const qchl = parseAcdNumber(row[2])
    const qmhl = parseAcdNumber(row[3])
    const bwbz = (row[5] || '').trim()
    const isBase = bwbz === '1' || code === baseFromXt
    const rateCandidate = qchl > 0 ? qchl : nchl > 0 ? nchl : 0
    const defaultRate = isBase ? 1 : rateCandidate > 0 ? rateCandidate : 1

    if (dryRun) {
      const existing = getCurrencyByCode(accountSetId, code)
      if (existing) stats.currencies.updated += 1
      else stats.currencies.inserted += 1
      continue
    }

    const existing = getCurrencyByCode(accountSetId, code)
    upsertCurrencyRow({
      account_set_id: accountSetId,
      code,
      is_base: isBase,
      default_rate: defaultRate,
    })
    if (existing) stats.currencies.updated += 1
    else stats.currencies.inserted += 1

    if (!isBase && rateCandidate > 0) {
      try {
        upsertExchangeRate({
          account_set_id: accountSetId,
          currency_code: code,
          year: opening.year,
          period: opening.month,
          rate: rateCandidate,
          closing_rate: qmhl > 0 ? qmhl : null,
        })
      } catch (err: any) {
        stats.warnings.push(`币种 ${code} 汇率写入失败: ${err?.message || err}`)
      }
    }
  }
}

/**
 * bzk 币种档案（bz/hl/bwbz/qtbz）：补齐 fbgl 未覆盖的币种。
 * 仅新增、不覆盖：已存在的币种（来自 fbgl 或手工维护）保持不动。
 */
export function importCurrencyArchive(
  accountSetId: string,
  bzkRows: AcdRow[],
  stats: ImportStats,
  dryRun = false,
  db: ReturnType<typeof getDb> = getDb()
): void {
  if (!bzkRows || bzkRows.length === 0) return
  const baseCode = (
    ((db
      .prepare(
        "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='base_currency' LIMIT 1"
      )
      .get(accountSetId) as { param_value?: string } | undefined)?.param_value || 'RMB')
  )
    .trim()
    .toUpperCase()

  const existing = db
    .prepare('SELECT code FROM currencies WHERE account_set_id=?')
    .all(accountSetId) as Array<{ code: string }>
  const existingCodes = new Set(existing.map(r => String(r.code || '').trim().toUpperCase()))

  const ins = db.prepare(
    `INSERT INTO currencies
       (id, account_set_id, code, name, is_base, default_rate, begin_rate, end_rate, rate_decimals, is_enabled, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,?,datetime('now'),datetime('now'))`
  )

  let inserted = 0
  for (const row of bzkRows) {
    const code = (row[0] || '').trim().toUpperCase()
    if (!code || code === 'BWB') continue
    if (existingCodes.has(code)) continue
    const isBase = (row[2] || '').trim() === '1' || code === baseCode ? 1 : 0
    const rate = parseAcdNumber(row[1]) || 1
    if (!dryRun) {
      ins.run(uuidv4(), accountSetId, code, code, isBase, rate, rate, rate, 4, existingCodes.size)
    }
    existingCodes.add(code)
    inserted += 1
  }
  if (inserted > 0) {
    stats.currencies.inserted += inserted
    stats.importedTables.push('bzk.txt')
  }
}

function importInitBalances(
  accountSetId: string,
  rows: AcdRow[],
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  if (rows.length === 0) {
    stats.warnings.push('nc.txt 没有可导入数据')
    return
  }

  stats.importedTables.push('nc.txt')

  const accounts = db
    .prepare(
      `SELECT id, code, direction, is_foreign, currency_code
       FROM accounts WHERE account_set_id = ?`
    )
    .all(accountSetId) as Array<{
    id: string
    code: string
    direction: 'debit' | 'credit'
    is_foreign: number
    currency_code: string | null
  }>
  const accountByCode = new Map(accounts.map(item => [String(item.code || '').trim(), item]))

  // FIX-2026-09-04：nc.txt 是「每年一套年初余额」的多年表（row[14]=年份），
  // 旧实现取首行年份当作唯一 importYear，再把所有年份的行合并累加写进那一年，
  // 结果是：其余年份（例如本例的 2016）一条期初都没有，科目余额表年初列全空；
  // 被选中的那一年金额还被叠加成了多年之和。这里改为按年份分组，各年独立写入。
  //
  // FIX-2026-09-05：旧实现只读 nc_jf/nc_df（年初）写进 init_debit/init_credit，
  // opening_*/pre_book_* 一律留 0，而「期初余额」页面和辅助期初都只读这四列，
  // 于是导入后页面里一片空白（"无法导入期初"）；同时 jq_jf/jq_df（建账前累计发生）
  // 被整个丢掉，年中开账（如 2025.12.01）的账套期初 = 年初 + 1~11 月累计，
  // 少了累计发生额，期初余额和本年累计都是错的。这里改为按系统口径完整落列。
  const preparedByYear = new Map<number, Map<string, PreparedInitBalanceRow>>()
  const fallbackYear = new Date().getFullYear()

  for (const row of pickBaseCurrencyRows(rows, NC_COLUMNS.bz)) {
    const code = (row[0] || '').trim()
    const account = accountByCode.get(code)
    if (!code || !account) {
      stats.initBalances.skipped += 1
      continue
    }

    const parsed = parseAcdNcAmounts(row, NC_COLUMNS, fallbackYear)
    accumulateInitBalanceRow(preparedByYear, parsed.year, account.id, account.direction, parsed)
  }

  // 外币科目：匹配 bz=currency_code 的原币行，写入 foreign_* 字段（BWB 本位币路径不变）
  for (const row of rows) {
    const code = (row[0] || '').trim()
    const account = accountByCode.get(code)
    if (!account || Number(account.is_foreign) !== 1) continue
    const currencyCode = String(account.currency_code || '')
      .trim()
      .toUpperCase()
    if (!currencyCode) continue
    const bz = (row[NC_COLUMNS.bz] || '').trim().toUpperCase()
    if (bz !== currencyCode) continue

    const parsed = parseAcdNcForeignAmounts(row, NC_COLUMNS, fallbackYear)
    applyForeignInitAmounts(preparedByYear, parsed.year, account.id, account.direction, parsed)
  }

  let totalPrepared = 0
  for (const preparedByAccount of preparedByYear.values()) {
    totalPrepared += preparedByAccount.size
  }
  stats.initBalances.inserted += totalPrepared

  if (totalPrepared === 0) {
    stats.warnings.push('nc.txt 未匹配到当前账套科目，未生成期初余额')
    return
  }

  if (dryRun) return

  const deleteStmt = db.prepare('DELETE FROM init_balances WHERE account_set_id = ? AND year = ?')
  const insertStmt = prepareInitBalanceInsert(db)
  for (const [year, preparedByAccount] of preparedByYear) {
    deleteStmt.run(accountSetId, year)
    for (const prepared of preparedByAccount.values()) {
      insertInitBalanceRow(insertStmt, accountSetId, year, '', prepared)
    }
  }
}

/** 润衡 nc / dwnc / bmnc / grnc / xmnc 表的列位置（见 data_stru.txt） */
type NcColumns = {
  bz: number
  nc_jf: number
  nc_df: number
  jq_jf: number
  jq_df: number
  nf: number
  nc_jf_b: number
  nc_df_b: number
  jq_jf_b: number
  jq_df_b: number
}

/** nc: kmbm, bz, nc_jf, nc_df, jq_jf, jq_df, yjd, fbs, kmjs, ys, *_b x4, nf */
export const NC_COLUMNS: NcColumns = {
  bz: 1,
  nc_jf: 2,
  nc_df: 3,
  jq_jf: 4,
  jq_df: 5,
  nf: 14,
  nc_jf_b: 10,
  nc_df_b: 11,
  jq_jf_b: 12,
  jq_df_b: 13,
}
/** dwnc/bmnc/grnc/xmnc: kmbm, <辅助编码>, bz, nc_jf, nc_df, jq_jf, jq_df, fbs, ys, *_b x4, nf */
export const AUX_NC_COLUMNS: NcColumns = {
  bz: 2,
  nc_jf: 3,
  nc_df: 4,
  jq_jf: 5,
  jq_df: 6,
  nf: 13,
  nc_jf_b: 9,
  nc_df_b: 10,
  jq_jf_b: 11,
  jq_df_b: 12,
}

/**
 * zjnc（资金来源期初）：lybm, kmbm, nf, bz, nc_jf, nc_df, jq_jf, jq_df, fbs, ys, *_b x4, yjd, lj_* x4。
 * 与 dwnc 布局不同：科目在 index 1、辅助编码在 index 0、年份在 index 2、币别在 index 3。
 */
export const FUND_SOURCE_NC_COLUMNS: NcColumns = {
  bz: 3,
  nc_jf: 4,
  nc_df: 5,
  jq_jf: 6,
  jq_df: 7,
  nf: 2,
  nc_jf_b: 10,
  nc_df_b: 11,
  jq_jf_b: 12,
  jq_df_b: 13,
}

/** 润衡年初表里的本位币行标记 */
const ACD_BASE_CURRENCY = 'BWB'

/**
 * 年初表按币种分行：bz='BWB' 是本位币汇总行，其余（RMB/USD…）是原币行，
 * 原币行的本位币列也可能带值，全部累加会重复计算。只要表里出现过 BWB 行，就只取 BWB 行。
 */
export function pickBaseCurrencyRows(rows: AcdRow[], bzIndex: number): AcdRow[] {
  const baseRows = rows.filter(row => (row[bzIndex] || '').trim().toUpperCase() === ACD_BASE_CURRENCY)
  return baseRows.length > 0 ? baseRows : rows
}

type ParsedNcAmounts = {
  year: number
  openingDebit: number
  openingCredit: number
  preBookDebit: number
  preBookCredit: number
}

type PreparedInitBalanceRow = {
  accountId: string
  direction: 'debit' | 'credit'
  openingDebit: number
  openingCredit: number
  preBookDebit: number
  preBookCredit: number
  foreignOpeningDebit: number
  foreignOpeningCredit: number
  foreignPreBookDebit: number
  foreignPreBookCredit: number
}

/**
 * 读取一行润衡年初表：
 *   nc_jf/nc_df = 年初余额（借/贷），jq_jf/jq_df = 建账前累计发生（借/贷）。
 * 年初余额按系统约束只能落一侧（借贷不可同时填写），这里先净额化再落列；
 * 累计发生额借贷两侧都保留。
 */
export function parseAcdNcAmounts(
  row: AcdRow,
  columns: NcColumns,
  fallbackYear: number
): ParsedNcAmounts {
  const parsedYear = Number.parseInt((row[columns.nf] || '').trim(), 10)
  const year = Number.isInteger(parsedYear) && parsedYear > 1900 ? parsedYear : fallbackYear
  const openingNet = parseAcdNumber(row[columns.nc_jf]) - parseAcdNumber(row[columns.nc_df])
  return {
    year,
    openingDebit: openingNet > 0 ? openingNet : 0,
    openingCredit: openingNet < 0 ? -openingNet : 0,
    preBookDebit: parseAcdNumber(row[columns.jq_jf]),
    preBookCredit: parseAcdNumber(row[columns.jq_df]),
  }
}

/**
 * 读取外币（原币）年初金额：优先 *_b 列；若 *_b 全为 0 则回退到非 _b 列。
 * 返回形状与 parseAcdNcAmounts 相同。
 */
export function parseAcdNcForeignAmounts(
  row: AcdRow,
  columns: NcColumns,
  fallbackYear: number
): ParsedNcAmounts {
  const parsedYear = Number.parseInt((row[columns.nf] || '').trim(), 10)
  const year = Number.isInteger(parsedYear) && parsedYear > 1900 ? parsedYear : fallbackYear

  let ncJf = parseAcdNumber(row[columns.nc_jf_b])
  let ncDf = parseAcdNumber(row[columns.nc_df_b])
  let jqJf = parseAcdNumber(row[columns.jq_jf_b])
  let jqDf = parseAcdNumber(row[columns.jq_df_b])

  if (ncJf === 0 && ncDf === 0 && jqJf === 0 && jqDf === 0) {
    ncJf = parseAcdNumber(row[columns.nc_jf])
    ncDf = parseAcdNumber(row[columns.nc_df])
    jqJf = parseAcdNumber(row[columns.jq_jf])
    jqDf = parseAcdNumber(row[columns.jq_df])
  }

  const openingNet = ncJf - ncDf
  return {
    year,
    openingDebit: openingNet > 0 ? openingNet : 0,
    openingCredit: openingNet < 0 ? -openingNet : 0,
    preBookDebit: jqJf,
    preBookCredit: jqDf,
  }
}

function emptyForeignAmounts() {
  return {
    foreignOpeningDebit: 0,
    foreignOpeningCredit: 0,
    foreignPreBookDebit: 0,
    foreignPreBookCredit: 0,
  }
}

function accumulateInitBalanceRow(
  preparedByYear: Map<number, Map<string, PreparedInitBalanceRow>>,
  year: number,
  key: string,
  direction: 'debit' | 'credit',
  amounts: ParsedNcAmounts,
  accountId = key
) {
  let preparedByKey = preparedByYear.get(year)
  if (!preparedByKey) {
    preparedByKey = new Map<string, PreparedInitBalanceRow>()
    preparedByYear.set(year, preparedByKey)
  }
  const existing = preparedByKey.get(key)
  if (existing) {
    // 同一科目多行（多币种 bz）合并，年初仍需保持单侧
    const openingNet =
      existing.openingDebit - existing.openingCredit + amounts.openingDebit - amounts.openingCredit
    existing.openingDebit = openingNet > 0 ? openingNet : 0
    existing.openingCredit = openingNet < 0 ? -openingNet : 0
    existing.preBookDebit += amounts.preBookDebit
    existing.preBookCredit += amounts.preBookCredit
    return
  }
  preparedByKey.set(key, {
    accountId,
    direction,
    openingDebit: amounts.openingDebit,
    openingCredit: amounts.openingCredit,
    preBookDebit: amounts.preBookDebit,
    preBookCredit: amounts.preBookCredit,
    ...emptyForeignAmounts(),
  })
}

function applyForeignInitAmounts(
  preparedByYear: Map<number, Map<string, PreparedInitBalanceRow>>,
  year: number,
  key: string,
  direction: 'debit' | 'credit',
  amounts: ParsedNcAmounts,
  accountId = key
) {
  let preparedByKey = preparedByYear.get(year)
  if (!preparedByKey) {
    preparedByKey = new Map<string, PreparedInitBalanceRow>()
    preparedByYear.set(year, preparedByKey)
  }
  const existing = preparedByKey.get(key)
  if (existing) {
    const openingNet =
      existing.foreignOpeningDebit -
      existing.foreignOpeningCredit +
      amounts.openingDebit -
      amounts.openingCredit
    existing.foreignOpeningDebit = openingNet > 0 ? openingNet : 0
    existing.foreignOpeningCredit = openingNet < 0 ? -openingNet : 0
    existing.foreignPreBookDebit += amounts.preBookDebit
    existing.foreignPreBookCredit += amounts.preBookCredit
    return
  }
  preparedByKey.set(key, {
    accountId,
    direction,
    openingDebit: 0,
    openingCredit: 0,
    preBookDebit: 0,
    preBookCredit: 0,
    foreignOpeningDebit: amounts.openingDebit,
    foreignOpeningCredit: amounts.openingCredit,
    foreignPreBookDebit: amounts.preBookDebit,
    foreignPreBookCredit: amounts.preBookCredit,
  })
}

function prepareInitBalanceInsert(db: any) {
  return db.prepare(`
    INSERT INTO init_balances (
      id, account_set_id, account_id, direction, year, period,
      init_balance, init_debit, init_credit, aux_item_id,
      opening_debit, opening_credit, pre_book_debit, pre_book_credit,
      foreign_init_balance, foreign_opening_debit, foreign_opening_credit,
      foreign_pre_book_debit, foreign_pre_book_credit, created_at
    )
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/** 与 initBalanceBatch.saveInitBalanceBatchItems 同口径：init_* = 年初 + 账前累计，余额按科目方向 */
function insertInitBalanceRow(
  insertStmt: { run: (...args: unknown[]) => unknown },
  accountSetId: string,
  year: number,
  auxItemId: string,
  prepared: PreparedInitBalanceRow
) {
  const od = roundMoney(prepared.openingDebit)
  const oc = roundMoney(prepared.openingCredit)
  const pd = roundMoney(prepared.preBookDebit)
  const pc = roundMoney(prepared.preBookCredit)
  const initDebit = roundMoney(od + pd)
  const initCredit = roundMoney(oc + pc)
  const initBalance = roundMoney(
    prepared.direction === 'credit' ? initCredit - initDebit : initDebit - initCredit
  )
  const fod = roundMoney(prepared.foreignOpeningDebit)
  const foc = roundMoney(prepared.foreignOpeningCredit)
  const fpd = roundMoney(prepared.foreignPreBookDebit)
  const fpc = roundMoney(prepared.foreignPreBookCredit)
  const foreignInit = roundMoney(
    calcForeignInitBalance(prepared.direction, fod, foc, fpd, fpc)
  )
  insertStmt.run(
    uuidv4(),
    accountSetId,
    prepared.accountId,
    prepared.direction,
    year,
    initBalance,
    initDebit,
    initCredit,
    auxItemId,
    od,
    oc,
    pd,
    pc,
    foreignInit,
    fod,
    foc,
    fpd,
    fpc
  )
}

/**
 * 辅助期初：dwnc（往来单位）/ bmnc（部门）/ grnc（个人）/ xmnc（项目）。
 * 每行 = 某科目 × 某辅助项目 × 年份 的年初 + 建账前累计，写成 aux_item_id='<前缀>:<项目id>' 的明细行。
 * 科目汇总行（aux_item_id=''）已由 nc.txt 写入且账簿取数「汇总行优先」，这里不重算汇总，
 * 只在明细合计与汇总行不一致时给出警告。
 */
/**
 * ACD 辅助类目 code → 系统 aux_item_id 键。
 * 必须与凭证侧 buildAuxItemId 生成的键一致（固定列前缀 + aux_data 类目键），
 * 否则辅助期初行与 account_balances 的辅助桶（复合键，如 supp:x|customer:x）对不上，期初取不到。
 */
const AUX_FIXED_COLUMN: Record<string, string> = {
  dept: 'dept_id',
  project: 'project_id',
  proj: 'project_id',
  customer: 'supplier_id',
  supplier: 'supplier_id',
  supp: 'supplier_id',
  person: 'person_id',
  pers: 'person_id',
  func_class: 'func_class_id',
  func: 'func_class_id',
}

function buildAuxInitItemId(categoryCode: string, itemId: string): string {
  const fixedColumn = AUX_FIXED_COLUMN[categoryCode]
  const entry: Record<string, unknown> = {}
  if (fixedColumn) entry[fixedColumn] = itemId
  entry.aux_data = { [categoryCode]: { id: itemId } }
  return buildAuxItemId(entry)
}

function importAuxInitBalances(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  const sources: Array<{
    table: string
    categoryCode: string
    rows: AcdRow[]
    /** 科目编码列（默认 0） */
    kmbmIndex?: number
    /** 辅助项目编码列（默认 1） */
    itemIndex?: number
    /** 金额/年份/币别列位置（默认 AUX_NC_COLUMNS） */
    columns?: NcColumns
  }> = [
    { table: 'dwnc.txt', categoryCode: 'customer', rows: tables.auxCustomerInitBalances },
    { table: 'bmnc.txt', categoryCode: 'dept', rows: tables.auxDeptInitBalances },
    { table: 'grnc.txt', categoryCode: 'person', rows: tables.auxPersonInitBalances },
    { table: 'xmnc.txt', categoryCode: 'project', rows: tables.auxProjectInitBalances },
    {
      table: 'zjnc.txt',
      categoryCode: 'fund_source',
      rows: tables.auxFundSourceInitBalances,
      kmbmIndex: 1,
      itemIndex: 0,
      columns: FUND_SOURCE_NC_COLUMNS,
    },
  ]
  if (sources.every(source => source.rows.length === 0)) return

  const accounts = db
    .prepare(
      `SELECT id, code, direction, is_foreign, currency_code
       FROM accounts WHERE account_set_id = ?`
    )
    .all(accountSetId) as Array<{
    id: string
    code: string
    direction: 'debit' | 'credit'
    is_foreign: number
    currency_code: string | null
  }>
  const accountByCode = new Map(accounts.map(item => [String(item.code || '').trim(), item]))

  const categories = db
    .prepare('SELECT id, code FROM aux_categories WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; code: string }>
  const categoryIdByCode = new Map(categories.map(item => [item.code, item.id]))

  const auxItems = db
    .prepare('SELECT id, type, code FROM aux_items WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; type: string; code: string }>
  const auxItemIdByTypeAndCode = new Map(
    auxItems.map(item => [`${item.type}|${String(item.code || '').trim()}`, item.id])
  )

  const fallbackYear = new Date().getFullYear()
  // key = `${accountId}|${auxItemId}`
  const preparedByYear = new Map<number, Map<string, PreparedInitBalanceRow>>()
  const auxItemIdByKey = new Map<string, string>()
  let matched = 0
  let skipped = 0

  for (const source of sources) {
    if (source.rows.length === 0) continue
    const categoryId = categoryIdByCode.get(source.categoryCode)
    if (!categoryId) {
      stats.warnings.push(`${source.table}：账套缺少「${source.categoryCode}」辅助类目，已跳过辅助期初`)
      continue
    }
    stats.importedTables.push(source.table)

    for (const row of pickBaseCurrencyRows(source.rows, (source.columns ?? AUX_NC_COLUMNS).bz)) {
      const account = accountByCode.get((row[source.kmbmIndex ?? 0] || '').trim())
      const itemCode = (row[source.itemIndex ?? 1] || '').trim()
      const itemId = itemCode ? auxItemIdByTypeAndCode.get(`${categoryId}|${itemCode}`) : undefined
      if (!account || !itemId) {
        skipped += 1
        continue
      }
      const auxItemId = buildAuxInitItemId(source.categoryCode, itemId)
      const key = `${account.id}|${auxItemId}`
      auxItemIdByKey.set(key, auxItemId)
      const parsed = parseAcdNcAmounts(row, source.columns ?? AUX_NC_COLUMNS, fallbackYear)
      accumulateInitBalanceRow(preparedByYear, parsed.year, key, account.direction, parsed, account.id)
      matched += 1
    }

    for (const row of source.rows) {
      const account = accountByCode.get((row[source.kmbmIndex ?? 0] || '').trim())
      if (!account || Number(account.is_foreign) !== 1) continue
      const currencyCode = String(account.currency_code || '')
        .trim()
        .toUpperCase()
      if (!currencyCode) continue
      const bz = (row[(source.columns ?? AUX_NC_COLUMNS).bz] || '').trim().toUpperCase()
      if (bz !== currencyCode) continue
      const itemCode = (row[source.itemIndex ?? 1] || '').trim()
      const itemId = itemCode ? auxItemIdByTypeAndCode.get(`${categoryId}|${itemCode}`) : undefined
      if (!itemId) continue
      const auxItemId = buildAuxInitItemId(source.categoryCode, itemId)
      const key = `${account.id}|${auxItemId}`
      auxItemIdByKey.set(key, auxItemId)
      const parsed = parseAcdNcForeignAmounts(row, source.columns ?? AUX_NC_COLUMNS, fallbackYear)
      applyForeignInitAmounts(preparedByYear, parsed.year, key, account.direction, parsed, account.id)
    }
  }

  let totalPrepared = 0
  for (const preparedByKey of preparedByYear.values()) totalPrepared += preparedByKey.size
  stats.auxInitBalances.inserted += totalPrepared
  stats.auxInitBalances.skipped += skipped
  if (skipped > 0) {
    stats.warnings.push(`辅助期初有 ${skipped} 行未匹配到科目或辅助项目，已跳过`)
  }
  if (totalPrepared === 0 || dryRun) return

  const deleteStmt = db.prepare(
    `DELETE FROM init_balances WHERE account_set_id = ? AND year = ? AND aux_item_id != ''`
  )
  const insertStmt = prepareInitBalanceInsert(db)
  for (const [year, preparedByKey] of preparedByYear) {
    deleteStmt.run(accountSetId, year)
    for (const [key, prepared] of preparedByKey) {
      insertInitBalanceRow(insertStmt, accountSetId, year, auxItemIdByKey.get(key) || '', prepared)
    }
  }

  // 明细合计 vs 科目汇总行（nc.txt）对账，差异只提示不改数
  const mismatches = db
    .prepare(
      `SELECT a.code, s.year,
              s.init_balance AS summary_balance,
              COALESCE(SUM(d.init_balance), 0) AS detail_balance
       FROM init_balances s
       JOIN accounts a ON a.id = s.account_id
       JOIN init_balances d
         ON d.account_set_id = s.account_set_id AND d.account_id = s.account_id
        AND d.year = s.year AND d.period = s.period AND d.aux_item_id != ''
       WHERE s.account_set_id = ? AND s.aux_item_id = ''
       GROUP BY s.id
       HAVING ABS(summary_balance - detail_balance) > 0.005`
    )
    .all(accountSetId) as Array<{
    code: string
    year: number
    summary_balance: number
    detail_balance: number
  }>
  for (const item of mismatches.slice(0, 20)) {
    stats.warnings.push(
      `科目 ${item.code} ${item.year} 年辅助期初明细合计 ${item.detail_balance.toFixed(2)} 与科目期初 ${item.summary_balance.toFixed(2)} 不一致（已按科目期初为准）`
    )
  }
  if (mismatches.length > 20) {
    stats.warnings.push(`另有 ${mismatches.length - 20} 个科目的辅助期初明细与科目期初不一致`)
  }
  console.log(`[ACD] 辅助期初: 匹配 ${matched} 行，写入 ${totalPrepared} 条，跳过 ${skipped} 行`)
}

function parseAcdNumber(value: string | undefined): number {
  const normalized = String(value || '')
    .replace(/,/g, '')
    .trim()
  if (!normalized) return 0
  return Number.parseFloat(normalized) || 0
}

function importBudgetSurplusAdjustments(
  accountSetId: string,
  rows: AcdRow[],
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  if (rows.length === 0) {
    stats.warnings.push('ysda.txt 没有可导入数据，@ys_cy 函数将按 0 处理')
    return
  }

  stats.importedTables.push('ysda.txt')

  const deleteStmt = db.prepare('DELETE FROM budget_surplus_adjustments WHERE account_set_id = ?')
  const insertStmt = db.prepare(`
    INSERT INTO budget_surplus_adjustments (
      id, account_set_id, source_seq, item_code, item_name, year, period,
      amount, account_code, alt_amount, item_type, balance_direction,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `)

  const preparedRows = rows
    .map(row => {
      const sourceSeq = Number.parseInt((row[0] || '').trim(), 10)
      const itemCode = (row[1] || '').trim()
      const itemName = (row[2] || '').trim()
      const year = Number.parseInt((row[3] || '').trim(), 10)
      const period = Number.parseInt((row[4] || '').trim(), 10)
      const amount = parseAcdNumber(row[5])
      const accountCode = (row[6] || '').trim()
      const altAmount = parseAcdNumber(row[7])
      const itemType = (row[8] || '').trim()
      const balanceDirection = (row[9] || '').trim()

      if (!itemCode || !Number.isInteger(year) || !Number.isInteger(period)) {
        stats.budgetSurplusAdjustments.skipped += 1
        return null
      }

      return {
        sourceSeq: Number.isInteger(sourceSeq) ? sourceSeq : null,
        itemCode,
        itemName,
        year,
        period,
        amount,
        accountCode,
        altAmount,
        itemType,
        balanceDirection,
      }
    })
    .filter(Boolean) as Array<{
    sourceSeq: number | null
    itemCode: string
    itemName: string
    year: number
    period: number
    amount: number
    accountCode: string
    altAmount: number
    itemType: string
    balanceDirection: string
  }>

  stats.budgetSurplusAdjustments.inserted += preparedRows.length
  if (dryRun || preparedRows.length === 0) return

  deleteStmt.run(accountSetId)
  for (const row of preparedRows) {
    insertStmt.run(
      uuidv4(),
      accountSetId,
      row.sourceSeq,
      row.itemCode,
      row.itemName || null,
      row.year,
      row.period,
      row.amount,
      row.accountCode || null,
      row.altAmount,
      row.itemType || null,
      row.balanceDirection || null
    )
  }
}

function buildPzlxNameByCode(rows: AcdRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const code = (row[0] || '').trim()
    const name = (row[1] || '').trim()
    if (code && name) map.set(code, name)
  }
  return map
}

function pickTransferLikeVoucherTypeName(
  pzlxNameByCode: Map<string, string>,
  fallback?: string
): string | null {
  for (const name of pzlxNameByCode.values()) {
    if (/转|结/.test(name)) return name
  }
  return fallback || null
}

/** 将 jzlx.txt 中的 pzlx 代码解析为系统凭证字名称 */
function resolveAcdTransferVoucherTypeLabel(
  pzlxCode: string,
  pzlxNameByCode: Map<string, string>
): string {
  const code = (pzlxCode || '').trim()
  if (!code) {
    return pickTransferLikeVoucherTypeName(pzlxNameByCode) || '结转'
  }

  const fromPzlx = pzlxNameByCode.get(code)
  if (fromPzlx) return fromPzlx

  // 非数字代码（如 ZZ/JZ）直接作为凭证字编码保留，运行时按 code 匹配
  if (!/^\d+$/.test(code)) {
    return code
  }

  if (code === '2') {
    return pzlxNameByCode.get('2') || pickTransferLikeVoucherTypeName(pzlxNameByCode) || '结转'
  }
  if (code === '1') {
    return (
      pzlxNameByCode.get('1') || pickTransferLikeVoucherTypeName(pzlxNameByCode, '记账') || '记账'
    )
  }

  return pickTransferLikeVoucherTypeName(pzlxNameByCode) || code
}

function importTransferTypes(
  accountSetId: string,
  rows: AcdRow[],
  accounts: AcdRow[],
  voucherTypeRows: AcdRow[],
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  if (rows.length === 0) {
    stats.warnings.push('jzlx.txt 没有可导入数据')
    return
  }

  stats.importedTables.push('jzlx.txt')

  // 根据结转类型名称判断周期类型
  function determinePeriodType(typeName: string): 'monthly' | 'yearly' {
    if (
      typeName.includes('年末') ||
      typeName.includes('(年末)') ||
      typeName.includes('年结') ||
      typeName.includes('年度')
    ) {
      return 'yearly'
    }
    return 'monthly'
  }

  // Build account code -> name map
  const accountNameMap = new Map<string, string>()
  for (const row of accounts) {
    const code = (row[0] || '').trim()
    const name = (row[1] || '').trim()
    if (code && name) accountNameMap.set(code, name)
  }

  const pzlxNameByCode = buildPzlxNameByCode(voucherTypeRows)

  // Group rows by transfer type code (column 0)
  const typeGroups = new Map<string, { rows: AcdRow[]; name: string; voucherType: string }>()
  for (const row of rows) {
    const typeCode = (row[0] || '').trim()
    const voucherType = (row[1] || '').trim()
    const typeName = (row[3] || '').trim()
    if (!typeCode) continue

    if (!typeGroups.has(typeCode)) {
      // ACD type names are sometimes truncated (e.g. "结转本期支" instead of "结转本期支出")
      // Provide complete fallback names for known truncated patterns
      const fullNames: Record<string, string> = {
        '10': '结转本期收入',
        '20': '结转本期支出',
        '30': '转营业成本',
        '40': '转所得税',
        '50': '转损益调整',
        '60': '结转盈余(日常)',
        '70': '结转累计盈余',
        '80': '结转财政拨款',
        '82': '结转非财政拨款',
        '84': '结转其他资金',
        '86': '结转经营(日常)',
        '88': '财政拨款结转',
        '90': '非财政拨款结转',
        '92': '其他结余结转',
        '94': '其他结余分配',
        '96': '非财政拨款结余',
        '98': '非财政拨款分配',
      }
      // 优先使用 ACD 文件中的原始名称（如果长度 >= 4 且不为空）
      // 只有当原始名称太短或为空时，才使用硬编码的完整名称
      // 这样可以保留 ACD 文件中的"年末"、"年结"等关键字用于周期判断
      const betterName =
        typeName && typeName.length >= 4
          ? typeName
          : fullNames[typeCode] || typeName || `结转类型${typeCode}`
      const vTypeLabel = resolveAcdTransferVoucherTypeLabel(voucherType, pzlxNameByCode)
      typeGroups.set(typeCode, { rows: [], name: betterName, voucherType: vTypeLabel })
    }
    typeGroups.get(typeCode)!.rows.push(row)
  }

  stats.transferTypes.types = typeGroups.size
  let itemCount = 0

  if (dryRun) {
    stats.transferTypes.items = rows.length
    return
  }

  // Delete existing transfer data for this account set
  db.prepare('DELETE FROM transfer_items WHERE account_set_id = ?').run(accountSetId)
  db.prepare('DELETE FROM transfer_types WHERE account_set_id = ?').run(accountSetId)

  const insertType = db.prepare(`
    INSERT INTO transfer_types (id, account_set_id, code, name, voucher_type, period_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `)

  const insertItem = db.prepare(`
    INSERT INTO transfer_items (id, account_set_id, type_code, summary, from_code, from_name, to_code, to_name, transfer_type, ratio, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `)

  for (const [typeCode, group] of typeGroups) {
    // First pass: collect valid items for this type
    const validItems: {
      summary: string
      fromCode: string
      toCode: string
      ratio: number
      sortOrder: number
    }[] = []
    for (let i = 0; i < group.rows.length; i++) {
      const row = group.rows[i]
      const summary = (row[4] || '').trim()
      // ACD jzlx.txt format: col5 = to_code (转入科目), col6 = from_code (转出科目)
      const rawCol5 = (row[5] || '').trim()
      const rawCol6 = (row[6] || '').trim()
      const fromCode = rawCol6 // col6 is the source (转出) account
      const toCode = rawCol5 // col5 is the target (转入) account
      const ratioStr = (row[7] || '1').trim()
      const ratio = parseFloat(ratioStr) || 1

      if (!fromCode && !toCode) continue

      validItems.push({
        summary: summary || group.name,
        fromCode,
        toCode,
        ratio,
        sortOrder: validItems.length,
      })
    }

    // Skip types with no valid items
    if (validItems.length === 0) {
      console.log(`[ACD] 结转类型 ${typeCode}(${group.name}) 没有有效分录，跳过`)
      continue
    }

    // 判断结转周期（只根据名称判断）
    const periodType = determinePeriodType(group.name)

    // Insert type only if it has valid items
    insertType.run(
      uuidv4(),
      accountSetId,
      typeCode,
      group.name,
      group.voucherType || '结转',
      periodType
    )

    console.log(
      `[ACD] 导入结转类型: ${typeCode}(${group.name}) - 周期: ${periodType === 'monthly' ? '月结' : '年结'}`
    )

    for (const item of validItems) {
      insertItem.run(
        uuidv4(),
        accountSetId,
        typeCode,
        item.summary,
        item.fromCode || null,
        accountNameMap.get(item.fromCode) || item.fromCode || null,
        item.toCode || null,
        accountNameMap.get(item.toCode) || item.toCode || null,
        item.ratio >= 1 ? 'all' : 'partial',
        item.ratio * 100,
        item.sortOrder
      )
      itemCount++
    }
  }

  stats.transferTypes.items = itemCount
}

function importAcdUsers(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun: boolean
) {
  const db = getDb()
  const acdUsers = tables.users
  const acdRights = tables.rights

  if (acdUsers.length === 0) {
    console.log('[ACD] b_user.txt 无数据，跳过用户导入')
    return
  }

  // 按用户代码分组权限
  const userRightsMap = new Map<string, AcdRight[]>()
  for (const right of acdRights) {
    if (!userRightsMap.has(right.userCode)) {
      userRightsMap.set(right.userCode, [])
    }
    userRightsMap.get(right.userCode)!.push(right)
  }

  // Get existing usernames for this account set
  const existingUsers = new Set(
    (
      db.prepare('SELECT username FROM users WHERE account_set_id = ?').all(accountSetId) as any[]
    ).map(u => u.username.toLowerCase())
  )

  let imported = 0
  let skipped = 0
  const noPasswordUsers: string[] = []
  const noPermissionUsers: string[] = []

  /**
   * 沿用 ACD 里的密码：b_user.txt 第 4 列是明文密码。
   * 有密码的按原密码 bcrypt 存；ACD 里本来就没设密码的保持空密码
   * （空串表示「免密码登录」，登录接口对空密码用户单独放行）。
   */
  const resolvePasswordHash = (plain: string) => {
    if (dryRun) return ''
    const value = (plain || '').trim()
    return value ? bcrypt.hashSync(value, 10) : ''
  }

  const persistUser = db.transaction(
    (
      roleId: string,
      roleName: string,
      roleCode: string,
      permissions: string[],
      isSystem: number,
      userId: string,
      username: string,
      nickname: string,
      roleIdForUser: string,
      passwordHash: string
    ) => {
      db.prepare(
        `INSERT INTO roles (id, name, code, permissions, account_set_id, is_system, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(roleId, roleName, roleCode, JSON.stringify(permissions), accountSetId, isSystem)
      db.prepare(
        `
      INSERT INTO users (id, account_set_id, username, password, nickname, role_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `
      ).run(userId, accountSetId, username, passwordHash, nickname, roleIdForUser)
      db.prepare(
        `INSERT OR IGNORE INTO user_roles (id, user_id, role_id, account_set_id)
         VALUES (?, ?, ?, ?)`
      ).run(uuidv4(), userId, roleIdForUser, accountSetId)
    }
  )

  for (const user of acdUsers) {
    // Skip if username already exists
    if (existingUsers.has(user.username.toLowerCase())) {
      console.log(`[ACD] 用户 ${user.username} 已存在，跳过`)
      skipped++
      continue
    }

    // 获取该用户的 ACD 权限列表
    const userRights = userRightsMap.get(user.code) || []

    // 转换为 CW 权限代码
    const cwPermissions = new Set<string>()
    /** 本系统确无对应模块的，按分组计数，最后汇总成一条提示 */
    const unsupportedCounts = new Map<string, number>()
    /** 既没映射、也不在已知不支持名单里的，属于对照表漏了，逐条列出 */
    const unknownRights: string[] = []

    for (const right of userRights) {
      const mapped = ACD_TO_CW[right.rightCode]
      if (mapped && mapped.length > 0) {
        mapped.forEach(p => cwPermissions.add(p))
        continue
      }
      if (ACD_SILENT_CODES.has(right.rightCode)) continue
      const group = ACD_UNSUPPORTED[right.rightCode]
      if (group) {
        unsupportedCounts.set(group, (unsupportedCounts.get(group) || 0) + 1)
      } else {
        unknownRights.push(`${right.rightCode}(${right.rightName || '未命名'})`)
      }
    }

    // ACD 没有「主页」概念，给真正拿到授权的用户垫上基础权限，
    // 否则他们能登录却进不了首页。ACD 里本就一条授权都没有的用户
    // 保持零权限，仍需管理员手工授权，不靠这里凭空放行。
    if (cwPermissions.size > 0) {
      ACD_IMPORT_BASE_PERMISSIONS.forEach(p => cwPermissions.add(p))
    }

    if (unsupportedCounts.size > 0) {
      const summary = [...unsupportedCounts.entries()]
        .map(([group, count]) => `${group}(${count}项)`)
        .join('、')
      stats.warnings.push(
        `用户 ${user.username}：ACD 中的 ${summary} 权限本系统暂无对应模块，已跳过`
      )
    }
    if (unknownRights.length > 0) {
      stats.warnings.push(
        `用户 ${user.username}：以下 ACD 权限不在对照表中，未能授权：${unknownRights.join('、')}`
      )
    }

    // 为该用户创建自定义角色。ACD 是按人授权、没有角色概念，
    // 强行归并到预设角色会错授权，因此保持一人一角色。
    const roleId = uuidv4()
    const userId = uuidv4()
    const nickname = user.fullName || user.username
    const roleName = `${nickname}（导入）`
    const permissions = Array.from(cwPermissions)

    // 如果用户是 MANAGER，给予所有权限
    if (user.username.toUpperCase() === 'MANAGER') {
      permissions.length = 0
      permissions.push('*')
    }

    const passwordHash = resolvePasswordHash(user.password)
    if (!passwordHash) noPasswordUsers.push(user.username)
    if (permissions.length === 0) noPermissionUsers.push(user.username)

    if (!dryRun) {
      persistUser(
        roleId,
        roleName,
        `imported_${user.username}`,
        permissions,
        0,
        userId,
        user.username,
        nickname,
        roleId,
        passwordHash
      )
    }

    existingUsers.add(user.username.toLowerCase())
    imported++
    console.log(
      `[ACD] 导入用户: ${user.username} (${nickname}), 权限数: ${permissions.length}, ACD权限数: ${userRights.length}, 密码: ${passwordHash ? '沿用ACD原密码' : '空(免密码登录)'}`
    )
  }

  stats.users = imported
  stats.warnings.push(`ACD用户: 导入${imported}个, 跳过${skipped}个(已存在)`)
  if (noPasswordUsers.length > 0) {
    stats.warnings.push(
      `以下用户在 ACD 里未设密码，导入后同样是空密码，登录时密码留空即可，建议尽快设置：${noPasswordUsers.join('、')}`
    )
  }
  if (noPermissionUsers.length > 0) {
    stats.warnings.push(
      `以下用户在 ACD 里没有任何可用的功能授权，导入后无权限、暂时无法登录，请在「系统管理 → 用户管理」中分配权限：${noPermissionUsers.join('、')}`
    )
  }
}

/**
 * 把 ACD pz.txt 的「借方/贷方」两列映射为系统的 direction + amount。
 *
 * ACD 允许红字（负数）分录：借方列为负 = 红字借，贷方列为负 = 红字贷。
 * 因此不能按「金额 > 0」判方向——那样红字行会被算成 amount<=0 而整行丢弃，
 * 导致本期发生额、期末余额与原软件对不上。方向只看哪一列有值，正负原样保留。
 *
 * 导入口径 = 按原始数据落库：这里**有意不套用** `validateVoucherEntryAmounts`
 * （services/voucherEntry.ts 的「金额必须大于 0」规则）。那条规则只约束手工录入，
 * 导入若套上去会把源账套的红字凭证全部拒掉。请勿给导入路径加该校验。
 *
 * @returns null 表示该行借贷均为 0，应跳过
 */
export function mapAcdEntryAmount(
  jf: number,
  df: number
): { direction: 'debit' | 'credit'; amount: number } | null {
  const useDebit = jf !== 0
  // 与 amount_cents 保持一致的 2 位精度，避免 ACD 里的浮点噪声（如 -48.58999999999992）
  const amount = Math.round((useDebit ? jf : df) * 100) / 100
  if (amount === 0) return null
  return { direction: useDebit ? 'debit' : 'credit', amount }
}

/**
 * 将 pz.txt 分录按 (年|月|类型|凭证号) 分组，并按润衡凭证号与 pz_xh 排序。
 * ACD 导出文件本身不保证凭证/分录顺序，旧实现按出现序写 seq 会导致「凭证错位」。
 */
export function groupAndSortAcdVoucherEntries(entries: AcdRow[]): {
  voucherGroups: Map<string, AcdRow[]>
  sortedGroupKeys: string[]
} {
  const voucherGroups = new Map<string, AcdRow[]>()
  for (const row of entries) {
    const nf = (row[0] || '').trim()
    const yf = (row[1] || '').trim()
    const pzlx = (row[2] || '').trim()
    const pzbh = (row[3] || '').trim()
    const key = `${nf}|${yf}|${pzlx}|${pzbh}`
    if (!voucherGroups.has(key)) {
      voucherGroups.set(key, [])
    }
    voucherGroups.get(key)!.push(row)
  }
  const sortedGroupKeys = Array.from(voucherGroups.keys()).sort((a, b) => {
    const [ay, am, at, an] = a.split('|')
    const [by, bm, bt, bn] = b.split('|')
    return (
      Number(ay) - Number(by) ||
      Number(am) - Number(bm) ||
      Number(at) - Number(bt) ||
      Number(an) - Number(bn) ||
      a.localeCompare(b)
    )
  })
  for (const group of voucherGroups.values()) {
    group.sort(
      (a, b) =>
        (Number.parseInt(a[4] || '0', 10) || 0) - (Number.parseInt(b[4] || '0', 10) || 0)
    )
  }
  return { voucherGroups, sortedGroupKeys }
}

function importVouchers(
  accountSetId: string,
  tables: ParsedTables,
  stats: ImportStats,
  dryRun: boolean,
  options?: { batched?: boolean; batchSize?: number }
) {
  const db = getDb()
  const entries = tables.voucherEntries
  const headers = tables.voucherHeaders

  if (entries.length === 0) {
    stats.warnings.push('pz.txt 没有可导入数据（该ACD账套无凭证）')
    return
  }

  stats.importedTables.push('pz.txt')
  if (headers.length > 0) {
    stats.importedTables.push('pzdj.txt')
  }

  // Build account code -> {id, name, is_foreign, currency_code} map
  const accounts = db
    .prepare(
      `SELECT id, code, name, is_foreign, currency_code FROM accounts WHERE account_set_id = ?`
    )
    .all(accountSetId) as Array<{
    id: string
    code: string
    name: string
    is_foreign: number
    currency_code: string | null
  }>
  const accountMap = new Map(accounts.map(a => [a.code.trim(), a]))

  // Build voucher type code -> id map
  const voucherTypes = db
    .prepare('SELECT id, code, name FROM voucher_types WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; code: string; name: string }>
  const voucherTypeMap = new Map(voucherTypes.map(vt => [vt.code.trim(), vt.id]))
  const voucherTypeNameMap = new Map(voucherTypes.map(vt => [vt.id, vt.name]))

  // FIX-2026-09-05：按 (年, 月, 类型, 润衡凭证号) 排序凭证，按 pz_xh 排序分录
  const { voucherGroups, sortedGroupKeys } = groupAndSortAcdVoucherEntries(entries)

  // Build header map for additional info (maker, auditor, etc.)
  const headerMap = new Map<string, AcdRow>()
  for (const row of headers) {
    const nf = (row[0] || '').trim()
    const yf = (row[1] || '').trim()
    const pzlx = (row[2] || '').trim()
    const pzbh = (row[3] || '').trim()
    const key = `${nf}|${yf}|${pzlx}|${pzbh}`
    headerMap.set(key, row)
  }

  stats.vouchers.vouchers = voucherGroups.size

  if (dryRun) {
    stats.vouchers.entries = entries.length
    return
  }

  // Get fiscal year from account set
  const accountSet = db
    .prepare('SELECT fiscal_year FROM account_sets WHERE id = ?')
    .get(accountSetId) as any
  const fiscalYear = accountSet?.fiscal_year || new Date().getFullYear()

  const insertVoucher = db.prepare(`
    INSERT INTO vouchers (
      id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, status, total_amount,
      maker_name, auditor_name, poster_name, posted_at, attachments, remark, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `)
  const voucherNoExists = db.prepare(
    `SELECT 1 FROM vouchers
     WHERE account_set_id = ? AND year = ? AND period = ? AND voucher_no = ?
       AND (voucher_type_id = ? OR (voucher_type_id IS NULL AND ? IS NULL))
     LIMIT 1`
  )

  const cashFlowItems = db
    .prepare('SELECT code, name FROM cash_flow_items WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ code: string; name: string }>
  const cashFlowNameByCode = new Map(cashFlowItems.map(item => [item.code.trim(), item.name]))

  // 分录辅助项：pz.txt 16 xmbm(项目) / 17 dwbm(往来单位) / 18 bmbm(部门) / 19 grbm(个人)
  // 按「类目 code + 项目编码」反查 aux_items，同时写固定列与 aux_data（账簿两种口径都兼容）
  const auxCategories = db
    .prepare('SELECT id, code FROM aux_categories WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; code: string }>
  const auxCategoryIdByCode = new Map(auxCategories.map(item => [item.code, item.id]))
  const auxItemRows = db
    .prepare('SELECT id, type, code, name FROM aux_items WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string; type: string; code: string; name: string }>
  const auxItemByTypeAndCode = new Map(
    auxItemRows.map(item => [`${item.type}|${String(item.code || '').trim()}`, item])
  )
  const lookupAuxItem = (categoryCode: string, itemCode: string) => {
    if (!itemCode) return null
    const categoryId = auxCategoryIdByCode.get(categoryCode)
    if (!categoryId) return null
    return auxItemByTypeAndCode.get(`${categoryId}|${itemCode}`) || null
  }
  const ACD_ENTRY_AUX_COLUMNS: Array<{ index: number; categoryCode: string }> = [
    { index: 16, categoryCode: 'project' },
    { index: 17, categoryCode: 'customer' },
    { index: 18, categoryCode: 'dept' },
    { index: 19, categoryCode: 'person' },
  ]
  let unresolvedAuxRefs = 0

  const insertEntry = db.prepare(`
    INSERT INTO voucher_entries (
      id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
      direction, amount, amount_cents, quantity, unit_price, unit,
      summary, cash_flow_code, cash_flow_name,
      dept_id, dept_name, project_id, project_name, supplier_id, supplier_name,
      person_id, person_name, aux_data,
      currency_code, exchange_rate, foreign_amount, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)

  let entryCount = 0
  let renumberedVouchers = 0
  let skippedMissingAccounts = 0

  // 按月按类型追踪凭证编号（仅用于润衡凭证号冲突时补号）
  const voucherNoMap = new Map<string, number>()

  const persistVoucherBatch = (batch: Array<[string, AcdRow[]]>, startVoucherNo: number) => {
    let localEntryCount = 0

    for (const [key, groupEntries] of batch) {
      const [nf, yf, pzlx, pzbh] = key.split('|')
      const year = parseInt(nf) || fiscalYear
      const period = parseInt(yf) || 1
      const voucherTypeId = voucherTypeMap.get(pzlx) || null
      const typeName = voucherTypeId
        ? voucherTypeNameMap.get(voucherTypeId) || undefined
        : undefined

      // 凭证号：沿用润衡 pzbh（如 收-001），保证与原账凭证一一对应；
      // 仅在号码已被占用（理论上不会）时才退回顺序补号。
      const periodKey = `${year}-${period}-${voucherTypeId || '__NULL__'}`
      const acdSeq = Number.parseInt(pzbh, 10)
      let voucherNo = Number.isInteger(acdSeq) && acdSeq > 0
        ? buildVoucherNo({ maxNo: acdSeq - 1, typeName })
        : ''
      if (
        !voucherNo ||
        voucherNoExists.get(accountSetId, year, period, voucherNo, voucherTypeId, voucherTypeId)
      ) {
        if (!voucherNoMap.has(periodKey)) {
          voucherNoMap.set(
            periodKey,
            getMaxVoucherNoSeqInPeriod({ db, accountSetId, year, period, voucherTypeId })
          )
        }
        const currentMax = voucherNoMap.get(periodKey)!
        voucherNo = buildVoucherNo({ maxNo: currentMax, typeName })
        voucherNoMap.set(periodKey, currentMax + 1)
        renumberedVouchers += 1
      }

      // 凭证头 pzdj：4 pzdj_fds 附单据数 / 6 制单 / 7 审核 / 8 记账 / 9 pzdj_rq 凭证日期 / 11 pzdj_jzrq 记账日期
      const headerRow = headerMap.get(key)
      const makerName = headerRow ? (headerRow[6] || '').trim() : ''
      const auditorName = headerRow ? (headerRow[7] || '').trim() : ''
      const posterName = headerRow ? (headerRow[8] || '').trim() : ''
      const attachments = headerRow ? Number.parseInt((headerRow[4] || '0').trim(), 10) || 0 : 0
      // 凭证日期优先取 pzdj_rq；缺失则用分录 dd（日）列；再退回月末。旧实现一律写月末日期，
      // 序时账 / 日记账 / 按日期查账的口径全部失真（本例 211 张里只有 78 张是 31 日）。
      const voucherDate =
        normalizeAcdDateInPeriod(headerRow?.[9], year, period) ??
        buildAcdDateFromDay(groupEntries[0]?.[24], year, period) ??
        buildPeriodEndDate(year, period)
      const postedAt = normalizeAcdDateInPeriod(headerRow?.[11]) ?? null

      // 确定凭证状态：根据审核人和记账人判断
      let status: 'draft' | 'audited' | 'posted' = 'draft'
      if (posterName) {
        status = 'posted'
      } else if (auditorName) {
        status = 'audited'
      }

      let totalAmount = 0
      const voucherId = uuidv4()
      const preparedEntries: Array<{
        seq: number
        accountId: string | null
        accountCode: string
        accountName: string
        direction: 'debit' | 'credit'
        amount: number
        summary: string
        cashFlowCode: string | null
        cashFlowName: string | null
        quantity: number
        unitPrice: number
        unit: string | null
        aux: EntryAuxFields
        currencyCode: string | null
        exchangeRate: number | null
        foreignAmount: number | null
      }> = []

      let voucherMissingAccount = false
      for (let i = 0; i < groupEntries.length; i++) {
        const row = groupEntries[i]
        const kmbm = (row[5] || '').trim()
        const zy = (row[6] || '').trim()
        const jf = parseFloat((row[7] || '0').replace(/,/g, '')) || 0
        const df = parseFloat((row[8] || '0').replace(/,/g, '')) || 0
        // 9 pz_wb 外币金额 / 10 pz_hl 汇率 / 20 bz 币种
        const pzWb = parseAcdNumber(row[9])
        const pzHl = parseAcdNumber(row[10])
        const entryBz = (row[20] || '').trim().toUpperCase()
        // 11 pz_sl 数量 / 12 pz_dj 单价 / 21 dw 计量单位（数量核算科目）
        const quantity = parseAcdNumber(row[11])
        const unitPrice = parseAcdNumber(row[12])
        const unit = (row[21] || '').trim() || null
        const xjbm = (row[26] || '').trim()

        const account = accountMap.get(kmbm)
        if (!account) voucherMissingAccount = true
        const mapped = mapAcdEntryAmount(jf, df)
        if (!mapped) continue
        const { direction, amount } = mapped

        const cashFlowCode = xjbm || null
        const cashFlowName = cashFlowCode
          ? cashFlowNameByCode.get(cashFlowCode) || cashFlowCode
          : null

        let currencyCode: string | null = null
        let exchangeRate: number | null = null
        let foreignAmount: number | null = null
        if (account && Number(account.is_foreign) === 1 && pzWb !== 0) {
          currencyCode = entryBz || account.currency_code || null
          exchangeRate = pzHl || null
          foreignAmount = pzWb
        }

        const aux: EntryAuxFields = {
          deptId: null,
          deptName: null,
          projectId: null,
          projectName: null,
          supplierId: null,
          supplierName: null,
          personId: null,
          personName: null,
          auxData: null,
        }
        const auxData: Record<string, { id: string; name: string }> = {}
        for (const column of ACD_ENTRY_AUX_COLUMNS) {
          const itemCode = (row[column.index] || '').trim()
          if (!itemCode) continue
          const item = lookupAuxItem(column.categoryCode, itemCode)
          if (!item) {
            unresolvedAuxRefs += 1
            continue
          }
          auxData[column.categoryCode] = { id: item.id, name: item.name }
          if (column.categoryCode === 'dept') {
            aux.deptId = item.id
            aux.deptName = item.name
          } else if (column.categoryCode === 'project') {
            aux.projectId = item.id
            aux.projectName = item.name
          } else if (column.categoryCode === 'customer') {
            aux.supplierId = item.id
            aux.supplierName = item.name
          } else if (column.categoryCode === 'person') {
            aux.personId = item.id
            aux.personName = item.name
          }
        }
        if (Object.keys(auxData).length > 0) {
          aux.auxData = JSON.stringify(auxData)
        }

        preparedEntries.push({
          seq: i + 1,
          accountId: account?.id || null,
          accountCode: kmbm,
          accountName: account?.name || kmbm,
          direction,
          amount,
          summary: zy,
          cashFlowCode,
          cashFlowName,
          quantity,
          unitPrice,
          unit,
          aux,
          currencyCode,
          exchangeRate,
          foreignAmount,
        })

        if (direction === 'debit') totalAmount += amount
      }

      // 科目缺失的凭证整体跳过，避免 account_id 为 NULL 触发 NOT NULL 约束、导致整批导入回滚
      if (voucherMissingAccount) {
        skippedMissingAccounts++
        continue
      }

      if (preparedEntries.length === 0) continue

      insertVoucher.run(
        voucherId,
        accountSetId,
        voucherNo,
        voucherTypeId,
        voucherDate,
        year,
        period,
        status,
        totalAmount,
        makerName || null,
        auditorName || null,
        posterName || null,
        status === 'posted' ? postedAt : null,
        attachments,
        `ACD导入凭证`
      )

      for (const entry of preparedEntries) {
        insertEntry.run(
          uuidv4(),
          accountSetId,
          voucherId,
          entry.seq,
          entry.accountId,
          entry.accountCode,
          entry.accountName,
          entry.direction,
          entry.amount,
          Math.round(entry.amount * 100),
          entry.quantity,
          entry.unitPrice,
          entry.unit,
          entry.summary || null,
          entry.cashFlowCode,
          entry.cashFlowName,
          entry.aux.deptId,
          entry.aux.deptName,
          entry.aux.projectId,
          entry.aux.projectName,
          entry.aux.supplierId,
          entry.aux.supplierName,
          entry.aux.personId,
          entry.aux.personName,
          entry.aux.auxData,
          entry.currencyCode,
          entry.exchangeRate,
          entry.foreignAmount
        )
        localEntryCount++
      }
    }

    return { entryCount: localEntryCount }
  }

  const groupedVouchers: Array<[string, AcdRow[]]> = sortedGroupKeys.map(key => [
    key,
    voucherGroups.get(key)!,
  ])
  const batchSize = options?.batchSize ?? 150

  if (options?.batched) {
    for (let i = 0; i < groupedVouchers.length; i += batchSize) {
      const batch = groupedVouchers.slice(i, i + batchSize)
      const result = db.transaction(() => persistVoucherBatch(batch, 0))()
      entryCount += result.entryCount
    }
  } else {
    const result = persistVoucherBatch(groupedVouchers, 0)
    entryCount = result.entryCount
  }

  stats.vouchers.entries = entryCount
  if (unresolvedAuxRefs > 0) {
    stats.warnings.push(
      `凭证分录有 ${unresolvedAuxRefs} 处辅助项目编码在辅助档案中找不到，已按无辅助导入`
    )
  }
  if (skippedMissingAccounts > 0) {
    stats.warnings.push(
      `有 ${skippedMissingAccounts} 张凭证引用了账套中不存在的科目，已整张跳过（避免导入中断）`
    )
  }
  if (renumberedVouchers > 0) {
    stats.warnings.push(
      `有 ${renumberedVouchers} 张凭证的润衡凭证号与账套已有凭证冲突，已顺序补号`
    )
  }
}

function buildPeriodEndDate(year: number, period: number): string {
  const lastDay = new Date(year, period, 0).getDate()
  return `${year}-${String(period).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/**
 * 解析润衡日期（2025-12-23 / 2025.12.23 / 2025/12/23 / 20251223）为 YYYY-MM-DD。
 * 传入 year/period 时要求落在该会计期间内，否则视为无效（防止串月）。
 */
export function normalizeAcdDateInPeriod(
  value: string | undefined | null,
  year?: number,
  period?: number
): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const m =
    raw.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/) ||
    raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return null
  if (year !== undefined && period !== undefined && (y !== year || mo !== period)) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** pz.txt 的 dd 列只存「日」，与凭证所属年月拼成完整日期 */
export function buildAcdDateFromDay(
  value: string | undefined | null,
  year: number,
  period: number
): string | null {
  const day = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isInteger(day) || day < 1 || day > new Date(year, period, 0).getDate()) return null
  return `${year}-${String(period).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

type EntryAuxFields = {
  deptId: string | null
  deptName: string | null
  projectId: string | null
  projectName: string | null
  supplierId: string | null
  supplierName: string | null
  personId: string | null
  personName: string | null
  auxData: string | null
}

async function runImport(options: Options): Promise<ImportStats> {
  const db = getDb()
  const accountSet = resolveCurrentAccountSet()
  const tables = options.acdBuffer
    ? parseAcdTables(options.acdBuffer)
    : parseAcdTables(options.acdFilePath!)
  const stats = buildStats(accountSet.id, accountSet.name)

  if (!options.dryRun) {
    updateAccountSetStartDateFromXt(db, accountSet.id, tables.xt)
  }

  // CLI 路径同样落库科目编码长度/级数，保证账簿 getCodeLengths 与导入切分规则一致（原仅 App 路径写）
  if (!options.dryRun) {
    let codeLengths = extractAccountCodeLengthsFromXt(tables.xt)
    if (!codeLengths) codeLengths = inferAccountCodeLengths(tables.accounts)
    const inferredLevels = inferAccountLevelsFromAccounts(tables.accounts)
    applyAccountCodeConfigToDb(db, accountSet.id, inferredLevels, codeLengths)
  }

  const execute = () => {
    importSystemParams(accountSet.id, tables.xt, stats, options.dryRun)
    importPeriodClosing(accountSet.id, tables.xt, stats, options.dryRun)
    importVoucherTypes(accountSet.id, tables.voucherTypes, stats, options.dryRun)
    // 先导币种，保证 importAccounts 读取到的 baseCurrency 正确（原顺序相反）
    importCurrencies(accountSet.id, tables.currencies, tables.xt, stats, options.dryRun)
    // bzk 补齐 fbgl 未覆盖的币种
    importCurrencyArchive(accountSet.id, tables.currencyArchives, stats, options.dryRun)
    importAccounts(accountSet.id, tables.accounts, stats, options.dryRun)
    importAuxiliaryData(accountSet.id, tables, stats, options.dryRun)
    importInitBalances(accountSet.id, tables.initBalances, stats, options.dryRun)
    importAuxInitBalances(accountSet.id, tables, stats, options.dryRun)
    importBudgetSurplusAdjustments(
      accountSet.id,
      tables.budgetSurplusAdjustments,
      stats,
      options.dryRun
    )
    importTransferTypes(
      accountSet.id,
      tables.transferTypes,
      tables.accounts,
      tables.voucherTypes,
      stats,
      options.dryRun
    )
    importVouchers(accountSet.id, tables, stats, options.dryRun)
    importVoucherTemplates(accountSet.id, tables, stats, options.dryRun)
    importAcdUsers(accountSet.id, tables, stats, options.dryRun)
  }

  if (options.dryRun) {
    execute()
  } else {
    db.transaction(execute)()
    // 导入的设置（资产类别/参数/转账项…）可能指向有下级的科目，统一改指第一个末级子科目
    db.transaction(() => normalizeNonLeafReferences(db, accountSet.id))()
    stats.accountBalanceRows = rebuildAccountBalances(db, accountSet.id).rows
  }

  // 报表模板不再随 ACD 导入自动加载（启发式识别会计准则不可靠）。
  // 用户可在「报表 → 动态报表 → 导入 Excel」里按需手动上传所需模板。
  stats.warnings.push(
    'ACD 导入未自动加载报表模板：请在「报表 → 动态报表 → 导入 Excel」里手动上传所需模板'
  )

  return stats
}

// Export for service layer usage — full import (includes vouchers & init balances)
export async function importAcdToAccountSet(
  accountSetId: string,
  acdBuffer: Buffer
): Promise<ImportStats> {
  const db = getDb()
  const accountSet = db.prepare('SELECT * FROM account_sets WHERE id = ?').get(accountSetId) as any
  if (!accountSet) {
    throw new Error('账套不存在: ' + accountSetId)
  }

  const tables = parseAcdTables(acdBuffer)
  const stats = buildStats(accountSet.id, accountSet.name)

  // FIX-2026-09-04：完整导入过去从不写 account_code_lengths / account_levels，
  // 只有模板导入（importAcdTemplateToAccountSet）写。于是账簿侧的 getCodeLengths()
  // 读不到配置、退回默认 [4,2,2,2,2,2]，与导入科目时实际用的分段规则（本例 [4,3,3,...]）
  // 不一致：7 位科目 1002001 被切出「1002 / 100200」两级父编码，
  // 科目余额表里就凭空多出 100200、224100 这类查不到名称、显示为「-」的幽灵父科目行。
  // 这里与模板导入走同一套推断并落库，保证建账与账簿用的是同一份编码规则。
  {
    let codeLengths = extractAccountCodeLengthsFromXt(tables.xt)
    if (!codeLengths) {
      console.log('[ACD] xt.txt 中未找到科目编码长度配置，使用推断算法')
      codeLengths = inferAccountCodeLengths(tables.accounts)
    }
    const inferredLevels = inferAccountLevelsFromAccounts(tables.accounts)
    const codeConfig = applyAccountCodeConfigToDb(db, accountSet.id, inferredLevels, codeLengths)
    console.log(
      `[ACD] 科目级数 ${codeConfig.accountLevels}，编码长度 [${codeConfig.accountCodeLengths.slice(0, codeConfig.accountLevels).join(',')}]`
    )
  }

  // 完整导入：账套就是这个 ACD 生成的，建账日期 / 会计年度以 xt_kzrq 为准
  updateAccountSetStartDateFromXt(db, accountSet.id, tables.xt, { preferXt: true })

  const execute = () => {
    // 标记账套来源为 ACD
    db.prepare('UPDATE account_sets SET import_source = ? WHERE id = ?').run('acd', accountSet.id)

    importSystemParams(accountSet.id, tables.xt, stats, false)
    importPeriodClosing(accountSet.id, tables.xt, stats, false)
    importVoucherTypes(accountSet.id, tables.voucherTypes, stats, false)
    // 先导币种，保证 importAccounts 读取到的 baseCurrency 正确（原顺序相反）
    importCurrencies(accountSet.id, tables.currencies, tables.xt, stats, false)
    // bzk 补齐 fbgl 未覆盖的币种
    importCurrencyArchive(accountSet.id, tables.currencyArchives, stats, false)
    importAccounts(accountSet.id, tables.accounts, stats, false)
    // 辅助核算主数据（dwk/bmk/grk/xmk/xjll_xm/zjly）：辅助期初与凭证分录辅助项都依赖它，
    // 过去只有模板导入会调用，完整导入里辅助科目挂着 is_aux 却没有任何辅助项目可选。
    importAuxiliaryData(accountSet.id, tables, stats, false)
    importInitBalances(accountSet.id, tables.initBalances, stats, false)
    importAuxInitBalances(accountSet.id, tables, stats, false)
    importBudgetSurplusAdjustments(accountSet.id, tables.budgetSurplusAdjustments, stats, false)
    importTransferTypes(
      accountSet.id,
      tables.transferTypes,
      tables.accounts,
      tables.voucherTypes,
      stats,
      false
    )
    // 出纳 / 固定资产 / 供应链模块数据（兼容 cn_* / zc_* / cpda/khda/ckda 表）
    importCashierTables(accountSet.id, tables, stats, false)
    importFixedAssetTables(accountSet.id, tables, stats, false)
  }

  db.transaction(execute)()
  db.transaction(() => normalizeNonLeafReferences(db, accountSet.id))()
  importVouchers(accountSet.id, tables, stats, false, { batched: true, batchSize: 150 })
  db.transaction(() => importVoucherTemplates(accountSet.id, tables, stats, false))()
  importAcdUsers(accountSet.id, tables, stats, false)

  // FIX-2026-09-05：导入的凭证直接落成 status='posted'，但过账时才会写的 account_balances 一直是空的，
  // 而资产负债表 / 利润表 / 现金流量表取数（reportBalance.getBatchBalances）和期末自动结转
  // （autoTransfer）都只读 account_balances —— 导入后报表本期发生额全是 0。这里按已记账凭证全量重建。
  const rebuilt = rebuildAccountBalances(db, accountSet.id)
  stats.accountBalanceRows = rebuilt.rows
  console.log(`[ACD] 重建 account_balances: ${rebuilt.rows} 行`)

  // 账套默认参数 / 默认打印模板 / 资产字典兜底：
  // ACD 建账走的是 acdImportService 直插 account_sets，从没调用过新建账套的 bootstrap，
  // 于是 require_audit / enable_cash_flow 等参数缺失、没有默认打印模板。
  // 放在导入之后执行：字典类只补空缺（不覆盖 ACD 带来的资产类别等），业务参数按 xt.txt 覆盖默认值。
  {
    const persisted = db
      .prepare('SELECT start_date, fiscal_year FROM account_sets WHERE id = ?')
      .get(accountSet.id) as { start_date?: string; fiscal_year?: number } | undefined
    const businessParams = deriveAcdBusinessParams(tables.xt)
    if (stats.foreignAccounts > 0) {
      businessParams.enable_foreign_currency = 'true'
    }
    const baseCurrency = (tables.xt.get('xt_bwb') || '').trim()
    if (baseCurrency) {
      businessParams.base_currency = baseCurrency.toUpperCase()
    }
    bootstrapNewAccountSetDefaults(db, accountSet.id, {
      start_date: persisted?.start_date,
      fiscal_year: persisted?.fiscal_year,
      params: businessParams,
    })
  }

  // 供应链模块数据（cpda→scm_item, khda→scm_partner, ckda→scm_warehouse）
  importSupplyChainFromAcd(db, accountSet.id, acdBuffer)

  // FIX-318：整套导入后各表规模骤增，立即刷新规划器统计，避免旧统计导致查询选错计划卡死服务
  try { db.pragma('optimize=0x10002') } catch { /* 只读库等情况忽略 */ }

  // 报表模板不再随 ACD 导入自动加载，提示用户手动上传
  stats.warnings.push(
    'ACD 导入未自动加载报表模板：请在「报表 → 动态报表 → 导入 Excel」里手动上传所需模板'
  )

  return stats
}

export interface ImportTemplateOptions {
  preserveStartDate?: boolean
  preserveAux?: boolean
  preserveVoucherTypes?: boolean
  preserveTransfer?: boolean
  preserveBusinessParams?: boolean
  accountLevels?: number
  accountCodeLengths?: number[]
}

// Template import — only presets (accounts, transfer types, voucher types, reports), no vouchers/init balances
export function importAcdTemplateToAccountSet(
  accountSetId: string,
  acdBuffer: Buffer,
  options: ImportTemplateOptions = {}
): ImportStats {
  const db = getDb()
  const accountSet = db.prepare('SELECT * FROM account_sets WHERE id = ?').get(accountSetId) as any
  if (!accountSet) {
    throw new Error('账套不存在: ' + accountSetId)
  }

  const tables = parseAcdTables(acdBuffer)
  const stats = buildStats(accountSet.id, accountSet.name)

  let codeConfig: { accountLevels: number; accountCodeLengths: number[] }
  if (options.accountLevels && options.accountCodeLengths?.length) {
    codeConfig = applyAccountCodeConfigToDb(
      db,
      accountSet.id,
      options.accountLevels,
      options.accountCodeLengths
    )
  } else {
    let codeLengths = extractAccountCodeLengthsFromXt(tables.xt)
    if (!codeLengths) {
      console.log('[ACD] xt.txt 中未找到科目编码长度配置，使用推断算法')
      codeLengths = inferAccountCodeLengths(tables.accounts)
    }
    const inferredLevels = inferAccountLevelsFromAccounts(tables.accounts)
    codeConfig = applyAccountCodeConfigToDb(db, accountSet.id, inferredLevels, codeLengths)
  }

  console.log(
    `[ACD] 科目级数 ${codeConfig.accountLevels}，编码长度 [${codeConfig.accountCodeLengths.slice(0, codeConfig.accountLevels).join(',')}]`
  )

  if (!options.preserveStartDate) {
    updateAccountSetStartDateFromXt(db, accountSet.id, tables.xt)
  }

  const execute = () => {
    if (!options.preserveBusinessParams) {
      importSystemParams(accountSet.id, tables.xt, stats, false)
    }
    if (!options.preserveVoucherTypes) {
      importVoucherTypes(accountSet.id, tables.voucherTypes, stats, false)
    }
    importAccounts(accountSet.id, tables.accounts, stats, false)
    importCurrencies(accountSet.id, tables.currencies, tables.xt, stats, false)
    if (!options.preserveTransfer) {
      importTransferTypes(
        accountSet.id,
        tables.transferTypes,
        tables.accounts,
        tables.voucherTypes,
        stats,
        false
      )
    }
    if (!options.preserveAux) {
      importAuxiliaryData(accountSet.id, tables, stats, false)
    }
    // Skip initBalances for template import
    // Skip vouchers for template import
    // 导入 ACD 报表模板（VTS 解析在某些边界情况下可能不完美，
    // 但至少提供可用的初始模板；用户后续可通过 Excel 导入覆盖）
    try {
      importReportTemplates(accountSet.id, tables, stats, false)
    } catch (err: any) {
      console.warn('[ACD] 报表模板导入失败（不影响其他数据）:', err.message)
      stats.warnings.push(`报表模板导入失败: ${err.message}`)
    }
    // Skip ACD users for template import
  }

  db.transaction(execute)()
  db.transaction(() => normalizeNonLeafReferences(db, accountSet.id))()

  return stats
}

export type { ImportStats, ParsedTables, AcdRow }
export {
  parseAcdTables,
  parseAcdFileTables,
  splitTableRows,
  inferAccountCodeLengths,
  inferAccountLevelsFromAccounts,
}

function printStats(stats: ImportStats, dryRun: boolean) {
  console.log('\n' + '='.repeat(60))
  console.log(`  ${dryRun ? '[模拟导入]' : '✓ 导入成功'}`)
  console.log('='.repeat(60))
  console.log(`\n账套信息:`)
  console.log(`  名称: ${stats.accountSetName}`)
  console.log(`  ID: ${stats.accountSetId}`)

  console.log(`\n导入统计:`)
  const accountTotal = stats.accounts.inserted + stats.accounts.updated
  if (accountTotal > 0) {
    console.log(
      `  ✓ 科目: ${accountTotal} 个 (新增 ${stats.accounts.inserted}, 更新 ${stats.accounts.updated})`
    )
  }

  if (stats.foreignAccounts > 0) {
    console.log(`  ✓ 外币科目: ${stats.foreignAccounts} 个`)
  }

  if (stats.currencies.inserted + stats.currencies.updated > 0) {
    console.log(
      `  ✓ 币种: ${stats.currencies.inserted + stats.currencies.updated} 个 (新增 ${stats.currencies.inserted}, 更新 ${stats.currencies.updated})`
    )
  }

  if (stats.initBalances.inserted > 0) {
    console.log(`  ✓ 期初余额: ${stats.initBalances.inserted} 条`)
  }

  if (stats.auxInitBalances.inserted > 0) {
    console.log(`  ✓ 辅助期初: ${stats.auxInitBalances.inserted} 条`)
  }

  if (stats.voucherTemplates > 0) {
    console.log(`  ✓ 凭证模板: ${stats.voucherTemplates} 个`)
  }

  if (stats.accountBalanceRows > 0) {
    console.log(`  ✓ 科目余额(account_balances): ${stats.accountBalanceRows} 行`)
  }

  if (stats.voucherTypes.inserted + stats.voucherTypes.updated > 0) {
    console.log(`  ✓ 凭证类型: ${stats.voucherTypes.inserted + stats.voucherTypes.updated} 个`)
  }

  if (stats.vouchers.vouchers > 0) {
    console.log(`  ✓ 凭证: ${stats.vouchers.vouchers} 张 (${stats.vouchers.entries} 条分录)`)
  }

  if (stats.budgetSurplusAdjustments.inserted > 0) {
    console.log(`  ✓ 预算盈余差异明细: ${stats.budgetSurplusAdjustments.inserted} 条`)
  }

  if (stats.transferTypes.types > 0) {
    console.log(
      `  ✓ 结转类型: ${stats.transferTypes.types} 个 (${stats.transferTypes.items} 条分录)`
    )
  }

  if (stats.reportTemplates.definitions > 0) {
    console.log(`  ✓ 报表模板: ${stats.reportTemplates.definitions} 个`)
  }

  if (stats.users > 0) {
    console.log(`  ✓ 用户: ${stats.users} 个`)
  }

  if (stats.warnings.length > 0) {
    console.log(`\n⚠ 警告信息:`)
    for (const warning of stats.warnings) {
      console.log(`  - ${warning}`)
    }
  }

  console.log('\n' + '='.repeat(60) + '\n')
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const positional = args.filter(arg => arg !== '--dry-run')

  if (positional.length === 0) {
    console.log(
      '用法: node --import tsx/esm src/scripts/importAcdToCurrentAccountSet.ts <acd文件路径> [--dry-run]'
    )
    process.exit(1)
  }

  return {
    acdFilePath: positional[0],
    dryRun,
  }
}

async function main() {
  const options = parseArgs()
  const stats = await runImport({ acdFilePath: options.acdFilePath, dryRun: options.dryRun })
  printStats(stats, options.dryRun)
}

// Only run main when executed directly (not when imported)
if (
  process.argv[1]?.endsWith('importAcdToCurrentAccountSet.ts') ||
  process.argv[1]?.endsWith('importAcdToCurrentAccountSet')
) {
  main().catch(err => {
    console.error('[ACD] 导入失败:', err)
    process.exit(1)
  })
}
