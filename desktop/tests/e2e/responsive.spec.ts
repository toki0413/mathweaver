import { test, expect, type Page } from '@playwright/test'

/**
 * Responsive & Mobile E2E Tests
 *
 * Verifies that MathWeaver renders correctly across a range of viewport
 * sizes: desktop (1920x1080), tablet (768x1024), mobile portrait (375x667),
 * mobile landscape (667x375), and very small screens (320x568).
 *
 * Checks performed:
 *  - All four mode tabs are visible and clickable at every viewport
 *  - The main grid layout adapts (two-column → single-column) correctly
 *  - No horizontal scroll occurs on tablet / mobile
 *  - The Cayley (operation) table remains usable on small screens
 *  - The chat panel textarea is properly sized within the viewport
 *  - Mode switching works on mobile (all four modes render)
 *  - Touch interactions (tap) work in addition to mouse clicks
 *  - Font sizes on mobile are readable (no primary content below 12px)
 *
 * The app is served at /test/ by vite.test.config.ts, with test/mock-api.js
 * injecting window.api. The first-run onboarding overlay must be dismissed
 * before interacting with the main UI.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to /test/ with retry logic. The vite dev server can become
 * temporarily unreachable under heavy load (ERR_CONNECTION_REFUSED), so
 * we retry the navigation a few times with a short delay before giving up.
 */
async function gotoTestPage(page: Page): Promise<void> {
  const maxRetries = 5
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto('/test/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    } catch (e) {
      if (i < maxRetries - 1 && String(e).includes('ERR_CONNECTION_REFUSED')) {
        // Server may be temporarily down — wait and retry.
        await page.waitForTimeout(2000)
        continue
      }
      throw e
    }
  }
}

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

/**
 * Assert that the page has no horizontal scrollbar.
 *
 * Uses document.body.scrollWidth <= window.innerWidth as specified in the
 * task, with a 1px tolerance to account for sub-pixel rounding in some
 * browser engines.
 */
async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const scrollInfo = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
    docClientWidth: document.documentElement.clientWidth,
    docScrollWidth: document.documentElement.scrollWidth,
  }))

  expect(
    scrollInfo.bodyScrollWidth,
    `Horizontal scroll detected: body.scrollWidth=${scrollInfo.bodyScrollWidth} > window.innerWidth=${scrollInfo.innerWidth}`,
  ).toBeLessThanOrEqual(scrollInfo.innerWidth + 1)
}

/**
 * Get the number of grid columns in the .main-grid element.
 */
async function getMainGridColumns(page: Page): Promise<number> {
  return page
    .locator('.main-grid')
    .first()
    .evaluate(el => {
      const cols = window.getComputedStyle(el).gridTemplateColumns
      // gridTemplateColumns returns e.g. "1fr 360px" or "1fr"
      return cols.split(' ').filter(s => s.trim() !== '').length
    })
}

// ---------------------------------------------------------------------------
// Viewport definitions
// ---------------------------------------------------------------------------

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
  { name: 'mobile-landscape', width: 667, height: 375 },
  { name: 'very-small', width: 320, height: 568 },
] as const

const MODE_TABS = ['对话', '挑战', '证明', '知识地图'] as const

// ---------------------------------------------------------------------------
// Tests: Cross-viewport rendering
// ---------------------------------------------------------------------------

