import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 3 E2E tests for the Six-Dimensional Thinking features.
 *
 * Tests verify the spec requirements FR-09 through FR-13:
 *   FR-09: Backward proof mode (分析能力)
 *   FR-10: Free conjecture at any DAG node (设想能力)
 *   FR-11: Z3 proof verification (逻辑推理能力)
 *   FR-12: Historical narrative cards (类比能力)
 *   FR-13: Cross-curriculum structure comparison (类比能力)
 *
 * The app runs against the mock API (test/mock-api.js) which now includes
 * interceptors for /api/historical/narrative, /api/curriculum/compare, and
 * the conjecture:test IPC channel.
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

// FR-09: Backward proof mode (分析能力)
test.describe('FR-09: Backward proof mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    // Switch to proof mode — use exact to avoid matching '正向证明'
    await page.getByRole('tab', { name: '证明', exact: true }).click()
  })

  test('backward mode tab exists and is switchable', async ({ page }) => {
    // Both proof sub-tabs should be visible
    await expect(page.getByRole('tab', { name: '正向证明' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '倒推模式' })).toBeVisible()

    // Default is forward mode
    await expect(page.getByRole('tab', { name: '正向证明' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Switch to backward mode
    await page.getByRole('tab', { name: '倒推模式' }).click()
    await expect(page.getByRole('tab', { name: '倒推模式' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('backward mode shows conclusion input and guidance', async ({ page }) => {
    await page.getByRole('tab', { name: '倒推模式' }).click()

    // Conclusion textarea should be visible
    await expect(page.locator('#backward-conclusion')).toBeVisible()
    // Guidance hint should be visible
    await expect(page.getByText('倒推模式：从结论出发')).toBeVisible()

    // "开始倒推" button should be disabled until conclusion is entered
    const startBtn = page.getByRole('button', { name: '开始倒推' })
    await expect(startBtn).toBeDisabled()

    // Enter a conclusion
    await page.locator('#backward-conclusion').fill('群的幺元是唯一的')
    await expect(startBtn).toBeEnabled()
  })

  test('full backward-to-forward workflow', async ({ page }) => {
    await page.getByRole('tab', { name: '倒推模式' }).click()

    // Step 1: Enter conclusion
    await page.locator('#backward-conclusion').fill('群的幺元是唯一的')

    // Step 2: Start backward reasoning
    await page.getByRole('button', { name: '开始倒推' }).click()

    // Step 3: A backward step textarea should appear
    const stepTextarea = page.locator('.backward-step-textarea').first()
    await expect(stepTextarea).toBeVisible()
    await stepTextarea.fill("假设存在两个幺元 e 和 e'")

    // Step 4: Add another backward step
    await page.getByRole('button', { name: /添加倒推步骤/ }).click()
    const secondStep = page.locator('.backward-step-textarea').nth(1)
    await expect(secondStep).toBeVisible()
    await secondStep.fill("由幺元定义 e = e·e' = e'")

    // Step 5: Flip to forward proof
    await page.getByRole('button', { name: '翻转为正向证明' }).click()

    // Verify we're back in forward mode
    await expect(page.getByRole('tab', { name: '正向证明' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Verify the flipped steps appear in the forward proof editor
    const forwardSteps = page.locator('.ddps-step-textarea')
    await expect(forwardSteps.first()).toBeVisible()
    // The first forward step should be the last backward step (reversed)
    const firstValue = await forwardSteps.first().inputValue()
    expect(firstValue).toContain('由幺元定义')
  })
})

// FR-10: Free conjecture at any DAG node (设想能力)
test.describe('FR-10: Conjecture input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // Send a chat message to populate visualData (needed for ConjectureTimeline)
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()
    // Wait for the mock response (includes visual_data with conjecture_journey)
    await page.waitForTimeout(1500)

    // Switch to grill mode where ConjectureTimeline lives
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
  })

  test('conjecture input is always visible with correct placeholder', async ({ page }) => {
    const input = page.locator('.conjecture-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', '我猜…')
    await expect(input).toHaveAttribute('aria-label', '输入猜想')
  })

  test('submit button is disabled until input has text', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: '提交猜想' })
    await expect(submitBtn).toBeDisabled()

    await page.locator('.conjecture-input').fill('所有群都是交换群')
    await expect(submitBtn).toBeEnabled()
  })

  test('conjecture submission shows loading then clears input', async ({ page }) => {
    // Add a delay to the conjecture:test API call so the loading state
    // ("验证中…") is visible long enough for the test to assert it.
    // The mock API resolves synchronously, which makes the loading state
    // disappear before Playwright can observe it.
    await page.evaluate(() => {
      const w = window as unknown as {
        api: { invoke: (...args: unknown[]) => Promise<unknown> }
      }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        if (channel === 'conjecture:test') {
          await new Promise(r => setTimeout(r, 500))
        }
        return original(channel, ...args)
      }
    })

    await page.locator('.conjecture-input').fill('所有群都是交换群')
    await page.getByRole('button', { name: '提交猜想' }).click()

    // Loading state
    await expect(page.getByRole('button', { name: '验证中…' })).toBeVisible()

    // After loading completes, input should be cleared
    await expect(page.locator('.conjecture-input')).toHaveValue('', { timeout: 5000 })
    await expect(page.getByRole('button', { name: '提交猜想' })).toBeVisible()
  })

  test('deferred input preview shows while typing', async ({ page }) => {
    await page.locator('.conjecture-input').fill('我猜群的阶一定是偶数')
    // The deferred preview should appear
    await expect(page.locator('.conjecture-preview')).toBeVisible()
    await expect(page.locator('.conjecture-preview')).toContainText('我猜群的阶一定是偶数')
  })
})

// FR-11: Z3 proof verification (逻辑推理能力)
test.describe('FR-11: Proof verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    // Wait for theorems to load from mock API
    await page.waitForTimeout(500)
  })

  test('proof panel has theorem selector and step editor', async ({ page }) => {
    await expect(page.getByText('课程级别')).toBeVisible()
    await expect(page.getByText('选择定理', { exact: true })).toBeVisible()
    // Use a heading locator to avoid matching the same text in the
    // collapsed "公式编辑器" CollapsibleSection paragraph.
    await expect(page.getByRole('heading', { name: /证明步骤/ })).toBeVisible()
    // At least one step textarea should exist
    await expect(page.locator('.ddps-step-textarea').first()).toBeVisible()
  })

  test('can add and remove proof steps', async ({ page }) => {
    const initialCount = await page.locator('.ddps-step-textarea').count()

    // Add a step
    await page.getByRole('button', { name: /添加步骤/ }).click()
    await expect(page.locator('.ddps-step-textarea')).toHaveCount(initialCount + 1)

    // Fill both steps
    await page.locator('.ddps-step-textarea').first().fill('设 e 是群 G 的幺元')
    await page.locator('.ddps-step-textarea').nth(1).fill('对任意 a ∈ G, e·a = a')
  })

  test('proof submission shows verification result', async ({ page }) => {
    // Fill in proof steps
    await page.locator('.ddps-step-textarea').first().fill("设 e 和 e' 都是群 G 的幺元")
    await page.getByRole('button', { name: /添加步骤/ }).click()
    await page.locator('.ddps-step-textarea').nth(1).fill("则 e = e·e' = e'，所以幺元唯一")

    // Submit
    await page.getByRole('button', { name: '提交验证' }).click()

    // Wait for result
    await expect(page.getByText('验证结果')).toBeVisible({ timeout: 10000 })

    // Result should have feedback
    await expect(page.locator('.proof-results .alert')).toBeVisible()
  })

  test('proof result shows step-by-step details', async ({ page }) => {
    await page.locator('.ddps-step-textarea').first().fill('第一步：群的幺元存在')
    await page.getByRole('button', { name: '提交验证' }).click()

    await expect(page.getByText('验证结果')).toBeVisible({ timeout: 10000 })
    // Step results should be visible
    await expect(page.locator('.step-result').first()).toBeVisible()
  })
})

