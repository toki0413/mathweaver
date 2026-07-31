import { test, expect, type Page } from '@playwright/test'

/**
 * Visual Regression Tests — Screenshot Comparison
 *
 * Captures baseline screenshots of each application mode (chat, grill, proof,
 * dag) and specific components (Cayley table, DAG graph, proof panel,
 * conjecture timeline), then compares them against stored baselines using
 * Playwright's built-in `toHaveScreenshot()` matcher.
 *
 * The app is served at /test/ by vite.test.config.ts, with test/mock-api.js
 * injecting window.api. The first-run onboarding overlay must be dismissed
 * before interacting with the main UI.
 *
 * Usage:
 *   First run (generate baselines):
 *     npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
 *   Subsequent runs (compare against baselines):
 *     npx playwright test tests/e2e/visual-regression.spec.ts
 *
 * The `reducedMotion: 'reduce'` context option disables all CSS animations
 * and transitions (via the app's @media (prefers-reduced-motion: reduce)
 * rule) so that screenshots are deterministic and not affected by
 * in-flight mode-enter or fade-in animations.
 */

// Disable animations for deterministic screenshots across all tests in this file.
test.use({ reducedMotion: 'reduce' })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss the first-run onboarding dialog by stepping through all four
 * steps and clicking "开始探索". The overlay blocks interaction with the
 * main UI until it is dismissed.
 */
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

/**
 * Wait for the page to fully settle: network idle, a short timeout for
 * React render cycles and KaTeX rendering, and blur any focused input so
 * carets don't appear in screenshots.
 */
async function settlePage(page: Page, ms = 1000): Promise<void> {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(ms)
  // Blur any focused element so carets don't appear in screenshots.
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      ;(document.activeElement as HTMLElement).blur()
    }
  })
}

/**
 * Send a chat message to populate visualData (four_fields, visual_data).
 * This is required before the ConjectureTimeline and gauges render,
 * because they are conditionally rendered when visualData is truthy.
 */
async function populateVisualData(page: Page): Promise<void> {
  await page.locator('textarea.text-input').fill('什么是群？')
  await page.getByRole('button', { name: '发送' }).click()
  // Wait for the mock API response (800ms delay) plus React render.
  await page.waitForTimeout(1500)
}

// ---------------------------------------------------------------------------
// Tests — Mode Layouts (full-page screenshots)
// ---------------------------------------------------------------------------

