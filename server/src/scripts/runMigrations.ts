import { runMigrations, rollbackMigration, getMigrationStatus } from '../db/migrations.js'
import { migrations } from '../db/migrationList.js'

/**
 * 数据库迁移 CLI 工具
 *
 * 使用方法：
 * - 执行所有待处理迁移: npm run db:migrate
 * - 回滚最后一次迁移: npm run db:migrate:rollback
 * - 查看迁移状态: npm run db:migrate:status
 */

const command = process.argv[2] || 'up'

switch (command) {
  case 'up':
    console.log('Running migrations...')
    runMigrations(migrations)
    break

  case 'down':
    console.log('Rolling back last migration...')
    rollbackMigration(migrations)
    break

  case 'status':
    console.log('Migration status:')
    const status = getMigrationStatus(migrations)
    console.log(`Current version: ${status.currentVersion}`)
    console.log(`\nApplied migrations (${status.appliedMigrations.length}):`)
    status.appliedMigrations.forEach(m => {
      console.log(`  ✓ ${m.version}: ${m.name} (${m.applied_at})`)
    })
    console.log(`\nPending migrations (${status.pendingMigrations.length}):`)
    status.pendingMigrations.forEach(m => {
      console.log(`  ○ ${m.version}: ${m.name}`)
    })
    break

  default:
    console.error(`Unknown command: ${command}`)
    console.log('Available commands: up, down, status')
    process.exit(1)
}
