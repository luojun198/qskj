import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { buildFtsPrefixQuery } from '../services/voucherQuery.js'

describe('评审 P2：凭证关键字 FTS5 转义', () => {
  const db = new Database(':memory:')
  db.exec("CREATE VIRTUAL TABLE t USING fts5(a, tokenize='unicode61')")
  db.prepare('INSERT INTO t VALUES (?)').run('安盾安保服务有限公司 付款单 A-1 "备注"')
  const hit = (kw: string) => (db.prepare('SELECT COUNT(*) c FROM t WHERE t MATCH ?').get(buildFtsPrefixQuery(kw)) as any).c

  it('中文前缀匹配保持不变', () => {
    expect(buildFtsPrefixQuery('安盾')).toBe('"安盾"*')
    expect(hit('安盾')).toBe(1)
    expect(hit('安盾*')).toBe(1)
  })

  it('含 FTS5 语法字符的关键字不再抛错', () => {
    for (const kw of ['A-1', '"备注', 'AND', '(付款', 'a:b', '-', '*']) {
      expect(() => hit(kw)).not.toThrow()
    }
    expect(hit('A-1')).toBe(1)
    expect(hit('"备注')).toBe(1)
  })
})
