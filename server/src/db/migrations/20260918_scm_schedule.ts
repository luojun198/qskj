import type Database from 'better-sqlite3'

/**
 * 2026-09-18 生产评审 决策 5 续：自动排程（有限产能顺排）。
 *  - scm_production_plan_process.sched_start / sched_end / sched_hours：排程结果（工序级）
 *  - scm_production_plan.sched_start_date / sched_end_date / sched_run_id：排程结果（工单级）
 *  - scm_schedule_run：排程运行记录（参数 + 汇总），最近一次为当前有效排程
 */
export function up(db: Database.Database): void {
  const pc = (db.prepare("PRAGMA table_info('scm_production_plan_process')").all() as { name: string }[]).map(c => c.name)
  if (!pc.includes('sched_start')) db.exec('ALTER TABLE scm_production_plan_process ADD COLUMN sched_start TEXT')
  if (!pc.includes('sched_end')) db.exec('ALTER TABLE scm_production_plan_process ADD COLUMN sched_end TEXT')
  if (!pc.includes('sched_hours')) db.exec('ALTER TABLE scm_production_plan_process ADD COLUMN sched_hours REAL NOT NULL DEFAULT 0')
  const pp = (db.prepare("PRAGMA table_info('scm_production_plan')").all() as { name: string }[]).map(c => c.name)
  if (!pp.includes('sched_start_date')) db.exec('ALTER TABLE scm_production_plan ADD COLUMN sched_start_date TEXT')
  if (!pp.includes('sched_end_date')) db.exec('ALTER TABLE scm_production_plan ADD COLUMN sched_end_date TEXT')
  if (!pp.includes('sched_run_id')) db.exec('ALTER TABLE scm_production_plan ADD COLUMN sched_run_id TEXT')
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_schedule_run (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      from_date TEXT NOT NULL,
      workdays TEXT NOT NULL,
      order_by TEXT NOT NULL,
      plan_count INTEGER NOT NULL DEFAULT 0,
      late_count INTEGER NOT NULL DEFAULT 0,
      unscheduled_hours REAL NOT NULL DEFAULT 0,
      summary_json TEXT,
      run_by TEXT
    );
  `)
  console.log('✓ 自动排程列 / 运行记录表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_schedule_run')
}
