import { test, expect, type Page } from '@playwright/test'

/**
 * E2E tests for the eye-tracking panel (webgazer.js).
 *
 * Validates the UI that wraps the webgazer 3.5.3 integration:
 *  1. The panel renders its header, status chip and metrics.
 *  2. In the browser-test environment the local webgazer bundle is not
 *     available (no `process.resourcesPath`), so the panel must fall back to
 *     a graceful error state and disable the tracking/calibration buttons —
 *     rather than throwing or leaving the UI in a broken state.
 *  3. Metrics start at their neutral defaults.
 *
 * The app runs against the mock API (test/mock-api.js).
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

/** Expand the "眼动认知负荷" collapsible section so the panel is visible. */
async function openEyeTrackingPanel(page: Page): Promise<void> {
  const section = page.getByRole('button', { name: /眼动认知负荷/ })
  await section.click()
  await expect(page.locator('.eye-tracking-panel')).toBeVisible()
}

test.describe('Eye tracking (webgazer)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await openEyeTrackingPanel(page)
  })

  test('panel renders header, status chip and metric labels', async ({ page }) => {
    await expect(page.locator('.eye-tracking-title')).toHaveText('眼动追踪')
    await expect(page.locator('.eye-tracking-status')).toHaveText('错误')
    await expect(page.locator('.eye-tracking-metric-label').first()).toHaveText('认知负荷')
  })

  test('metrics start at neutral defaults', async ({ page }) => {
    await expect(page.locator('.eye-tracking-metric').nth(0)).toContainText('0')
    await expect(page.locator('.eye-tracking-metric').nth(1)).toContainText('0ms')
    await expect(page.locator('.eye-tracking-metric').nth(2)).toContainText('0')
  })

  test('falls back to a graceful error state when webgazer cannot load', async ({ page }) => {
    // In the browser-test environment the local webgazer bundle is absent,
    // so the panel must surface a clear error instead of crashing.
    await expect(page.locator('.eye-tracking-error')).toBeVisible()
    await expect(page.locator('.eye-tracking-error')).toContainText('无法加载 webgazer.js')
  })

  test('tracking and calibration buttons are disabled in the error state', async ({ page }) => {
    await expect(page.getByRole('button', { name: '开始追踪' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '校准' })).toBeDisabled()
  })
})
