import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

// 动态导入xlsx库
const xlsxModule = await import('xlsx')
const XLSX = xlsxModule.default || xlsxModule

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 读取Excel文件
const excelPath = path.join(__dirname, '../../../模版/资产表.XLS')
console.log(`读取Excel文件: ${excelPath}`)

try {
  // 读取工作簿
  const workbook = XLSX.readFile(excelPath)
  console.log(`工作簿包含 ${workbook.SheetNames.length} 个工作表:`)

  workbook.SheetNames.forEach((sheetName, index) => {
    console.log(`  ${index + 1}. ${sheetName}`)
  })

  // 分析第一个工作表（资产负债表(定义)）
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  // 获取所有单元格
  const cellData: Record<string, any> = {}
  for (const cellAddress in worksheet) {
    if (cellAddress[0] === '!') continue // 跳过特殊属性
    cellData[cellAddress] = worksheet[cellAddress].v
  }

  console.log(`\n工作表 "${sheetName}" 分析:`)
  console.log(`总单元格数: ${Object.keys(cellData).length}`)

  // 按行分组
  const rows: Record<number, Array<{col: string, address: string, value: any}>> = {}
  for (const address in cellData) {
    const match = address.match(/^([A-Z]+)(\d+)$/)
    if (match) {
      const col = match[1]
      const rowNum = parseInt(match[2])
      if (!rows[rowNum]) rows[rowNum] = []
      rows[rowNum].push({col, address, value: cellData[address]})
    }
  }

  // 显示有内容的行
  console.log(`\n有内容的行（前20行）:`)
  const rowNumbers = Object.keys(rows).map(Number).sort((a, b) => a - b)
  let displayed = 0
  for (const rowNum of rowNumbers) {
    const rowCells = rows[rowNum]
    // 过滤掉空值
    const nonEmptyCells = rowCells.filter(cell =>
      cell.value !== undefined && cell.value !== null && cell.value !== ''
    )

    if (nonEmptyCells.length > 0) {
      console.log(`行 ${rowNum}:`)
      nonEmptyCells.forEach(cell => {
        console.log(`  ${cell.address}: ${JSON.stringify(cell.value)}`)
      })
      displayed++
      if (displayed >= 20) break
    }
  }

  // 分析公式
  console.log(`\n公式分析:`)
  const formulas: Array<{address: string, formula: string}> = []
  for (const address in worksheet) {
    if (address[0] === '!') continue
    const cell = worksheet[address]
    if (cell.f) {
      formulas.push({address, formula: cell.f})
    }
  }

  console.log(`总公式数: ${formulas.length}`)
  if (formulas.length > 0) {
    console.log(`前10个公式:`)
    formulas.slice(0, 10).forEach(({address, formula}) => {
      console.log(`  ${address}: ${formula}`)
    })
  }

  // 保存精简版数据
  const simplifiedData: Record<string, any> = {}
  for (const rowNum of rowNumbers.slice(0, 50)) { // 只保存前50行
    const rowCells = rows[rowNum]
    const nonEmptyCells = rowCells.filter(cell =>
      cell.value !== undefined && cell.value !== null && cell.value !== ''
    )
    if (nonEmptyCells.length > 0) {
      simplifiedData[rowNum] = nonEmptyCells.map(cell => ({
        address: cell.address,
        value: cell.value
      }))
    }
  }

  const outputPath = path.join(__dirname, '../../../模版/资产表_详细分析.json')
  fs.writeFileSync(outputPath, JSON.stringify({
    sheetName,
    totalCells: Object.keys(cellData).length,
    totalFormulas: formulas.length,
    data: simplifiedData,
    formulas: formulas.slice(0, 20)
  }, null, 2), 'utf8')
  console.log(`\n详细分析已保存到: ${outputPath}`)

} catch (error) {
  console.error('读取Excel文件失败:', error)
}