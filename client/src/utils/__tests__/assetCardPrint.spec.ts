import { describe, it, expect } from 'vitest'
import {
  buildQrPayload,
  buildQrMap,
  buildAssetCardHtml,
  buildAssetLabelHtml,
} from '../assetCardPrint'
import type { AssetCard } from '@/api/fixedAsset'

function makeAsset(over: Partial<AssetCard> = {}): AssetCard {
  return {
    id: 'fa-1',
    asset_no: 'GD0001',
    asset_name: '数控机床',
    category_code: 'C1',
    category_name: '机器设备',
    status_code: '01',
    status_name: '在用',
    dept_code: 'D1',
    dept_name: '生产部',
    purpose_code: 'P1',
    purpose_name: '生产用',
    acquire_date: '2026-01-05',
    start_depr_date: '2026-01-15',
    original_value: 120000,
    salvage_rate: 0.1,
    salvage_value: 12000,
    depr_method: '1',
    use_months: 120,
    use_years: 10,
    total_workload: null,
    depr_months_done: 5,
    accum_depr: 4500,
    net_value: 115500,
    card_no: null,
    qty: 1,
    unit: '台',
    user_name: '张三',
    keeper: '李四',
    source: '购入',
    install_place: '一号车间',
    remark: null,
    scrap_reason: null,
    scrap_date: null,
    ...over,
  } as AssetCard
}

describe('assetCardPrint', () => {
  describe('buildQrPayload', () => {
    it('按「编号|名称|类别|部门」竖线拼接', () => {
      expect(buildQrPayload(makeAsset())).toBe('GD0001|数控机床|机器设备|生产部')
    })

    it('字段为空时保留占位，不塌缩分隔符', () => {
      const payload = buildQrPayload(makeAsset({ category_name: undefined, dept_name: undefined }))
      expect(payload).toBe('GD0001|数控机床||')
      expect(payload.split('|')).toHaveLength(4)
    })

    it('名称中的竖线被替换，避免破坏分隔结构', () => {
      const payload = buildQrPayload(makeAsset({ asset_name: 'A|B' }))
      expect(payload.split('|')).toHaveLength(4)
      expect(payload).toContain('A/B')
    })
  })

  describe('buildQrMap', () => {
    it('为每张资产生成 data URI，key 为资产 id', async () => {
      const assets = [makeAsset(), makeAsset({ id: 'fa-2', asset_no: 'GD0002' })]
      const map = await buildQrMap(assets, 100)
      expect(Object.keys(map).sort()).toEqual(['fa-1', 'fa-2'])
      expect(map['fa-1']).toMatch(/^data:image\/png;base64,/)
      // 不同内容应生成不同二维码
      expect(map['fa-1']).not.toBe(map['fa-2'])
    })

    it('空数组返回空对象', async () => {
      expect(await buildQrMap([])).toEqual({})
    })
  })

  describe('buildAssetCardHtml', () => {
    it('包含关键字段与格式化后的金额', () => {
      const html = buildAssetCardHtml([makeAsset()], { 'fa-1': 'data:image/png;base64,AAA' })
      expect(html).toContain('固定资产卡片')
      expect(html).toContain('GD0001')
      expect(html).toContain('数控机床')
      expect(html).toContain('平均年限法')
      expect(html).toContain('120,000.00')
      expect(html).toContain('115,500.00')
      expect(html).toContain('10.00%')
      expect(html).toContain('data:image/png;base64,AAA')
    })

    it('多张资产之间插入分页符，首张不加', () => {
      const assets = [makeAsset(), makeAsset({ id: 'fa-2', asset_no: 'GD0002' })]
      const html = buildAssetCardHtml(assets, {})
      expect(html.match(/page-break-before:always/g)).toHaveLength(1)
    })

    it('空字段渲染为短横线而不是 null/undefined', () => {
      const html = buildAssetCardHtml([makeAsset({ user_name: null, remark: null })], {})
      expect(html).not.toContain('null')
      expect(html).not.toContain('undefined')
    })

    it('转义 HTML 特殊字符，防止注入破坏排版', () => {
      const html = buildAssetCardHtml([makeAsset({ asset_name: '<script>x</script>' })], {})
      expect(html).not.toContain('<script>x</script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('可带出单位名称抬头', () => {
      const html = buildAssetCardHtml([makeAsset()], {}, { companyName: '某某公司' })
      expect(html).toContain('某某公司固定资产卡片')
    })
  })

  describe('buildAssetLabelHtml', () => {
    it('按指定列数排布并渲染每张标签', () => {
      const assets = [makeAsset(), makeAsset({ id: 'fa-2', asset_no: 'GD0002', asset_name: '空压机' })]
      const html = buildAssetLabelHtml(assets, {}, { columns: 2 })
      expect(html).toContain('repeat(2, 1fr)')
      expect(html).toContain('GD0001')
      expect(html).toContain('空压机')
      expect(html.match(/class="asset-label"/g)).toHaveLength(2)
    })

    it('列数越界时被夹到 1~6', () => {
      expect(buildAssetLabelHtml([], {}, { columns: 99 })).toContain('repeat(6, 1fr)')
      expect(buildAssetLabelHtml([], {}, { columns: 0 })).toContain('repeat(1, 1fr)')
    })

    it('默认 3 列', () => {
      expect(buildAssetLabelHtml([], {})).toContain('repeat(3, 1fr)')
    })

    it('标签设置了避免跨页切断', () => {
      expect(buildAssetLabelHtml([makeAsset()], {})).toContain('page-break-inside: avoid')
    })
  })
})
