import { chromium } from 'playwright';

async function removeSpinners() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:5275/system/param');

  // Wait for page to load
  await page.waitForLoadState('networkidle');

  // Find all number inputs and remove spinners
  // This CSS removes the spinner buttons from number inputs
  await page.addStyleTag({
    content: `
      input[type="number"]::-webkit-inner-spin-button,
      input[type="number"]::-webkit-outer-spin-button {
        -webkit-appearance: none !important;
        margin: 0 !important;
      }
      input[type="number"] {
        -moz-appearance: textfield !important;
        appearance: none !important;
      }
    `
  });

  console.log('Removed spinner buttons from number inputs');

  // Take screenshot to verify
  await page.screenshot({ path: 'tmp/param-page-after.png' });

  await browser.close();
}

removeSpinners().catch(console.error);