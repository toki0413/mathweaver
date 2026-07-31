import { test, expect, type Page } from '@playwright/test'

/**
 * Performance & Load E2E Tests
 *
 * Measures page-load metrics (TTFB, FCP), time-to-interactive, JS bundle
 * size, render performance with 100+ DAG nodes, interaction responsiveness,
 * memory-usage stability, and concurrent-rendering jank.
 *
 * The app is served at /test/ by vite.test.config.ts, with test/mock-api.js
 * injecting window.api. The first-run onboarding overlay must be dismissed
 * before interacting with the main UI.
 *
 * Performance APIs used:
 *   - performance.getEntriesByType('navigation')  → Navigation Timing
 *   - performance.getEntriesByType('paint')       → FCP, paint metrics
 *   - performance.now()                           → high-res timestamps
 *   - (performance as any).memory                 → Chromium heap snapshot
 *   - page.metrics().JSHeapUsedSize               → Playwright/CDP heap
 *
 * NOTE: The Vite dev server serves modules individually (no production
 * bundling), so JS "bundle size" is measured as the aggregate of all JS
 * responses plus per-module checks.
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

/**
 * Switch to a specific mode tab by clicking it. Uses exact matching because
 * the proof mode adds sub-tabs whose names contain '证明' as a substring.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- helper for future test cases
async function switchMode(page: Page, mode: '对话' | '挑战' | '证明' | '知识地图'): Promise<void> {
  await page.getByRole('tab', { name: mode, exact: true }).click()
}

/**
 * Get the used JS heap size in bytes via the Chromium-only
 * `performance.memory` API.  Playwright >= 1.50 removed the
 * `page.metrics()` method, so we use `page.evaluate()` instead.
 * Returns 0 if the API is unavailable (non-Chromium browsers).
 */
async function getUsedHeapSize(page: Page): Promise<number> {
  return page.evaluate(() => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return mem ? mem.usedJSHeapSize : 0
  })
}

// ---------------------------------------------------------------------------
// Tests — Page Load Metrics
// ---------------------------------------------------------------------------

test.describe('Performance — Page Load', () => {
  test('page loads within 3 seconds', async ({ page }) => {
    const start = Date.now()
    await page.goto('/test/')
    await page.waitForLoadState('networkidle')
    const loadTime = Date.now() - start

    // The mock API has artificial delays (~200ms per invoke), so 3s is a
    // generous upper bound for the full init sequence (health check, DAG
    // fetch, onboarding check, session start).
    expect(loadTime).toBeLessThan(3000)
  })

  test('TTFB and FCP are within acceptable range', async ({ page }) => {
    await page.goto('/test/')
    await page.waitForLoadState('networkidle')

    const metrics = await page.evaluate(() => {
      const navEntries = performance.getEntriesByType('navigation')
      const nav = navEntries[0] as PerformanceNavigationTiming | undefined
      const paintEntries = performance.getEntriesByType('paint')
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint')

      return {
        ttfb: nav ? nav.responseStart - nav.requestStart : -1,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : -1,
        loadEventEnd: nav ? nav.loadEventEnd - nav.startTime : -1,
        fcp: fcp ? fcp.startTime : -1,
        transferSize: nav ? nav.transferSize : -1,
      }
    })

    // TTFB should be fast — the Vite dev server responds immediately.
    expect(metrics.ttfb).toBeGreaterThanOrEqual(0)
    expect(metrics.ttfb).toBeLessThan(1000)

    // First Contentful Paint should happen well within 2 seconds.
    expect(metrics.fcp).toBeGreaterThanOrEqual(0)
    expect(metrics.fcp).toBeLessThan(2000)

    // DOM Content Loaded should also be under 2 seconds.
    expect(metrics.domContentLoaded).toBeLessThan(2000)
  })

  test('navigation timing entry is available', async ({ page }) => {
    await page.goto('/test/')
    await page.waitForLoadState('domcontentloaded')

    const navData = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation')
      if (entries.length === 0) return null
      const nav = entries[0] as PerformanceNavigationTiming
      return {
        type: nav.type,
        name: nav.name,
        redirectCount: nav.redirectCount,
        duration: nav.duration,
      }
    })

    expect(navData).not.toBeNull()
    expect(navData!.name).toContain('/test/')
    // The navigation duration should be reasonable.
    expect(navData!.duration).toBeLessThan(5000)
  })
})

