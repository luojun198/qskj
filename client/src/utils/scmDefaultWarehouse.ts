export interface DefaultWarehouseInput {
  sourceWarehouse?: string
  headerWarehouse?: string
  manuallySelected: boolean
  itemWarehouses: Array<string | null | undefined>
}

export function resolveDefaultWarehouse(input: DefaultWarehouseInput): string {
  if (input.sourceWarehouse) return input.sourceWarehouse
  if (input.manuallySelected) return input.headerWarehouse || ''
  const warehouses = [...new Set(input.itemWarehouses.map(code => String(code || '').trim()).filter(Boolean))]
  return warehouses.length === 1 ? warehouses[0] : ''
}
