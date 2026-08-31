/**
 * 一次性脚本：净化历史已导入的报表模板。
 *
 * 用法：
 *   npm run --workspace=server scripts:sanitize-templates
 *   或：tsx server/src/scripts/sanitizeExistingTemplates.ts
 *
 * 作用：
 *   - 扫描 report_definitions
 *   - 对每个有磁盘模板或 raw_content 的 .xlsx 模板执行 sanitizeTemplateWorkbook
 *   - 仅保留首个 sheet，清除边界外脏数据
 *   - 覆盖回磁盘文件（如可解析）与 report_template_sources.raw_content
 *
 * 幂等：再次运行不会破坏已净化模板。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { getDb } from '../db/index.js'
import {
  loadReportTemplateExcelSource,
  saveReportTemplateExcelSource,
} from '../services/reportTemplatePersistence.js'
import { sanitizeTemplateWorkbook } from '../services/reportTemplateSanitize.js'
import {
  resolveTemplateFilePath,
  resolveUploadedTemplatePath,
} from '../services/reportTemplateExport.js'

type DefinitionRow = {
  id: string
  code: string
  name: string
  source_file: string | null
}

async function run() {
  const db = getDb()
  const definitions = db
    .prepare(`SELECT id, code, name, source_file FROM report_definitions`)
    .all() as DefinitionRow[]

  console.log(`[sanitize-templates] 共 ${definitions.length} 个报表模板`)

  let okCount = 0
  let skipCount = 0
  let failCount = 0

  const updateSourceFileStmt = db.prepare(
    `UPDATE report_definitions SET source_file = ?, updated_at = datetime('now') WHERE id = ?`
  )

  for (const def of definitions) {
    try {
      // 1) 解析磁盘路径：先按 source_file 原路径，再回退按 basename 在 uploads/ 与 标准模版/ 下搜
      const diskPath =
        resolveTemplateFilePath(def.source_file) ||
        resolveUploadedTemplatePath(def.source_file)
      const stored = loadReportTemplateExcelSource(db, def.id)

      let buffer: Buffer | null = null
      let bufferFromDisk = false

      if (diskPath && existsSync(diskPath) && /\.xlsx$/i.test(diskPath)) {
        buffer = readFileSync(diskPath)
        bufferFromDisk = true
      } else if (stored?.buffer.length) {
        buffer = stored.buffer
      }

      if (!buffer) {
        console.log(`[sanitize-templates] 跳过 [${def.code}] ${def.name}：无可用模板内容`)
        skipCount++
        continue
      }

      // 仅处理 xlsx；非 zip 格式（如 xls 二进制）直接跳过
      const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
      if (!isZip) {
        console.log(`[sanitize-templates] 跳过 [${def.code}] ${def.name}：非 xlsx 格式`)
        skipCount++
        continue
      }

      const sanitized = await sanitizeTemplateWorkbook(buffer)

      // 仅当磁盘文件位于 uploads/report-templates 下（用户上传副本）时才覆盖；
      // 标准模版目录下的原始文件保持只读，导出会优先用 DB raw_content
      const isUploadedCopy = bufferFromDisk && diskPath
        ? /[\\/]uploads[\\/]report-templates[\\/]/i.test(diskPath)
        : false
      if (isUploadedCopy && diskPath) {
        writeFileSync(diskPath, sanitized)
      }

      // 2) 修复 DB source_file：若原路径已失效但磁盘上找到了真正的文件，
      //    把 source_file 更新成实际存在的路径，避免后续导出再次走错路径回退
      const sourceFileForSave =
        (diskPath && existsSync(diskPath) && diskPath) ||
        def.source_file ||
        `${def.code}.xlsx`
      if (diskPath && existsSync(diskPath) && def.source_file !== diskPath) {
        updateSourceFileStmt.run(diskPath, def.id)
        console.log(
          `[sanitize-templates]   ↳ 修正 source_file：${def.source_file} → ${diskPath}`
        )
      }

      saveReportTemplateExcelSource(db, def.id, sourceFileForSave, sanitized)

      console.log(
        `[sanitize-templates] ✓ [${def.code}] ${def.name}（${buffer.length} → ${sanitized.length} 字节，来源=${bufferFromDisk ? '磁盘' : 'DB raw_content'}${isUploadedCopy ? '，已覆盖磁盘副本' : '，仅更新 raw_content'}）`
      )
      okCount++
    } catch (error) {
      failCount++
      console.error(
        `[sanitize-templates] ✗ [${def.code}] ${def.name} 失败：`,
        error instanceof Error ? error.message : error
      )
    }
  }

  console.log(
    `[sanitize-templates] 完成：成功 ${okCount}，跳过 ${skipCount}，失败 ${failCount}`
  )
}

const entryScript = process.argv[1] ? basename(process.argv[1]) : ''
const thisScript = basename(fileURLToPath(import.meta.url))
if (entryScript === thisScript) {
  run().catch(error => {
    console.error('[sanitize-templates] 运行失败：', error)
    process.exit(1)
  })
}
