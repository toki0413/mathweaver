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
 * finishing with the "开始使用" button. Used by scenarios that need to interact
 * with the main UI underneath the overlay.
 */
async function completeOnboarding(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '使用引导' })
  await expect(dialog).toBeVisible()

  // Steps 1..3 expose a "下一步" button; click through to the final step.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }

  await page.getByRole('button', { name: '开始使用' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('MathWeaver', () => {
  test('page loads and renders the app shell', async ({ page }) => {
    await page.goto('/test/')

    // App header is present.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
    // The mode-switcher tablist is rendered.
    await expect(page.getByRole('tablist', { name: '模式切换' })).toBeVisible()
    // All four mode tabs exist.
    for (const name of ['对话', '面试', '证明', '图谱']) {
      await expect(page.getByRole('tab', { name })).toBeVisible()
    }
  })

  test('onboarding flow can be completed', async ({ page }) => {
    await page.goto('/test/')

    const dialog = page.getByRole('dialog', { name: '使用引导' })
    await expect(dialog).toBeVisible()

    // First step welcomes the user.
    await expect(page.getByText('欢迎使用 MathWeaver')).toBeVisible()

    // Walk through to the final step and finish.
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '下一步' }).click()
    }
    await expect(page.getByRole('button', { name: '开始使用' })).toBeVisible()
    await page.getByRole('button', { name: '开始使用' }).click()

    // The overlay is dismissed.
    await expect(dialog).toBeHidden()
  })

  test('switches between dialogue / interview / proof / graph modes', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // Visiting each mode marks its tab as selected.
    for (const name of ['面试', '证明', '图谱', '对话']) {
      const tab = page.getByRole('tab', { name })
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
    await expect(page.getByText('✗ 未闭合')).toBeVisible()
  })
})
