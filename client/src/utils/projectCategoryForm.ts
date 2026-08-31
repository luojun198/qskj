export interface ProjectCategoryFieldForm {
  field_key: string
  field_name: string
  field_type: 'text' | 'number' | 'date' | 'select'
  options_json: string | null
  options_text: string
  show_in_voucher: boolean
  required_in_voucher: boolean
  required_in_archive: boolean
  sort_order: number
  _persisted: boolean
}

function parseOptions(optionsJson: string | null) {
  if (!optionsJson) return ''
  try {
    const values = JSON.parse(optionsJson)
    return Array.isArray(values) ? values.join(',') : ''
  } catch { return '' }
}

export function normalizeProjectCategoryField(field: any): ProjectCategoryFieldForm {
  return {
    ...field,
    field_key: String(field.field_key || ''),
    field_name: String(field.field_name || ''),
    field_type: field.field_type || 'text',
    options_json: field.options_json || null,
    options_text: parseOptions(field.options_json),
    show_in_voucher: !!field.show_in_voucher,
    required_in_voucher: !!field.required_in_voucher,
    required_in_archive: !!field.required_in_archive,
    sort_order: Number(field.sort_order) || 0,
    _persisted: true,
  }
}

export function nextProjectCategoryCode(categories: Array<{ code?: string }>) {
  const maxCodeNumber = categories.reduce((max, category) => {
    const match = String(category.code || '').match(/CAT(\d+)/)
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max
  }, 0)
  return `CAT${String(maxCodeNumber + 1).padStart(3, '0')}`
}

export function buildProjectCategoryFieldsPayload(fields: ProjectCategoryFieldForm[]) {
  return fields.map((field, index) => ({
    field_key: field.field_key,
    field_name: field.field_name,
    field_type: field.field_type || 'text',
    options_json: field.field_type === 'select' && field.options_text
      ? JSON.stringify(field.options_text.split(',').map(value => value.trim()).filter(Boolean))
      : null,
    show_in_voucher: field.show_in_voucher ? 1 : 0,
    required_in_voucher: field.required_in_voucher ? 1 : 0,
    required_in_archive: field.required_in_archive ? 1 : 0,
    sort_order: index,
  }))
}
