import { chromium } from 'playwright'

const API = 'http://127.0.0.1:3105'
const WEB = 'http://127.0.0.1:5275'
const TEMPLATE = process.argv[2] || '6b6e2a01-161d-4ebd-a654-16a120dd7a5c'

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
await page.waitForTimeout(1000)
await page.locator('.hiprint-printElement-text').first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'scratch/designer-text.png' })

const table = page.locator('.hiprint-printElement-table').first()
if (await table.count()) {
  await table.click({ position: { x: 20, y: 10 } })
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'scratch/designer-table.png' })
}

const box = await page.locator('.designer-settings-wrap').boundingBox()
const itemBox = await page.locator('#hiprint-element-settings .hiprint-option-item').first().boundingBox()
console.log(JSON.stringify({ settingsWidth: box?.width, itemWidth: itemBox?.width, itemHeight: itemBox?.height }))
await browser.close()
