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

  // 读取第一个工作表
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]

  // 获取工作表范围
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1')
  console.log(`\n工作表 "${firstSheetName}" 范围: ${XLSX.utils.encode_range(range)}`)
  console.log(`行数: ${range.e.r - range.s.r + 1}, 列数: ${range.e.c - range.s.c + 1}`)

  // 转换为JSON数组（带表头）
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })

  console.log(`\n数据预览（前10行）:`)
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i] as any[]
    console.log(`行 ${i}: ${JSON.stringify(row)}`)
  }

  // 分析数据结构
  console.log(`\n数据结构分析:`)
  console.log(`总行数: ${data.length}`)

  // 检查每行的列数
  const columnCounts = new Map<number, number>()
  data.forEach((row, index) => {
    const cols = (row as any[]).length
    columnCounts.set(cols, (columnCounts.get(cols) || 0) + 1)
  })

  console.log(`列数分布:`)
  Array.from(columnCounts.entries())
    .sort((a, b) => b[0] - a[0])
    .forEach(([cols, count]) => {
      console.log(`  ${cols}列: ${count}行`)
    })

  // 查找可能的表头行
  console.log(`\n可能的表头行:`)
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i] as any[]
    const chineseCount = row.filter(cell =>
      typeof cell === 'string' && /[\u4e00-\u9fff]/.test(cell)
    ).length

    console.log(`行 ${i}: ${chineseCount}个中文字段, 内容: ${row.slice(0, 3).join(' | ')}`)
  }

  // 保存为JSON文件以便查看
  const outputPath = path.join(__dirname, '../../../模版/资产表_解析.json')
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8')
  console.log(`\n解析结果已保存到: ${outputPath}`)

} catch (error) {
  console.error('读取Excel文件失败:', error)
}