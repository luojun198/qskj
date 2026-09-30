/**
 * 固定资产卡片与标签打印（P3-3）
 *
 * 生成两种打印 HTML，交给 HiprintDialog 的 html 模式（getPrintHtml）输出：
 *  - 资产卡片：一资产一页的完整档案卡，右上角带二维码
 *  - 资产标签：标签纸多列排布，用于贴在实物上，扫码即得资产编号与名称
 *
 * 二维码用 qrcode 在浏览器端渲染成 data URI 内嵌，避免打印时再发网络请求。
 */
import { todayStr } from './format'
import QRCode from 'qrcode'
import type { AssetCard } from '@/api/fixedAsset'
import { DEPR_METHODS } from '@/api/fixedAsset'

/** 二维码承载的文本：竖线分隔，扫码后肉眼也能直接读 */
export function buildQrPayload(asset: AssetCard): string {
  return [asset.asset_no, asset.asset_name, asset.category_name || '', asset.dept_name || '']
    .map(s => String(s ?? '').replace(/\|/g, '/'))
    .join('|')
}

/** 批量生成二维码 data URI，key 为资产 id */
export async function buildQrMap(
  assets: AssetCard[],
  width = 120
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    assets.map(async a => {
      const url = await QRCode.toDataURL(buildQrPayload(a), {
        width,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
      return [a.id, url] as const
    })
  )
  return Object.fromEntries(entries)
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const fmtAmt = (n: number | null | undefined): string =>
  (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const dash = (v: unknown): string => {
  const s = String(v ?? '').trim()
  return s ? esc(s) : '-'
}

/** 资产卡片打印 HTML（每张资产一页） */
export function buildAssetCardHtml(
  assets: AssetCard[],
  qrMap: Record<string, string>,
  options: { companyName?: string } = {}
): string {
  const cards = assets
    .map((a, index) => {
      const qr = qrMap[a.id]
      return `
      <table class="asset-card"${index > 0 ? ' style="page-break-before:always"' : ''}>
        <tr>
          <td class="card-title" colspan="5">
            ${esc(options.companyName || '')}固定资产卡片
          </td>
          <td class="card-qr" rowspan="2">
            ${qr ? `<img src="${qr}" alt="${esc(a.asset_no)}" />` : ''}
            <div class="qr-no">${esc(a.asset_no)}</div>
          </td>
        </tr>
        <tr>
          <th>资产编号</th><td>${dash(a.asset_no)}</td>
          <th>资产名称</th><td colspan="2">${dash(a.asset_name)}</td>
        </tr>
        <tr>
          <th>资产类别</th><td>${dash(a.category_name)}</td>
          <th>使用状态</th><td>${dash(a.status_name)}</td>
          <th>使用部门</th><td>${dash(a.dept_name)}</td>
        </tr>
        <tr>
          <th>使用人</th><td>${dash(a.user_name)}</td>
          <th>保管人</th><td>${dash(a.keeper)}</td>
          <th>存放地点</th><td>${dash(a.install_place)}</td>
        </tr>
        <tr>
          <th>取得日期</th><td>${dash(a.acquire_date)}</td>
          <th>开始折旧</th><td>${dash(a.start_depr_date)}</td>
          <th>数量 / 单位</th><td>${dash(a.qty)} ${dash(a.unit)}</td>
        </tr>
        <tr>
          <th>原值</th><td class="num">${fmtAmt(a.original_value)}</td>
          <th>累计折旧</th><td class="num">${fmtAmt(a.accum_depr)}</td>
          <th>净值</th><td class="num strong">${fmtAmt(a.net_value)}</td>
        </tr>
        <tr>
          <th>折旧方法</th><td>${dash(DEPR_METHODS[a.depr_method ?? ''] || a.depr_method)}</td>
          <th>使用月数</th><td>${dash(a.use_months)}</td>
          <th>已提月数</th><td>${dash(a.depr_months_done)}</td>
        </tr>
        <tr>
          <th>残值率</th><td>${a.salvage_rate != null ? esc((Number(a.salvage_rate) * 100).toFixed(2)) + '%' : '-'}</td>
          <th>预计净残值</th><td class="num">${fmtAmt(a.salvage_value)}</td>
          <th>资产来源</th><td>${dash(a.source)}</td>
        </tr>
        <tr>
          <th>备注</th><td colspan="5">${dash(a.remark)}</td>
        </tr>
        <tr class="sign-row">
          <td colspan="6">
            制表人：____________&#12288;&#12288;保管人：____________
            部门负责人：____________&#12288;&#12288;制表日期：${todayStr()}
          </td>
        </tr>
      </table>`
    })
    .join('\n')

  return `
    <style>
      .asset-card { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
      .asset-card th, .asset-card td { border: 1px solid #000; padding: 5px 7px; }
      .asset-card th { width: 78px; background: #f5f5f5; font-weight: normal; text-align: right; white-space: nowrap; }
      .card-title { text-align: center; font-size: 17px; font-weight: 700; letter-spacing: 2px; padding: 9px 0; }
      .card-qr { width: 104px; text-align: center; vertical-align: middle; }
      .card-qr img { width: 88px; height: 88px; }
      .qr-no { font-size: 10px; margin-top: 2px; word-break: break-all; }
      .asset-card .num { text-align: right; font-variant-numeric: tabular-nums; }
      .asset-card .strong { font-weight: 700; }
      .sign-row td { text-align: right; padding: 12px 8px; border: none; }
    </style>
    ${cards}`
}

/** 资产标签打印 HTML（标签纸多列排布，贴实物用） */
export function buildAssetLabelHtml(
  assets: AssetCard[],
  qrMap: Record<string, string>,
  options: { columns?: number; companyName?: string } = {}
): string {
  const columns = Math.max(1, Math.min(6, options.columns ?? 3))
  const labels = assets
    .map(a => {
      const qr = qrMap[a.id]
      return `
      <div class="asset-label">
        <div class="label-qr">${qr ? `<img src="${qr}" alt="${esc(a.asset_no)}" />` : ''}</div>
        <div class="label-info">
          ${options.companyName ? `<div class="label-org">${esc(options.companyName)}</div>` : ''}
          <div class="label-name">${esc(a.asset_name)}</div>
          <div class="label-no">${esc(a.asset_no)}</div>
          <div class="label-meta">${dash(a.dept_name)}</div>
          <div class="label-meta">${dash(a.user_name)}</div>
        </div>
      </div>`
    })
    .join('\n')

  return `
    <style>
      .label-grid {
        display: grid;
        grid-template-columns: repeat(${columns}, 1fr);
        gap: 6px;
      }
      .asset-label {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px dashed #666;
        padding: 7px 9px;
        /* 标签不允许被分页切断 */
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .label-qr img { width: 62px; height: 62px; display: block; }
      .label-info { min-width: 0; font-size: 11px; line-height: 1.45; }
      .label-org { font-size: 10px; color: #555; }
      .label-name { font-size: 13px; font-weight: 700; word-break: break-all; }
      .label-no { font-family: Consolas, monospace; }
      .label-meta { color: #555; }
    </style>
    <div class="label-grid">${labels}</div>`
}
