import request from './request'

export interface Currency {
  id: string
  account_set_id: string
  code: string
  name: string
  is_base: number
  default_rate: number
  /** 年初汇率 */
  begin_rate: number
  /** 期末汇率 */
  end_rate: number
  rate_decimals: number
  is_enabled: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CurrencySettings {
  exchange_gain_account_code: string | null
  exchange_gain_account_name: string | null
}

export interface ExchangeRate {
  id: string
  account_set_id: string
  currency_code: string
  year: number
  period: number
  rate: number
  closing_rate: number | null
  created_at: string
  updated_at: string
}

export function getCurrencies(includeDisabled = false) {
  return request.get<Currency[]>('/base/currencies', {
    params: includeDisabled ? { include_disabled: '1' } : undefined,
  })
}

export function createCurrency(data: {
  code: string
  name?: string
  is_base?: boolean
  default_rate?: number
  begin_rate?: number
  end_rate?: number
  rate_decimals?: number
  is_enabled?: boolean
  sort_order?: number
}) {
  return request.post<Currency>('/base/currencies', data)
}

export function updateCurrency(
  id: string,
  data: Partial<{
    name: string
    is_base: boolean
    default_rate: number
    begin_rate: number
    end_rate: number
    rate_decimals: number
    is_enabled: boolean
    sort_order: number
  }>
) {
  return request.put(`/base/currencies/${id}`, data)
}

export function getCurrencySettings() {
  return request.get<CurrencySettings>('/base/currency-settings')
}

export function saveCurrencySettings(data: { exchange_gain_account_code: string | null }) {
  return request.put<CurrencySettings>('/base/currency-settings', data)
}

export function deleteCurrency(id: string) {
  return request.delete(`/base/currencies/${id}`)
}

export function getExchangeRates(params?: { currency_code?: string; year?: number }) {
  return request.get<ExchangeRate[]>('/base/exchange-rates', { params })
}

export function upsertExchangeRate(data: {
  currency_code: string
  year: number
  period: number
  rate: number
  closing_rate?: number | null
}) {
  return request.post<ExchangeRate>('/base/exchange-rates', data)
}

export function deleteExchangeRate(id: string) {
  return request.delete(`/base/exchange-rates/${id}`)
}

export function resolveExchangeRate(currencyCode: string, year: number, period: number) {
  return request.get<{ rate: number }>('/base/exchange-rates/resolve', {
    params: { currency_code: currencyCode, year, period },
  })
}
