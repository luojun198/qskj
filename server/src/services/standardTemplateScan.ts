import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve, isAbsolute } from 'path'
import { getDeployDir } from '../db/index.js'
import { listImportableExcelFiles } from '../utils/reportTemplateFiles.js'
import {
  inferAccountingStandardFromTemplateId,
  isAccountingStandardParam,
} from './accountingStandard.js'
import type { AccountingStandardParam } from './accountingStandard.js'

export type StandardTemplateInfo = {
  id: string
  name: string
  description: string
  acdFile: string
  excelFiles: Array<{ name: string; path: string }>
  inferredStandard: AccountingStandardParam
  /** 目录分组（来自 catalog.json；未登记的目录归入「其他模版」） */
  group: string
  /** 原软件行业代码（ACD xt_hy），仅 catalog 登记项有 */
  code?: string
  /** 已停用的旧准则：默认折叠到列表末尾，仅供沿用旧账的单位选择 */
  retired: boolean
  /** 排序号：catalog 顺序优先，未登记目录排在最后 */
  order: number
  /** 模板概况（懒加载：科目数 / 报表数 / 科目级次），列表接口返回 */
  summary?: StandardTemplateSummary
}

export type StandardTemplateSummary = {
  accounts: number
  topLevelAccounts: number
  reports: number
  codeLengths: number[]
  cashFlowItems: number
  transferTypes: number
}

type CatalogEntry = {
  id: string
  code?: string
  name?: string
  group?: string
  standard?: string
  dir?: string
  acd?: string
  retired?: boolean
  description?: string
}

type CatalogFile = {
  groups?: string[]
  templates?: CatalogEntry[]
}

export const STANDARD_TEMPLATE_CATALOG_FILE = 'catalog.json'
export const STANDARD_TEMPLATE_DEFAULT_GROUP = '其他模版'

function getStandardTemplateDirs(): string[] {
  const deployDir = getDeployDir()
  return [
    join(deployDir, '标准模版'),
    join(process.cwd(), '标准模版'),
    resolve(process.cwd(), '..', '标准模版'),
  ]
}

let cachedStandardTemplates: StandardTemplateInfo[] | null = null
let cachedGroups: string[] | null = null
let cachedStamp = ''

function templateDirStamp(dirs: string[] = getStandardTemplateDirs()): string {
  const parts: string[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      parts.push(`${dir}:${statSync(dir).mtimeMs}`)
      const catalog = join(dir, STANDARD_TEMPLATE_CATALOG_FILE)
      if (existsSync(catalog)) parts.push(`${catalog}:${statSync(catalog).mtimeMs}`)
      const library = join(dir, '准则库')
      if (existsSync(library)) parts.push(`${library}:${statSync(library).mtimeMs}`)
    } catch {
      // 目录中途被替换时退回重新扫描
    }
  }
  return parts.join('|')
}

function getCachedStandardTemplates(): StandardTemplateInfo[] {
  const stamp = templateDirStamp()
  if (!cachedStandardTemplates || cachedStamp !== stamp) {
    const result = scanStandardTemplatesUncached()
    cachedStandardTemplates = result.templates
    cachedGroups = result.groups
    cachedStamp = stamp
  }
  return cachedStandardTemplates
}

/** 标准模板目录变更后（如部署升级）可调用以刷新缓存 */
export function invalidateStandardTemplateCache() {
  cachedStandardTemplates = null
  cachedGroups = null
  cachedStamp = ''
}

/** 解析 catalog.json；文件缺失或损坏时返回空目录（退回纯目录扫描） */
export function readStandardTemplateCatalog(baseDir: string): CatalogFile {
  const file = join(baseDir, STANDARD_TEMPLATE_CATALOG_FILE)
  if (!existsSync(file)) return {}
  try {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(raw) as CatalogFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn(
      `[标准模版] catalog.json 解析失败，退回目录扫描: ${error instanceof Error ? error.message : String(error)}`
    )
    return {}
  }
}

function resolveCatalogStandard(entry: CatalogEntry, fallbackName: string): AccountingStandardParam {
  const declared = String(entry.standard || '').trim()
  if (declared && isAccountingStandardParam(declared) && declared !== 'custom') return declared
  return inferAccountingStandardFromTemplateId(fallbackName)
}

function findAcdInDir(dirPath: string): string | null {
  if (!existsSync(dirPath)) return null
  const files = readdirSync(dirPath)
  const acdFile = files.find(f => f.toLowerCase().endsWith('.acd'))
  return acdFile ? join(dirPath, acdFile) : null
}

