import type Database from 'better-sqlite3'

type Rule = { codeRoots?: unknown; nameKeywords?: unknown }

function normalizeRule(value: unknown): { codeRoots: string[]; nameKeywords: string[] } {
  const source = value && typeof value === 'object' ? (value as Rule) : {}
  return {
    codeRoots: Array.isArray(source.codeRoots)
      ? [...new Set(source.codeRoots.map(String).map(item => item.trim()).filter(Boolean))]
      : [],
    nameKeywords: Array.isArray(source.nameKeywords)
      ? [...new Set(source.nameKeywords.map(String).map(item => item.trim()).filter(Boolean))]
      : [],
  }
}

function toV2(raw: string, customized: boolean, isGovernment: boolean) {
  const parsed = JSON.parse(raw || '{}') as any
  if (parsed?.version === 2) {
    return { ...parsed, version: 2, customized: parsed.customized === true || customized }
  }

  const income = normalizeRule(parsed?.income)
  const pureExpense = normalizeRule(parsed?.pureExpense)
  return {
    version: 2,
    customized,
    financial: {
      income: {
        ...income,
        codeRoots: isGovernment ? income.codeRoots.filter(code => !code.startsWith('6')) : income.codeRoots,
      },
      pureExpense: {
        ...pureExpense,
        codeRoots: isGovernment
          ? pureExpense.codeRoots.filter(code => !code.startsWith('7'))
          : pureExpense.codeRoots,
      },
      fee: normalizeRule(parsed?.fee),
      cost: normalizeRule(parsed?.cost),
    },
    budget: {
      income: {
        codeRoots: isGovernment ? income.codeRoots.filter(code => code.startsWith('6')) : [],
        nameKeywords: [],
      },
      expense: {
        codeRoots: isGovernment ? pureExpense.codeRoots.filter(code => code.startsWith('7')) : [],
        nameKeywords: [],
      },
    },
  }
}

export function up(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, account_set_id, param_value
       FROM system_params
       WHERE param_key='dashboard_category_rules'`
    )
    .all() as Array<{ id: string; account_set_id: string; param_value: string }>
  const standardStmt = db.prepare(
    `SELECT param_value FROM system_params
     WHERE account_set_id=? AND param_key='accounting_standard' LIMIT 1`
  )
  const governmentProbeStmt = db.prepare(
    `SELECT 1 FROM accounts
     WHERE account_set_id=? AND (
       (code='4001' AND name LIKE '%财政拨款收入%')
       OR (code='5001' AND name LIKE '%业务活动费用%')
       OR (code='3001' AND name LIKE '%累计盈余%')
     ) LIMIT 1`
  )
  const update = db.prepare('UPDATE system_params SET param_value=? WHERE id=?')

  for (const row of rows) {
    try {
      const standard = standardStmt.get(row.account_set_id) as { param_value?: string } | undefined
      const isGovernment =
        standard?.param_value === 'government' ||
        (standard?.param_value !== 'custom' && !!governmentProbeStmt.get(row.account_set_id))
      const config = toV2(
        row.param_value,
        standard?.param_value === 'custom',
        isGovernment
      )
      update.run(JSON.stringify(config), row.id)
    } catch {
      // 无效旧值不阻断迁移，改为跟随准则预置。
      update.run(
        JSON.stringify({
          version: 2,
          customized: false,
          financial: {
            income: { codeRoots: [], nameKeywords: [] },
            pureExpense: { codeRoots: [], nameKeywords: [] },
            fee: { codeRoots: [], nameKeywords: [] },
            cost: { codeRoots: [], nameKeywords: [] },
          },
          budget: {
            income: { codeRoots: [], nameKeywords: [] },
            expense: { codeRoots: [], nameKeywords: [] },
          },
        }),
        row.id
      )
    }
  }
}

export function down(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, param_value FROM system_params WHERE param_key='dashboard_category_rules'`
    )
    .all() as Array<{ id: string; param_value: string }>
  const update = db.prepare('UPDATE system_params SET param_value=? WHERE id=?')
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.param_value || '{}') as any
      if (parsed?.version !== 2) continue
      const financial = parsed.financial || {}
      const budget = parsed.budget || {}
      const income = normalizeRule(financial.income)
      const expense = normalizeRule(financial.pureExpense)
      const budgetIncome = normalizeRule(budget.income)
      const budgetExpense = normalizeRule(budget.expense)
      update.run(
        JSON.stringify({
          income: { ...income, codeRoots: [...income.codeRoots, ...budgetIncome.codeRoots] },
          pureExpense: {
            ...expense,
            codeRoots: [...expense.codeRoots, ...budgetExpense.codeRoots],
          },
          fee: normalizeRule(financial.fee),
          cost: normalizeRule(financial.cost),
        }),
        row.id
      )
    } catch {
      // 保留无法解析的数据，交由应用层回退。
    }
  }
}
