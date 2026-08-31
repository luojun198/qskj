import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(__dirname, '../../data/finance.db'))

function inferLevel(code, codeLengths, maxLevels) {
  let expectedLength = 0
  for (let index = 0; index < maxLevels; index++) {
    expectedLength += codeLengths[index] || 0
    if (code.length === expectedLength) return index + 1
  }
  return null
}

function getParentCode(code, level, codeLengths) {
  if (level <= 1) return null
  let length = 0
  for (let i = 0; i < level - 1; i++) length += codeLengths[i] || 0
  return code.substring(0, length)
}

function findPrefixParent(code, allCodes) {
  let best = null
  for (const pc of allCodes) {
    if (pc.length > 0 && pc.length < code.length && code.startsWith(pc)) {
      if (!best || pc.length > best.length) best = pc
    }
  }
  return best
}

const codeLengths = [4, 2, 2, 2, 2, 2, 2, 2, 2, 2]
const maxLevels = 4
const update = db.prepare('UPDATE accounts SET level=?, parent_id=? WHERE id=?')

for (const setId of ['5945a5a8-e9f2-4145-968f-86862ce54aa3', '2c7a9340-a82f-49d7-8730-fb10370442eb']) {
  const accounts = db
    .prepare('SELECT id, code, level, parent_id FROM accounts WHERE account_set_id=?')
    .all(setId)
  const byCode = new Map(accounts.map(a => [a.code, a]))
  let updated = 0
  const tx = db.transaction(() => {
    for (const account of accounts) {
      const level = inferLevel(account.code, codeLengths, maxLevels)
      if (!level) continue
      let parentId = null
      if (level > 1) {
        const parentCode = getParentCode(account.code, level, codeLengths)
        parentId = parentCode ? byCode.get(parentCode)?.id || null : null
        if (!parentId) {
          const fallback = findPrefixParent(account.code, accounts.map(a => a.code))
          parentId = fallback ? byCode.get(fallback)?.id || null : null
        }
      }
      if (account.level !== level || account.parent_id !== parentId) {
        update.run(level, parentId, account.id)
        updated++
      }
    }
  })
  tx()
  const name = db.prepare('SELECT name FROM account_sets WHERE id=?').get(setId)
  console.log(name?.name, 'updated', updated)
}

db.close()