// ---------------------------------------------------------------------------
// Tests — Time to Interactive
// ---------------------------------------------------------------------------

test.describe('Performance — Time to Interactive', () => {
  test('first mode tab is clickable shortly after load', async ({ page }) => {
    const start = Date.now()
    await page.goto('/test/')

    // Wait for the mode tablist to become visible.
    const tablist = page.getByRole('tablist', { name: '模式切换' })
    await expect(tablist).toBeVisible({ timeout: 5000 })

    // The first tab should be clickable almost immediately after the tablist
    // appears.  Clicking it and verifying aria-selected confirms interactivity.
    const chatTab = page.getByRole('tab', { name: '对话', exact: true })
    await chatTab.click()
    await expect(chatTab).toHaveAttribute('aria-selected', 'true')

    const tti = Date.now() - start
    // Time to interactive: from navigation start to first successful
    // interaction.  3 seconds is generous given the mock API init sequence.
    expect(tti).toBeLessThan(3000)
  })

  test('all four mode tabs are interactive after onboarding', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    const start = Date.now()
    for (const mode of ['挑战', '证明', '知识地图', '对话'] as const) {
      const tab = page.getByRole('tab', { name: mode, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
    }
    const elapsed = Date.now() - start

    // Switching through all four modes should be nearly instant since the
    // components are already mounted (conditional rendering, not lazy load).
    expect(elapsed).toBeLessThan(2000)
  })
})

// ---------------------------------------------------------------------------
// Tests — Bundle Size
// ---------------------------------------------------------------------------

test.describe('Performance — Bundle Size', () => {
  test('main JS bundle is within size budget', async ({ page }) => {
    const responses: { url: string; size: number }[] = []

    page.on('response', async response => {
      const url = response.url()
      // In Vite dev mode, JS is served as transformed modules (.js, .tsx, .ts).
      if (
        url.endsWith('.js') ||
        url.endsWith('.tsx') ||
        url.endsWith('.ts') ||
        url.includes('.js?') ||
        url.includes('.tsx?') ||
        url.includes('.ts?')
      ) {
        let size = 0
        const contentLength = response.headers()['content-length']
        if (contentLength) {
          size = parseInt(contentLength, 10)
        }
        if (!size || size <= 0) {
          try {
            const body = await response.body()
            size = body.length
          } catch {
            // Some responses (e.g. 304 Not Modified) have no body.
          }
        }
        if (size > 0) {
          responses.push({ url, size })
        }
      }
    })

    await page.goto('/test/')
    await page.waitForLoadState('networkidle')

    // --- Assert that JS was actually loaded ---
    expect(responses.length).toBeGreaterThan(0)

    // --- Total JS transferred ---
    const totalSize = responses.reduce((sum, r) => sum + r.size, 0)

    // In dev mode, Vite serves modules individually (no tree-shaking or
    // minification), so the total is larger than a production bundle.
    // 5 MB is a generous ceiling for the dev server.
    expect(totalSize).toBeLessThan(5 * 1024 * 1024)

    // --- Per-module check: no single app-code module exceeds 600 KB ---
    // App code lives under /src/ in the dev server URL space.
    const appModules = responses.filter(r => r.url.includes('/src/'))
    for (const mod of appModules) {
      expect(
        mod.size,
        `App module ${mod.url} is ${Math.round(mod.size / 1024)}KB, exceeding 600KB budget`,
      ).toBeLessThan(600 * 1024)
    }

    // --- Per-module check: no single dependency exceeds 2 MB ---
    // Pre-bundled dependencies (react-dom, katex, etc.) are served from
    // /node_modules/.vite/deps/.
    const depModules = responses.filter(r => !r.url.includes('/src/'))
    for (const mod of depModules) {
      expect(
        mod.size,
        `Dependency ${mod.url} is ${Math.round(mod.size / 1024)}KB, exceeding 2MB ceiling`,
      ).toBeLessThan(2 * 1024 * 1024)
    }
  })

  test('number of JS requests is reasonable', async ({ page }) => {
    const jsUrls: string[] = []
    page.on('response', response => {
      const url = response.url()
      if (
        url.endsWith('.js') ||
        url.endsWith('.tsx') ||
        url.endsWith('.ts') ||
        url.includes('.js?') ||
        url.includes('.tsx?') ||
        url.includes('.ts?')
      ) {
        jsUrls.push(url)
      }
    })

    await page.goto('/test/')
    await page.waitForLoadState('networkidle')

    // In dev mode, each module is a separate request.  200 is a generous
    // ceiling — the app has ~30 components plus React, KaTeX, Zustand, etc.
    expect(jsUrls.length).toBeGreaterThan(0)
    expect(jsUrls.length).toBeLessThan(200)
  })
})

// ---------------------------------------------------------------------------
// Tests — Render Performance
// ---------------------------------------------------------------------------

test.describe('Performance — Render', () => {
  test('DAG renders 100+ nodes within performance budget', async ({ page }) => {
    // Generate 120 DAG nodes across 5 abstraction levels.
    const largeDagNodes = Array.from({ length: 120 }, (_, i) => ({
      id: `perf_node_${i}`,
      name: `概念 ${i}`,
      description: `概念 ${i} 的描述`,
      prerequisites: i > 0 ? [`perf_node_${Math.max(0, i - 5)}`] : [],
      abstraction_level: Math.floor(i / 24),
      difficulty: 0.3 + (i % 10) * 0.05,
      is_milestone: i % 10 === 0,
      mastery: i % 3 === 0 ? 0.8 : 0,
      status: i === 30 ? 'current' : i < 30 ? 'mastered' : 'locked',
      is_current: i === 30,
      domain: 'group_theory',
    }))

    // Inject custom DAG data before the page loads.  The init script uses
    // a property descriptor on window.api so that when mock-api.js assigns
    // window.api = mockApi, the setter intercepts it and overrides getDag
    // to return our large node set.  Plain JS (no TS annotations) is used
    // inside the callback to ensure clean serialization.
    await page.addInitScript(nodes => {
      window.__customDagData = nodes

      function wrapApi(api) {
        if (!api || api.__dagWrapped) return
        api.__dagWrapped = true
        api.getDag = async function () {
          if (window.__customDagData) {
            return { nodes: window.__customDagData }
          }
          return { nodes: [] }
        }
      }

      let _api
      Object.defineProperty(window, 'api', {
        configurable: true,
        get() {
          return _api
        },
        set(v) {
          _api = v
          wrapApi(v)
        },
      })
    }, largeDagNodes)

    await page.goto('/test/')
    await completeOnboarding(page)

    // Mark the start time, then switch to DAG mode.
    await page.evaluate(() => {
      window.__renderStart = performance.now()
    })
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()

    // Wait for at least one DAG node to be visible.  The DagGraph component
    // renders each node as an SVG <g class="dag-node-group ...">.
    await expect(page.locator('.dag-node-group').first()).toBeVisible({ timeout: 10000 })
    // Let the SVG layout settle.
    await page.waitForTimeout(500)

    const renderTime = await page.evaluate(() => {
      return performance.now() - window.__renderStart
    })

    // Verify that 100+ nodes actually rendered.
    const nodeCount = await page.locator('.dag-node-group').count()
    expect(nodeCount).toBeGreaterThanOrEqual(100)

    // Rendering 120 SVG nodes should complete within 3 seconds.
    expect(renderTime).toBeLessThan(3000)
  })

  test('large conjecture timeline renders within budget', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)

    // Send a chat message to populate visualData (includes a 3-entry timeline).
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForTimeout(1500)

    const start = Date.now()
    // Switch to grill mode where the ConjectureTimeline lives.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await expect(page.locator('.timeline-entry').first()).toBeVisible({ timeout: 5000 })
    const elapsed = Date.now() - start

    // The mock API provides 3 timeline entries; rendering them should be fast.
    const entryCount = await page.locator('.timeline-entry').count()
    expect(entryCount).toBeGreaterThanOrEqual(1)
    expect(elapsed).toBeLessThan(2000)
  })
})

