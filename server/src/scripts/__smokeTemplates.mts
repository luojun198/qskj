// 临时冒烟脚本（验证后删除）
import { getDb } from '../db/index.js'
import { scanStandardTemplates, getStandardTemplateGroups } from '../services/standardTemplateScan.js'
import {
  listStandardTemplatesForClient,
  createAccountSetFromStandardTemplate,
} from '../services/standardTemplateAccountSet.js'
import { cleanupAccountSetCascade } from '../services/accountSetCleanup.js'

const t0 = Date.now()
const templates = scanStandardTemplates()
console.log(`扫描到 ${templates.length} 个模板，分组：${getStandardTemplateGroups().join(' / ')}，耗时 ${Date.now() - t0}ms`)
const t1 = Date.now()
const list = listStandardTemplatesForClient()
console.log(`概况解析耗时 ${Date.now() - t1}ms`)
for (const item of list) {
  console.log(
    `${String(item.order).padStart(2)} [${item.group}] ${item.id.padEnd(12)} ${item.name.padEnd(28)} ${item.inferredStandard.padEnd(14)} ${item.retired ? '停用' : '    '} ${item.description}`
  )
}

const targets = (process.argv[2] || '').split(',').filter(Boolean)
if (targets.length) {
  const db = getDb()
  for (const id of targets) {
    const name = `冒烟-${id}-${Date.now()}`
    const t = Date.now()
    const result = await createAccountSetFromStandardTemplate(db, {
      name,
      standard_template_id: id,
      start_date: '2026-01-01',
      fiscal_year: 2026,
    })
    const brief = {
      ...result,
      rawStats: undefined,
      reportStats: {
        total: result.reportStats.total,
        success: result.reportStats.success,
        failed: result.reportStats.failed,
      },
    }
    console.log(`\n建账「${result.template.name}」 ${Date.now() - t}ms:`, JSON.stringify(brief))
    const cnt = (sql: string) => (db.prepare(sql).get(result.id) as any).c
    console.log(
      '  accounts', cnt('SELECT COUNT(*) c FROM accounts WHERE account_set_id=?'),
      'voucher_types', cnt('SELECT COUNT(*) c FROM voucher_types WHERE account_set_id=?'),
      'cash_flow_items', cnt('SELECT COUNT(*) c FROM cash_flow_items WHERE account_set_id=?'),
      'transfer_types', cnt('SELECT COUNT(*) c FROM transfer_types WHERE account_set_id=?'),
      'rh_standard_reports', cnt('SELECT COUNT(*) c FROM rh_standard_reports WHERE account_set_id=?'),
      'report_definitions', cnt('SELECT COUNT(*) c FROM report_definitions WHERE account_set_id=?'),
      'params',
      JSON.stringify(
        db
          .prepare(
            "SELECT param_key, substr(param_value,1,60) v FROM system_params WHERE account_set_id=? AND param_key IN ('accounting_standard','account_levels','account_code_lengths')"
          )
          .all(result.id)
      )
    )
    if (process.argv[3] === 'cleanup') {
      cleanupAccountSetCascade(db, result.id)
      console.log('  已清理')
    }
  }
}
