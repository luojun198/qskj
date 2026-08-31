import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { getDeployDir } from '../db/index.js'
import { listImportableExcelFiles } from '../utils/reportTemplateFiles.js'
import { inferAccountingStandardFromTemplateId } from './accountingStandard.js'
import type { AccountingStandardParam } from './accountingStandard.js'

export type StandardTemplateInfo = {
  id: string
  name: string
  description: string
  acdFile: string
  excelFiles: Array<{ name: string; path: string }>
  inferredStandard: AccountingStandardParam
}

function getStandardTemplateDirs(): string[] {
  const deployDir = getDeployDir()
  return [
    join(deployDir, '标准模版'),
    join(process.cwd(), '标准模版'),
    resolve(process.cwd(), '..', '标准模版'),
  ]
}

let cachedStandardTemplates: StandardTemplateInfo[] | null = null

function getCachedStandardTemplates(): StandardTemplateInfo[] {
  if (!cachedStandardTemplates) {
    cachedStandardTemplates = scanStandardTemplatesUncached()
  }
  return cachedStandardTemplates
}

/** 标准模板目录变更后（如部署升级）可调用以刷新缓存 */
export function invalidateStandardTemplateCache() {
  cachedStandardTemplates = null
}

function scanStandardTemplatesUncached(): StandardTemplateInfo[] {
  const dirs = getStandardTemplateDirs()
  const templates: StandardTemplateInfo[] = []
  const seen = new Set<string>()

  for (const dir of dirs) {
    if (!existsSync(dir)) continue

    const subDirs = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())

    for (const subDir of subDirs) {
      const subDirPath = join(dir, subDir.name)
      const files = readdirSync(subDirPath)

      const acdFile = files.find(f => f.toLowerCase().endsWith('.acd'))
      if (!acdFile) continue

      if (seen.has(subDir.name)) continue
      seen.add(subDir.name)

      const excelFiles = listImportableExcelFiles(subDirPath)

      templates.push({
        id: subDir.name,
        name: subDir.name,
        description: `包含 1 个 ACD 文件和 ${excelFiles.length} 个报表模板`,
        acdFile: join(subDirPath, acdFile),
        excelFiles,
        inferredStandard: inferAccountingStandardFromTemplateId(subDir.name),
      })
    }
  }

  return templates
}

export function scanStandardTemplates(): StandardTemplateInfo[] {
  return getCachedStandardTemplates()
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
