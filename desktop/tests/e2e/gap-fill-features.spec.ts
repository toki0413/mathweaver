import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the three "查漏补缺" (gap-fill) features added in v0.5.0:
 *  1. 导出学习快照 — self-contained HTML snapshot
 *  2. 复制分享链接 — shareable session link
 *  3. 生成主题课程 — LLM-driven course DAG generation
 *
 * The app runs against the mock API (test/mock-api.js), which now includes
 * the file:export-html and api:generate-course channels.
 */

async function completeOnboarding(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '使用引导' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: /初中/ }).click()
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }
  await page.getByRole('button', { name: '开始探索' }).click()
  await expect(dialog).toBeHidden()
  const coachDialog = page.getByRole('dialog', { name: '功能引导' })
  const coachVisible = await coachDialog.isVisible().catch(() => false)
  if (coachVisible) {
    await coachDialog.getByRole('button', { name: '跳过' }).click()
    await expect(coachDialog).toBeHidden({ timeout: 5000 })
  }
}

async function openCommand(page: Page, keyword: string): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  const palette = page.getByRole('dialog', { name: '命令面板' })
  await expect(palette).toBeVisible()
  await palette.getByPlaceholder('输入命令名称…').fill(keyword)
  const item = palette.getByRole('button', { name: new RegExp(keyword.split(' ')[0]) })
  await expect(item.first()).toBeVisible()
  await item.first().click()
  await expect(palette).toBeHidden()
}

test.describe('Gap-fill: 导出学习快照', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
  })

  test('command exports a self-contained HTML snapshot', async ({ page }) => {
    // Start a session so there is content to export.
    await page.getByPlaceholder(/输入|提问|message/i).first().fill('所有群都是交换群吗？')
    await page.getByPlaceholder(/输入|提问|message/i).first().press('Enter')

    await openCommand(page, '导出学习快照')

    const toast = page.getByText(/快照已导出/)
    await expect(toast).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/mathweaver-snapshot\.html/)).toBeVisible()
  })
})

test.describe('Gap-fill: 复制分享链接', () => {
  test('with a session it copies a mathweaver://share link', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page
      .getByPlaceholder(/输入|提问|message/i)
      .first()
      .fill('群的定义是什么？')
    await page.getByPlaceholder(/输入|提问|message/i).first().press('Enter')
    await page.waitForTimeout(400)

    // Grant clipboard permissions so navigator.clipboard.writeText works.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    await openCommand(page, '复制分享链接')

    const toast = page.getByText('已复制', { exact: true })
    await expect(toast).toBeVisible({ timeout: 8000 })
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toMatch(/^mathweaver:\/\/share\/[A-Za-z0-9_-]+$/)
  })
})

test.describe('Gap-fill: 生成主题课程', () => {
  test('generates course nodes and reports them in a toast', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // Stub the prompt so the test is deterministic.
    await page.evaluate(() => {
      window.prompt = () => '线性代数'
    })

    await openCommand(page, '生成主题课程')

    const toast = page.getByText(/已生成 3 个概念/)
    await expect(toast).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/线性代数 · 入门/)).toBeVisible()
  })
})