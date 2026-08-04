import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'

async function completeOnboarding(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '使用引导' })
  await expect(dialog).toBeVisible()
  // Step 0: Select age level (tweens = 4 steps, matching 3×下一步 + 开始探索)
  await page.getByRole('button', { name: /初中/ }).click()
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

test('debug proof mode', async ({ page }) => {
  await page.goto('/test/')
  await completeOnboarding(page)
  await page.getByRole('tab', { name: '证明', exact: true }).click()
  await expect(page.getByText('证明步骤')).toBeVisible({ timeout: 5000 })
  await page.waitForTimeout(500)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

  for (const v of results.violations) {
    console.warn(`\nPROOF RULE: ${v.id} (impact: ${v.impact}) - ${v.nodes.length} nodes`)
    for (const n of v.nodes.slice(0, 3)) {
      console.warn(`  TARGET: ${JSON.stringify(n.target)} HTML: ${n.html.slice(0, 200)}`)
    }
  }
})

test('debug math katex', async ({ page }) => {
  await page.goto('/test/')
  await completeOnboarding(page)
  await page.locator('textarea.text-input').fill('什么是群？')
  await page.getByRole('button', { name: '发送' }).click()
  await page.waitForTimeout(2000)

  const katexCount = await page.locator('.katex').count()
  console.warn('KATEX COUNT:', katexCount)

  if (katexCount === 0) {
    const contentHtml = await page.locator('.chat-msg .content').first().innerHTML()
    console.warn('CONTENT HTML:', contentHtml.slice(0, 500))
  }
})
