import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { computePushedQty } from '../services/scmProduction.js'
import { up as addPlanProductSourceUp } from '../db/migrations/20260625_add_plan_product_source.js'

const AID = 'AS-TEST'

describe('下推防重 · computePushedQty', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, item_code TEXT, qty REAL, source_line_id TEXT);
      CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, source_line_id TEXT);
      CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, item_code TEXT, plan_qty REAL, source_line_id TEXT);
    `)
  })

  it('无任何下推 → 0', () => {
    expect(computePushedQty(db, 'L1')).toBe(0)
  })

  it('下游单据行(采购/发货)计入已下推', () => {
    db.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,item_code,qty,source_line_id) VALUES (?,?,?,?,?,?)').run('d1', AID, 'PO1', 'M1', 7, 'L1')
    expect(computePushedQty(db, 'L1')).toBe(7)
  })

  it('成品行(生产/委外工单)计入已下推', () => {
    db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,source_line_id) VALUES (?,?,?,?,?,?)').run('p1', AID, 'PP1', '9002', 5, 'L1')
    expect(computePushedQty(db, 'L1')).toBe(5)
  })

  it('下游单据 + 成品行 累加（部分多次下推后累计）', () => {
    db.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,item_code,qty,source_line_id) VALUES (?,?,?,?,?,?)').run('d1', AID, 'PO1', 'M1', 3, 'L1')
    db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,source_line_id) VALUES (?,?,?,?,?,?)').run('p1', AID, 'PP1', '9002', 4, 'L1')
    db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,source_line_id) VALUES (?,?,?,?,?,?)').run('p2', AID, 'PP2', '9002', 2, 'L1')
    expect(computePushedQty(db, 'L1')).toBe(9)   // 3 + 4 + 2
  })

  it('只读成品行、不读工单头 source_line_id（避免回填头字段被双计）', () => {
    // 工单头也带 source_line_id（迁移回填的历史数据），但口径只算成品行
    db.prepare('INSERT INTO scm_production_plan (id,account_set_id,source_line_id) VALUES (?,?,?)').run('PP1', AID, 'L1')
    db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,source_line_id) VALUES (?,?,?,?,?,?)').run('p1', AID, 'PP1', '9002', 5, 'L1')
    expect(computePushedQty(db, 'L1')).toBe(5)   // 不是 10
  })

  it('不同缺料行互不串扰', () => {
    db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,source_line_id) VALUES (?,?,?,?,?,?)').run('p1', AID, 'PP1', '9002', 5, 'L1')
    db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,source_line_id) VALUES (?,?,?,?,?,?)').run('p2', AID, 'PP1', '9003', 3, 'L2')
    expect(computePushedQty(db, 'L1')).toBe(5)
    expect(computePushedQty(db, 'L2')).toBe(3)
  })
})

describe('下推重复检测 · 按表头 source_doc_id 统计已生成下游（gen-downstream needConfirm 口径）', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    // 仅建检测所需两表；检测用表头 source_doc_id，不依赖易漏的 source_line_id
    db.exec(`
      CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, source_doc_id TEXT, source_line_id TEXT);
      CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, plan_type TEXT, source_doc_id TEXT);
    `)
  })
  // 与 scmDoc.ts gen-downstream 中的检测口径保持一致
  const countExisting = (mrId: string) => {
    const existDocs = db.prepare('SELECT doc_type, COUNT(*) c FROM scm_doc WHERE account_set_id=? AND source_doc_id=? GROUP BY doc_type').all(AID, mrId) as any[]
    const existPlans = db.prepare('SELECT plan_type, COUNT(*) c FROM scm_production_plan WHERE account_set_id=? AND source_doc_id=? GROUP BY plan_type').all(AID, mrId) as any[]
    return {
      assembly: Number(existDocs.find(r => r.doc_type === 'AS')?.c) || 0,
      po: Number(existDocs.find(r => r.doc_type === 'PO')?.c) || 0,
      self_plans: Number(existPlans.find(r => r.plan_type === 'self')?.c) || 0,
      outsource_plans: Number(existPlans.find(r => r.plan_type === 'outsource')?.c) || 0,
    }
  }
  const insDoc = (id: string, type: string, src: string | null, line: string | null = null) =>
    db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,source_doc_id,source_line_id) VALUES (?,?,?,?,?)').run(id, AID, type, src, line)

  it('无下游 → 全 0', () => {
    expect(countExisting('MR1')).toEqual({ assembly: 0, po: 0, self_plans: 0, outsource_plans: 0 })
  })

  it('已生成 2 张组装单 → assembly:2（即使成品行 source_line_id 为空也能检出）', () => {
    insDoc('AS1', 'AS', 'MR1', null) // 模拟历史 AS：成品行 source_line_id 漏写
    insDoc('AS2', 'AS', 'MR1', 'L1')
    expect(countExisting('MR1').assembly).toBe(2)
  })

  it('按目标类型分别计数：AS/PO/自制工单', () => {
    insDoc('AS1', 'AS', 'MR1')
    insDoc('PO1', 'PO', 'MR1')
    db.prepare('INSERT INTO scm_production_plan (id,account_set_id,plan_type,source_doc_id) VALUES (?,?,?,?)').run('PP1', AID, 'self', 'MR1')
    expect(countExisting('MR1')).toEqual({ assembly: 1, po: 1, self_plans: 1, outsource_plans: 0 })
  })

  it('不同缺料单互不串扰', () => {
    insDoc('AS1', 'AS', 'MR1')
    expect(countExisting('MR2')).toEqual({ assembly: 0, po: 0, self_plans: 0, outsource_plans: 0 })
  })
})

describe('完工入库防重 · 已有未审核 PF/WI 草稿检测（gen-finish 口径）', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, plan_id TEXT, status TEXT, doc_no TEXT, created_at TEXT);')
  })
  // 与 scmDoc.ts gen-finish 中的草稿检测口径一致
  const draftFinish = (planId: string) =>
    db.prepare(
      "SELECT doc_no FROM scm_doc WHERE account_set_id=? AND plan_id=? AND status='draft' AND doc_type IN ('PF','WI') ORDER BY created_at DESC LIMIT 1"
    ).get(AID, planId) as any
  const insPf = (id: string, plan: string, status: string, type = 'PF', no = 'PF-001') =>
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,plan_id,status,doc_no,created_at) VALUES (?,?,?,?,?,?,'2026-01-01')").run(id, AID, type, plan, status, no)

  it('无完工单 → 无草稿命中', () => {
    expect(draftFinish('PLAN1')).toBeUndefined()
  })
  it('已审核完工单不算草稿（finished_qty 已更新，可安全再生成剩余）', () => {
    insPf('PF1', 'PLAN1', 'audited')
    expect(draftFinish('PLAN1')).toBeUndefined()
  })
  it('存在未审核 PF 草稿 → 命中，拦截重复生成', () => {
    insPf('PF1', 'PLAN1', 'draft')
    expect(draftFinish('PLAN1')?.doc_no).toBe('PF-001')
  })
  it('委外入库 WI 草稿同样命中', () => {
    insPf('WI1', 'PLAN1', 'draft', 'WI', 'WI-001')
    expect(draftFinish('PLAN1')?.doc_no).toBe('WI-001')
  })
  it('不同工单互不串扰', () => {
    insPf('PF1', 'PLAN1', 'draft')
    expect(draftFinish('PLAN2')).toBeUndefined()
  })
})

describe('领料单防重 · 已有未审核 PL/WO 草稿检测（gen-issue 口径）', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, plan_id TEXT, status TEXT, doc_no TEXT, created_at TEXT);')
  })
  // 与 scmDoc.ts gen-issue 中的草稿检测口径一致（含 PB 补料单）
  const draftIssue = (planId: string) =>
    db.prepare(
      "SELECT doc_no FROM scm_doc WHERE account_set_id=? AND plan_id=? AND status='draft' AND doc_type IN ('PL','PB','WO') ORDER BY created_at DESC LIMIT 1"
    ).get(AID, planId) as any
  const insIssue = (id: string, plan: string, status: string, type = 'PL', no = 'PL-001') =>
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,plan_id,status,doc_no,created_at) VALUES (?,?,?,?,?,?,'2026-01-01')").run(id, AID, type, plan, status, no)

  it('无领料单 → 无草稿命中', () => {
    expect(draftIssue('PLAN1')).toBeUndefined()
  })
  it('已审核领料单不算草稿（库存已移动，可继续领剩余）', () => {
    insIssue('PL1', 'PLAN1', 'audited')
    expect(draftIssue('PLAN1')).toBeUndefined()
  })
  it('存在未审核 PL 草稿 → 命中，拦截重复生成', () => {
    insIssue('PL1', 'PLAN1', 'draft')
    expect(draftIssue('PLAN1')?.doc_no).toBe('PL-001')
  })
  it('委外发货 WO 草稿同样命中', () => {
    insIssue('WO1', 'PLAN1', 'draft', 'WO', 'WO-001')
    expect(draftIssue('PLAN1')?.doc_no).toBe('WO-001')
  })
  it('补料单 PB 草稿也计入防重（同口径）', () => {
    insIssue('PB1', 'PLAN1', 'draft', 'PB', 'PB-001')
    expect(draftIssue('PLAN1')?.doc_no).toBe('PB-001')
  })
  it('取最新一张草稿（ORDER BY created_at DESC）', () => {
    insIssue('PL1', 'PLAN1', 'draft', 'PL', 'PL-001')
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,plan_id,status,doc_no,created_at) VALUES (?,?,?,?,?,?,'2026-01-02')").run('PL2', AID, 'PL', 'PLAN1', 'draft', 'PL-002')
    expect(draftIssue('PLAN1')?.doc_no).toBe('PL-002')
  })
  it('不同工单互不串扰', () => {
    insIssue('PL1', 'PLAN1', 'draft')
    expect(draftIssue('PLAN2')).toBeUndefined()
  })
})

describe('迁移 v83 · 成品行来源回填', () => {
  function preV83Db() {
    const db = new Database(':memory:')
    // 模拟 v83 之前：成品行尚无 source_line_id/source_doc_id 列
    db.exec(`
      CREATE TABLE scm_production_plan (id TEXT, source_line_id TEXT, source_doc_id TEXT);
      CREATE TABLE scm_production_plan_product (id TEXT, plan_id TEXT, item_code TEXT);
    `)
    db.prepare('INSERT INTO scm_production_plan (id,source_line_id,source_doc_id) VALUES (?,?,?)').run('PP1', 'LINE-1', 'MR-1')
    db.prepare('INSERT INTO scm_production_plan (id,source_line_id,source_doc_id) VALUES (?,?,?)').run('PP2', null, null) // 手工建工单（无来源）
    db.prepare('INSERT INTO scm_production_plan_product (id,plan_id,item_code) VALUES (?,?,?)').run('PP1-P1', 'PP1', '9002')
    db.prepare('INSERT INTO scm_production_plan_product (id,plan_id,item_code) VALUES (?,?,?)').run('PP2-P1', 'PP2', '9003')
    return db
  }

  it('从父工单头回填成品行 source_line_id/source_doc_id', () => {
    const db = preV83Db()
    addPlanProductSourceUp(db)
    const cols = db.prepare('PRAGMA table_info(scm_production_plan_product)').all().map((c: any) => c.name)
    expect(cols).toContain('source_line_id')
    expect(cols).toContain('source_doc_id')
    const p1 = db.prepare("SELECT source_line_id, source_doc_id FROM scm_production_plan_product WHERE id='PP1-P1'").get() as any
    expect(p1).toMatchObject({ source_line_id: 'LINE-1', source_doc_id: 'MR-1' })
    const p2 = db.prepare("SELECT source_line_id FROM scm_production_plan_product WHERE id='PP2-P1'").get() as any
    expect(p2.source_line_id).toBeNull()   // 手工工单无来源，保持空
  })

  it('幂等：重复执行不报错、不破坏已有来源', () => {
    const db = preV83Db()
    addPlanProductSourceUp(db)
    expect(() => addPlanProductSourceUp(db)).not.toThrow()
    const p1 = db.prepare("SELECT source_line_id FROM scm_production_plan_product WHERE id='PP1-P1'").get() as any
    expect(p1.source_line_id).toBe('LINE-1')
  })
})
