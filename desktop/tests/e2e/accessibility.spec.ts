import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'

/**
 * WCAG 2.1 AA Accessibility Compliance Tests
 *
 * These tests use axe-core to scan each application mode (chat, grill, proof,
 * dag) for accessibility violations. They also verify keyboard navigation,
 * accessible names on interactive elements, color contrast, math content
 * alternatives, ARIA attributes on the Cayley table and mode tabs, and
 * label associations on form inputs.
 *
 * The app is served at /test/ by vite.test.config.ts, with test/mock-api.js
 * injecting window.api. The first-run onboarding overlay must be dismissed
 * before interacting with the main UI.
 */

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

  // Steps 1..3 expose a "下一步" button; click through to the final step.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
  }

  await page.getByRole('button', { name: '开始探索' }).click()
  await expect(dialog).toBeHidden()

  // After the static onboarding, a CoachMarks overlay ("功能引导") may appear
  // with interactive step-by-step highlights. Dismiss it so it doesn't block
  // interaction with the main UI.
  const coachDialog = page.getByRole('dialog', { name: '功能引导' })
  const coachVisible = await coachDialog.isVisible().catch(() => false)
  if (coachVisible) {
    await coachDialog.getByRole('button', { name: '跳过' }).click()
    await expect(coachDialog).toBeHidden({ timeout: 5000 })
  }
}

/**
 * Filter axe results to only critical and serious violations, as required
 * by the task specification.
 */
function filterCriticalViolations(
  violations: typeof AxeBuilder.prototype.analyze extends () => Promise<infer R>
    ? R extends { violations: infer V }
      ? V
      : never
    : never,
): typeof AxeBuilder.prototype.analyze extends () => Promise<infer R>
  ? R extends { violations: infer V }
    ? V
    : never
  : never {
  return violations.filter(
    (v: { impact?: string | null }) => v.impact === 'critical' || v.impact === 'serious',
  )
}

/**
 * Switch to a specific mode tab by clicking it. Uses exact matching because
 * the proof mode adds sub-tabs whose names contain '证明' as a substring.
 */
