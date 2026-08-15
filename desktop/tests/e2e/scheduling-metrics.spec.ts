import { test, expect, type Page } from '@playwright/test'

/**
 * E2E scenarios for the long-horizon teaching scheduling / memory checkpoint
 * metrics surfaced in the renderer UI.
 *
 * The mock backend (`test/mock-api.js`) returns a `scheduling` block from
 * `api:session-input` that carries turn/step/token counters and the
 * cross-session `restored` flag. These specs verify the header progress pill
 * and, for the resumed variant, the resume-toast + "续接" badge.
 */

/** Walk through the first-run onboarding overlay to reach the main UI. */
async function completeOnboarding(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '使用引导' })
  await expect(dialog).toBeVisible({ timeout: 15000 })

  await page.getByRole('button', { name: /初中/ }).click()
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }
  await page.getByRole('button', { name: '开始探索' }).click()
  await expect(dialog).toBeHidden()

  // Dismiss any CoachMarks overlay that may block the main UI.
  const coachDialog = page.getByRole('dialog', { name: '功能引导' })
  const coachVisible = await coachDialog.isVisible().catch(() => false)
  if (coachVisible) {
    await coachDialog.getByRole('button', { name: '跳过' }).click()
    await expect(coachDialog).toBeHidden({ timeout: 5000 })
  }
}

/** Send a chat message through the primary conversation textarea. */
async function sendMessage(page: Page, text = '什么是对称群？'): Promise<void> {
  const textarea = page.getByRole('textbox', { name: '输入数学问题' })
  await textarea.fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

test.describe('Scheduling metrics', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
  })

  test('header progress pill appears with turn/token counts after a message', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    const progress = page.locator('.session-progress')
    await expect(progress).toBeHidden()

    await sendMessage(page)

    await expect(progress).toBeVisible({ timeout: 10000 })
    // Turn counter starts at 1; token count is derived from it.
    await expect(progress).toContainText('#1')
    await expect(progress).toContainText('tok')
    // Not a resumed session, so no 续接 badge.
    await expect(progress.locator('.resume-badge')).toHaveCount(0)
  })

  test('resumed session shows the resume toast and 续接 badge', async ({ page }) => {
    await page.goto('/test/?mockSchedulingResumed=1')
    await completeOnboarding(page)

    await sendMessage(page)

    // Resume toast announcing the restored long-horizon teaching memory.
    const toast = page.getByText('已续接上次教学')
    await expect(toast).toBeVisible({ timeout: 10000 })

    // Header pill marks the session as resumed and shows the restored turn count.
    const progress = page.locator('.session-progress')
    await expect(progress).toBeVisible()
    await expect(progress.locator('.resume-badge')).toHaveText('续接')
    // In the resumed mock, the counter starts at 4 and increments on input -> 5.
    await expect(progress).toContainText('#5')
  })
})