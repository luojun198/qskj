export function commonSourceHeaderValue<T extends Record<string, any>>(
  docs: T[],
  key: keyof T,
): any {
  if (!docs.length) return ''
  const first = docs[0][key] ?? ''
  return docs.every(doc => (doc[key] ?? '') === first) ? first : ''
}

export function sourceFieldValues(docs: Array<{ field_values?: Record<string, any> | string }>, key: string): string {
  const values = [...new Set(docs.map(doc => {
    const raw = doc.field_values
    if (typeof raw === 'string') {
      try { return JSON.parse(raw)?.[key] || '' } catch { return '' }
    }
    return raw?.[key] || ''
  }).filter(Boolean).map(String))]
  return values.join('、')
}

export function buildMultiSourceRemainingLines(docs: Array<{ id?: string; doc_no?: string; lines?: any[] }>): any[] {
  return docs.flatMap(doc => (doc.lines || []).flatMap(line => {
    const remain = (Number(line.qty) || 0) - (Number(line.pushed_qty) || 0)
    if (remain <= 0) return []
    const { id, ...rest } = line
    const price = Number(line.price) || 0
    const taxRate = line.tax_rate === null || line.tax_rate === undefined || line.tax_rate === '' ? null : Number(line.tax_rate)
    return [{
      ...rest,
      qty: remain,
      price: price || null,
      amount: Math.round(remain * price * 100) / 100 || null,
      tax_rate: taxRate,
      tax_amount: taxRate === null ? null : Math.round(remain * price * taxRate) / 100,
      source_line_id: id,
      source_doc_id: doc.id,
      source_doc_no: doc.doc_no,
    }]
  }))
}
