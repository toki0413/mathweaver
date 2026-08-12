import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '@/stores/sessionStore'
import { GrillPanel } from '@/components/GrillPanel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A sample grill question with a long recommended answer for hint testing. */
const SAMPLE_QUESTION = {
  qid: 'q-001',
  concept_node_id: 'node-group',
  concept_name: '群论基础',
  question: 'What is a group? Define it formally.',
  recommended_answer:
    'A group is a set equipped with a binary operation that satisfies closure, associativity, identity, and invertibility axioms.',
  difficulty: 0.5,
  branch_type: 'concept',
}

/** A sample adaptive summary for the stats row. */
const SAMPLE_SUMMARY = {
  active: true,
  total_branches: 5,
  resolved_branches: 3,
  correct_answers: 2,
  progress: '60%',
  adaptive: {
    current_difficulty: 0.55,
    difficulty_band: 'standard',
    target_difficulty: 0.6,
    accuracy_rate: 0.67,
    streak_correct: 2,
    streak_wrong: 1,
    total_questions: 3,
    total_correct: 2,
    trend: 'rising',
    should_increase: true,
    should_decrease: false,
  },
  encouragement: {},
  branches: {},
}

/** Mock action stubs — replaced on the store before each render. */
const mockStartGrill = vi.fn().mockResolvedValue(undefined)
const mockSubmitGrillAnswer = vi.fn().mockResolvedValue(undefined)

interface RenderOptions {
  active?: boolean
  currentQuestion?: typeof SAMPLE_QUESTION | null
  difficulty?: number
  questionsAsked?: number
  encouragement?: string
  summary?: typeof SAMPLE_SUMMARY | null
  loading?: boolean
  backendReady?: boolean
}

/**
 * Set the store to the desired grillState + flags, then render GrillPanel.
 * The action methods are replaced with vi.fn stubs so the component's
 * interaction logic can be asserted without hitting the real backend.
 */