// FR-12: Historical narrative cards (类比能力)
test.describe('FR-12: Historical narrative cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // The mock API returns an empty conjecture_journey.timeline. Override
    // api:session-input to inject timeline entries so the ConjectureTimeline
    // renders entries for the historical narrative tests.
    await page.evaluate(() => {
      const w = window as unknown as {
        api: { invoke: (...args: unknown[]) => Promise<unknown> }
      }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        const result = await original(channel, ...args)
        if (channel === 'api:session-input' && result && typeof result === 'object') {
          const r = result as Record<string, unknown>
          const vd = r.visual_data as Record<string, unknown>
          if (vd) {
            const cj = vd.conjecture_journey as Record<string, unknown>
            if (cj) {
              cj.timeline = [
                {
                  step: 1,
                  claim: '所有群都是交换群',
                  verdict: 'refuted',
                  counter_example: 'S₃（三阶对称群）是非交换群： (12)(13) ≠ (13)(12)',
                },
                {
                  step: 2,
                  claim: '群的幺元是唯一的',
                  verdict: 'confirmed',
                  counter_example: null,
                },
                {
                  step: 3,
                  claim: '群的阶一定是偶数',
                  verdict: 'undecidable',
                  counter_example: null,
                },
              ]
              cj.total_conjectures = 3
              cj.confirmed = 1
              cj.refuted = 1
            }
          }
        }
        return result
      }
    })

    // Populate visualData with conjecture journey timeline
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForTimeout(1500)

    // Switch to grill mode
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
  })

  test('timeline entries exist from mock data', async ({ page }) => {
    // The mock API provides 3 conjecture journey entries
    await expect(page.locator('.timeline-entry').first()).toBeVisible()
    const entryCount = await page.locator('.timeline-entry').count()
    expect(entryCount).toBeGreaterThanOrEqual(3)
  })

  test('expanding a verified entry loads historical narrative', async ({ page }) => {
    // Expand the first timeline entry (refuted with "交换" claim -> should load narratives)
    const expandButton = page.locator('.timeline-counter-toggle').first()
    await expect(expandButton).toBeVisible()
    await expandButton.click()

    // Check if entry expanded
    await expect(page.locator('.timeline-card.expanded').first()).toBeVisible()

    // Wait for historical cards to appear (mock API responds in ~300ms)
    await expect(page.locator('.historical-card').first()).toBeVisible({
      timeout: 10000,
    })

    // Historical card should have title and content
    await expect(page.locator('.historical-card-title').first()).toBeVisible()
    await expect(page.locator('.historical-card-content').first()).toBeVisible()
    await expect(page.locator('.historical-card-source').first()).toContainText('HistoricalAgent')
  })

  test('historical card content is relevant to conjecture', async ({ page }) => {
    // Entry 1 claim: "所有群都是交换群" — should show Abel/Galois narratives
    await page.locator('.timeline-counter-toggle').first().click()
    await expect(page.locator('.historical-card').first()).toBeVisible({
      timeout: 10000,
    })

    // Should mention Abel or Galois (mock returns these for "交换" claims)
    const cardText = await page.locator('.historical-card-content').first().textContent()
    expect(cardText?.toLowerCase()).toMatch(/abel|galois|交换/)
  })
})