test.describe('Visual Regression — Mode Layouts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await settlePage(page)
  })

  test('chat mode full-page layout', async ({ page }) => {
    // Chat is the default mode after onboarding.
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Wait for the Cayley table to confirm chat mode has rendered.
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()
    await settlePage(page, 500)

    await expect(page).toHaveScreenshot('chat-mode-layout.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.1,
    })
  })

  test('grill mode full-page layout', async ({ page }) => {
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    // Wait for the grill panel to render.
    await expect(page.getByRole('button', { name: '开始挑战' })).toBeVisible({ timeout: 5000 })
    await settlePage(page, 500)

    await expect(page).toHaveScreenshot('grill-mode-layout.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.1,
    })
  })

  test('proof mode full-page layout', async ({ page }) => {
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    // Wait for proof panel to render.
    await expect(page.getByText('证明步骤')).toBeVisible({ timeout: 5000 })
    await settlePage(page, 500)

    await expect(page).toHaveScreenshot('proof-mode-layout.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.1,
    })
  })

  test('dag mode full-page layout', async ({ page }) => {
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()
    // Wait for the DAG graph to render.
    await expect(page.getByText('概念依赖图')).toBeVisible({ timeout: 5000 })
    await settlePage(page, 500)

    await expect(page).toHaveScreenshot('dag-mode-layout.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.1,
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — Component Details (element screenshots)
// ---------------------------------------------------------------------------

test.describe('Visual Regression — Component Details', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await settlePage(page)
  })

  test('Cayley table component', async ({ page }) => {
    // The Cayley table lives in chat mode (the default).
    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()
    await settlePage(page, 300)

    await expect(table).toHaveScreenshot('cayley-table.png', {
      threshold: 0.2,
    })
  })

  test('DAG graph component', async ({ page }) => {
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()
    await expect(page.getByText('概念依赖图')).toBeVisible({ timeout: 5000 })
    await settlePage(page, 500)

    // Screenshot the card containing the DAG graph.
    const dagCard = page.locator('.card-primary').filter({ hasText: '概念依赖图' })
    await expect(dagCard).toBeVisible()
    await expect(dagCard).toHaveScreenshot('dag-graph.png', {
      threshold: 0.2,
    })
  })

  test('proof panel component', async ({ page }) => {
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    await expect(page.getByText('证明步骤')).toBeVisible({ timeout: 5000 })
    await settlePage(page, 500)

    // Screenshot the main column containing the proof editor.
    const mainCol = page.locator('.main-col').first()
    await expect(mainCol).toBeVisible()
    await expect(mainCol).toHaveScreenshot('proof-panel.png', {
      threshold: 0.2,
    })
  })

  test('conjecture timeline component', async ({ page }) => {
    // Populate visualData so the ConjectureTimeline renders.
    await populateVisualData(page)
    // Switch to grill mode where the ConjectureTimeline lives.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await settlePage(page, 500)

    // The timeline is inside a card titled "猜想之旅".
    const timelineCard = page.locator('.card-compact').filter({ hasText: '猜想之旅' })
    await expect(timelineCard).toBeVisible({ timeout: 5000 })
    await expect(timelineCard).toHaveScreenshot('conjecture-timeline.png', {
      threshold: 0.2,
    })
  })

  test('cognitive dashboard gauges', async ({ page }) => {
    // Populate visualData so the gauges render.
    await populateVisualData(page)
    // The gauges are in the chat mode sidebar.
    await expect(page.getByText('认知仪表盘')).toBeVisible({ timeout: 5000 })
    await settlePage(page, 300)

    const gaugeCard = page.locator('.card-compact').filter({ hasText: '认知仪表盘' })
    await expect(gaugeCard).toBeVisible()
    await expect(gaugeCard).toHaveScreenshot('cognitive-gauges.png', {
      threshold: 0.2,
    })
  })

  test('mode tab bar', async ({ page }) => {
    // Screenshot just the mode navigation bar.
    const tablist = page.getByRole('tablist', { name: '模式切换' })
    await expect(tablist).toBeVisible()
    await expect(tablist).toHaveScreenshot('mode-tabs.png', {
      threshold: 0.2,
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — After Interactions
// ---------------------------------------------------------------------------

test.describe('Visual Regression — After Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await settlePage(page)
  })

  test('Cayley table after filling out-of-range value', async ({ page }) => {
    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()

    // Enter an out-of-range value to break closure and show the "not closed" badge.
    const firstCellInput = table.locator('input').first()
    await firstCellInput.fill('9')
    await expect(page.getByText('✗ 未闭合')).toBeVisible()
    await settlePage(page, 300)

    await expect(table).toHaveScreenshot('cayley-table-after-fill.png', {
      threshold: 0.2,
    })
  })

  test('Cayley table after loading S3 preset', async ({ page }) => {
    // Click the S3 preset button to load a 6x6 table.
    await page.getByRole('button', { name: 'S3' }).click()
    await settlePage(page, 300)

    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()
    await expect(table).toHaveScreenshot('cayley-table-s3-preset.png', {
      threshold: 0.2,
      maxDiffPixelRatio: 0.1,
    })
  })

  test('proof panel after submitting proof', async ({ page }) => {
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    await expect(page.getByText('证明步骤')).toBeVisible({ timeout: 5000 })

    // Fill in proof steps.
    await page.locator('.ddps-step-textarea').first().fill("设 e 和 e' 都是群 G 的幺元")
    await page.getByRole('button', { name: /添加步骤/ }).click()
    await page.locator('.ddps-step-textarea').nth(1).fill("则 e = e·e' = e'，所以幺元唯一")

    // Submit and wait for verification result.
    await page.getByRole('button', { name: '提交验证' }).click()
    await expect(page.getByText('验证结果')).toBeVisible({ timeout: 10000 })
    await settlePage(page, 500)

    // Screenshot the main column with the proof and results.
    const mainCol = page.locator('.main-col').first()
    await expect(mainCol).toBeVisible()
    await expect(mainCol).toHaveScreenshot('proof-panel-after-submit.png', {
      threshold: 0.2,
      maxDiffPixelRatio: 0.1,
    })
  })

  test('chat panel after sending a message', async ({ page }) => {
    // Send a chat message that triggers a mock response.
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()
    // Wait for the mock response (800ms delay) plus KaTeX rendering.
    await page.waitForTimeout(2000)
    await settlePage(page, 500)

    // Screenshot the chat panel area (the card containing the textarea + chat messages).
    const chatSection = page.locator('.section-group').filter({ hasText: '对话' }).first()
    await expect(chatSection).toBeVisible()
    await expect(chatSection).toHaveScreenshot('chat-after-message.png', {
      maxDiffPixelRatio: 0.15,
      threshold: 0.2,
    })
  })

  test('grill panel after starting interview', async ({ page }) => {
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await expect(page.getByRole('button', { name: '开始挑战' })).toBeVisible({ timeout: 5000 })

    // Start the grill session.
    await page.getByRole('button', { name: '开始挑战' }).click()
    // Wait for the mock API response (500ms delay) plus render.
    await page.waitForTimeout(1500)
    await settlePage(page, 300)

    // Screenshot the main column with the active grill session.
    const mainCol = page.locator('.main-col').first()
    await expect(mainCol).toBeVisible()
    await expect(mainCol).toHaveScreenshot('grill-after-start.png', {
      threshold: 0.2,
    })
  })
})