function renderGrillPanel(opts: RenderOptions = {}) {
  useStore.setState({
    grillState: {
      active: opts.active ?? false,
      currentQuestion: opts.currentQuestion ?? null,
      difficulty: opts.difficulty ?? 0.5,
      questionsAsked: opts.questionsAsked ?? 0,
      encouragement: opts.encouragement ?? '',
      summary: opts.summary ?? null,
    },
    loading: opts.loading ?? false,
    backendReady: opts.backendReady ?? true,
    startGrill: mockStartGrill,
    submitGrillAnswer: mockSubmitGrillAnswer,
  })
  return render(<GrillPanel />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrillPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Inactive state — start section
  // -------------------------------------------------------------------------

  describe('when grill is not active', () => {
    it('renders the start button', () => {
      renderGrillPanel({ active: false })
      expect(screen.getByRole('button', { name: '开始挑战' })).toBeInTheDocument()
    })

    it('shows the curriculum level selector with all options', () => {
      renderGrillPanel({ active: false })
      const select = screen.getByLabelText('课程级别')
      expect(select).toBeInTheDocument()

      const options = within(select).getAllByRole('option')
      // CURRICULUM_LEVELS has 10 entries + the leading "默认" option = 11.
      expect(options).toHaveLength(11)

      // Spot-check a few labels.
      expect(screen.getByText('默认（群论）')).toBeInTheDocument()
      expect(screen.getByText('群论（大学）')).toBeInTheDocument()
      expect(screen.getByText('线性代数（大学）')).toBeInTheDocument()
      expect(screen.getByText('高中')).toBeInTheDocument()
      expect(screen.getByText('小学')).toBeInTheDocument()
    })

    it('start button calls startGrill action', async () => {
      const user = userEvent.setup()
      renderGrillPanel({ active: false })

      await user.click(screen.getByRole('button', { name: '开始挑战' }))

      expect(mockStartGrill).toHaveBeenCalledOnce()
      // First arg is a student id string starting with 'grill_'
      const [studentId, curriculumLevel] = mockStartGrill.mock.calls[0]
      expect(studentId).toMatch(/^grill_\d+$/)
      // Default curriculum level is '' → passed as undefined
      expect(curriculumLevel).toBeUndefined()
    })

    it('start button calls startGrill with the selected curriculum level', async () => {
      const user = userEvent.setup()
      renderGrillPanel({ active: false })

      const select = screen.getByLabelText('课程级别')
      await user.selectOptions(select, 'linear_algebra')
      await user.click(screen.getByRole('button', { name: '开始挑战' }))

      expect(mockStartGrill).toHaveBeenCalledOnce()
      const [, curriculumLevel] = mockStartGrill.mock.calls[0]
      expect(curriculumLevel).toBe('linear_algebra')
    })

    it('start button is disabled when backendReady is false', () => {
      renderGrillPanel({ active: false, backendReady: false })
      expect(screen.getByRole('button', { name: '开始挑战' })).toBeDisabled()
    })

    it('start button is disabled when loading', () => {
      renderGrillPanel({ active: false, loading: true })
      const btn = screen.getByRole('button', { name: '启动中' })
      expect(btn).toBeDisabled()
    })

    it('does not show the question section', () => {
      renderGrillPanel({ active: false })
      expect(screen.queryByText('提交回答')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Active state — question section
  // -------------------------------------------------------------------------

  describe('when grill is active with a current question', () => {
    it('shows the current question text', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })
      expect(screen.getByText(/What is a group/)).toBeInTheDocument()
    })

    it('shows the answer textarea', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })
      expect(screen.getByPlaceholderText('输入你的回答...')).toBeInTheDocument()
    })

    it('submit button is disabled when answer is empty', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })
      expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled()
    })

    it('submit button is enabled when answer has text', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      const textarea = screen.getByPlaceholderText('输入你的回答...')
      await user.type(textarea, 'A group is a set with an operation.')

      expect(screen.getByRole('button', { name: '提交回答' })).toBeEnabled()
    })

    it('submit calls submitGrillAnswer with qid, answer, and response time', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      const textarea = screen.getByPlaceholderText('输入你的回答...')
      await user.type(textarea, 'My answer text')

      await user.click(screen.getByRole('button', { name: '提交回答' }))

      expect(mockSubmitGrillAnswer).toHaveBeenCalledOnce()
      const [qid, answer, rt] = mockSubmitGrillAnswer.mock.calls[0]
      expect(qid).toBe('q-001')
      expect(answer).toBe('My answer text')
      expect(typeof rt).toBe('number')
    })

    it('submit calls submitGrillAnswer with the answer', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      const textarea = screen.getByPlaceholderText('输入你的回答...') as HTMLTextAreaElement
      await user.type(textarea, 'Some answer')
      await user.click(screen.getByRole('button', { name: '提交回答' }))

      expect(mockSubmitGrillAnswer).toHaveBeenCalledOnce()
    })

    it('submit button is disabled while loading', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        loading: true,
      })
      const btn = screen.getByRole('button', { name: '提交回答' })
      expect(btn).toBeDisabled()
    })

    it('shows a "重新开始" (restart) button', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })
      expect(screen.getByRole('button', { name: '重新开始' })).toBeInTheDocument()
    })

    it('restart button calls startGrill', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      await user.click(screen.getByRole('button', { name: '重新开始' }))

      expect(mockStartGrill).toHaveBeenCalled()
    })

    it('shows concept name tag when present', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })
      expect(screen.getByText('群论基础')).toBeInTheDocument()
    })

    it('shows branch type badge when branch_type is not concept', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: { ...SAMPLE_QUESTION, branch_type: 'edge_case' },
      })
      expect(screen.getByText('edge_case')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Hint level buttons
  // -------------------------------------------------------------------------

  describe('hint level buttons', () => {
    it('shows L1, L2, and 查看答案 buttons when hint level is 0', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })
      expect(screen.getByRole('button', { name: '💡 方向提示' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '📝 详细提示' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '查看答案' })).toBeInTheDocument()
    })

    it('L1 button reveals the L1 hint (truncated at word boundary)', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      await user.click(screen.getByRole('button', { name: '💡 方向提示' }))

      // L1 label should now be visible
      const l1Labels = screen.getAllByText('L1 提示')
      expect(l1Labels.length).toBeGreaterThanOrEqual(1)

      // The hint text should be truncated at a word boundary (no sentence/comma
      // break within range, so falls back to lastIndexOf(' ', 50))
      const answer = SAMPLE_QUESTION.recommended_answer
      const cut = answer.lastIndexOf(' ', 50)
      const expectedL1 = answer.slice(0, cut) + '...'
      // MathText wraps content in spans, so use a function matcher on textContent
      expect(
        screen.getAllByText((_, node) => node?.textContent === expectedL1).length,
      ).toBeGreaterThan(0)

      // L2 and answer should NOT be visible yet
      expect(screen.queryByText('参考答案')).not.toBeInTheDocument()
    })

    it('L2 button reveals both L1 and L2 hints', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      await user.click(screen.getByRole('button', { name: '📝 详细提示' }))

      // L2 hint label should be visible
      expect(screen.getAllByText('L2 提示').length).toBeGreaterThanOrEqual(1)

      // The L2 hint finds the first sentence end (the trailing '.') and since
      // there's no second sentence, returns the full text + '...'
      const answer = SAMPLE_QUESTION.recommended_answer
      const firstEnd = answer.search(/[。！？.!?;]/)
      const expectedL2 = answer.slice(0, firstEnd + 1) + '...'
      // MathText wraps content in spans, so use a function matcher on textContent
      expect(
        screen.getAllByText((_, node) => node?.textContent === expectedL2).length,
      ).toBeGreaterThan(0)

      // Full answer should NOT be visible yet
      expect(screen.queryByText('参考答案')).not.toBeInTheDocument()
    })

    it('查看答案 button reveals L1, L2, and the full answer', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      await user.click(screen.getByRole('button', { name: '查看答案' }))

      // The full recommended answer should be visible
      expect(screen.getByText('参考答案')).toBeInTheDocument()
      expect(screen.getByText(SAMPLE_QUESTION.recommended_answer)).toBeInTheDocument()
    })

    it('收起 button hides hints and shows the hint buttons again', async () => {
      const user = userEvent.setup()
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
      })

      // Reveal L1
      await user.click(screen.getByRole('button', { name: '💡 方向提示' }))
      // The hint buttons should be replaced by the 收起 button
      expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '📝 详细提示' })).not.toBeInTheDocument()

      // Click 收起
      await user.click(screen.getByRole('button', { name: '收起' }))

      // Hint buttons should be back
      expect(screen.getByRole('button', { name: '💡 方向提示' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '📝 详细提示' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '查看答案' })).toBeInTheDocument()
    })

    it('does not show hint buttons when question has no recommended_answer', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: { ...SAMPLE_QUESTION, recommended_answer: '' },
      })
      expect(screen.queryByRole('button', { name: '💡 方向提示' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '📝 详细提示' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '查看答案' })).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Encouragement message
  // -------------------------------------------------------------------------

  describe('encouragement message', () => {
    it('is displayed when present and a current question exists', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        encouragement: '做得不错！继续保持。',
      })
      expect(screen.getByText('系统反馈')).toBeInTheDocument()
      expect(screen.getByText('做得不错！继续保持。')).toBeInTheDocument()
    })

    it('is not shown when there is no current question', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: null,
        encouragement: '鼓励文本',
      })
      // The encouragement section (with 系统反馈 label) should not appear
      expect(screen.queryByText('系统反馈')).not.toBeInTheDocument()
    })

    it('falls back to a default message when no current question and no encouragement', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: null,
        encouragement: '',
      })
      expect(screen.getByText(/所有问题已回答完毕/)).toBeInTheDocument()
    })

    it('shows encouragement text in the paragraph when no current question', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: null,
        encouragement: '面试结束，干得好！',
      })
      expect(screen.getByText('面试结束，干得好！')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Difficulty badge
  // -------------------------------------------------------------------------

  describe('difficulty badge', () => {
    it('shows difficulty percentage and label', () => {
      const { container } = renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        difficulty: 0.55,
      })
      // 55% — 标准 (0.55 → difficultyLabel: 0.55 < 0.6 → '标准')
      expect(screen.getByText('55% — 标准')).toBeInTheDocument()

      // The meter fill div exists
      const fill = container.querySelector('.difficulty-meter-fill')
      expect(fill).not.toBeNull()
      expect(fill).toHaveStyle({ width: '55%' })
    })

    it('applies success class for very low difficulty (< 0.3)', () => {
      const { container } = renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        difficulty: 0.2,
      })
      const fill = container.querySelector('.difficulty-meter-fill')
      expect(fill).toHaveClass('success')
    })

    it('applies no extra class for low-medium difficulty (0.3 <= d < 0.5)', () => {
      const { container } = renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        difficulty: 0.4,
      })
      const fill = container.querySelector('.difficulty-meter-fill')
      expect(fill).not.toHaveClass('success')
      expect(fill).not.toHaveClass('warning')
      expect(fill).not.toHaveClass('danger')
    })

    it('applies warning class for medium difficulty (0.5 <= d < 0.7)', () => {
      const { container } = renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        difficulty: 0.6,
      })
      const fill = container.querySelector('.difficulty-meter-fill')
      expect(fill).toHaveClass('warning')
    })

    it('applies danger class for high difficulty (>= 0.7)', () => {
      const { container } = renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        difficulty: 0.8,
      })
      const fill = container.querySelector('.difficulty-meter-fill')
      expect(fill).toHaveClass('danger')
    })

    it('shows correct difficulty label for each band', () => {
      const cases: Array<[number, string]> = [
        [0.2, '热身'],
        [0.4, '基础'],
        [0.55, '标准'],
        [0.7, '进阶'],
        [0.85, '挑战'],
      ]
      for (const [d, label] of cases) {
        const { unmount } = renderGrillPanel({
          active: true,
          currentQuestion: SAMPLE_QUESTION,
          difficulty: d,
        })
        const pct = Math.round(d * 100)
        expect(screen.getByText(`${pct}% — ${label}`)).toBeInTheDocument()
        unmount()
      }
    })
  })

  // -------------------------------------------------------------------------
  // Stats row (summary / adaptive data)
  // -------------------------------------------------------------------------

  describe('stats row', () => {
    it('shows questions asked count', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        questionsAsked: 7,
      })
      expect(screen.getByText('7')).toBeInTheDocument()
    })

    it('shows correct/total from summary when present', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        summary: SAMPLE_SUMMARY,
      })
      // summary.correct_answers = 2, summary.resolved_branches = 3
      expect(screen.getByText('已完成 2/3')).toBeInTheDocument()
    })

    it('shows accuracy rate from adaptive summary', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        summary: SAMPLE_SUMMARY,
      })
      // accuracy_rate = 0.67 → 67%
      expect(screen.getByText('67%')).toBeInTheDocument()
    })

    it('shows streak info from adaptive summary', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        summary: SAMPLE_SUMMARY,
      })
      // streak_correct = 2, streak_wrong = 1
      expect(screen.getByText('连对 2 — 连错 1')).toBeInTheDocument()
    })

    it('shows trend arrow for rising trend', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        summary: SAMPLE_SUMMARY,
      })
      // trend = 'rising' → ↑
      expect(screen.getByText('↑')).toBeInTheDocument()
    })

    it('shows trend arrow for falling trend', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: SAMPLE_QUESTION,
        summary: {
          ...SAMPLE_SUMMARY,
          adaptive: { ...SAMPLE_SUMMARY.adaptive, trend: 'falling' },
        },
      })
      expect(screen.getByText('↓')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Loading state (no current question)
  // -------------------------------------------------------------------------

  describe('when active but loading with no current question', () => {
    it('shows loading indicator', () => {
      renderGrillPanel({
        active: true,
        currentQuestion: null,
        loading: true,
      })
      expect(screen.getByText('正在生成下一个问题')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Wrong-question re-ask phase
  // -------------------------------------------------------------------------

  /**
   * Render with a summary whose adaptive.streak_wrong is > 0 so the
   * "答错检测" effect records the current question into wrongQuestions.
   * The effect runs after mount, so the caller must await the banner.
   */
  function renderWithWrongQuestion() {
    const utils = renderGrillPanel({
      active: true,
      currentQuestion: SAMPLE_QUESTION,
      summary: {
        ...SAMPLE_SUMMARY,
        adaptive: { ...SAMPLE_SUMMARY.adaptive, streak_wrong: 1 },
      },
    })
    return utils
  }

  describe('wrong-question re-ask phase', () => {
    it('records a wrong question and shows the pending banner', async () => {
      renderWithWrongQuestion()
      await waitFor(() => {
        expect(screen.getByText(/还有 1 道错题将在结束时重新出现/)).toBeInTheDocument()
      })
    })

    it('"结束并复习错题" enters the re-ask phase and shows the queued question', async () => {
      const user = userEvent.setup()
      renderWithWrongQuestion()

      const endBtn = await screen.findByRole('button', {
        name: /结束并复习错题/,
      })
      await user.click(endBtn)

      expect(screen.getByText(/错题复习/)).toBeInTheDocument()
      // The recorded question text is shown in the re-ask section.
      expect(screen.getByText(/What is a group/)).toBeInTheDocument()
    })

    it('submitting a re-ask answer removes it from the queue and exits re-ask', async () => {
      const user = userEvent.setup()
      renderWithWrongQuestion()

      const endBtn = await screen.findByRole('button', { name: /结束并复习错题/ })
      await user.click(endBtn)

      const textarea = screen.getByLabelText('输入你的答案')
      await user.type(textarea, 'A group is a set with an operation.')
      await user.click(screen.getByRole('button', { name: '提交复习答案' }))

      // With one wrong question, clearing it exits the re-ask phase and the
      // banner disappears.
      await waitFor(() => {
        expect(screen.queryByText(/错题复习/)).not.toBeInTheDocument()
      })
    })

    it('re-ask submit button is disabled while the answer is empty', async () => {
      const user = userEvent.setup()
      renderWithWrongQuestion()

      const endBtn = await screen.findByRole('button', { name: /结束并复习错题/ })
      await user.click(endBtn)

      expect(screen.getByRole('button', { name: '提交复习答案' })).toBeDisabled()
    })

    it('"跳过" skips the re-asked question without submitting', async () => {
      const user = userEvent.setup()
      renderWithWrongQuestion()

      const endBtn = await screen.findByRole('button', { name: /结束并复习错题/ })
      await user.click(endBtn)

      await user.click(screen.getByRole('button', { name: '跳过' }))
      await waitFor(() => {
        expect(screen.queryByText(/错题复习/)).not.toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // End-challenge button
  // -------------------------------------------------------------------------

  describe('end-challenge button', () => {
    it('shows "结束挑战" when there are no wrong questions', () => {
      renderGrillPanel({ active: true, currentQuestion: SAMPLE_QUESTION })
      expect(screen.getByRole('button', { name: '结束挑战' })).toBeInTheDocument()
    })

    it('shows the wrong-question count when wrong questions exist', async () => {
      renderWithWrongQuestion()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '结束并复习错题 (1)' })).toBeInTheDocument()
      })
    })
  })
})
