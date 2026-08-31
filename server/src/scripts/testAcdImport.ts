import { readFileSync } from 'fs'
import { acdImportService } from '../services/acdImport.js'

const acdPath = process.argv[2]
const accountSetName = process.argv[3] || '测试账套'

if (!acdPath) {
  console.error('Usage: node testAcdImport.js <acd-file-path> [account-set-name]')
  process.exit(1)
}

async function run() {
  console.log('开始导入ACD文件:', acdPath)
  console.log('账套名称:', accountSetName)

  const acdBuffer = readFileSync(acdPath)
  console.log('文件大小:', acdBuffer.length, 'bytes')

  const result = await acdImportService({
    acdBuffer,
    name: accountSetName,
    code: `AS${Date.now()}`,
    fiscalYear: new Date().getFullYear(),
    startDate: `${new Date().getFullYear()}-01-01`,
  })

  console.log('\n导入成功！')
  console.log('账套ID:', result.accountSetId)
  console.log('账套名称:', result.name)
  console.log('账套编码:', result.code)
  console.log('会计年度:', result.fiscalYear)
  console.log('\n导入统计:')
  console.log('- 科目数量:', result.stats.accounts)
  console.log('- 凭证数量:', result.stats.vouchers)
  console.log('- 分录数量:', result.stats.entries)
  console.log('- 辅助核算项:', result.stats.auxItems)
}

run()
  .then(() => process.exit(0))
  .catch((error: any) => {
    console.error('\n导入失败:', error.message)
    console.error(error.stack)
    process.exit(1)
  })
