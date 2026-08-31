import { computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { formatAmount as formatAmountUtil } from '@/utils/format'

// 科目名称映射
export const accountNames: Record<string, string> = {
  '1001': '库存现金',
  '1002': '银行存款',
  '1011': '零余额账户用款额度',
  '1012': '其他货币资金',
  '1021': '短期投资',
  '1101': '应收票据',
  '1211': '应收账款',
  '1212': '预付账款',
  '1214': '其他应收款',
  '1218': '财政应返还额度',
  '1301': '在途物品',
  '1401': '受托代理资产',
  '1501': '库存物品',
  '1511': '加工物品',
  '1601': '固定资产（净值）',
  '1611': '在建工程',
  '1613': '在建工程（其他）',
  '1701': '无形资产（净值）',
  '1801': '公共基础设施（净值）',
  '1803': '政府储备物资',
  '1811': '文物文化资产',
  '1821': '保障性住房',
  '1891': '待处理财产损溢',
  '1901': '长期待摊费用',
  '2001': '短期借款',
  '2101': '应付票据',
  '2102': '应付账款',
  '2103': '应付政府补贴款',
  '2105': '应付利息',
  '2106': '预收账款',
  '2201': '应缴财政款',
  '2202': '应交增值税',
  '2301': '应付职工薪酬',
  '2302': '其他应付款',
  '2305': '应付政府补贴款',
  '2401': '预提费用',
  '2501': '长期借款',
  '2502': '长期应付款',
  '2601': '预计负债',
  '2901': '受托代理负债',
  '3001': '累计盈余',
  '3101': '专用基金',
  '3201': '权益法调整',
  '3301': '本期盈余',
  '3302': '本年盈余分配',
  '3401': '无偿调拨净资产',
  '3501': '以前年度盈余调整',
}

// 行次映射
export const lineNumbers: Record<string, string> = {
  '1001': '1', '1002': '2', '1011': '3', '1012': '4', '1021': '5',
  '1101': '6', '1211': '7', '1212': '8', '1214': '9', '1218': '10',
  '1301': '11', '1401': '12', '1501': '13', '1511': '14', '1601': '15',
  '1611': '16', '1613': '17', '1701': '18', '1801': '19', '1803': '20',
  '1811': '21', '1821': '22', '1891': '23', '1901': '24',
  '2001': '1', '2101': '2', '2102': '3', '2103': '4', '2105': '5',
  '2106': '6', '2201': '7', '2202': '8', '2301': '9', '2302': '10',
  '2305': '11', '2401': '12', '2501': '13', '2502': '14', '2601': '15',
  '2901': '16',
  '3001': '1', '3101': '2', '3201': '3', '3301': '4', '3302': '5',
  '3401': '6', '3501': '7',
}

// 负债顺序
export const liabilitySequence = [
  { code: '2001', name: '短期借款', type: '流动负债' },
  { code: '2101', name: '应付票据', type: '流动负债' },
  { code: '2102', name: '应付账款', type: '流动负债' },
  { code: '2103', name: '应付政府补贴款', type: '流动负债' },
  { code: '2105', name: '应付利息', type: '流动负债' },
  { code: '2106', name: '预收账款', type: '流动负债' },
  { code: '2201', name: '应缴财政款', type: '流动负债' },
  { code: '2202', name: '应交增值税', type: '流动负债' },
  { code: '2301', name: '应付职工薪酬', type: '流动负债' },
  { code: '2302', name: '其他应付款', type: '流动负债' },
  { code: '2305', name: '应付政府补贴款', type: '流动负债' },
  { code: '2401', name: '预提费用', type: '流动负债' },
  { code: '2501', name: '长期借款', type: '非流动负债' },
  { code: '2502', name: '长期应付款', type: '非流动负债' },
  { code: '2601', name: '预计负债', type: '非流动负债' },
  { code: '2901', name: '受托代理负债', type: '非流动负债' },
]

// 净资产顺序
export const equitySequence = [
  { code: '3001', name: '累计盈余' },
  { code: '3101', name: '专用基金' },
  { code: '3201', name: '权益法调整' },
  { code: '3301', name: '本期盈余' },
  { code: '3302', name: '本年盈余分配' },
  { code: '3401', name: '无偿调拨净资产' },
  { code: '3501', name: '以前年度盈余调整' },
]

export const deductionNames: Record<string, string> = {
  '1602': '累计折旧(1602)',
  '1603': '固定资产累计折旧(1603)',
  '1702': '累计摊销(1702)',
  '1703': '无形资产累计摊销(1703)',
  '1802': '公共基础设施累计折旧(1802)',
}

export function formatAmount(val: number | null | undefined): string {
  if (val === null || val === undefined || val === 0) return '—'
  return formatAmountUtil(val)
}

export function useBalanceSheetData(reportData: Ref<any>) {
  const deductions = computed(() => reportData.value?.deductions || {})

  const deductionTotal = computed(() => {
    const d = deductions.value
    return (d['1602'] || 0) + (d['1603'] || 0) + (d['1702'] || 0) + (d['1703'] || 0) + (d['1802'] || 0)
  })

  const assetItemsByGroup: ComputedRef<Record<string, any[]>> = computed(() => {
    const items = reportData.value?.items || {}
    const result: Record<string, any[]> = { 流动资产: [], 非流动资产: [], 其他非流动资产: [] }

    if (items['流动资产']) {
      for (const [code, bal] of Object.entries(items['流动资产'] as Record<string, number>)) {
        if (bal !== 0) {
          result['流动资产'].push({
            code,
            name: accountNames[code] || code,
            num: lineNumbers[code] || '',
            formatted: formatAmount(bal),
          })
        }
      }
    }

    if (items['非流动资产']) {
      for (const [code, bal] of Object.entries(items['非流动资产'] as Record<string, number>)) {
        if (bal !== 0) {
          result['非流动资产'].push({
            code,
            name: accountNames[code] || code,
            num: lineNumbers[code] || '',
            formatted: formatAmount(bal),
          })
        }
      }
    }

    const otherCodes = ['1803', '1811', '1821', '1891', '1901']
    for (const code of otherCodes) {
      let bal = 0
      for (const g of ['政府储备物资', '文物文化资产', '保障性住房']) {
        if (items[g]?.[code]) bal = items[g][code]
      }
      if (bal === 0 && items['非流动资产']?.[code]) bal = items['非流动资产'][code]
      if (bal !== 0) {
        result['其他非流动资产'].push({
          code,
          name: accountNames[code] || code,
          num: lineNumbers[code] || '',
          formatted: formatAmount(bal),
        })
      }
    }

    return result
  })

  const netValueItems: ComputedRef<Record<string, any[]>> = computed(() => {
    const items = reportData.value?.items || {}
    const result: Record<string, any[]> = {
      固定资产: [],
      无形资产: [],
      公共基础设施: [],
    }
    const netGroups = [
      { key: '固定资产', codes: ['1601'] },
      { key: '无形资产', codes: ['1701'] },
      { key: '公共基础设施', codes: ['1801'] },
    ]
    for (const g of netGroups) {
      if (items[g.key]) {
        for (const [code, bal] of Object.entries(items[g.key] as Record<string, number>)) {
          if (bal !== 0) {
            result[g.key].push({
              code,
              name: accountNames[code] || code,
              num: lineNumbers[code] || '',
              formatted: formatAmount(bal),
            })
          }
        }
      }
    }
    return result
  })

  const liabilityItems = computed(() => {
    const items = reportData.value?.items || {}
    const result: any[] = []
    for (const item of liabilitySequence) {
      const bal = items['流动负债']?.[item.code] || items['非流动负债']?.[item.code] || 0
      result.push({
        code: item.code,
        name: item.name,
        type: item.type,
        num: lineNumbers[item.code] || '',
        formatted: formatAmount(bal),
      })
    }
    return result
  })

  const equityItems = computed(() => {
    const items = reportData.value?.items || {}
    const result: any[] = []
    for (const item of equitySequence) {
      const bal = items['净资产']?.[item.code] || 0
      result.push({
        code: item.code,
        name: item.name,
        num: lineNumbers[item.code] || '',
        formatted: formatAmount(bal),
      })
    }
    return result
  })

  return {
    deductions,
    deductionTotal,
    assetItemsByGroup,
    netValueItems,
    liabilityItems,
    equityItems,
  }
}
