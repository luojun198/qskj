// 获取当前文件目录
import { fileURLToPath } from 'url'
import * as path from 'path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = import.meta.dirname || path.dirname(__filename)

async function testXlsxModule() {
  try {
    const xlsx = await import('xlsx')
    console.log('xlsx模块结构:')
    console.log('Keys:', Object.keys(xlsx))

    // 检查是否有默认导出
    if (xlsx.default) {
      console.log('\n有默认导出:')
      console.log('Default keys:', Object.keys(xlsx.default))
    }

    // 检查具体函数
    console.log('\n检查具体函数:')
    console.log('readFile exists:', typeof xlsx.readFile === 'function')
    console.log('read exists:', typeof xlsx.read === 'function')
    console.log('utils exists:', xlsx.utils ? 'yes' : 'no')

    // 尝试读取文件
    const path = await import('path')
    const excelPath = path.join(__dirname, '../../../模版/资产表.XLS')

    console.log(`\n尝试读取文件: ${excelPath}`)

    // 尝试不同的读取方式
    if (typeof xlsx.readFile === 'function') {
      const workbook = xlsx.readFile(excelPath)
      console.log('使用 readFile 成功')
      console.log('工作表:', workbook.SheetNames)
    } else if (typeof xlsx.read === 'function') {
      const fs = await import('fs')
      const buffer = fs.readFileSync(excelPath)
      const workbook = xlsx.read(buffer, { type: 'buffer' })
      console.log('使用 read 成功')
      console.log('工作表:', workbook.SheetNames)
    } else if (xlsx.default && typeof xlsx.default.readFile === 'function') {
      const workbook = xlsx.default.readFile(excelPath)
      console.log('使用 default.readFile 成功')
      console.log('工作表:', workbook.SheetNames)
    }

  } catch (error) {
    console.error('测试失败:', error)
  }
}

testXlsxModule()