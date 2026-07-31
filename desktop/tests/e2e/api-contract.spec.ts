import { test, expect, type Page } from '@playwright/test'

/**
 * API Contract & Integration E2E Tests
 *
 * Verifies that the frontend-backend contract is consistent: every IPC
 * channel the frontend calls is answered by the mock API with the expected
 * shape, and every HTTP fallback endpoint returns the documented payload.
 * Also exercises full lifecycles (session, grill, proof, conjecture) through
 * the UI and validates that the resulting state updates propagate correctly.
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
 * Invoke an IPC channel through the mock API bridge and return the result.
 */
async function invoke(
  page: Page,
  channel: string,
  ...args: unknown[]
): Promise<Record<string, unknown> | unknown[] | string | null> {
  return page.evaluate(
    async ({ channel, args }) => {
      const api = (
        window as unknown as {
          api: { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> }
        }
      ).api
      return await api.invoke(channel, ...args)
    },
    { channel, args },
  )
}

/**
 * POST JSON to an HTTP fallback endpoint and return { status, json }.
 */
async function postJSON(
  page: Page,
  url: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ({ url, body }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return { status: res.status, json: await res.json() }
    },
    { url, body },
  )
}

/**
 * Read the persisted zustand store state from localStorage.
 *
 * The store uses the 'mathweaver-session' key with the structure:
 * { state: PersistedSessionState, version: 1 }
 */
async function getPersistedState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('mathweaver-session')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      return parsed?.state ?? null
    } catch {
      return null
    }
  })
}

// ---------------------------------------------------------------------------
// Tests: IPC Channel Contract
// ---------------------------------------------------------------------------

