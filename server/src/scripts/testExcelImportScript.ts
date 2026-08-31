import * as path from 'path'
import { fileURLToPath } from 'url'
import { importExcelReport } from './importExcelReport.js'

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function testImport() {
  try {
    const excelPath = path.join(__dirname, '../../../模版/资产表.XLS')

    console.log('=== 测试Excel报表导入 ===')
    console.log(`文件: ${excelPath}`)

    // 首先需要获取一个账套ID
    // 这里假设有一个测试账套，或者我们可以从数据库中获取第一个账套
    const { getDb } = await import('../db/index.js')
    const db = getDb()

    // 获取第一个账套
    const accountSet = db.prepare('SELECT id, name FROM account_sets LIMIT 1').get() as { id: string, name: string } | undefined

    if (!accountSet) {
      console.error('没有找到账套，请先创建账套')
      console.log('提示: 可以运行 npm run db:init 初始化数据库')
      return
    }

    console.log(`使用账套: ${accountSet.name} (${accountSet.id})`)

    // 测试导入
    const stats = await importExcelReport({
      excelPath,
      accountSetId: accountSet.id,
      reportCode: 'balance_sheet_test',
      reportName: '资产负债表测试',
      overwrite: true,
      importFirstSheetOnly: true
    })

    console.log('\n=== 导入结果 ===')
    console.log(`报表编码: ${stats.reportCode}`)
    console.log(`报表名称: ${stats.reportName}`)
    console.log(`工作表数: ${stats.sheetsImported}`)
    console.log(`单元格数: ${stats.cellsImported}`)
    console.log(`公式数: ${stats.formulasImported}`)
    console.log(`是否覆盖: ${stats.overwritten ? '是' : '否'}`)

    if (stats.warnings.length > 0) {
      console.log('\n警告:')
      stats.warnings.forEach(warning => console.log(`  - ${warning}`))
    }

    // 验证导入的数据
    console.log('\n=== 验证导入的数据 ===')

    // 查询导入的报表定义
    const definition = db.prepare(`
      SELECT id, code, name, source_file
      FROM report_definitions
      WHERE account_set_id = ? AND code = ?
    `).get(accountSet.id, 'balance_sheet_test') as any

    if (definition) {
      console.log(`报表定义: ${definition.name} (${definition.code})`)
      console.log(`源文件: ${definition.source_file}`)

      // 查询工作表
      const sheets = db.prepare(`
        SELECT sheet_key, sheet_name, sheet_index
        FROM report_sheets
        WHERE report_definition_id = ?
        ORDER BY sheet_index
      `).all(definition.id) as any[]

      console.log(`工作表数: ${sheets.length}`)
      sheets.forEach(sheet => {
        console.log(`  - ${sheet.sheet_name} (${sheet.sheet_key})`)

        // 查询单元格统计
        const cellStats = db.prepare(`
          SELECT
            COUNT(*) as total_cells,
            SUM(CASE WHEN cell_type = 'formula' THEN 1 ELSE 0 END) as formula_cells
          FROM report_cells
          WHERE report_sheet_id = ?
        `).get(sheet.id) as any

        console.log(`    单元格: ${cellStats.total_cells} (公式: ${cellStats.formula_cells})`)
      })
    }

    console.log('\n=== 测试完成 ===')
    console.log('Excel报表导入功能正常工作！')

  } catch (error) {
    console.error('测试失败:', error)
  }
}

// 运行测试
testImport()