// 把底层技术错误（SQLite 约束 / 系统异常 / 英文堆栈）转成中文友好提示；
// 已经是中文业务提示的原样返回，避免误伤。供全局响应中间件与 errorHandler 复用。

const COLUMN_CN: Record<string, string> = {
  warehouse_code: '仓库', warehouse: '仓库', item_code: '物料', item: '物料',
  account_set_id: '账套', doc_no: '单据号', doc_type: '单据类型',
  code: '编码', name: '名称', qty: '数量', amount: '金额', price: '单价',
}

/** 输入可为字符串或 Error（better-sqlite3 的约束码在 err.code 上）。 */
export function humanizeError(input: unknown): string {
  const err: any = input
  const code: string = (err && typeof err === 'object' && err.code) ? String(err.code) : ''
  const raw = typeof input === 'string' ? input : (err?.message ?? '')
  const msg = String(raw ?? '').trim()
  if (!msg) return '操作失败，请稍后重试'

  const isConstraint = code.startsWith('SQLITE_CONSTRAINT') || /constraint failed/i.test(msg)

  // NOT NULL：某必填字段为空
  const m = msg.match(/NOT NULL constraint failed:\s*\w+\.(\w+)/i)
  if (m) {
    if (m[1] === 'warehouse_code') return '存在未指定仓库的明细，无法完成出入库，请为每行（或表头）指定仓库'
    const cn = COLUMN_CN[m[1]]
    return cn ? `必填项「${cn}」不能为空` : '有必填项未填写，请补全后重试'
  }
  if (isConstraint && /UNIQUE/i.test(msg)) return '数据重复：编号/单号等已存在，请勿重复录入'
  if (isConstraint && /FOREIGN KEY/i.test(msg)) return '关联数据不存在或已被引用，无法操作'
  if (isConstraint && /CHECK/i.test(msg)) return '数据不符合校验规则，请检查后重试'
  if (isConstraint) return '数据校验未通过，请检查录入内容'

  // 其它数据库 / SQL 技术错误
  if (code.startsWith('SQLITE_') || /\b(no such (table|column)|syntax error|datatype mismatch|database is locked|disk i\/o)\b/i.test(msg)) {
    return '数据处理失败，请检查数据完整性或联系管理员'
  }

  // 已含中文 → 视为业务提示，原样返回
  if (/[一-龥]/.test(msg)) return msg

  // 纯英文技术串 / JS 堆栈 → 中文兜底
  if (/\bat .+:\d+:\d+/.test(msg) || /^(Error|TypeError|ReferenceError|SyntaxError|RangeError):/.test(msg) || /^[\x00-\x7f]+$/.test(msg)) {
    return '操作失败，请检查输入或联系管理员'
  }
  return msg
}
