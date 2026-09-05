import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  ACD_PERMISSION_CATALOG,
  ACD_TO_CW,
  ACD_UNSUPPORTED,
  ACD_SILENT_CODES,
  ACD_IMPORT_BASE_PERMISSIONS,
  CW_TO_ACD,
  PERMISSIONS,
} from '../db/permissions.js'

/**
 * 真实账套备份 zw06广州东汇食品有限公司20260827.acd 的 b_rights.txt 里
 * 出现过的全部 109 个功能代码，作为对照表的回归基准。
 * 少一个都说明对照表漏了，导入时会有权限静默落空。
 */
const ACD_SAMPLE_CODES = [
  '101', '400', '401', '402', '403', '404', '411', '412', '413', '414',
  '415', '416', '417', '418', '419', '421', '422', '423', '424', '425',
  '426', '427', '430', '431', '435', '43A', '43B', '43C', '43M', '43N',
  '440', '441', '442', '443', '444', '445', '446', '450', '451', '452',
  '453', '454', '460', '461', '462', '463', '464', '470', '471', '472',
  '473', '474', '481', '482', '483', '484', '485', '486', '487', '488',
  '489', '48a', '491', '492', '493', '494', '495', '496', '497', '4A1',
  '4A2', '4A3', '4AA', '4AB', '4AC', '4AD', '4AE', '4C1', '4C2', '4C3',
  '4C4', '4C5', '4C6', '4C7', '501', '502', '503', '504', '505', '506',
  '511', '512', '513', '514', '515', '517', '521', '522', '523', '524',
  '525', '801', '802', '803', '804', '805', 'A02', 'A03', 'A04',
]

const definedPermissionCodes = new Set(PERMISSIONS.map(p => p.code))

describe('ACD 权限对照表', () => {
  it('引用的 CW 权限码都真实存在', () => {
    const referenced = [...new Set(ACD_PERMISSION_CATALOG.flatMap(entry => entry.cw))]
    const missing = referenced.filter(code => !definedPermissionCodes.has(code))
    expect(missing).toEqual([])
  })

  it('acdCode 不重复', () => {
    const seen = new Set<string>()
    const duplicated: string[] = []
    for (const entry of ACD_PERMISSION_CATALOG) {
      if (seen.has(entry.acdCode)) duplicated.push(entry.acdCode)
      seen.add(entry.acdCode)
    }
    expect(duplicated).toEqual([])
  })

  it('覆盖真实 ACD 样本里出现的全部功能代码', () => {
    const catalogCodes = new Set(ACD_PERMISSION_CATALOG.map(entry => entry.acdCode))
    const missing = ACD_SAMPLE_CODES.filter(code => !catalogCodes.has(code))
    expect(missing).toEqual([])
    expect(ACD_PERMISSION_CATALOG).toHaveLength(ACD_SAMPLE_CODES.length)
  })

  it('不支持项没有 CW 权限，有 CW 权限的项不标不支持', () => {
    for (const entry of ACD_PERMISSION_CATALOG) {
      if (entry.unsupported || entry.silent) {
        expect(entry.cw, `${entry.acdCode} 不该有 CW 权限`).toEqual([])
      } else {
        expect(entry.cw.length, `${entry.acdCode}(${entry.acdName}) 未映射到任何 CW 权限`)
          .toBeGreaterThan(0)
      }
    }
  })

  it('派生索引与目录表一致', () => {
    const mapped = ACD_PERMISSION_CATALOG.filter(e => e.cw.length > 0)
    expect(Object.keys(ACD_TO_CW)).toHaveLength(mapped.length)
    for (const entry of mapped) {
      expect(ACD_TO_CW[entry.acdCode]).toEqual(entry.cw)
      for (const cw of entry.cw) {
        expect(CW_TO_ACD[cw]).toContain(entry.acdCode)
      }
    }
    expect(Object.keys(ACD_UNSUPPORTED)).toHaveLength(
      ACD_PERMISSION_CATALOG.filter(e => e.unsupported).length
    )
    expect(ACD_SILENT_CODES.size).toBe(ACD_PERMISSION_CATALOG.filter(e => e.silent).length)
  })

  it('固定资产 / 出纳 / 供应链三个模块都有 ACD 映射', () => {
    // 这三块的数据随 ACD 一起导入，权限却曾经整体落空，专门守住
    for (const module of ['asset', 'cashier', 'scm']) {
      const covered = PERMISSIONS.filter(
        p => p.module === module && (CW_TO_ACD[p.code] || []).length > 0
      )
      expect(covered.length, `${module} 模块没有任何权限对应到 ACD`).toBeGreaterThan(0)
    }
  })

  it('导入基础权限是已定义的权限码', () => {
    for (const code of ACD_IMPORT_BASE_PERMISSIONS) {
      expect(definedPermissionCodes.has(code), `${code} 未在 PERMISSIONS 中定义`).toBe(true)
    }
  })

  it('前端导航引用的权限码都已定义', () => {
    // 曾经出现 navigation.ts 用了 cashier:dict、而 PERMISSIONS 里没定义的情况，
    // 结果那个菜单只有超管看得见。
    const navPath = resolve(__dirname, '../../../client/src/config/navigation.ts')
    const source = readFileSync(navPath, 'utf-8')
    const referenced = new Set(
      [...source.matchAll(/'([a-z]+:[a-zA-Z]+)'/g)].map(match => match[1])
    )
    const missing = [...referenced].filter(code => !definedPermissionCodes.has(code)).sort()
    expect(missing).toEqual([])
  })
})