// ---------------------------------------------------------------------------
// Tests — Interaction Responsiveness
// ---------------------------------------------------------------------------

test.describe('Performance — Interaction Responsiveness', () => {
  test('click-to-visual-update for preset table load', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Measure the time from clicking the "S3" preset button to the Cayley
    // table DOM updating.  We use a MutationObserver in the browser to
    // detect the first DOM mutation on the table, which avoids Playwright
    // IPC overhead in the measurement.
    const timing = await page.evaluate(() => {
      return new Promise<number>(resolve => {
        const start = performance.now()

        // Find the S3 preset button.
        const buttons = Array.from(document.querySelectorAll('button'))
        const s3Btn = buttons.find(b => b.textContent?.trim() === 'S3')
        if (!s3Btn) {
          resolve(-1)
          return
        }

        // Observe the table for any DOM change (cell values update).
        const table = document.querySelector('[role="grid"]')
        if (!table) {
          resolve(-1)
          return
        }

        const observer = new MutationObserver(() => {
          resolve(performance.now() - start)
          observer.disconnect()
        })
        observer.observe(table, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        })

        s3Btn.click()

        // Fallback: if no mutation happens within 2s, resolve with elapsed.
        setTimeout(() => {
          observer.disconnect()
          resolve(performance.now() - start)
        }, 2000)
      })
    })

    expect(timing).toBeGreaterThan(0)
    // The preset load is a synchronous state update (no API call), so it
    // should be near-instant.  500ms is a generous ceiling.
    expect(timing).toBeLessThan(500)
  })

  test('mode switch completes within responsiveness budget', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    const switchTimes: number[] = []

    for (let i = 0; i < 8; i++) {
      const modes = ['挑战', '证明', '知识地图', '对话'] as const
      const mode = modes[i % 4]

      const start = Date.now()
      await page.getByRole('tab', { name: mode, exact: true }).click()
      await expect(page.getByRole('tab', { name: mode, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      switchTimes.push(Date.now() - start)
    }

    // No single mode switch should exceed 500ms (Playwright IPC included).
    for (const t of switchTimes) {
      expect(t).toBeLessThan(500)
    }

    // The average should be well under 200ms.
    const avg = switchTimes.reduce((a, b) => a + b, 0) / switchTimes.length
    expect(avg).toBeLessThan(200)
  })

  test('chat send-to-response appears within expected latency', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Count system messages before sending.
    const beforeCount = await page.locator('.chat-msg.system').count()

    const start = Date.now()
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()

    // Wait for a new system message to appear (mock API delay ~800ms).
    await expect(async () => {
      const afterCount = await page.locator('.chat-msg.system').count()
      expect(afterCount).toBeGreaterThan(beforeCount)
    }).toPass({ timeout: 5000 })
    const elapsed = Date.now() - start

    // The mock API has an 800ms artificial delay, so the response should
    // appear within ~1.5s on fast hardware. Allow 2.5s for slower CI / sandbox
    // environments where React render + KaTeX is naturally slower.
    expect(elapsed).toBeLessThan(2500)
  })
})