test.describe('Responsive Layout', () => {
  for (const vp of VIEWPORTS) {
    test(`renders correctly on ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await gotoTestPage(page)
      await completeOnboarding(page)

      // App header is present.
      await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

      // The mode-switcher tablist is rendered.
      await expect(page.getByRole('tablist', { name: '模式切换' })).toBeVisible()

      // All four mode tabs exist.
      for (const name of MODE_TABS) {
        await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
      }

      // No horizontal scroll on any viewport.
      await assertNoHorizontalScroll(page)
    })
  }
})

// ---------------------------------------------------------------------------
// Tests: Desktop (1920x1080)
// ---------------------------------------------------------------------------

test.describe('Desktop Layout (1920x1080)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('all four mode tabs are visible', async ({ page }) => {
    for (const name of MODE_TABS) {
      const tab = page.getByRole('tab', { name, exact: true })
      await expect(tab).toBeVisible()
      // Tabs should be within the viewport horizontally.
      const box = await tab.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(1920)
    }
  })

  test('main grid layout has two columns (content + sidebar)', async ({ page }) => {
    // On desktop (>1024px) the grid is "1fr 360px" — two columns.
    const colCount = await getMainGridColumns(page)
    expect(colCount).toBe(2)

    // Both columns should be visible.
    await expect(page.locator('.main-col').first()).toBeVisible()
    await expect(page.locator('.sidebar-col').first()).toBeVisible()
  })

  test('no horizontal scroll on desktop', async ({ page }) => {
    await assertNoHorizontalScroll(page)
  })
})

// ---------------------------------------------------------------------------
// Tests: Tablet (768x1024)
// ---------------------------------------------------------------------------

test.describe('Tablet Layout (768x1024)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('layout adjusts to single column at 768px breakpoint', async ({ page }) => {
    // At max-width: 768px the grid becomes "1fr" — single column.
    const colCount = await getMainGridColumns(page)
    expect(colCount).toBe(1)
  })

  test('all mode tabs remain visible on tablet', async ({ page }) => {
    for (const name of MODE_TABS) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    }
  })

  test('no horizontal scroll on tablet', async ({ page }) => {
    await assertNoHorizontalScroll(page)
  })

  test('Cayley table is visible on tablet', async ({ page }) => {
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Tests: Mobile (375x667)
// ---------------------------------------------------------------------------

test.describe('Mobile Layout (375x667)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('mode tabs are visible and clickable', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: '模式切换' })
    await expect(tablist).toBeVisible()

    // Each tab should be visible and clickable.
    for (const name of MODE_TABS) {
      const tab = page.getByRole('tab', { name, exact: true })
      await expect(tab).toBeVisible()
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
    }

    // Return to the default chat mode.
    await page.getByRole('tab', { name: '对话', exact: true }).click()
  })

  test('main content is readable and not overflowing', async ({ page }) => {
    // The app header should fit within the viewport.
    const header = page.getByRole('heading', { name: 'MathWeaver' })
    await expect(header).toBeVisible()
    const headerBox = await header.boundingBox()
    expect(headerBox).not.toBeNull()
    expect(headerBox!.x).toBeGreaterThanOrEqual(0)
    expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(375)

    // The main content column should fit within the viewport.
    const mainCol = page.locator('.main-col').first()
    await expect(mainCol).toBeVisible()
    const colBox = await mainCol.boundingBox()
    expect(colBox).not.toBeNull()
    expect(colBox!.x).toBeGreaterThanOrEqual(0)
    expect(colBox!.x + colBox!.width).toBeLessThanOrEqual(375)
  })

  test('operation table (Cayley table) is usable on small screens', async ({ page }) => {
    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()

    // Cell inputs should be present and interactive.
    const cellInputs = table.locator('input')
    const inputCount = await cellInputs.count()
    expect(inputCount).toBeGreaterThan(0)

    // Verify a cell input can be filled (the table is functional).
    const firstInput = cellInputs.first()
    await firstInput.fill('1')
    await expect(firstInput).toHaveValue('1')

    // The table (or its scrollable wrapper) should fit within the viewport
    // horizontally. At 480px and below, the card-primary wrapper has
    // overflow-x: auto, so the table can scroll internally without causing
    // body-level horizontal scroll.
    const tableBox = await table.boundingBox()
    expect(tableBox).not.toBeNull()
    // The table's left edge should not be off-screen.
    expect(tableBox!.x).toBeGreaterThanOrEqual(-1)
  })

  test('chat panel textarea is properly sized', async ({ page }) => {
    const textarea = page.locator('textarea.text-input')
    await expect(textarea).toBeVisible()

    // The textarea should fit within the viewport width.
    const box = await textarea.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)

    // The textarea should be functional (can type and read back).
    await textarea.fill('测试输入')
    await expect(textarea).toHaveValue('测试输入')

    // The textarea should have a reasonable height (not collapsed to 0).
    expect(box!.height).toBeGreaterThan(20)
  })

  test('no horizontal scroll on mobile', async ({ page }) => {
    await assertNoHorizontalScroll(page)
  })
})

// ---------------------------------------------------------------------------
// Tests: Mobile Landscape (667x375)
// ---------------------------------------------------------------------------

test.describe('Mobile Landscape (667x375)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('layout does not break in landscape orientation', async ({ page }) => {
    // App header and mode tabs should be visible.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
    await expect(page.getByRole('tablist', { name: '模式切换' })).toBeVisible()

    for (const name of MODE_TABS) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    }

    // The Cayley table should be accessible (possibly via scroll).
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()

    // No horizontal scroll.
    await assertNoHorizontalScroll(page)
  })

  test('mode switching works in landscape', async ({ page }) => {
    for (const name of ['挑战', '证明', '知识地图', '对话'] as const) {
      const tab = page.getByRole('tab', { name, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: Very Small Viewport (320x568)
// ---------------------------------------------------------------------------

test.describe('Very Small Viewport (320x568)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('app does not crash on very small viewport', async ({ page }) => {
    // The app shell should still render.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
    await expect(page.getByRole('tablist', { name: '模式切换' })).toBeVisible()
  })

  test('content is accessible on very small viewport', async ({ page }) => {
    // All mode tabs should be visible (the nav is scrollable at 768px).
    for (const name of MODE_TABS) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    }

    // The Cayley table should be present (wrapper scrolls at 480px).
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()

    // Chat textarea should be present and functional.
    const textarea = page.locator('textarea.text-input')
    await expect(textarea).toBeVisible()
    await textarea.fill('小屏测试')
    await expect(textarea).toHaveValue('小屏测试')

    // No horizontal scroll.
    await assertNoHorizontalScroll(page)
  })
})

// ---------------------------------------------------------------------------
// Tests: Mode switching on mobile
// ---------------------------------------------------------------------------

test.describe('Mobile Mode Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('all four modes render correctly on mobile', async ({ page }) => {
    // Chat mode (default) — Cayley table visible.
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()

    // Grill mode — start button visible.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await expect(page.getByRole('tab', { name: '挑战', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('button', { name: '开始挑战' })).toBeVisible({ timeout: 5000 })

    // Proof mode — proof panel visible.
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    await expect(page.getByRole('tab', { name: '证明', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText('证明步骤')).toBeVisible({ timeout: 5000 })

    // DAG mode — concept graph visible.
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()
    await expect(page.getByRole('tab', { name: '知识地图', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText('概念依赖图')).toBeVisible({ timeout: 5000 })

    // No horizontal scroll in any mode.
    await assertNoHorizontalScroll(page)
  })
})

// ---------------------------------------------------------------------------
// Tests: Touch interactions
// ---------------------------------------------------------------------------

test.describe('Touch Interactions', () => {
  // Enable touch support for the browser context in this describe block.
  test.use({ hasTouch: true })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('tap on mode tabs switches modes (touch instead of click)', async ({ page }) => {
    // Tap the grill mode tab.
    const grillTab = page.getByRole('tab', { name: '挑战', exact: true })
    await grillTab.tap()
    await expect(grillTab).toHaveAttribute('aria-selected', 'true')

    // Tap the proof mode tab.
    const proofTab = page.getByRole('tab', { name: '证明', exact: true })
    await proofTab.tap()
    await expect(proofTab).toHaveAttribute('aria-selected', 'true')

    // Tap the DAG mode tab.
    const dagTab = page.getByRole('tab', { name: '知识地图', exact: true })
    await dagTab.tap()
    await expect(dagTab).toHaveAttribute('aria-selected', 'true')

    // Tap the chat mode tab to return.
    const chatTab = page.getByRole('tab', { name: '对话', exact: true })
    await chatTab.tap()
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')
  })

  test('tap on Cayley table cell input works', async ({ page }) => {
    const table = page.getByRole('grid', { name: /运算表/ })
    const firstInput = table.locator('input').first()
    // Tap to focus the input (touch interaction).
    await firstInput.tap()
    await expect(firstInput).toBeFocused()
    // Use fill() to set a new value — this properly handles React controlled
    // inputs by dispatching the expected input/change events.
    await firstInput.fill('2')
    await expect(firstInput).toHaveValue('2')
  })

  test('tap on send button submits chat input', async ({ page }) => {
    const textarea = page.locator('textarea.text-input')
    await textarea.tap()
    await page.keyboard.type('触摸测试')

    const sendBtn = page.getByRole('button', { name: '发送' })
    await sendBtn.tap()

    // The textarea should be cleared after sending (loading state begins).
    await expect(textarea).toHaveValue('', { timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Tests: Font size readability on mobile
// ---------------------------------------------------------------------------

test.describe('Font Size Readability on Mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('primary content text is at least 12px on mobile', async ({ page }) => {
    // Collect computed font sizes for key content elements. We check the
    // elements that carry primary readable content (mode tabs, buttons,
    // chat input, table cells, headings, descriptions) rather than every
    // text node — small metadata like card-hints and status labels are
    // intentionally smaller and are not "primary content".
    const fontSizeData = await page.evaluate(() => {
      const results: { selector: string; fontSize: number; text: string }[] = []

      const checks: { selector: string; label: string }[] = [
        { selector: '.mode-tab', label: 'mode-tab' },
        { selector: '.btn', label: 'btn' },
        { selector: 'textarea.text-input', label: 'chat-textarea' },
        { selector: '.cayley-table td input', label: 'cayley-input' },
        { selector: 'h1', label: 'h1' },
        { selector: 'h2', label: 'h2' },
        { selector: '.desc', label: 'desc' },
      ]

      for (const { selector, label } of checks) {
        const els = document.querySelectorAll(selector)
        els.forEach((el, i) => {
          const computed = window.getComputedStyle(el)
          const fontSize = parseFloat(computed.fontSize)
          // Only check visible elements.
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            results.push({
              selector: `${label}[${i}]`,
              fontSize,
              text: (el.textContent || '').trim().slice(0, 40),
            })
          }
        })
      }

      return results
    })

    // We should have found at least some elements to check.
    expect(fontSizeData.length, 'Should have found content elements to check').toBeGreaterThan(0)

    // Every checked element should have font-size >= 12px.
    const below12 = fontSizeData.filter(r => r.fontSize < 12)
    expect(
      below12,
      `Found elements with font-size below 12px: ${below12
        .map(r => `${r.selector}=${r.fontSize}px`)
        .join(', ')}`,
    ).toEqual([])
  })

  test('mode tab labels are at least 14px on mobile (touch target readability)', async ({
    page,
  }) => {
    const tabFontSizes = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.mode-tab')
      return Array.from(tabs).map(el => ({
        text: (el.textContent || '').trim(),
        fontSize: parseFloat(window.getComputedStyle(el).fontSize),
      }))
    })

    expect(tabFontSizes.length).toBe(4)
    for (const tab of tabFontSizes) {
      expect(
        tab.fontSize,
        `Mode tab "${tab.text}" has font-size ${tab.fontSize}px, expected >= 14px`,
      ).toBeGreaterThanOrEqual(14)
    }
  })
})
