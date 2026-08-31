const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('http://localhost:5276/login');
  try {
    await page.fill('input[type="text"]', 'admin');
    await page.fill('input[type="password"]', '123456');
    await page.click('button.el-button--primary');
    await page.waitForTimeout(1000);
  } catch(e) {}

  await page.goto('http://localhost:5276/scm/docs/new?doc_type=SO');
  await page.waitForTimeout(3000);
  
  const content = await page.content();
  fs.writeFileSync('page_content.html', content);
  console.log('Saved page content');
  
  await browser.close();
})();
