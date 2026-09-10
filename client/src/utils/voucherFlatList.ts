/**
 * 凭证列表展平：一张凭证 → 多条分录行。
 * 供录入 / 查询 / 记账三页共用，支持增量 concat（传入 indexOffset）。
 */

const TYPE_ABBR: Record<string, string> = {
  记账凭证: '记',
  收款凭证: '收',
  付款凭证: '付',
  转账凭证: '转',
}

export type VoucherFlatMode = 'entry' | 'query'

export interface BuildVoucherFlatRowsOptions {
  /** entry：年/月/类型/编号拆列；query：voucher_no 合成「记-1」 */
  mode?: VoucherFlatMode
  /** 追加时传入已加载凭证张数，保证斑马纹连续 */
  indexOffset?: number
  /** 可选外部缓存，避免重复解析 aux_data */
  auxDataCache?: Map<string, Record<string, string>>
}

export function getVoucherSeq(voucherNo: string, pad = false): string {
  if (!voucherNo) return ''
  const idx = voucherNo.indexOf('-')
  const seq = idx >= 0 ? voucherNo.slice(idx + 1) : voucherNo
  const num = parseInt(seq, 10)
  if (isNaN(num)) return seq
  return pad ? String(num).padStart(4, '0') : String(num)
}

export function getTypeAbbr(name: string, fallback = '记'): string {
  return TYPE_ABBR[name] || name?.charAt(0) || fallback
}

