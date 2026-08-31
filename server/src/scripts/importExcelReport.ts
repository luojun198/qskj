import * as fs from 'fs'
import * as path from 'path'
import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import { fileURLToPath } from 'url'

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface ImportOptions {
  /** Excel文件路径 */
  excelPath: string
  /** 账套ID */
  accountSetId: string
  /** 报表编码 */
  reportCode: string
  /** 报表名称 */
  reportName: string
  /** 是否覆盖现有报表 */
  overwrite?: boolean
  /** 是否只导入第一个工作表 */
  importFirstSheetOnly?: boolean
}

interface ImportStats {
  /** 导入的报表编码 */
  reportCode: string
  /** 报表名称 */
  reportName: string
  /** 导入的工作表数量 */
  sheetsImported: number
  /** 导入的单元格数量 */
  cellsImported: number
  /** 导入的公式数量 */
  formulasImported: number
  /** 是否覆盖了现有报表 */
  overwritten: boolean
  /** 警告信息 */
  warnings: string[]
  /** 错误信息 */
  errors: string[]
}

/**
 * 导入Excel报表模板
 */
export async function importExcelReport(options: ImportOptions): Promise<ImportStats> {
  const stats: ImportStats = {
    reportCode: options.reportCode,
    reportName: options.reportName,
    sheetsImported: 0,
    cellsImported: 0,
    formulasImported: 0,
    overwritten: false,
    warnings: [],
    errors: []
  }

  const db = getDb()

  try {
    // 1. 验证Excel文件
    if (!fs.existsSync(options.excelPath)) {
      throw new Error(`Excel文件不存在: ${options.excelPath}`)
    }

    const ext = path.extname(options.excelPath).toLowerCase()
    if (!['.xls', '.xlsx'].includes(ext)) {
      throw new Error(`只支持 .xls 或 .xlsx 格式，当前文件: ${ext}`)
    }

    console.log(`[Excel导入] 开始导入报表: ${options.reportName} (${options.reportCode})`)
    console.log(`[Excel导入] 文件路径: ${options.excelPath}`)

    // 2. 检查报表是否已存在
    const existingDefinition = db
      .prepare('SELECT id FROM report_definitions WHERE account_set_id = ? AND code = ?')
      .get(options.accountSetId, options.reportCode) as { id: string } | undefined

    if (existingDefinition && !options.overwrite) {
      throw new Error(`报表 ${options.reportCode} 已存在，请使用 overwrite: true 参数覆盖`)
    }

    // 3. 读取Excel文件
    const xlsx = await import('xlsx')
    const fileBuffer = fs.readFileSync(options.excelPath)
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' })
    console.log(`[Excel导入] 工作簿包含 ${workbook.SheetNames.length} 个工作表`)

    // 确定要导入的工作表
    const sheetsToImport = options.importFirstSheetOnly
      ? [workbook.SheetNames[0]]
      : workbook.SheetNames

    // 4. 开始数据库事务
    db.transaction(() => {
      // 创建或更新报表定义
      const definitionId = existingDefinition?.id || uuidv4()

      if (existingDefinition && options.overwrite) {
        // 覆盖现有报表
        db.prepare(`
          UPDATE report_definitions
          SET name = ?, source = 'manual', source_file = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(options.reportName, path.basename(options.excelPath), definitionId)

        // 删除现有的工作表和单元格
        db.prepare(`
          DELETE FROM report_cells
          WHERE report_sheet_id IN (
            SELECT id FROM report_sheets WHERE report_definition_id = ?
          )
        `).run(definitionId)
        db.prepare('DELETE FROM report_sheets WHERE report_definition_id = ?').run(definitionId)

        stats.overwritten = true
        console.log(`[Excel导入] 覆盖现有报表: ${options.reportCode}`)
      } else {
        // 创建新报表
        db.prepare(`
          INSERT INTO report_definitions (
            id, account_set_id, code, name, source, source_file,
            sort_order, is_enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'manual', ?, 0, 1, datetime('now'), datetime('now'))
        `).run(
          definitionId,
          options.accountSetId,
          options.reportCode,
          options.reportName,
          path.basename(options.excelPath)
        )
        console.log(`[Excel导入] 创建新报表: ${options.reportCode}`)
      }

      // 5. 导入每个工作表
      sheetsToImport.forEach((sheetName, sheetIndex) => {
        const sheet = workbook.Sheets[sheetName]
        const sheetId = uuidv4()

        // 插入工作表记录
        db.prepare(`
          INSERT INTO report_sheets (
            id, report_definition_id, sheet_key, sheet_name, sheet_index, created_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(
          sheetId,
          definitionId,
          `sheet_${sheetIndex + 1}`,
          sheetName,
          sheetIndex
        )

        // 转换工作表数据
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (string | number)[][]

        // 准备插入单元格的语句
        const insertCell = db.prepare(`
          INSERT INTO report_cells (
            id, report_sheet_id, row_index, col_index, cell_type,
            text_value, formula_text, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `)

        // 导入单元格数据
        let sheetCells = 0
        let sheetFormulas = 0

        data.forEach((row, rowIndex) => {
          row.forEach((cell, colIndex) => {
            if (cell !== '' && cell !== null && cell !== undefined) {
              const cellStr = String(cell)

              // 判断是否为公式
              const isFormula = cellStr.startsWith('=') || cellStr.startsWith('@')

              insertCell.run(
                uuidv4(),
                sheetId,
                rowIndex,
                colIndex,
                isFormula ? 'formula' : 'text',
                isFormula ? null : cellStr,
                isFormula ? cellStr : null
              )

              sheetCells++
              if (isFormula) {
                sheetFormulas++
              }
            }
          })
        })

        stats.cellsImported += sheetCells
        stats.formulasImported += sheetFormulas
        stats.sheetsImported++

        console.log(`[Excel导入] 工作表 ${sheetName}: 导入 ${sheetCells} 个单元格 (${sheetFormulas} 个公式)`)
      })

    })()

    console.log(`[Excel导入] 导入完成: ${stats.sheetsImported} 个工作表, ${stats.cellsImported} 个单元格`)
    return stats

  } catch (error) {
    stats.errors.push(error instanceof Error ? error.message : String(error))
    console.error('[Excel导入] 导入失败:', error)
    throw error
  }
}

/**
 * 从Excel文件自动检测报表信息
 */
export async function detectReportInfoFromExcel(excelPath: string): Promise<{ code: string, name: string }> {
  const xlsx = await import('xlsx')
  const fileBuffer = fs.readFileSync(excelPath)
  const workbook = xlsx.read(fileBuffer, { type: 'buffer' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

  // 尝试从第一行获取报表名称
  let reportName = '未命名报表'
  const firstRow = xlsx.utils.sheet_to_json(firstSheet, { header: 1, range: 'A1:Z1' })[0] as any[]

  if (firstRow && firstRow.length > 0) {
    const firstCell = String(firstRow[0] || '').trim()
    if (firstCell && firstCell.length > 0) {
      reportName = firstCell
    }
  }

  // 从文件名生成编码
  const fileName = path.basename(excelPath, path.extname(excelPath))
  const reportCode = fileName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()

  return { code: reportCode, name: reportName }
}

/**
 * 命令行接口
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.log(`
用法: tsx importExcelReport.ts <Excel文件路径> <账套ID> [选项]

参数:
  <Excel文件路径>   要导入的Excel文件路径
  <账套ID>         目标账套ID

选项:
  --code <编码>     报表编码 (默认从文件名生成)
  --name <名称>     报表名称 (默认从Excel文件读取)
  --overwrite       覆盖现有报表
  --first-sheet-only 只导入第一个工作表

示例:
  tsx importExcelReport.ts "模版/资产表.XLS" "account-set-id" --code "balance_sheet" --name "资产负债表"
  tsx importExcelReport.ts "模版/资产表.XLS" "account-set-id" --overwrite
    `)
    process.exit(1)
  }

  const excelPath = path.resolve(args[0])
  const accountSetId = args[1]

  // 解析选项
  const options: ImportOptions = {
    excelPath,
    accountSetId,
    reportCode: '',
    reportName: '',
    overwrite: false,
    importFirstSheetOnly: false
  }

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--code' && args[i + 1]) {
      options.reportCode = args[++i]
    } else if (args[i] === '--name' && args[i + 1]) {
      options.reportName = args[++i]
    } else if (args[i] === '--overwrite') {
      options.overwrite = true
    } else if (args[i] === '--first-sheet-only') {
      options.importFirstSheetOnly = true
    }
  }

  // 如果没有指定编码或名称，尝试自动检测
  if (!options.reportCode || !options.reportName) {
    const detected = await detectReportInfoFromExcel(excelPath)
    if (!options.reportCode) options.reportCode = detected.code
    if (!options.reportName) options.reportName = detected.name
  }

  console.log(`\n导入配置:`)
  console.log(`  文件: ${excelPath}`)
  console.log(`  账套ID: ${accountSetId}`)
  console.log(`  报表编码: ${options.reportCode}`)
  console.log(`  报表名称: ${options.reportName}`)
  console.log(`  覆盖: ${options.overwrite ? '是' : '否'}`)
  console.log(`  只导入第一个工作表: ${options.importFirstSheetOnly ? '是' : '否'}\n`)

  try {
    const stats = await importExcelReport(options)

    console.log(`\n导入成功!`)
    console.log(`  报表: ${stats.reportName} (${stats.reportCode})`)
    console.log(`  工作表: ${stats.sheetsImported} 个`)
    console.log(`  单元格: ${stats.cellsImported} 个`)
    console.log(`  公式: ${stats.formulasImported} 个`)
    console.log(`  覆盖: ${stats.overwritten ? '是' : '否'}`)

    if (stats.warnings.length > 0) {
      console.log(`\n警告:`)
      stats.warnings.forEach(warning => console.log(`  - ${warning}`))
    }

  } catch (error) {
    console.error(`\n导入失败:`, error)
    process.exit(1)
  }
}

// 如果是直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}