test.describe('IPC Channel Contract', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  // --- api:health ---

  test('api:health returns { status, version }', async ({ page }) => {
    const result = (await invoke(page, 'api:health')) as Record<string, unknown>
    expect(result).not.toBeNull()
    expect(result.status).toBe('ok')
    expect(typeof result.version).toBe('string')
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  // --- api:dag ---

  test('api:dag returns { nodes: [...] }', async ({ page }) => {
    const result = (await invoke(page, 'api:dag')) as Record<string, unknown>
    expect(result).not.toBeNull()
    expect(Array.isArray(result.nodes)).toBe(true)
    expect((result.nodes as unknown[]).length).toBeGreaterThan(0)

    // Each node should have the expected fields.
    const nodes = result.nodes as Record<string, unknown>[]
    for (const node of nodes) {
      expect(typeof node.id).toBe('string')
      expect(typeof node.name).toBe('string')
      expect(typeof node.description).toBe('string')
      expect(Array.isArray(node.prerequisites)).toBe(true)
      expect(typeof node.abstraction_level).toBe('number')
      expect(typeof node.difficulty).toBe('number')
      expect(typeof node.is_milestone).toBe('boolean')
    }
  })

  // --- api:session-start ---

  test('api:session-start returns session data', async ({ page }) => {
    const result = (await invoke(page, 'api:session-start', {
      student_id: 'test_student',
      target_node_id: 'group_definition',
    })) as Record<string, unknown>

    expect(result).not.toBeNull()
    expect(typeof result.session_id).toBe('string')
    expect(typeof result.target_node).toBe('string')
    expect(typeof result.node_name).toBe('string')
    expect(typeof result.node_description).toBe('string')
    expect(typeof result.phase).toBe('string')
    expect(Array.isArray(result.learning_path)).toBe(true)

    // The learning_path should contain objects with a name field.
    const path = result.learning_path as Record<string, unknown>[]
    for (const step of path) {
      expect(typeof step.name).toBe('string')
    }
  })

  // --- api:session-input ---

  test('api:session-input returns response with four_fields and visual_data', async ({ page }) => {
    const result = (await invoke(page, 'api:session-input', {
      student_input: '什么是群？',
      response_time_ms: 5000,
    })) as Record<string, unknown>

    expect(result).not.toBeNull()

    // response object
    const response = result.response as Record<string, unknown>
    expect(response).toBeDefined()
    expect(typeof response.content).toBe('string')
    expect(typeof response.action).toBe('string')

    // phase
    expect(typeof result.phase).toBe('string')

    // four_fields
    const fourFields = result.four_fields as Record<string, unknown>
    expect(fourFields).toBeDefined()
    expect(fourFields.knowledge).toBeDefined()
    expect(fourFields.cognitive).toBeDefined()
    expect(fourFields.emotional).toBeDefined()
    expect(fourFields.interaction).toBeDefined()

    // phase_trace
    expect(Array.isArray(result.phase_trace)).toBe(true)

    // decision
    const decision = result.decision as Record<string, unknown>
    expect(decision).toBeDefined()
    expect(typeof decision.action).toBe('string')
    expect(typeof decision.reason).toBe('string')

    // visual_data
    const visualData = result.visual_data as Record<string, unknown>
    expect(visualData).toBeDefined()
    expect(visualData.four_field_gauges).toBeDefined()
    expect(visualData.mastery_radar).toBeDefined()
    expect(visualData.conjecture_journey).toBeDefined()
    expect(visualData.difficulty_gauge).toBeDefined()
    expect(visualData.dag_progress).toBeDefined()
  })

  // --- api:proof-theorems ---

  test('api:proof-theorems returns { theorems: [...] }', async ({ page }) => {
    const result = (await invoke(page, 'api:proof-theorems')) as Record<string, unknown>
    expect(result).not.toBeNull()
    expect(Array.isArray(result.theorems)).toBe(true)
    expect((result.theorems as unknown[]).length).toBeGreaterThan(0)

    // Each theorem should be a string.
    const theorems = result.theorems as unknown[]
    for (const t of theorems) {
      expect(typeof t).toBe('string')
    }
  })

  // --- api:proof-verify ---

  test('api:proof-verify returns proof result with steps and is_complete', async ({ page }) => {
    const result = (await invoke(page, 'api:proof-verify', '群的幺元唯一性', [
      "设 e 和 e' 都是群 G 的幺元",
      "则 e = e·e' = e'，所以幺元唯一",
    ])) as Record<string, unknown>

    expect(result).not.toBeNull()
    expect(typeof result.theorem_name).toBe('string')
    expect(Array.isArray(result.steps)).toBe(true)
    expect(typeof result.is_complete).toBe('boolean')
    expect(Array.isArray(result.missing_steps)).toBe(true)
    expect(typeof result.socratic_hint).toBe('string')
    expect(typeof result.overall_feedback).toBe('string')
    expect(typeof result.progress).toBe('string')

    // Each step result should have the expected fields.
    const steps = result.steps as Record<string, unknown>[]
    for (const step of steps) {
      expect(typeof step.step_number).toBe('number')
      expect(typeof step.claim).toBe('string')
      expect(typeof step.justification).toBe('string')
      expect(typeof step.is_valid).toBe('boolean')
      expect(typeof step.feedback).toBe('string')
    }
  })

  // --- api:grill-start ---

  test('api:grill-start returns grill state with active and current_question', async ({ page }) => {
    const result = (await invoke(
      page,
      'api:grill-start',
      'test_student',
      'group_theory',
    )) as Record<string, unknown>

    expect(result).not.toBeNull()
    const grill = result.grill as Record<string, unknown>
    expect(grill).toBeDefined()
    expect(grill.active).toBe(true)

    // current_question
    const currentQuestion = grill.current_question as Record<string, unknown>
    expect(currentQuestion).toBeDefined()
    expect(typeof currentQuestion.qid).toBe('string')
    expect(typeof currentQuestion.concept_node_id).toBe('string')
    expect(typeof currentQuestion.concept_name).toBe('string')
    expect(typeof currentQuestion.question).toBe('string')
    expect(typeof currentQuestion.recommended_answer).toBe('string')
    expect(typeof currentQuestion.difficulty).toBe('number')
    expect(typeof currentQuestion.branch_type).toBe('string')

    // difficulty
    expect(typeof grill.difficulty).toBe('number')

    // encouragement
    expect(typeof grill.encouragement).toBe('string')

    // summary
    const summary = grill.summary as Record<string, unknown>
    expect(summary).toBeDefined()
    expect(summary.active).toBe(true)
    expect(typeof summary.total_branches).toBe('number')
    expect(typeof summary.resolved_branches).toBe('number')

    // adaptive
    const adaptive = summary.adaptive as Record<string, unknown>
    expect(adaptive).toBeDefined()
    expect(typeof adaptive.current_difficulty).toBe('number')
    expect(typeof adaptive.difficulty_band).toBe('string')
    expect(typeof adaptive.accuracy_rate).toBe('number')
  })

  // --- conjecture:test ---

  test('conjecture:test returns { verdict, counter_example }', async ({ page }) => {
    // Test a refuted claim (contains "交换")
    const refuted = (await invoke(page, 'conjecture:test', {
      claim: '所有群都是交换群',
      node_id: 'group_definition',
    })) as Record<string, unknown>

    expect(refuted).not.toBeNull()
    expect(refuted.verdict).toBe('refuted')
    expect(typeof refuted.counter_example).toBe('string')
    expect(refuted.counter_example).toBeTruthy()
  })

  test('conjecture:test confirms claims containing "唯一"', async ({ page }) => {
    const confirmed = (await invoke(page, 'conjecture:test', {
      claim: '群的幺元是唯一的',
      node_id: 'group_definition',
    })) as Record<string, unknown>

    expect(confirmed).not.toBeNull()
    expect(confirmed.verdict).toBe('confirmed')
    expect(confirmed.counter_example).toBeNull()
  })

  test('conjecture:test returns undecidable for generic claims', async ({ page }) => {
    const undecidable = (await invoke(page, 'conjecture:test', {
      claim: '群具有某种特殊性质',
      node_id: 'group_definition',
    })) as Record<string, unknown>

    expect(undecidable).not.toBeNull()
    expect(undecidable.verdict).toBe('undecidable')
    expect(undecidable.counter_example).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: HTTP Fallback Endpoints
// ---------------------------------------------------------------------------

test.describe('HTTP Fallback Endpoints', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  // --- /api/historical/narrative ---

  test('POST /api/historical/narrative returns array of { title, content, score }', async ({
    page,
  }) => {
    const { status, json } = await postJSON(page, '/api/historical/narrative', {
      claim: '所有群都是交换群',
    })

    expect(status).toBe(200)
    expect(Array.isArray(json)).toBe(true)
    expect((json as unknown[]).length).toBeGreaterThan(0)

    const narratives = json as Record<string, unknown>[]
    for (const entry of narratives) {
      expect(typeof entry.title).toBe('string')
      expect(typeof entry.content).toBe('string')
      expect(typeof entry.score).toBe('number')
      // Score should be between 0 and 1.
      expect(entry.score).toBeGreaterThanOrEqual(0)
      expect(entry.score).toBeLessThanOrEqual(1)
    }
  })

  test('POST /api/historical/narrative returns relevant narratives for "唯一" claims', async ({
    page,
  }) => {
    const { json } = await postJSON(page, '/api/historical/narrative', {
      claim: '群的幺元是唯一的',
    })

    const narratives = json as Record<string, unknown>[]
    expect(narratives.length).toBeGreaterThan(0)
    // The mock returns a narrative about 幺元唯一性 for "唯一" claims.
    const hasRelevant = narratives.some(
      n => (n.title as string).includes('唯一') || (n.content as string).includes('唯一'),
    )
    expect(hasRelevant).toBe(true)
  })

  // --- /api/curriculum/compare ---

  test('POST /api/curriculum/compare returns { structures: [...] }', async ({ page }) => {
    const { status, json } = await postJSON(page, '/api/curriculum/compare', {
      concept: 'isomorphism',
    })

    expect(status).toBe(200)
    const data = json as Record<string, unknown>
    expect(data.structures).toBeDefined()
    expect(Array.isArray(data.structures)).toBe(true)
    expect((data.structures as unknown[]).length).toBeGreaterThan(0)

    const structures = data.structures as Record<string, unknown>[]
    for (const struct of structures) {
      expect(typeof struct.name).toBe('string')
      expect(typeof struct.domain).toBe('string')
      expect(typeof struct.definition).toBe('string')
      expect(typeof struct.example).toBe('string')
      expect(Array.isArray(struct.key_properties)).toBe(true)
    }
  })

  // --- /api/conjecture/test ---

  test('POST /api/conjecture/test returns { verdict, counter_example }', async ({ page }) => {
    const { status, json } = await postJSON(page, '/api/conjecture/test', {
      claim: '所有群都是交换群',
      node_id: 'group_definition',
    })

    expect(status).toBe(200)
    const data = json as Record<string, unknown>
    expect(data.verdict).toBe('refuted')
    expect(typeof data.counter_example).toBe('string')
  })

  test('POST /api/conjecture/test returns undecidable for generic claims', async ({ page }) => {
    const { status, json } = await postJSON(page, '/api/conjecture/test', {
      claim: 'some generic claim',
    })

    expect(status).toBe(200)
    const data = json as Record<string, unknown>
    expect(data.verdict).toBe('undecidable')
    expect(data.counter_example).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: Data Shape Validation
// ---------------------------------------------------------------------------

test.describe('Data Shape Validation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)
  })

  test('session-start response fields have correct types', async ({ page }) => {
    const result = (await invoke(page, 'api:session-start', {
      student_id: 'test_student',
      target_node_id: 'group_definition',
    })) as Record<string, unknown>

    expect(typeof result.session_id).toBe('string')
    expect(result.session_id.length).toBeGreaterThan(0)
    expect(typeof result.target_node).toBe('string')
    expect(typeof result.node_name).toBe('string')
    expect(typeof result.node_description).toBe('string')
    expect(typeof result.phase).toBe('string')
    expect(Array.isArray(result.learning_path)).toBe(true)
  })

  test('session-input four_fields have correct nested types', async ({ page }) => {
    const result = (await invoke(page, 'api:session-input', {
      student_input: 'test',
      response_time_ms: 1000,
    })) as Record<string, unknown>

    const ff = result.four_fields as Record<string, Record<string, unknown>>

    // knowledge
    expect(typeof ff.knowledge.mastery_estimate).toBe('number')
    expect(typeof ff.knowledge.zpd_lower).toBe('number')
    expect(typeof ff.knowledge.zpd_upper).toBe('number')
    expect(Array.isArray(ff.knowledge.prerequisite_gaps)).toBe(true)
    expect(typeof ff.knowledge.in_zpd).toBe('boolean')
    expect(typeof ff.knowledge.ready_to_advance).toBe('boolean')

    // cognitive
    expect(typeof ff.cognitive.response_time_ms).toBe('number')
    expect(typeof ff.cognitive.cognitive_load).toBe('number')
    expect(typeof ff.cognitive.state).toBe('string')
    expect(typeof ff.cognitive.is_overloaded).toBe('boolean')

    // emotional
    expect(typeof ff.emotional.anxiety_index).toBe('number')
    expect(typeof ff.emotional.flow_score).toBe('number')
    expect(typeof ff.emotional.state).toBe('string')
    expect(typeof ff.emotional.is_anxious).toBe('boolean')
    expect(typeof ff.emotional.in_flow).toBe('boolean')

    // interaction
    expect(typeof ff.interaction.current_hint_level).toBe('number')
    expect(typeof ff.interaction.consecutive_correct).toBe('number')
    expect(typeof ff.interaction.should_fade_scaffold).toBe('boolean')
  })

  test('session-input visual_data has correct nested types', async ({ page }) => {
    const result = (await invoke(page, 'api:session-input', {
      student_input: 'test',
      response_time_ms: 1000,
    })) as Record<string, unknown>

    const vd = result.visual_data as Record<string, unknown>

    // four_field_gauges
    const gauges = vd.four_field_gauges as Record<string, unknown>
    expect(typeof gauges.cognitive_load).toBe('number')
    expect(typeof gauges.cognitive_state).toBe('string')
    expect(typeof gauges.anxiety_index).toBe('number')
    expect(typeof gauges.flow_score).toBe('number')
    expect(typeof gauges.hint_dependency).toBe('number')

    // mastery_radar
    const radar = vd.mastery_radar as Record<string, unknown>
    expect(typeof radar.accuracy).toBe('number')
    expect(typeof radar.conjecture).toBe('number')
    expect(typeof radar.independence).toBe('number')
    expect(typeof radar.fluency).toBe('number')
    expect(typeof radar.abstraction).toBe('number')
    expect(typeof radar.overall).toBe('number')

    // conjecture_journey
    const journey = vd.conjecture_journey as Record<string, unknown>
    expect(Array.isArray(journey.timeline)).toBe(true)
    expect(typeof journey.total_conjectures).toBe('number')
    expect(typeof journey.confirmed).toBe('number')
    expect(typeof journey.refuted).toBe('number')

    // Each timeline entry
    const timeline = journey.timeline as Record<string, unknown>[]
    for (const entry of timeline) {
      expect(typeof entry.step).toBe('number')
      expect(typeof entry.claim).toBe('string')
      expect(['confirmed', 'refuted', 'undecidable']).toContain(entry.verdict)
    }
  })

  test('grill-start current_question has correct types', async ({ page }) => {
    const result = (await invoke(page, 'api:grill-start', 'student_001', 'group_theory')) as Record<
      string,
      unknown
    >

    const grill = result.grill as Record<string, unknown>
    const q = grill.current_question as Record<string, unknown>

    expect(typeof q.qid).toBe('string')
    expect(typeof q.concept_node_id).toBe('string')
    expect(typeof q.concept_name).toBe('string')
    expect(typeof q.question).toBe('string')
    expect(typeof q.recommended_answer).toBe('string')
    expect(typeof q.difficulty).toBe('number')
    expect(q.difficulty).toBeGreaterThanOrEqual(0)
    expect(q.difficulty).toBeLessThanOrEqual(1)
    expect(typeof q.branch_type).toBe('string')
  })

  test('proof-verify steps have correct types', async ({ page }) => {
    const result = (await invoke(page, 'api:proof-verify', '群的逆元唯一性', [
      '设 a 有两个逆元 b 和 c',
      '则 b = b·e = b·(a·c) = (b·a)·c = e·c = c',
    ])) as Record<string, unknown>

    const steps = result.steps as Record<string, unknown>[]
    expect(steps.length).toBeGreaterThan(0)

    for (const step of steps) {
      expect(typeof step.step_number).toBe('number')
      expect(typeof step.claim).toBe('string')
      expect(typeof step.justification).toBe('string')
      expect(typeof step.is_valid).toBe('boolean')
      expect(typeof step.feedback).toBe('string')
      expect(typeof step.matched_expected).toBe('string')
      expect(Array.isArray(step.implicit_steps)).toBe(true)
    }

    // is_complete should be a boolean consistent with step validity.
    const allValid = steps.every(s => s.is_valid === true)
    expect(result.is_complete).toBe(allValid)
  })
})

// ---------------------------------------------------------------------------
// Tests: Session Lifecycle
// ---------------------------------------------------------------------------

test.describe('Session Lifecycle', () => {
  test('start session → send input → get response → verify state update', async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)

    // The app auto-starts a session when the backend becomes ready.
    // Verify the session-start system message appears in chat.
    await expect(page.locator('.chat-msg.system').first()).toBeVisible({ timeout: 10000 })

    // The system message should contain the learning target name.
    await expect(page.locator('.chat-msg.system').first()).toContainText('学习目标')

    // Record the initial chat message count.
    const initialCount = await page.locator('.chat-msg').count()

    // Send a chat message.
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()

    // Wait for the response: the chat message count should increase
    // (user message + system response = +2).
    await expect(async () => {
      const count = await page.locator('.chat-msg').count()
      expect(count).toBeGreaterThanOrEqual(initialCount + 2)
    }).toPass({ timeout: 15000 })

    // The latest system message should contain content from the mock response.
    const systemMessages = page.locator('.chat-msg.system')
    const lastSystemMsg = systemMessages.last()
    await expect(lastSystemMsg).toBeVisible()
    const responseText = await lastSystemMsg.textContent()
    expect(responseText?.length).toBeGreaterThan(0)

    // Verify the persisted store state has the chat messages and updated phase.
    await expect(async () => {
      const state = await getPersistedState(page)
      expect(state).not.toBeNull()
      const chat = (state as Record<string, unknown>).chat as unknown[]
      expect(chat.length).toBeGreaterThanOrEqual(2)
      const phase = (state as Record<string, unknown>).phase
      expect(typeof phase).toBe('string')
      expect(phase).not.toBe('idle')
    }).toPass({ timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Tests: Grill Lifecycle
// ---------------------------------------------------------------------------

test.describe('Grill Lifecycle', () => {
  test('start grill → answer question → get next question', async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)

    // Switch to grill mode.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await expect(page.getByRole('button', { name: '开始挑战' })).toBeVisible({ timeout: 5000 })

    // Start the grill session.
    await page.getByRole('button', { name: '开始挑战' }).click()

    // The first question should appear (the mock returns a question immediately).
    await expect(page.locator('.grill-question-text').first()).toBeVisible({ timeout: 10000 })

    // Type an answer in the grill answer textarea.
    const answerInput = page.locator('textarea.grill-answer-input')
    await expect(answerInput).toBeVisible({ timeout: 5000 })
    await answerInput.fill('群是一个非空集合配上二元运算，满足封闭性、结合律、存在幺元和逆元。')

    // Submit the answer.
    const submitBtn = page.getByRole('button', { name: '提交回答' })
    await expect(submitBtn).toBeVisible()
    await submitBtn.click()

    // Wait for the answer to be processed: the store's questionsAsked
    // should increment to 1, and a new question should appear.
    await expect(async () => {
      const state = await getPersistedState(page)
      const grillState = (state as Record<string, unknown>)?.grillState as Record<string, unknown>
      expect(grillState).toBeDefined()
      expect(grillState.questionsAsked).toBe(1)
    }).toPass({ timeout: 15000 })

    // The grill should still be active with a new question.
    const state = await getPersistedState(page)
    const grillState = (state as Record<string, unknown>)?.grillState as Record<string, unknown>
    expect(grillState.active).toBe(true)
    expect(grillState.questionsAsked).toBe(1)
    expect(grillState.currentQuestion).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: Proof Lifecycle
// ---------------------------------------------------------------------------

test.describe('Proof Lifecycle', () => {
  test('fetch theorems → submit proof → get verification result', async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)

    // Switch to proof mode.
    await page.getByRole('tab', { name: '证明', exact: true }).click()

    // The proof panel should render and auto-fetch theorems.
    await expect(page.getByText('证明步骤')).toBeVisible({ timeout: 5000 })

    // Wait for theorems to load (the theorem selector should be populated).
    await page.waitForTimeout(1000)

    // Verify the persisted store has theorems.
    await expect(async () => {
      const state = await getPersistedState(page)
      const proofState = (state as Record<string, unknown>)?.proofState as Record<string, unknown>
      expect(proofState).toBeDefined()
      const theorems = proofState.theorems as unknown[]
      expect(theorems.length).toBeGreaterThan(0)
    }).toPass({ timeout: 5000 })

    // Fill in proof steps.
    const stepTextarea = page.locator('.ddps-step-textarea').first()
    await expect(stepTextarea).toBeVisible()
    await stepTextarea.fill("设 e 和 e' 都是群 G 的幺元")

    // Add a second step.
    await page.getByRole('button', { name: /添加步骤/ }).click()
    await page.locator('.ddps-step-textarea').nth(1).fill("则 e = e·e' = e'，所以幺元唯一")

    // Submit the proof for verification.
    await page.getByRole('button', { name: '提交验证' }).click()

    // Wait for the verification result to appear.
    await expect(page.getByText('验证结果')).toBeVisible({ timeout: 15000 })

    // The result should contain step-by-step feedback.
    await expect(page.locator('.step-result').first()).toBeVisible({ timeout: 5000 })

    // Verify the persisted store has the proof result.
    await expect(async () => {
      const state = await getPersistedState(page)
      const proofState = (state as Record<string, unknown>)?.proofState as Record<string, unknown>
      const currentResult = proofState?.currentResult as Record<string, unknown>
      expect(currentResult).toBeDefined()
      expect(currentResult).not.toBeNull()
      expect(Array.isArray(currentResult.steps)).toBe(true)
      expect(typeof currentResult.is_complete).toBe('boolean')
      expect(typeof currentResult.overall_feedback).toBe('string')
    }).toPass({ timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Tests: Conjecture Lifecycle
// ---------------------------------------------------------------------------

test.describe('Conjecture Lifecycle', () => {
  test('submit claim → get verdict → verify state update', async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)

    // First, send a chat message to populate visualData (needed for the
    // ConjectureTimeline component to render).
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()
    // Wait for the mock response (includes visual_data with conjecture_journey).
    await page.waitForTimeout(2000)

    // Switch to grill mode where the ConjectureTimeline lives.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await page.waitForTimeout(500)

    // The conjecture input should be visible.
    const conjectureInput = page.locator('.conjecture-input')
    await expect(conjectureInput).toBeVisible({ timeout: 5000 })

    // Record the initial number of conjecture entries in the store.
    const stateBefore = await getPersistedState(page)
    const conjectureStateBefore = (stateBefore as Record<string, unknown>)
      ?.conjectureState as Record<string, unknown>
    const entriesBefore = (conjectureStateBefore?.entries as unknown[]) ?? []

    // Submit a conjecture that will be refuted (contains "交换").
    await conjectureInput.fill('所有群都是交换群')
    await page.getByRole('button', { name: '提交猜想' }).click()

    // Wait for the loading state and then the input to clear.
    await expect(page.getByRole('button', { name: '验证中…' })).toBeVisible({ timeout: 3000 })
    await expect(conjectureInput).toHaveValue('', { timeout: 10000 })

    // Verify the persisted store has the new conjecture entry with the
    // correct verdict.
    await expect(async () => {
      const state = await getPersistedState(page)
      const conjectureState = (state as Record<string, unknown>)?.conjectureState as Record<
        string,
        unknown
      >
      expect(conjectureState).toBeDefined()
      const entries = conjectureState.entries as Record<string, unknown>[]
      expect(entries.length).toBeGreaterThan(entriesBefore.length)

      // The latest entry should have the refuted verdict.
      const latest = entries[entries.length - 1]
      expect(latest.claim).toBe('所有群都是交换群')
      expect(latest.verdict).toBe('refuted')
      expect(typeof latest.counter_example).toBe('string')
      expect(latest.counter_example).toBeTruthy()
    }).toPass({ timeout: 5000 })
  })

  test('submit confirmed claim updates state with confirmed verdict', async ({ page }) => {
    await gotoTestPage(page)
    await completeOnboarding(page)

    // Populate visualData.
    await page.locator('textarea.text-input').fill('什么是群？')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForTimeout(2000)

    // Switch to grill mode.
    await page.getByRole('tab', { name: '挑战', exact: true }).click()
    await page.waitForTimeout(500)

    const conjectureInput = page.locator('.conjecture-input')
    await expect(conjectureInput).toBeVisible({ timeout: 5000 })

    // Submit a claim containing "唯一" which the mock API confirms.
    await conjectureInput.fill('群的幺元是唯一的')
    await page.getByRole('button', { name: '提交猜想' }).click()

    // Wait for processing to complete.
    await expect(conjectureInput).toHaveValue('', { timeout: 10000 })

    // Verify the verdict is "confirmed".
    await expect(async () => {
      const state = await getPersistedState(page)
      const conjectureState = (state as Record<string, unknown>)?.conjectureState as Record<
        string,
        unknown
      >
      const entries = conjectureState.entries as Record<string, unknown>[]
      const latest = entries[entries.length - 1]
      expect(latest.claim).toBe('群的幺元是唯一的')
      expect(latest.verdict).toBe('confirmed')
      expect(latest.counter_example).toBeNull()
    }).toPass({ timeout: 5000 })
  })
})
