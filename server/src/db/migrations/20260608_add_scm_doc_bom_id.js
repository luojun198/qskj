export function up(db) {
  try {
    db.prepare('ALTER TABLE scm_doc ADD COLUMN bom_id TEXT').run()
  } catch (e) {
    // 列已存在则跳过
    if (!e.message.includes('duplicate column name')) throw e
  }
}

export function down(db) {
  // SQLite 不支持 DROP COLUMN，此迁移不可回滚；bom_id 列无数据损毁风险
}