/**
 * 扫描「标准模版」目录：
 * 1. 先按 catalog.json 的顺序登记模板（dir 子目录 或 acd 单文件两种形态）；
 * 2. 再把未登记的子目录（含 .acd）追加到末尾，保持旧版纯目录约定可用。
 */
export function scanStandardTemplatesUncached(dirs: string[] = getStandardTemplateDirs()): {
  templates: StandardTemplateInfo[]
  groups: string[]
} {
  const templates: StandardTemplateInfo[] = []
  const seen = new Set<string>()
  const groups: string[] = []
  let order = 0

  const pushGroup = (group: string) => {
    if (group && !groups.includes(group)) groups.push(group)
  }

  for (const dir of dirs) {
    if (!existsSync(dir)) continue

    const catalog = readStandardTemplateCatalog(dir)
    for (const group of catalog.groups || []) pushGroup(String(group))

    for (const entry of catalog.templates || []) {
      const id = String(entry?.id || '').trim()
      if (!id || seen.has(id)) continue

      let acdFile: string | null = null
      let excelFiles: Array<{ name: string; path: string }> = []
      if (entry.dir) {
        const subDirPath = isAbsolute(entry.dir) ? entry.dir : join(dir, entry.dir)
        acdFile = findAcdInDir(subDirPath)
        if (acdFile) excelFiles = listImportableExcelFiles(subDirPath)
      } else if (entry.acd) {
        const file = isAbsolute(entry.acd) ? entry.acd : join(dir, entry.acd)
        if (existsSync(file)) acdFile = file
      }
      if (!acdFile) {
        console.warn(`[标准模版] catalog 登记的模板「${id}」找不到 ACD 文件，已跳过`)
        continue
      }

      const name = String(entry.name || id).trim() || id
      const group = String(entry.group || STANDARD_TEMPLATE_DEFAULT_GROUP).trim()
      pushGroup(group)
      seen.add(id)
      templates.push({
        id,
        name,
        description:
          entry.description ||
          `包含 1 个 ACD 文件和 ${excelFiles.length} 个报表模板`,
        acdFile,
        excelFiles,
        inferredStandard: resolveCatalogStandard(entry, name),
        group,
        code: entry.code ? String(entry.code) : undefined,
        retired: entry.retired === true,
        order: order++,
      })
    }
  }

  // 未登记目录：沿用旧约定（子目录名即 ID）。
  // catalog 里 dir 指向的子目录、以及 acd 单文件所在的子目录（如「准则库」）都不再重复登记。
  const catalogDirs = new Set<string>()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readStandardTemplateCatalog(dir).templates || []) {
      if (entry?.dir) catalogDirs.add(String(entry.dir).replace(/[\\/]+$/, ''))
      if (entry?.acd) {
        const top = String(entry.acd).split(/[\\/]/)[0]
        if (top) catalogDirs.add(top)
      }
    }
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const subDirs = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
    for (const subDir of subDirs) {
      if (seen.has(subDir.name) || catalogDirs.has(subDir.name)) continue
      const subDirPath = join(dir, subDir.name)
      const acdFile = findAcdInDir(subDirPath)
      if (!acdFile) continue
      seen.add(subDir.name)
      const excelFiles = listImportableExcelFiles(subDirPath)
      pushGroup(STANDARD_TEMPLATE_DEFAULT_GROUP)
      templates.push({
        id: subDir.name,
        name: subDir.name,
        description: `包含 1 个 ACD 文件和 ${excelFiles.length} 个报表模板`,
        acdFile,
        excelFiles,
        inferredStandard: inferAccountingStandardFromTemplateId(subDir.name),
        group: STANDARD_TEMPLATE_DEFAULT_GROUP,
        retired: false,
        order: order++,
      })
    }
  }

  return { templates, groups }
}

export function scanStandardTemplates(): StandardTemplateInfo[] {
  return getCachedStandardTemplates()
}

/** catalog 中声明的分组顺序（含扫描时新出现的分组） */
export function getStandardTemplateGroups(): string[] {
  getCachedStandardTemplates()
  return cachedGroups || []
}

export function findStandardTemplateById(templateId: string): StandardTemplateInfo | null {
  const id = String(templateId || '').trim()
  if (!id) return null
  return getCachedStandardTemplates().find(item => item.id === id) || null
}

export function readStandardTemplateAcdBuffer(templateId: string): Buffer {
  const template = findStandardTemplateById(templateId)
  if (!template) {
    throw new Error('标准模板不存在')
  }
  if (!existsSync(template.acdFile)) {
    throw new Error('标准模板 ACD 文件不存在')
  }
  return readFileSync(template.acdFile)
}