// ---------------------------------------------------------------------------
// Tests — Memory Stability
// ---------------------------------------------------------------------------

test.describe('Performance — Memory', () => {
  test('no significant memory leak after repeated mode switches', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Warmup: do a few mode switches to fill caches and JIT-compile.
    for (const mode of ['挑战', '证明', '知识地图', '对话'] as const) {
      await page.getByRole('tab', { name: mode, exact: true }).click()
      await page.waitForTimeout(50)
    }

    // Measure baseline heap via the Chromium performance.memory API.
    const baselineHeap = await getUsedHeapSize(page)

    // Perform 15 rounds of mode switching (60 total switches).
    for (let round = 0; round < 15; round++) {
      for (const mode of ['挑战', '证明', '知识地图', '对话'] as const) {
        await page.getByRole('tab', { name: mode, exact: true }).click()
      }
    }

    // Let the runtime settle and GC run naturally.
    await page.waitForTimeout(1000)

    const finalHeap = await getUsedHeapSize(page)
    const growth = finalHeap - baselineHeap
    const growthPercent = baselineHeap > 0 ? (growth / baselineHeap) * 100 : 0

    // Without forced GC, some growth is expected (event listeners, cached
    // React fibers, etc.).  We assert that growth is bounded.
    // 100% growth is a generous heuristic — a real leak would show
    // unbounded linear growth across more iterations.
    expect(growthPercent).toBeLessThan(100)

    // Absolute growth should be under 100 MB.
    expect(growth).toBeLessThan(100 * 1024 * 1024)
  })

  test('heap does not grow unboundedly after chat interactions', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Baseline after warmup.
    await page.locator('textarea.text-input').fill('warmup')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForTimeout(2000)

    const baselineHeap = await getUsedHeapSize(page)

    // Send 10 chat messages.
    for (let i = 0; i < 10; i++) {
      await page.locator('textarea.text-input').fill(`message ${i}`)
      await page.getByRole('button', { name: '发送' }).click()
      await page.waitForTimeout(200)
    }

    await page.waitForTimeout(1000)
    const finalHeap = await getUsedHeapSize(page)
    const growth = finalHeap - baselineHeap

    // Chat messages accumulate in the store, so some growth is expected.
    // But it should be bounded — each message is a few KB.
    // 50 MB growth is a generous ceiling for 10 messages + mock responses.
    expect(growth).toBeLessThan(50 * 1024 * 1024)
  })

  test('DOM node count stays bounded after interactions', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Warmup.
    for (const mode of ['挑战', '证明', '知识地图', '对话'] as const) {
      await page.getByRole('tab', { name: mode, exact: true }).click()
      await page.waitForTimeout(50)
    }

    const baselineNodes = await page.evaluate(() => document.querySelectorAll('*').length)

    // 20 rounds of mode switching.
    for (let i = 0; i < 20; i++) {
      const modes = ['挑战', '证明', '知识地图', '对话'] as const
      await page.getByRole('tab', { name: modes[i % 4], exact: true }).click()
      await page.waitForTimeout(30)
    }

    await page.waitForTimeout(500)
    const finalNodes = await page.evaluate(() => document.querySelectorAll('*').length)

    // DOM node count should not grow significantly (React unmounts old mode
    // content).  Allow up to 50% growth for varying mode complexity.
    const growthPercent = (finalNodes / baselineNodes - 1) * 100
    expect(growthPercent).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------
// Tests — Concurrent Rendering (Jank)
// ---------------------------------------------------------------------------

test.describe('Performance — Concurrent Rendering', () => {
  test('rapid mode switches do not cause jank or errors', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Rapidly switch between all four modes (8 switches with minimal delay).
    const modes = ['挑战', '证明', '知识地图', '对话', '挑战', '证明', '知识地图', '对话'] as const

    for (const mode of modes) {
      await page.getByRole('tab', { name: mode, exact: true }).click()
      // Minimal delay — just enough for the click to register.
      await page.waitForTimeout(50)
    }

    // After rapid switching, the app should still be fully functional.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()

    // The last clicked mode should be selected.
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // No error banner should be visible.
    await expect(page.locator('.error-banner')).not.toBeVisible()

    // The Cayley table should be visible and interactive in chat mode.
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()
  })

  test('concurrent chat send and mode switch does not break state', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Send a chat message, then immediately switch to proof mode while the
    // response is still loading.  This tests that concurrent async operations
    // (pending API response + mode switch) don't corrupt state.
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()

    // Immediately switch modes while the mock API is still processing.
    await page.getByRole('tab', { name: '证明', exact: true }).click()
    await expect(page.getByRole('tab', { name: '证明', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Wait for the chat response to complete (mock API: 800ms delay).
    await page.waitForTimeout(2000)

    // Switch back to chat mode and verify the response was received.
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // The app should not have crashed.
    await expect(page.getByRole('heading', { name: 'MathWeaver' })).toBeVisible()
    // No error banner.
    await expect(page.locator('.error-banner')).not.toBeVisible()
  })

  test('rapid preset switching updates table without errors', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Rapidly click through all preset buttons.
    const presets = ['Z3', 'Klein', 'S3', '非群', '非结合', 'Z3', 'Klein', 'S3']
    for (const preset of presets) {
      await page.getByRole('button', { name: preset }).click()
      await page.waitForTimeout(30)
    }

    // After rapid preset switching, the table should show the last preset (S3).
    await page.waitForTimeout(200)
    const table = page.getByRole('grid', { name: /运算表/ })
    await expect(table).toBeVisible()

    // S3 is a 6x6 table, so there should be 36 cell inputs.
    const inputCount = await table.locator('input').count()
    expect(inputCount).toBe(36)

    // No errors.
    await expect(page.locator('.error-banner')).not.toBeVisible()
  })

  test('long-running rendering task does not block UI', async ({ page }) => {
    await page.goto('/test/')
    await completeOnboarding(page)
    await page.waitForLoadState('networkidle')

    // Switch to DAG mode (which renders an SVG graph).
    await page.getByRole('tab', { name: '知识地图', exact: true }).click()
    await expect(page.getByText('概念依赖图')).toBeVisible({ timeout: 5000 })

    // While in DAG mode, verify the header and tabs remain responsive.
    const start = Date.now()
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    await expect(page.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const elapsed = Date.now() - start

    // The mode switch should be responsive even after the DAG graph rendered.
    expect(elapsed).toBeLessThan(1000)

    // The Cayley table should be visible in chat mode.
    await expect(page.getByRole('grid', { name: /运算表/ })).toBeVisible()
  })
})
