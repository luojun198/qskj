import { chromium } from 'playwright'
const API = 'http://127.0.0.1:3105'
const WEB = 'http://localhost:5275'
const browser = await chromium.launch()
const page = await browser.newPage()
const sets = await (await page.request.get(`${API}/api/auth/account-sets`)).json()
const asid = sets.data[0].id
const login = await (await page.request.post(`${API}/api/auth/login`, { data: { username: 'admin', password: 'admin123', targetAccountSetId: asid } })).json()
await page.goto(WEB + '/')
await page.evaluate(({ token, asid }) => { localStorage.setItem('token', token); localStorage.setItem('accountSetId', asid) }, { token: login.token, asid })
await page.goto(WEB + '/base/print-template/design?preset=standard')
await page.waitForSelector('.hiprint-printPaper', { timeout: 20000 })
await page.waitForTimeout(800)
const info = await page.evaluate(() => {
  const inst = document.querySelector('.hiprint-designer').__vueParentComponent
  const tp = inst.setupState.tp
  const keys = Object.keys(tp || {})
  const panels = tp.printPanels || tp.editingPanel
  const els = (tp.printPanels?.[0]?.printElements) || (tp.editingPanel?.printElements) || []
  const table = els.find(e => e.printElementType?.type === 'table' || e.options?.field === 'entries')
  return {
    keys,
    panelCount: tp.printPanels?.length,
    elCount: els.length,
    tableType: table && {
      typeKeys: Object.keys(table.printElementType || {}),
      type: table.printElementType,
      optionKeys: Object.keys(table.options || {}),
      height: table.options?.height,
      columns: table.options?.columns,
    },
  }
})
console.log(JSON.stringify(info, null, 2).slice(0, 4000))
await browser.close()
