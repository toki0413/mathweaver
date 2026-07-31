import { test, expect, type Page } from '@playwright/test'

/**
 * Error Handling & Resilience E2E Tests
 *
 * These tests verify that MathWeaver gracefully handles adverse conditions:
 * - Network failures (fetch rejection)
 * - API timeouts (delayed responses)
 * - Malformed data (invalid types / broken JSON)
 * - Empty state (null visualData)
 * - Component errors (ErrorBoundary recovery UI)
 * - IPC failures (window.api.invoke rejection)
 * - Concurrent operations (rapid button clicks)
 * - Session recovery (navigation after errors)
 *
 * Error injection uses page.evaluate() to override window.api.invoke (the
 * Electron IPC bridge mocked by test/mock-api.js) and page.route() to
 * intercept network-level requests.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss the first-run onboarding dialog by stepping through all four
 * steps and clicking "开始探索".
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Error Handling & Resilience', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
  })

  // -------------------------------------------------------------------------
  // Network failure
  // -------------------------------------------------------------------------

  test('network failure shows error UI instead of white screen', async ({ page }) => {
    // Override window.fetch to reject all requests, simulating a total
    // network outage. The mock API's fetch interceptors (for historical
    // narrative, curriculum comparison, etc.) are replaced by this override.
    await page.evaluate(() => {
      window.fetch = async () => {
        throw new Error('Network failure: connection refused')
      }
    })

    // The app should still render — not a white screen.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
    await expect(page.getByRole('tablist', { name: '模式切换' })).toBeVisible()

    // Switch to DAG mode and expand the curriculum mapper section, which
    // uses fetch for the structure comparison endpoint.
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()
    await page.getByRole('button', { name: /教材课程映射/ }).click()
    await page.waitForTimeout(500)

    // The CurriculumMapper should show fallback data (it has built-in
    // fallback when the backend is unreachable).
    await expect(page.locator('.cw-cm-root')).toBeVisible({ timeout: 5000 })

    // Switch to the structure comparison tab (triggers a fetch that fails).
    const compareTab = page.getByRole('tab', { name: '结构对照' })
    if (await compareTab.isVisible().catch(() => false)) {
      await compareTab.click()
      await page.waitForTimeout(500)
    }

    // The app must still be visible and functional — not crashed.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // API timeout
  // -------------------------------------------------------------------------

  test('API timeout shows loading state and does not freeze', async ({ page }) => {
    // Override window.api.invoke to add a 15-second delay for chat input,
    // simulating a backend that is slow to respond.
    await page.evaluate(() => {
      const w = window as unknown as { api: { invoke: (...args: unknown[]) => Promise<unknown> } }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        if (channel === 'api:session-input') {
          // Delay for 15 seconds — longer than any reasonable timeout.
          await new Promise(r => setTimeout(r, 15000))
        }
        return original(channel, ...args)
      }
    })

    // Send a chat message to trigger the delayed API call.
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()

    // The loading state should appear immediately — the send button
    // becomes disabled.
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled({ timeout: 3000 })

    // The app should still be responsive (not frozen) while waiting.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // The user can still switch modes while waiting for the response.
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    await expect(page.getByRole('tab', { name: '证明', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Switch back to chat mode.
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  // -------------------------------------------------------------------------
  // Malformed data
  // -------------------------------------------------------------------------

  test('malformed API response does not crash the app', async ({ page }) => {
    // Override window.api.invoke to return a string instead of an object
    // for the session-input channel, simulating corrupted IPC data.
    await page.evaluate(() => {
      const w = window as unknown as { api: { invoke: (...args: unknown[]) => Promise<unknown> } }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        if (channel === 'api:session-input') {
          // Return malformed data: a string instead of the expected object.
          return 'this is not a valid response object'
        }
        return original(channel, ...args)
      }
    })

    // Send a chat message.
    await page.locator('textarea.text-input').fill('test')
    await page.getByRole('button', { name: '发送' }).click()

    // Wait for the store to process the malformed response.
    await page.waitForTimeout(1500)

    // The app should still render — the store's try/catch and defensive
    // accessors (response?.content, data.phase || 'idle') prevent crashes.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
    await expect(page.getByRole('tablist', { name: '模式切换' })).toBeVisible()

    // The loading state should have cleared. The send button may remain
    // disabled because the input was cleared after sending — so we refill
    // the input and verify the button becomes enabled.
    await page.locator('textarea.text-input').fill('another test')
    await expect(page.getByRole('button', { name: '发送' })).toBeEnabled({ timeout: 5000 })
  })

  test('malformed historical narrative data does not crash', async ({ page }) => {
    // Override window.fetch to return invalid JSON for the historical
    // narrative endpoint.
    await page.evaluate(() => {
      window.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : (input as Request).url || ''
        if (url.includes('/api/historical/narrative')) {
          // Return a 200 with invalid JSON body.
          return new Response('{{{invalid json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        // For other URLs, throw to simulate network failure.
        throw new Error('Network error')
      }) as typeof window.fetch
    })

    // Send a chat message to populate visualData (needed for ConjectureTimeline).
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForTimeout(1500)

    // Switch to grill mode where the ConjectureTimeline lives.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await page.waitForTimeout(500)

    // Wait for the lazy-loaded GrillPanel to render (it may show a
    // Suspense fallback briefly while the chunk is fetched), then start
    // a grill session to populate data.
    const startBtn = page.getByRole('button', { name: '开始面试' })
    await startBtn.waitFor({ state: 'visible', timeout: 10000 })
    await startBtn.click()
    await page.waitForTimeout(1000)

    // Try expanding a timeline entry (triggers the historical narrative fetch).
    const expandBtn = page.locator('.timeline-counter-toggle').first()
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click()
      await page.waitForTimeout(1000)
    }

    // The app should not crash — ConjectureTimeline catches fetch errors.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  test('empty state renders without crashing when visualData is null', async ({ page }) => {
    // Override window.api.invoke to return null for visual_data.
    await page.evaluate(() => {
      const w = window as unknown as { api: { invoke: (...args: unknown[]) => Promise<unknown> } }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        const result = await original(channel, ...args)
        if (channel === 'api:session-input' && result && typeof result === 'object') {
          ;(result as Record<string, unknown>).visual_data = null
        }
        return result
      }
    })

    // Send a chat message.
    await page.locator('textarea.text-input').fill('test')
    await page.getByRole('button', { name: '发送' }).click()

    // Wait for the response to be processed.
    await page.waitForTimeout(1500)

    // The app should render without the gauges (which are conditionally
    // rendered when visualData?.four_field_gauges is truthy).
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // The cognitive dashboard should NOT be visible (visualData is null).
    await expect(page.getByText('认知仪表盘')).not.toBeVisible()

    // But the Cayley table and chat should still work.
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()

    // The chat message should have been added (user message visible).
    await expect(page.locator('.chat-msg').first()).toBeVisible({ timeout: 5000 })
  })

  // -------------------------------------------------------------------------
  // Error boundary
  // -------------------------------------------------------------------------

  test('error boundary shows recovery UI when a component throws during render', async ({
    page,
  }) => {
    // Override window.api.invoke to return visual_data with a throwing
    // getter. When the RadialGauge component tries to read
    // visualData.four_field_gauges.cognitive_load during render, the getter
    // throws, which the ErrorBoundary catches.
    await page.evaluate(() => {
      const w = window as unknown as { api: { invoke: (...args: unknown[]) => Promise<unknown> } }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        const result = await original(channel, ...args)
        if (channel === 'api:session-input' && result && typeof result === 'object') {
          const r = result as Record<string, unknown>
          r.visual_data = {
            four_field_gauges: {
              // Accessing cognitive_load during render throws an error,
              // which React's ErrorBoundary will catch.
              get cognitive_load(): number {
                throw new Error('Simulated component render crash')
              },
              cognitive_state: 'error',
              anxiety_index: 0,
              flow_score: 0,
              hint_dependency: 0,
            },
          }
        }
        return result
      }
    })

    // Send a chat message to trigger the corrupted response and re-render.
    await page.locator('textarea.text-input').fill('test')
    await page.getByRole('button', { name: '发送' }).click()

    // The ErrorBoundary should catch the render error and show its
    // recovery UI with the title "应用遇到了问题".
    await expect(page.getByText('应用遇到了问题')).toBeVisible({ timeout: 5000 })

    // The recovery message should be displayed.
    await expect(page.getByText(/MathWeaver 遇到了一个意外错误/)).toBeVisible()

    // Recovery buttons should be present and clickable.
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()

    // The error details toggle should be available.
    await expect(page.getByText(/显示错误详情/)).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // IPC failure
  // -------------------------------------------------------------------------

  test('IPC failure for session input shows error banner', async ({ page }) => {
    // Override window.api.invoke to reject for the session-input channel,
    // simulating an IPC channel failure.
    await page.evaluate(() => {
      const w = window as unknown as { api: { invoke: (...args: unknown[]) => Promise<unknown> } }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        if (channel === 'api:session-input') {
          throw new Error('IPC channel closed unexpectedly')
        }
        return original(channel, ...args)
      }
    })

    // Send a chat message — this triggers api:session-input.
    await page.locator('textarea.text-input').fill('test')
    await page.getByRole('button', { name: '发送' }).click()

    // The store catches the IPC error and sets the error state, which
    // renders the ErrorBanner with role="alert".
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 })

    // The error banner should display a headline.
    const banner = page.locator('.error-banner')
    await expect(banner).toBeVisible()

    // The app should still render (not a white screen).
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
  })

  test('IPC failure for grill mode shows error banner', async ({ page }) => {
    // Override window.api.invoke to reject for grill-start.
    await page.evaluate(() => {
      const w = window as unknown as { api: { invoke: (...args: unknown[]) => Promise<unknown> } }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        if (channel === 'api:grill-start') {
          throw new Error('Grill IPC channel error')
        }
        return original(channel, ...args)
      }
    })

    // Switch to grill mode.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()

    // Wait for the lazy-loaded GrillPanel to render (it may show a
    // Suspense fallback briefly while the chunk is fetched).
    const startBtn = page.getByRole('button', { name: '开始面试' })
    await startBtn.waitFor({ state: 'visible', timeout: 10000 })
    await startBtn.click()

    // The error banner should appear.
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 })

    // The app should still render.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Concurrent operations
  // -------------------------------------------------------------------------

  test('concurrent rapid clicks do not cause race conditions', async ({ page }) => {
    // The table submit button is a good candidate: it doesn't clear its
    // input (the Cayley table persists), so rapid clicks are possible.
    const submitBtn = page.getByRole('button', { name: '提交' })
    await expect(submitBtn).toBeVisible()

    // Click the submit button once.
    await submitBtn.click()

    // The button should immediately enter a loading state (disabled,
    // text changes to "验证中").
    await expect(page.getByRole('button', { name: '验证中' })).toBeVisible({ timeout: 2000 })

    // Attempt rapid clicks while loading — these should be no-ops because
    // the button is disabled.
    for (let i = 0; i < 5; i++) {
      // Use evaluate to dispatch click events directly (bypasses Playwright's
      // actionability checks on the disabled button).
      await page.evaluate(() => {
        const btn = document.querySelector('button.btn-primary')
        if (btn && !btn.hasAttribute('disabled')) {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      })
      await page.waitForTimeout(50)
    }

    // Wait for the loading state to clear.
    await expect(page.getByRole('button', { name: '提交' })).toBeVisible({ timeout: 10000 })

    // The app should still be functional.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // The submit button should be enabled again.
    await expect(page.getByRole('button', { name: '提交' })).toBeEnabled()
  })

  test('rapid chat message sends are prevented by disabled state', async ({ page }) => {
    const textInput = page.locator('textarea.text-input')
    const sendBtn = page.getByRole('button', { name: '发送' })

    // Fill input and send.
    await textInput.fill('first message')
    await sendBtn.click()

    // The send button should be disabled during loading.
    await expect(sendBtn).toBeDisabled({ timeout: 2000 })

    // The input should be cleared after sending.
    await expect(textInput).toHaveValue('')

    // Wait for loading to complete. The send button may stay disabled
    // because the input is empty — so we refill it and check it becomes
    // enabled, confirming loading has finished.
    await textInput.fill('check ready')
    await expect(sendBtn).toBeEnabled({ timeout: 10000 })

    // Verify only one user message was sent (no duplicates from race conditions).
    const userMessages = await page.locator('.chat-message-user, .chat-message .role-user').count()
    // There should be at most 1 user message (the one we sent).
    expect(userMessages).toBeLessThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // Session recovery
  // -------------------------------------------------------------------------

  test('user can navigate and interact after an error', async ({ page }) => {
    // Set up a one-time failure: the first session-input call fails,
    // subsequent calls succeed.
    await page.evaluate(() => {
      const w = window as unknown as {
        __failOnce: boolean
        api: { invoke: (...args: unknown[]) => Promise<unknown> }
      }
      w.__failOnce = true
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        if (channel === 'api:session-input' && w.__failOnce) {
          w.__failOnce = false
          throw new Error('One-time IPC failure')
        }
        return original(channel, ...args)
      }
    })

    // Send a message that triggers the one-time failure.
    await page.locator('textarea.text-input').fill('test')
    await page.getByRole('button', { name: '发送' }).click()

    // The error banner should appear.
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 })

    // Close the error banner manually (it also auto-dismisses after 5s).
    const closeBtn = page.getByRole('button', { name: '关闭错误提示' })
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
    }
    await expect(page.locator('[role="alert"]')).not.toBeVisible()

    // The user should still be able to switch to proof mode.
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    await expect(page.getByRole('tab', { name: '证明', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Switch back to chat mode.
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Send another message — this time it should succeed.
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()

    // Wait for the response.
    await page.waitForTimeout(2000)

    // The app should be fully functional.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // The Cayley table should still be interactive.
    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()

    // No error banner should be visible after successful recovery.
    await expect(page.locator('.error-banner')).not.toBeVisible()
  })

  test('user can switch modes after DAG fetch failure', async ({ page }) => {
    // Override window.api.invoke to reject for the DAG fetch channel.
    await page.evaluate(() => {
      const w = window as unknown as { api: { invoke: (...args: unknown[]) => Promise<unknown> } }
      const original = w.api.invoke
      w.api.invoke = async (channel: string, ...args: unknown[]) => {
        if (channel === 'api:dag') {
          throw new Error('DAG fetch failed')
        }
        return original(channel, ...args)
      }
    })

    // The app should still render even if DAG fetch fails.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // Switch to DAG mode — the concept graph area should render (possibly empty).
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()
    await expect(page.getByRole('tab', { name: '知识地图', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // The app header should still be visible.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // Switch back to chat mode.
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // The Cayley table should be visible and functional.
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Graceful degradation
  // -------------------------------------------------------------------------

  test('app renders initial state without any chat messages', async ({ page }) => {
    // The app should render with an empty chat and no visualData.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // The Cayley table should be visible (it has default data).
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()

    // The empty-state message for collaboration flow should be visible
    // after expanding the collapsed "协作流程" section.
    const collabHeader = page.getByRole('button', { name: /协作流程/ })
    await collabHeader.click()
    await expect(page.getByText(/提交运算表后显示智能体协作流程/)).toBeVisible()

    // The cognitive dashboard should not be visible (no visualData yet).
    await expect(page.getByText('认知仪表盘')).not.toBeVisible()

    // The send button should be disabled (empty input).
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  test('app handles concurrent mode switches without errors', async ({ page }) => {
    // Rapidly switch between all four modes.
    const modes = ['挑战', '证明', '知识地图', '对话', '挑战', '证明', '知识地图', '对话'] as const

    for (const mode of modes) {
      await page.getByRole('tab', { name: mode, exact: true }).click()
      // Small delay to let the mode render.
      await page.waitForTimeout(100)
    }

    // The app should still be functional after rapid switching.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // The currently selected mode should be 对话 (the last one clicked).
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // The Cayley table should be visible in chat mode.
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()
  })
})
