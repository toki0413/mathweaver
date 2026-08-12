import { test, expect, type Page } from '@playwright/test'

/**
 * E2E scenarios for the MathWeaver renderer.
 *
 * The app is served by `vite.test.config.ts` (see playwright.config.ts), with
 * `test/mock-api.js` injecting a mock Electron IPC bridge. Onboarding is
 * initially incomplete in the mock, so the first-run guide overlay appears on
 * every fresh page load.
 */

/**
 * Wait for the first-run onboarding dialog and walk through all four steps,
 * finishing with the "开始探索" button. Used by scenarios that need to interact
 * with the main UI underneath the overlay.
 */
async function completeOnboarding(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '使用引导' })
  await expect(dialog).toBeVisible()

  // Step 0: Select age level (tweens = 4 steps, matching 3×下一步 + 开始探索)
  await page.getByRole('button', { name: /初中/ }).click()

  // Steps 1..3 expose a "下一步" button; click through to the final step.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }

  await page.getByRole('button', { name: '开始探索' }).click()
  await expect(dialog).toBeHidden()

  // After the static onboarding, a CoachMarks overlay ("功能引导") may appear.
  // Dismiss it so it doesn't block interaction with the main UI.
  const coachDialog = page.getByRole('dialog', { name: '功能引导' })
  const coachVisible = await coachDialog.isVisible().catch(() => false)
  if (coachVisible) {
    await coachDialog.getByRole('button', { name: '跳过' }).click()
    await expect(coachDialog).toBeHidden({ timeout: 5000 })
  }
}

test.describe('MathWeaver', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
  })

  test('page loads and renders the app shell', async ({ page }) => {
    await page.goto('/test/')

    // App header is present.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible({ timeout: 15000 })
    // The mode-switcher tablist is rendered.
    await expect(page.getByRole('tablist', { name: '模式切换' })).toBeVisible()
    // All five mode tabs exist.
    for (const name of ['对话', '挑战', '证明', '知识地图', '建模']) {
      await expect(page.getByRole('tab', { name })).toBeVisible()
    }
  })

  test('onboarding flow can be completed', async ({ page }) => {
    await page.goto('/test/')

    const dialog = page.getByRole('dialog', { name: '使用引导' })
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // First step welcomes the user.
    await expect(dialog.getByText('欢迎')).toBeVisible()

    // Step 0: Select age level (tweens = 4 steps, matching 3×下一步 + 开始探索)
    await page.getByRole('button', { name: /初中/ }).click()

    // Walk through to the final step and finish.
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '下一步' }).click()
    }
    await expect(page.getByRole('button', { name: '开始探索' })).toBeVisible()
    await page.getByRole('button', { name: '开始探索' }).click()

    // The overlay is dismissed.
    await expect(dialog).toBeHidden()
  })

  test('switches between dialogue / challenge / proof / graph modes', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // Visiting each mode marks its tab as selected.
    // Use exact: true because proof mode adds sub-tabs (正向证明/倒推模式)
    // whose names contain '证明' as a substring.
    for (const name of ['挑战', '证明', '知识地图', '建模', '对话']) {
      const tab = page.getByRole('tab', { name, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
    }
  })

  test('operation table interaction updates the closure badge', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // Ensure we are in 对话 (chat) mode, where the Cayley table lives.
    await page.getByRole('tab', { name: '对话' }).click()

    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()

    // The initial 3x3 identity table is closed.
    await expect(page.getByText('✓ 闭合')).toBeVisible()

    // Enter an out-of-range value in the first cell to break closure.
    const firstCellInput = table.locator('input').first()
    await firstCellInput.fill('9')

    // The badge should now report a closure violation.
    await expect(page.getByText('× 未闭合')).toBeVisible()
  })

  test('modeling mode renders canvas and parameter sliders', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // Switch to modeling mode.
    await page.getByRole('tab', { name: '建模', exact: true }).click()

    // The modeling canvas should be visible.
    await expect(page.getByRole('img', { name: /可视化/ })).toBeVisible({ timeout: 10000 })

    // Model preset buttons should be present.
    await expect(page.getByText('模型预设')).toBeVisible()
    await expect(page.getByRole('button', { name: '捕食-被捕食模型' })).toBeVisible()

    // Parameter sliders should be present.
    await expect(page.getByText('参数控制')).toBeVisible()

    // The "explain the math path" section should be visible (GeoChat-inspired).
    await expect(page.getByText('解释数学路径')).toBeVisible()

    // Switch to Cayley graph model (connects to group theory core).
    await page.getByRole('button', { name: 'Cayley 图可视化' }).click()
    await expect(page.getByRole('img', { name: /Cayley/ })).toBeVisible({ timeout: 10000 })
  })
})