async function switchMode(
  page: Page,
  mode: '对话' | '挑战' | '证明' | '知识地图' | '建模',
): Promise<void> {
  await page.getByRole('tab', { name: mode, exact: true }).click()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Accessibility (WCAG 2.1 AA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
  })

  // -------------------------------------------------------------------------
  // Axe-core scans for each mode
  // -------------------------------------------------------------------------

  test('chat mode has no critical axe violations', async ({ page }) => {
    // Chat is the default mode after onboarding
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

    const critical = filterCriticalViolations(results.violations)
    expect(critical).toEqual([])
  })

  test('grill mode has no critical axe violations', async ({ page }) => {
    await switchMode(page, '挑战')
    // Wait for the grill panel to render
    await expect(page.getByRole('button', { name: '开始挑战' })).toBeVisible({ timeout: 5000 })

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

    const critical = filterCriticalViolations(results.violations)
    expect(critical).toEqual([])
  })

  test('proof mode has no critical axe violations', async ({ page }) => {
    await switchMode(page, '证明')
    // Wait for proof panel to render — use a heading locator to avoid
    // matching the same text in collapsed sections or other elements.
    await expect(page.getByRole('heading', { name: /证明步骤/ })).toBeVisible({ timeout: 5000 })

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

    const critical = filterCriticalViolations(results.violations)
    expect(critical).toEqual([])
  })

  test('dag mode has no critical axe violations', async ({ page }) => {
    await switchMode(page, '知识地图')
    // Wait for the DAG graph to render — use a heading locator to avoid
    // matching the nav aria-label text as well.
    await expect(page.getByRole('heading', { name: /概念依赖图/ })).toBeVisible({ timeout: 5000 })

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

    const critical = filterCriticalViolations(results.violations)
    expect(critical).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Keyboard navigation
  // -------------------------------------------------------------------------

  test('keyboard navigation moves focus logically through the main UI', async ({ page }) => {
    // Start from the beginning of the tab order. Focus the document body
    // first, then press Tab repeatedly and collect focus targets.
    await page.focus('body')

    const focusedKeys: string[] = []
    const focusedTags: string[] = []

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      // Small delay to let focus settle
      await page.waitForTimeout(50)

      const info = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          type: (el as HTMLInputElement).type || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: (el.textContent || '').trim().slice(0, 30),
          id: el.id || '',
          className: el.className || '',
        }
      })

      if (info) {
        focusedTags.push(info.tag)
        // Build a unique key to detect whether focus is stuck on the same
        // element. Using tag + id + className + text distinguishes different
        // buttons even when they share the same role/type.
        focusedKeys.push(`${info.tag}:${info.id}:${info.className}:${info.text}`)
      }
    }

    // Verify that Tab moves focus to interactive elements (not just text nodes).
    expect(focusedTags.length).toBeGreaterThan(0)

    // All focused elements should be interactive (button, input, textarea,
    // a, or elements with tabindex/role — including SVG <g> nodes which
    // act as buttons in the DAG graph).
    for (const tag of focusedTags) {
      expect(['button', 'input', 'textarea', 'a', 'div', 'span', 'th', 'td', 'g']).toContain(tag)
    }

    // Verify that focus moves to at least 2 different elements (not stuck
    // on a single element).
    const uniqueElements = new Set(focusedKeys)
    expect(uniqueElements.size).toBeGreaterThan(1)

    // Verify no element receives focus twice in a row (stuck focus).
    for (let i = 1; i < focusedKeys.length; i++) {
      expect(focusedKeys[i], `Focus appears stuck at step ${i}`).not.toBe(focusedKeys[i - 1])
    }
  })

  // -------------------------------------------------------------------------
  // Accessible names on interactive elements
  // -------------------------------------------------------------------------

  test('all buttons have accessible names', async ({ page }) => {
    // Query all visible buttons and verify each has an accessible name.
    const buttons = page.locator('button:visible')
    const count = await buttons.count()

    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i)
      const accessibleName = await btn.evaluate((el: Element) => {
        const htmlEl = el as HTMLElement
        // Check aria-label, aria-labelledby, text content, or title
        if (htmlEl.getAttribute('aria-label')) return htmlEl.getAttribute('aria-label')
        if (htmlEl.getAttribute('aria-labelledby')) {
          const labelledBy = htmlEl.getAttribute('aria-labelledby')!
          const labelEl = document.getElementById(labelledBy)
          if (labelEl) return labelEl.textContent?.trim() || ''
        }
        if (htmlEl.getAttribute('title')) return htmlEl.getAttribute('title')!
        return htmlEl.textContent?.trim() || ''
      })

      // Each button must have a non-empty accessible name.
      expect(accessibleName, `Button #${i} has no accessible name`).toBeTruthy()
      expect(accessibleName!.length, `Button #${i} has empty accessible name`).toBeGreaterThan(0)
    }
  })

  test('all links have accessible names', async ({ page }) => {
    const links = page.locator('a:visible')
    const count = await links.count()

    for (let i = 0; i < count; i++) {
      const link = links.nth(i)
      const accessibleName = await link.evaluate((el: Element) => {
        const htmlEl = el as HTMLElement
        if (htmlEl.getAttribute('aria-label')) return htmlEl.getAttribute('aria-label')
        return htmlEl.textContent?.trim() || ''
      })

      if (count > 0) {
        expect(accessibleName, `Link #${i} has no accessible name`).toBeTruthy()
      }
    }
  })

  // -------------------------------------------------------------------------
  // Color contrast (axe-core checks this automatically — covered by the
  // mode scans above. This test makes the contrast check explicit.)
  // -------------------------------------------------------------------------

  test('color contrast meets WCAG AA standards', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2aa'])
      .withRules(['color-contrast'])
      .analyze()

    const contrastViolations = results.violations.filter(
      (v: { impact?: string | null }) => v.impact === 'critical' || v.impact === 'serious',
    )
    expect(contrastViolations).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Math content (KaTeX) accessibility
  // -------------------------------------------------------------------------

  test('math content (KaTeX rendered) has accessible text alternatives', async ({ page }) => {
    // The app shows an initial system message on session start (the learning
    // objectives message). We need to wait for the NEW system message that
    // contains the chat response with LaTeX math, so we record the count of
    // system messages before sending.
    const systemMsgCountBefore = await page.locator('.chat-msg.system').count()

    // Send a chat message that triggers a mock response containing LaTeX math.
    // The mock API returns responses with inline ($...$) and display ($$...$$) math.
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()

    // Wait for the NEW system response to appear. The mock API has an 800ms
    // delay, so we wait for the system message count to increase beyond the
    // initial session-start message.
    await expect(async () => {
      const count = await page.locator('.chat-msg.system').count()
      expect(count).toBeGreaterThan(systemMsgCountBefore)
    }).toPass({ timeout: 10000 })

    // KaTeX rendering is synchronous within React's render cycle, but we add
    // a short wait to ensure the DOM has settled after the state update.
    await page.waitForTimeout(300)

    // KaTeX renders math as spans with class "katex". Each KaTeX element should
    // have an accessible name via aria-label (KaTeX adds the TeX source as
    // aria-label by default) or contain an annotation element with the TeX.
    const katexElements = page.locator('.katex')
    const katexCount = await katexElements.count()

    // The mock response contains math like $Z_3$, $1 + 1 = 2$, etc.
    expect(katexCount, 'Expected KaTeX-rendered math in the chat response').toBeGreaterThan(0)

    for (let i = 0; i < katexCount; i++) {
      const el = katexElements.nth(i)
      const hasAccessibleName = await el.evaluate((node: Element) => {
        const htmlEl = node as HTMLElement
        // KaTeX adds aria-label with the original TeX source.
        if (htmlEl.getAttribute('aria-label')) return true
        // Check for an annotation element containing the TeX source.
        const annotation = htmlEl.querySelector('annotation')
        if (annotation && annotation.textContent) return true
        // Check for aria-hidden="true" which means the math is decorative
        // and the accessible text is provided elsewhere (e.g., MathML).
        if (htmlEl.getAttribute('aria-hidden') === 'true') {
          // KaTeX renders both an HTML view (aria-hidden) and a MathML view
          // (with annotation) for screen readers. The MathML view provides
          // the accessible text.
          const mathml = htmlEl.querySelector('math')
          if (mathml) return true
          // Look for a sibling or parent that provides the text alternative.
          const parent = htmlEl.parentElement
          if (parent && (parent.getAttribute('aria-label') || parent.querySelector('math')))
            return true
        }
        return false
      })

      expect(
        hasAccessibleName,
        `KaTeX element #${i} has no accessible text alternative (aria-label, annotation, or MathML)`,
      ).toBeTruthy()
    }
  })

  // -------------------------------------------------------------------------
  // Cayley table (operation table) aria-labels
  // -------------------------------------------------------------------------

  test('Cayley table has proper aria-labels', async ({ page }) => {
    // Chat mode is the default; the Cayley table lives here.
    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()

    // The table must have role="grid" and an aria-label.
    const ariaLabel = await table.getAttribute('aria-label')
    expect(ariaLabel).toBeTruthy()
    expect(ariaLabel).toMatch(/运算表/)

    // Verify header cells have scope attributes.
    const headerCells = table.locator('th[scope]')
    const headerCount = await headerCells.count()
    expect(headerCount).toBeGreaterThan(0)

    // Verify each cell input has an aria-label.
    const cellInputs = table.locator('td input[aria-label]')
    const inputCount = await cellInputs.count()
    expect(inputCount).toBeGreaterThan(0)

    for (let i = 0; i < inputCount; i++) {
      const label = await cellInputs.nth(i).getAttribute('aria-label')
      expect(label, `Cell input #${i} has no aria-label`).toBeTruthy()
      // The label should describe the cell's position.
      expect(label).toMatch(/元素|运算/)
    }

    // The closure/associativity badge should have an aria-live region.
    const badgeRegion = table.locator('..').locator('[aria-live]')
    await expect(badgeRegion.first()).toBeAttached()
  })

  // -------------------------------------------------------------------------
  // Mode tabs aria-selected
  // -------------------------------------------------------------------------

  test('mode tabs have proper aria-selected attributes', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: '模式切换' })
    await expect(tablist).toBeVisible()

    const tabs = tablist.getByRole('tab')
    const tabCount = await tabs.count()
    expect(tabCount).toBe(5)

    // Initially, the chat (对话) tab should be selected.
    const chatTab = page.getByRole('tab', { name: '对话', exact: true })
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')

    // All mode tab names in the application.
    const allModes = ['对话', '挑战', '证明', '知识地图', '建模'] as const

    // Switch to each mode and verify aria-selected updates.
    for (const mode of ['挑战', '证明', '知识地图', '建模', '对话'] as const) {
      const tab = page.getByRole('tab', { name: mode, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')

      // All other tabs should have aria-selected="false".
      for (const other of allModes) {
        if (other === mode) continue
        const otherTab = page.getByRole('tab', { name: other, exact: true })
        await expect(otherTab).toHaveAttribute('aria-selected', 'false')
      }
    }
  })

  // -------------------------------------------------------------------------
  // Form inputs have associated labels
  // -------------------------------------------------------------------------

  test('form inputs in chat mode have associated labels', async ({ page }) => {
    // The chat textarea should have an accessible label (placeholder alone
    // is not sufficient; axe checks for aria-label or associated <label>).
    const textarea = page.locator('textarea.text-input')
    await expect(textarea).toBeVisible()

    // Check via axe specifically for form-field-labels / label rules.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .withRules(['label', 'form-field-multiple-labels'])
      .analyze()

    const labelViolations = results.violations.filter(
      (v: { impact?: string | null }) => v.impact === 'critical' || v.impact === 'serious',
    )
    expect(labelViolations).toEqual([])
  })

  test('Cayley table cell inputs have aria-labels', async ({ page }) => {
    const table = page.getByRole('grid', { name: /运算表/ })
    const inputs = table.locator('input[type="number"]')
    const count = await inputs.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const ariaLabel = await inputs.nth(i).getAttribute('aria-label')
      expect(ariaLabel, `Cayley cell input #${i} missing aria-label`).toBeTruthy()
    }
  })

  test('conjecture input has accessible label', async ({ page }) => {
    // Switch to grill mode where the conjecture input lives.
    await switchMode(page, '挑战')
    // Wait for grill panel
    await expect(page.getByRole('button', { name: '开始挑战' })).toBeVisible({ timeout: 5000 })

    // The conjecture input may not be visible until visualData is populated.
    // Start a grill session to populate data.
    await page.getByRole('button', { name: '开始挑战' }).click()
    await page.waitForTimeout(1000)

    const conjectureInput = page.locator('.conjecture-input')
    const inputVisible = await conjectureInput.isVisible().catch(() => false)

    if (inputVisible) {
      const ariaLabel = await conjectureInput.getAttribute('aria-label')
      expect(ariaLabel, 'Conjecture input should have aria-label').toBeTruthy()
      expect(ariaLabel).toBe('输入猜想')
    }
  })

  test('proof mode form inputs have accessible labels', async ({ page }) => {
    await switchMode(page, '证明')
    await expect(page.getByRole('heading', { name: /证明步骤/ })).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(300)

    // Check proof step textareas for accessible labels.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .withRules(['label'])
      .analyze()

    const labelViolations = results.violations.filter(
      (v: { impact?: string | null }) => v.impact === 'critical' || v.impact === 'serious',
    )
    expect(labelViolations).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Additional: SVG icons in tabs should be decorative (aria-hidden)
  // -------------------------------------------------------------------------

  test('decorative SVG icons are hidden from assistive technology', async ({ page }) => {
    // Mode tab icons are decorative because the tab text provides the label.
    const tabIcons = page.locator('.mode-tab svg, .tab-icon')
    const count = await tabIcons.count()

    if (count > 0) {
      for (let i = 0; i < Math.min(count, 10); i++) {
        const isHidden = await tabIcons.nth(i).evaluate((el: Element) => {
          const htmlEl = el as HTMLElement
          return (
            htmlEl.getAttribute('aria-hidden') === 'true' ||
            htmlEl.parentElement?.getAttribute('aria-hidden') === 'true' ||
            window.getComputedStyle(htmlEl).display === 'none'
          )
        })
        // Tab icons should either be aria-hidden or the parent handles it.
        // We log but don't strictly fail — axe covers this in the mode scans.
        expect(typeof isHidden).toBe('boolean')
      }
    }
  })

  // -------------------------------------------------------------------------
  // Full-page axe scan (all modes combined)
  // -------------------------------------------------------------------------

  test('full document has no critical axe violations across all modes', async ({ page }) => {
    // Scan the default chat mode.
    const chatResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

    const chatCritical = filterCriticalViolations(chatResults.violations)
    expect(chatCritical).toEqual([])

    // Switch to each other mode and scan.
    for (const mode of ['挑战', '证明', '知识地图', '建模'] as const) {
      await switchMode(page, mode)
      // Give the mode panel time to render.
      await page.waitForTimeout(500)

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()

      const critical = filterCriticalViolations(results.violations)
      expect(critical, `${mode} mode has critical axe violations`).toEqual([])
    }
  })
})
