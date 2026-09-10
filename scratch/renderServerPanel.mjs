import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const API = 'http://127.0.0.1:3105'
const WEB = 'http://127.0.0.1:5275'
const serverPanel = JSON.parse(readFileSync('scratch/server-panel.json', 'utf8'))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const sets = await (await page.request.get(`${API}/api/auth/account-sets`)).json()
const asid = sets.data[0].id
const login = await (
  await page.request.post(`${API}/api/auth/login`, {
    data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  })
).json()
await page.goto(WEB + '/')
await page.evaluate(
  ({ token, asid }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('accountSetId', asid)
  },
  { token: login.token, asid }
)
await page.goto(`${WEB}/base/print-template/design?preset=standard`)
await page.waitForSelector('.hiprint-printPaper', { timeout: 20000 })
await page.waitForTimeout(1200)

const result = await page.evaluate(panel => {
  const inst = document.querySelector('.hiprint-designer').__vueParentComponent
  const tp = inst.setupState.tp
  const PrintTemplate = tp.constructor
  const mk = n =>
    Array.from({ length: n }, (_, i) => ({
      summary: `分录 ${i + 1}`,
      account_code: '1001',
      account_name: '库存现金',
      debit: i % 2 ? '' : '1,000.00',
      credit: i % 2 ? '1,000.00' : '',
    }))
  const render = n => {
    const t = new PrintTemplate({ template: JSON.parse(JSON.stringify(panel)) })
    const $html = t.getHtml({ doc_title: '记 账 凭 证', account_set_name: '示例账套', entries: mk(n), maker_text: '制单：张三' })
    const root = $html[0] || $html.get(0)
    document.body.appendChild(root)
    const papers = [...root.querySelectorAll('.hiprint-printPaper')].map(p => {
      const tb = p.querySelector('.hiprint-printElement-tableTarget')
      return {
        rows: tb ? tb.querySelectorAll('tbody tr').length : 0,
        tfoot: tb ? [...tb.querySelectorAll('tfoot td')].map(td => td.textContent.trim()) : [],
      }
    })
    const html = n === 2 ? root.outerHTML : ''
    root.remove()
    return { papers, html }
  }
  const two = render(2)
  return { two: two.papers, eight: render(8).papers, html: two.html }
}, serverPanel)
console.log(JSON.stringify({ two: result.two, eight: result.eight }, null, 1))

await page.setContent(
  `<link rel="stylesheet" href="${WEB}/node_modules/vue-plugin-hiprint/dist/print-lock.css">` +
    `<style>body{margin:0;background:#eee;padding:16px}.hiprint-printPaper{background:#fff;margin:0 auto}</style>` +
    result.html
)
await page.waitForTimeout(500)
await page.locator('.hiprint-printPaper').first().screenshot({ path: 'scratch/server-panel-render.png' })
await browser.close()