/** 解析分录 aux_data，结果带 `_aux_${code}` 键 */
export function parseVoucherAuxData(
  entry: any,
  cache?: Map<string, Record<string, string>>
): Record<string, string> {
  if (!entry?.aux_data) return {}

  const raw = entry.aux_data
  const cacheKey = `${entry.id ?? ''}_${typeof raw === 'string' ? raw : JSON.stringify(raw)}`
  if (cache?.has(cacheKey)) return cache.get(cacheKey)!

  const result: Record<string, string> = {}
  try {
    const auxData = typeof raw === 'string' ? JSON.parse(raw) : raw
    for (const [code, val] of Object.entries(auxData || {})) {
      if (!val || typeof val !== 'object') continue
      const obj = val as { name?: string; field_values?: Record<string, unknown> }
      if (obj.name) {
        result[`_aux_${code}`] = obj.name
      }
      if (obj.field_values && typeof obj.field_values === 'object') {
        for (const [fieldKey, fieldValue] of Object.entries(obj.field_values)) {
          if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
            result[`_aux_${code}_${fieldKey}`] = String(fieldValue)
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  cache?.set(cacheKey, result)
  return result
}

/**
 * 从一批凭证构建分录扁平行。
 * 行对象只带表格需要的字段，避免把整张凭证对象铺到每一行。
 */
export function buildVoucherFlatRows(
  vouchers: any[],
  options: BuildVoucherFlatRowsOptions = {}
): any[] {
  const mode = options.mode ?? 'query'
  const indexOffset = options.indexOffset ?? 0
  const cache = options.auxDataCache
  const rows: any[] = []

  for (const [i, v] of vouchers.entries()) {
    const index = indexOffset + i
    const rawDate = v.voucher_date || v.date || ''
    const seq = getVoucherSeq(v.voucher_no, mode === 'entry')
    const abbr = getTypeAbbr(v.voucher_type_name || (mode === 'entry' ? '记账凭证' : '记'))
    const entries = v.entries?.length ? v.entries : [null]
    const entryCount = entries.length

    const year = rawDate ? rawDate.slice(0, 4) : String(v.year || '')
    const period = rawDate ? rawDate.slice(5, 7) : String(v.period || '').padStart(2, '0')

    for (const [entryIdx, e] of entries.entries()) {
      const auxObj = e ? parseVoucherAuxData(e, cache) : {}
      const isFirst = entryIdx === 0

      const row: Record<string, any> = {
        id: v.id,
        entry_id: e?.id,
        voucher_type_id: v.voucher_type_id,
        voucher_type_name: v.voucher_type_name,
        voucher_date: rawDate,
        status: v.status,
        remark: v.remark,
        summary: e ? e.summary || v.remark || '' : v.remark || '',
        account_id: e?.account_id,
        account_code: e?.account_code || '',
        account_name: e?.account_name || '',
        amount: e?.amount || 0,
        direction: e?.direction || '',
        debit_amount: e?.debit_amount,
        credit_amount: e?.credit_amount,
        maker_name: v.maker_name || v.created_by_name || '-',
        auditor_name: v.auditor_name || v.checked_by_name || '-',
        poster_name: v.poster_name || v.posted_by_name || '-',
        created_by_name: v.created_by_name,
        checked_by_name: v.checked_by_name,
        posted_by_name: v.posted_by_name,
        attachment_count: v.attachments_count ?? v.attachment_count ?? (v.attachments?.length || 0),
        attachments_count: v.attachments_count,
        project_name: e?.project_name || auxObj._aux_project || auxObj._aux_item || '',
        dept_name: e?.dept_name || auxObj._aux_dept || auxObj._aux_department || '',
        person_name: e?.person_name || e?.employee_name || auxObj._aux_person || auxObj._aux_emp || '',
        supplier_name: e?.supplier_name,
        customer_name: e?.customer_name,
        cust_supp_name:
          e?.supplier_name ||
          e?.customer_name ||
          auxObj._aux_supplier ||
          auxObj._aux_customer ||
          auxObj._aux_cust_supp ||
          '',
        ...auxObj,
        _voucherId: v.id,
        _stripeGroup: index % 2,
        _voucherRowIndex: entryIdx,
        _voucherEntryCount: entryCount,
        _isFirstEntryRow: isFirst,
      }

      if (mode === 'entry') {
        row.year = year
        row.period = period
        row.voucher_type_abbr = abbr
        row.voucher_seq = seq
        row.voucher_no = v.voucher_no
      } else {
        row.voucher_no = `${abbr}-${seq}`
        row.year = v.year
        row.period = v.period
      }

      // 冲红等相关字段（查询/记账需要）
      if (v.reversed_by_id != null) row.reversed_by_id = v.reversed_by_id
      if (v.reverse_of_id != null) row.reverse_of_id = v.reverse_of_id
      if (v.is_reversed != null) row.is_reversed = v.is_reversed

      rows.push(row)
    }
  }

  return rows
}

/** 常用辅助类别同义 code 归组 */
export const AUX_ALIAS_GROUPS: Array<{
  aliases: string[]
  fallback: string
  legacyProp: string
}> = [
  { aliases: ['project', 'item'], fallback: '项目', legacyProp: 'project_name' },
  { aliases: ['customer', 'supplier', 'cust_supp'], fallback: '客供', legacyProp: 'cust_supp_name' },
  { aliases: ['dept', 'department'], fallback: '部门', legacyProp: 'dept_name' },
  { aliases: ['person', 'emp', 'employee'], fallback: '人员', legacyProp: 'person_name' },
]

export interface AuxColumnDef {
  /** 列设置 / orderedColumnKeys 用的 key（通常等于 prop） */
  key: string
  code: string
  /** 表头显示名 */
  name: string
  label?: string
  prop: string
  dynamic?: boolean
  group?: string
  visible?: boolean
}

/**
 * 从一批新行中发现辅助列（增量：只扫本批，合并进已有 Set）。
 * @returns 本批新发现的列（不含 alreadySeen 里已有的）
 */
export function discoverAuxColumnsFromRows(
  rows: any[],
  options: {
    auxCategories?: Array<{ code: string; name: string }>
    alreadySeen?: Set<string>
    /** entry 模式用 alias 组；query/audit 用固定 dept/project + _aux_ */
    mode?: 'entry' | 'query'
    fixedCodes?: Set<string>
  } = {}
): AuxColumnDef[] {
  const alreadySeen = options.alreadySeen ?? new Set<string>()
  const auxCategories = options.auxCategories ?? []
  const mode = options.mode ?? 'query'
  const fixedCodes =
    options.fixedCodes ?? new Set(['dept', 'project', 'supplier', 'person', 'func_class'])
  const labelOf = (code: string) => auxCategories.find(c => c.code === code)?.name

  const usedCodes: string[] = []
  const usedCodeSet = new Set<string>()
  let hasDept = false
  let hasProject = false

  for (const row of rows) {
    if (!hasDept && row.dept_name && String(row.dept_name).trim() !== '') hasDept = true
    if (!hasProject && row.project_name && String(row.project_name).trim() !== '') hasProject = true

    for (const key of Object.keys(row)) {
      if (!key.startsWith('_aux_')) continue
      const value = row[key]
      if (!value || (typeof value === 'string' && value.trim() === '')) continue
      // 跳过 field_values 派生键 `_aux_code_field`
      const rest = key.slice(5)
      if (rest.includes('_') && !auxCategories.some(c => c.code === rest)) {
        // 可能是 code_field；只取第一段作为 code 若能匹配类别
        const maybeCode = rest.split('_')[0]
        if (auxCategories.some(c => c.code === maybeCode)) {
          if (!usedCodeSet.has(maybeCode)) {
            usedCodeSet.add(maybeCode)
            usedCodes.push(maybeCode)
          }
          continue
        }
      }
      if (!usedCodeSet.has(rest)) {
        usedCodeSet.add(rest)
        usedCodes.push(rest)
      }
    }
  }

  const result: AuxColumnDef[] = []

  if (mode === 'entry') {
    const handled = new Set<string>()
    for (const group of AUX_ALIAS_GROUPS) {
      const hit =
        group.aliases.find(a => usedCodes.includes(a)) ||
        (rows.some(r => r[group.legacyProp] && String(r[group.legacyProp]).trim() !== '')
          ? group.aliases[0]
          : '')
      if (!hit) continue
      group.aliases.forEach(a => handled.add(a))
      const prop = `_aux_${hit}`
      if (alreadySeen.has(prop)) continue
      alreadySeen.add(prop)
      group.aliases.forEach(a => alreadySeen.add(`_aux_${a}`))
      const name = labelOf(hit) || group.fallback
      result.push({
        key: prop,
        code: hit,
        name,
        label: name,
        prop,
        dynamic: true,
        group: '辅助核算',
        visible: true,
      })
    }
    for (const code of usedCodes) {
      if (handled.has(code)) continue
      const prop = `_aux_${code}`
      if (alreadySeen.has(prop)) continue
      alreadySeen.add(prop)
      const name = labelOf(code) || code
      result.push({
        key: prop,
        code,
        name,
        label: name,
        prop,
        dynamic: true,
        group: '辅助核算',
        visible: true,
      })
    }
    return result
  }

  // query / audit
  if (hasDept && !alreadySeen.has('dept_name')) {
    alreadySeen.add('dept_name')
    result.push({
      key: 'dept_name',
      code: 'dept',
      name: '部门',
      label: '部门',
      prop: 'dept_name',
      dynamic: true,
      group: '辅助核算',
      visible: true,
    })
  }
  if (hasProject && !alreadySeen.has('project_name')) {
    alreadySeen.add('project_name')
    result.push({
      key: 'project_name',
      code: 'project',
      name: '项目',
      label: '项目',
      prop: 'project_name',
      dynamic: true,
      group: '辅助核算',
      visible: true,
    })
  }

  for (const code of usedCodes) {
    if (fixedCodes.has(code)) continue
    const prop = `_aux_${code}`
    if (alreadySeen.has(prop)) continue
    const cat = auxCategories.find(c => c.code === code)
    if (!cat) continue
    alreadySeen.add(prop)
    const name = cat.name || code
    result.push({
      key: prop,
      code,
      name,
      label: name,
      prop,
      dynamic: true,
      group: '辅助核算',
      visible: true,
    })
  }

  return result
}

/** 读取行上某辅助类别显示值（含同义 code / 旧扁平字段） */
export function readAuxDisplayValue(row: any, code: string): string {
  const group = AUX_ALIAS_GROUPS.find(g => g.aliases.includes(code))
  const aliases = group ? group.aliases : [code]
  for (const a of aliases) {
    const v = row[`_aux_${a}`]
    if (v && String(v).trim() !== '') return v
  }
  if (group) {
    const v = row[group.legacyProp]
    if (v && String(v).trim() !== '') return v
  }
  return ''
}
