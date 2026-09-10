import { chromium } from 'playwright'

const API = 'http://127.0.0.1:3105'
const WEB = 'http://127.0.0.1:5275'
const TEMPLATE = '6b6e2a01-161d-4ebd-a654-16a120dd7a5c'

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
await page.goto(`${WEB}/base/print-template/design/${TEMPLATE}`)
await page.waitForSelector('.hiprint-printPaper', { timeout: 20000 })
await page.waitForTimeout(1200)

const table = page.locator('.hiprint-printElement-table').first()
const box = await table.boundingBox()
console.log('table box', JSON.stringify(box))

const dump = await page.evaluate(() => {
  const t = document.querySelector('.hiprint-printElement-table')
  const walk = (el, depth) => {
    if (depth > 3 || !el) return null
    return {
      tag: el.tagName,
      cls: el.className,
      rect: (r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }))(
        el.getBoundingClientRect()
      ),
      kids: [...el.children].slice(0, 6).map(c => walk(c, depth + 1)),
    }
  }
  return walk(t, 0)
})
console.log(JSON.stringify(dump, null, 1))

async function clickAt(label, x, y) {
  await page.mouse.click(x, y)
  await page.waitForTimeout(500)
  const info = await page.evaluate(() => {
    const root = document.querySelector('#hiprint-element-settings')
    const inst = document.querySelector('.hiprint-designer').__vueParentComponent
    const tp = inst.setupState.tp
    return {
      items: root.querySelectorAll('.hiprint-option-item').length,
      tabs: root.querySelectorAll('.prop-tab-item').length,
      html: root.innerHTML.length,
      lastType: tp?.lastPrintElement?.printElementType?.type || null,
    }
  })
  console.log(label, JSON.stringify(info))
}

// 先点空白清掉选中
await page.mouse.click(box.x + box.width / 2, box.y - 40)
await clickAt('表头文字(科目代码)', box.x + 200, box.y + 8)
await page.mouse.click(box.x + box.width / 2, box.y - 40)
await clickAt('表体空白区中部', box.x + box.width / 2, box.y + box.height - 8)
await page.mouse.click(box.x + box.width / 2, box.y - 40)
await clickAt('表格左边框', box.x + 2, box.y + box.height / 2)
await browser.close()
