import { test, expect } from './fixtures'

test.describe('凭证打印设置', () => {
  test('列表只有预设新建入口，设计器可预览保存', async ({ loggedInPage: page }) => {
    await page.goto('/base/print-template')
    await expect(page.locator('h2')).toContainText('凭证打印设置')
    await expect(page.getByRole('button', { name: '从预设新建' })).toBeVisible()
    await expect(page.getByText('新增凭证模版（旧）')).toHaveCount(0)
    await expect(page.getByText('新增套打模板')).toHaveCount(0)

    await page.getByRole('button', { name: '从预设新建' }).click()
    await page.getByRole('menuitem', { name: /标准记账凭证/ }).click()
    await expect(page).toHaveURL(/\/base\/print-template\/design/)
    await expect(page.getByText('凭证字段', { exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: '凭证字号' })).toBeVisible()
    await expect(page.getByRole('button', { name: '分录表' })).toBeVisible()
    await expect(page.getByText('会计科目').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('记 账 凭 证').first()).toBeVisible({ timeout: 10000 })

    const titleBox = page.locator('.hiprint-printElement-text').first()
    await titleBox.click()
    const titleInput = page.locator('#hiprint-element-settings textarea').first()
    await expect(titleInput).toBeVisible({ timeout: 8000 })
    await titleInput.fill('123')
    await titleInput.blur()
    await expect(page.locator('.hiprint-printElement-text-content', { hasText: '123' }).first()).toBeVisible({
      timeout: 5000,
    })

    const tableHandle = page.locator('.hiprint-printElement-table-handle').first()
    await expect(tableHandle).toBeVisible()
    const handleStyle = await tableHandle.evaluate(el => {
      const s = getComputedStyle(el)
      return { backgroundColor: s.backgroundColor, cursor: s.cursor, backgroundImage: s.backgroundImage }
    })
    expect(handleStyle.backgroundColor).not.toMatch(/rgb\(\s*255,\s*0,\s*0\s*\)/)
    expect(handleStyle.cursor).toBe('move')
    expect(handleStyle.backgroundImage).toContain('image/svg+xml')

    await page.locator('.hiprint-printElement-table').getByText('会计科目').first().click()
    await expect(
      page.locator('#hiprint-element-settings .prop-tabs, #hiprint-element-settings .hiprint-option-item').first()
    ).toBeVisible({ timeout: 8000 })

    const textEl = page.locator('.hiprint-printElement-text').first()
    if (await textEl.count()) {
      await textEl.click()
      await expect(page.locator('#hiprint-element-settings input, #hiprint-element-settings select').first()).toBeVisible({
        timeout: 8000,
      })
    }

    // hiprint 原生只在列头绑了选中事件，点表体也要能出表格属性
    const tableBox = await page.locator('.hiprint-printElement-table').first().boundingBox()
    if (tableBox) {
      await page.mouse.click(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height - 6)
      await expect(
        page.locator('#hiprint-element-settings .hiprint-option-item-label', { hasText: '表格头显示' }).first()
      ).toBeVisible({ timeout: 8000 })
    }

    // 固定行数：新建预设默认 6 行；示例数据只有 2 条分录，预览应补空行到 6 行、合计在 tfoot
    const rowsCard = page.locator('.summary-card', { hasText: '分录表 · 打印行数' })
    await expect(rowsCard).toBeVisible()
    await expect(rowsCard.locator('input')).toHaveValue('6')

    await page.getByRole('main').getByRole('button', { name: '示例预览' }).click()
    await expect(page.locator('.el-dialog__title', { hasText: '示例数据预览' })).toBeVisible({ timeout: 15000 })
    const previewTable = page.locator('.preview-wrap .hiprint-printElement-tableTarget').first()
    await expect(previewTable).toBeVisible({ timeout: 10000 })
    await expect(previewTable.locator('tbody tr')).toHaveCount(6)
    await expect(previewTable.locator('tfoot tr')).toHaveCount(1)
    await page.keyboard.press('Escape')

    await page.getByRole('main').getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存成功')).toBeVisible()
    await expect(page).toHaveURL(/\/base\/print-template\/design\/.+/)
    // 等第一次的提示消失，否则下一次 expect(保存成功) 会撞上残留的提示、在保存返回前就往下走
    await expect(page.getByText('保存成功')).toBeHidden({ timeout: 8000 })

    await page.locator('.hiprint-printElement-text').first().click()
    await titleInput.fill('继续编辑')
    await titleInput.blur()
    await expect(page.locator('.hiprint-printElement-text-content', { hasText: '继续编辑' }).first()).toBeVisible()
    await page.getByRole('main').getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存成功')).toBeVisible()
    await expect(page).toHaveURL(/\/base\/print-template\/design\/.+/)

    await page.getByRole('main').getByRole('button', { name: '返回' }).click()
    await expect(page).toHaveURL(/\/base\/print-template$/)
    await expect(page.locator('h2')).toContainText('凭证打印设置')
    await expect(page.locator('.template-card').first()).toBeVisible({ timeout: 15000 })
  })

  test('凭证查询打印走 hiprint 对话框', async ({ loggedInPage: page }) => {
    await page.goto('/voucher/query')
    await expect(page.locator('.apple-breadcrumb')).toContainText('凭证查询', { timeout: 15000 })
    const firstRow = page.locator('.el-table__body tr').first()
    if (await firstRow.count()) {
      await firstRow.click()
    }
    const printBtn = page.locator('.gl-tool-btn', { hasText: '打印' }).first()
    if (await printBtn.isEnabled()) {
      await printBtn.click()
      await expect(page.getByRole('button', { name: '浏览器打印' })).toBeVisible({ timeout: 15000 })
      await expect(page.getByText('编辑打印模版')).toHaveCount(0)
    }
  })
})