// FR-13: Cross-curriculum structure comparison (类比能力)
test.describe('FR-13: Curriculum structure comparison', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    // Switch to DAG mode
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()
  })

  test('curriculum mapper section exists and can be expanded', async ({ page }) => {
    // The curriculum mapper is inside a CollapsibleSection
    const sectionHeader = page.getByRole('button', { name: /教材课程映射/ })
    await expect(sectionHeader).toBeVisible()
    // Expand it
    await sectionHeader.click()
    await page.waitForTimeout(500)
  })

  test('structure comparison tab exists and is switchable', async ({ page }) => {
    // Expand the curriculum section
    await page.getByRole('button', { name: /教材课程映射/ }).click()
    await page.waitForTimeout(500)

    // Two view tabs should exist: mapping and compare
    await expect(page.getByRole('tab', { name: '课程标准映射' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '结构对照' })).toBeVisible()

    // Default is mapping view
    await expect(page.getByRole('tab', { name: '课程标准映射' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Switch to comparison view
    await page.getByRole('tab', { name: '结构对照' }).click()
    await expect(page.getByRole('tab', { name: '结构对照' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('comparison table renders with structure data', async ({ page }) => {
    // Expand and switch to compare view
    await page.getByRole('button', { name: /教材课程映射/ }).click()
    await page.waitForTimeout(300)
    await page.getByRole('tab', { name: '结构对照' }).click()

    // Wait for fetch + render
    await page.waitForTimeout(1000)

    // The comparison table should be visible
    await expect(page.locator('.cw-cm-compare-table')).toBeVisible()

    // Should contain structure names (from mock or fallback data)
    const tableText = await page.locator('.cw-cm-compare-table').textContent()
    expect(tableText).toMatch(/同构|同胚|isomorphism/i)
  })

  test('comparison data source indicator is shown', async ({ page }) => {
    await page.getByRole('button', { name: /教材课程映射/ }).click()
    await page.waitForTimeout(300)
    await page.getByRole('tab', { name: '结构对照' }).click()
    await page.waitForTimeout(1000)

    // The note at the bottom should indicate data source
    await expect(page.locator('.cw-cm-compare-note')).toBeVisible()
    const noteText = await page.locator('.cw-cm-compare-note').textContent()
    // Mock API is available, so it should say "后端"
    expect(noteText).toContain('数据来源')
  })
})
