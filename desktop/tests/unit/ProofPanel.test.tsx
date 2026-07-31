import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { ProofPanel } from '@/components/ProofPanel'
import { useStore } from '@/stores/sessionStore'

// ---------------------------------------------------------------------------
// Mock the Zustand session store.
//
// ProofPanel reads several slices via `useStore(selector)` and also calls
// `useStore.getState().setSelectedTheorem(...)`. We build a callable mock that
// forwards every selector to a mutable state object, and attach a `getState`
// helper returning the same object. `vi.hoisted` guarantees the state holder
// exists before the (hoisted) `vi.mock` factory is evaluated.
// ---------------------------------------------------------------------------
const { mockState } = vi.hoisted(() => ({
  mockState: {
    proofState: {
      theorems: [] as string[],
      currentResult: null as unknown,
      selectedTheorem: null as string | null,
    },
    fetchTheorems: () => Promise.resolve(),
    submitProof: () => Promise.resolve(),
    loading: false,
    backendReady: true,
    setSelectedTheorem: (_id: string | null) => {},
  },
}))

vi.mock('@/stores/sessionStore', () => ({
  useStore: Object.assign(
    vi.fn((selector?: (s: typeof mockState) => unknown) =>
      typeof selector === 'function' ? selector(mockState) : mockState,
    ),
    { getState: () => mockState },
  ),
}))

/** Reset the shared mock state to a known-good baseline before each test. */
function resetStore(overrides: Partial<typeof mockState> = {}) {
  mockState.proofState = {
    theorems: ['lagrange_theorem', 'cauchy_theorem'],
    currentResult: null,
    selectedTheorem: 'lagrange_theorem',
  }
  mockState.fetchTheorems = vi.fn().mockResolvedValue(undefined)
  mockState.submitProof = vi.fn().mockResolvedValue(undefined)
  mockState.loading = false
  mockState.backendReady = true
  mockState.setSelectedTheorem = vi.fn((id: string | null) => {
    mockState.proofState.selectedTheorem = id
  })
  Object.assign(mockState, overrides)
  vi.mocked(useStore).mockClear()
}

beforeEach(() => {
  resetStore()
})

describe('ProofPanel', () => {
  // -------------------------------------------------------------------------
  // Default (forward) mode
  // -------------------------------------------------------------------------

  it('renders the panel heading and description', () => {
    render(<ProofPanel />)

    expect(screen.getByText('证明验证')).toBeInTheDocument()
    expect(screen.getByText(/选择定理，逐步写出你的证明/)).toBeInTheDocument()
  })

  it('renders forward mode by default with a theorem selector and step editor', () => {
    const { container } = render(<ProofPanel />)

    // The forward tab is selected.
    const forwardTab = screen.getByRole('tab', { name: '正向证明' })
    expect(forwardTab).toHaveAttribute('aria-selected', 'true')
    const backwardTab = screen.getByRole('tab', { name: '倒推模式' })
    expect(backwardTab).toHaveAttribute('aria-selected', 'false')

    // Course-level and theorem selectors exist.
    expect(screen.getByLabelText('课程级别')).toBeInTheDocument()
    expect(screen.getByLabelText('选择定理')).toBeInTheDocument()

    // The theorem dropdown exposes the mocked theorem ids (formatted).
    // "Lagrange Theorem" also appears in the theorem-env block because it is
    // the selected theorem, so use getAllByText; "Cauchy Theorem" only lives
    // in the dropdown options.
    expect(screen.getAllByText('Lagrange Theorem').length).toBeGreaterThan(0)
    expect(screen.getByText('Cauchy Theorem')).toBeInTheDocument()

    // A single editable step textarea is rendered by DragDropProofSteps.
    const stepTextareas = container.querySelectorAll('.ddps-step-textarea')
    expect(stepTextareas).toHaveLength(1)

    // The forward action buttons are present.
    expect(screen.getByRole('button', { name: /添加步骤/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交验证' })).toBeInTheDocument()
  })

  it('fetches theorems for the default curriculum level on mount', () => {
    render(<ProofPanel />)

    expect(mockState.fetchTheorems).toHaveBeenCalledWith('group_theory')
    expect(mockState.fetchTheorems).toHaveBeenCalledTimes(1)
  })

  it('keeps the submit button disabled until a theorem is selected and backend is ready', () => {
    resetStore({
      proofState: {
        theorems: ['lagrange_theorem'],
        currentResult: null,
        selectedTheorem: null,
      },
      backendReady: false,
    })

    render(<ProofPanel />)
    expect(screen.getByRole('button', { name: '提交验证' })).toBeDisabled()
  })

  it('renders the theorem environment once a theorem is selected', () => {
    render(<ProofPanel />)

    expect(screen.getByText('定理')).toBeInTheDocument()
    // The formatted theorem statement is shown via MathText.
    expect(screen.getAllByText('Lagrange Theorem').length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // Mode tabs & accessibility
  // -------------------------------------------------------------------------

  it('exposes a tablist with two tabs and toggles aria-selected on switch', () => {
    render(<ProofPanel />)

    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs).toHaveLength(2)

    const backwardTab = screen.getByRole('tab', { name: '倒推模式' })
    fireEvent.click(backwardTab)

    expect(backwardTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '正向证明' })).toHaveAttribute('aria-selected', 'false')
  })

  // -------------------------------------------------------------------------
  // Backward (倒推) mode
  // -------------------------------------------------------------------------

  it('switches to backward mode and shows the conclusion textarea (#backward-conclusion)', () => {
    render(<ProofPanel />)

    fireEvent.click(screen.getByRole('tab', { name: '倒推模式' }))

    const conclusion = document.getElementById('backward-conclusion')
    expect(conclusion).not.toBeNull()
    expect(conclusion).toBeInstanceOf(HTMLTextAreaElement)
    expect(conclusion).toHaveAttribute('placeholder', '输入你要证明的结论…')

    // The backward hint copy is shown.
    expect(screen.getByText(/倒推模式：从结论出发/)).toBeInTheDocument()
  })

  it('disables the 开始倒推 button until a conclusion is entered', () => {
    render(<ProofPanel />)

    fireEvent.click(screen.getByRole('tab', { name: '倒推模式' }))

    const startBtn = screen.getByRole('button', { name: '开始倒推' })
    expect(startBtn).toBeDisabled()

    const conclusion = document.getElementById('backward-conclusion') as HTMLTextAreaElement
    fireEvent.change(conclusion, { target: { value: '结论 P 成立' } })

    expect(startBtn).not.toBeDisabled()
  })

  it('creates the first backward step and reveals the flip controls after 开始倒推', () => {
    const { container } = render(<ProofPanel />)

    fireEvent.click(screen.getByRole('tab', { name: '倒推模式' }))

    const conclusion = document.getElementById('backward-conclusion') as HTMLTextAreaElement
    fireEvent.change(conclusion, { target: { value: 'C' } })

    fireEvent.click(screen.getByRole('button', { name: '开始倒推' }))

    // One backward step textarea is rendered.
    expect(container.querySelectorAll('.backward-step-textarea')).toHaveLength(1)
    // The start button is replaced by add + flip controls.
    expect(screen.getByRole('button', { name: /添加倒推步骤/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '翻转为正向证明' })).toBeInTheDocument()
    // The prompt references the conclusion as the previous claim ("要证 C，只需证：").
    const prompt = container.querySelector('.backward-step-prompt')
    expect(prompt).not.toBeNull()
    expect(prompt?.textContent).toContain('C')
    expect(prompt?.textContent).toContain('要证')
  })

  // -------------------------------------------------------------------------
  // Forward step editing
  // -------------------------------------------------------------------------

  it('can add and remove proof steps in forward mode', () => {
    const { container } = render(<ProofPanel />)

    // Initially one step textarea.
    expect(container.querySelectorAll('.ddps-step-textarea')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /添加步骤/ }))
    expect(container.querySelectorAll('.ddps-step-textarea')).toHaveLength(2)

    // Remove the first step via its delete button (aria-label 删除此步骤).
    const deleteButtons = screen.getAllByRole('button', { name: '删除此步骤' })
    expect(deleteButtons).toHaveLength(2)
    fireEvent.click(deleteButtons[0])

    expect(container.querySelectorAll('.ddps-step-textarea')).toHaveLength(1)
  })

  it('reflects typed text in the step editor', () => {
    const { container } = render(<ProofPanel />)

    const textarea = container.querySelector('.ddps-step-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '由 a 可得 b' } })

    expect(textarea.value).toBe('由 a 可得 b')
  })

  // -------------------------------------------------------------------------
  // Backward -> forward flip
  // -------------------------------------------------------------------------

  it('reverses the backward chain order when flipping to forward mode', () => {
    const { container } = render(<ProofPanel />)

    // Enter backward mode and build a chain: conclusion C, steps S0 then S1.
    fireEvent.click(screen.getByRole('tab', { name: '倒推模式' }))

    const conclusion = document.getElementById('backward-conclusion') as HTMLTextAreaElement
    fireEvent.change(conclusion, { target: { value: 'C' } })
    fireEvent.click(screen.getByRole('button', { name: '开始倒推' }))

    const backwardTextareas = container.querySelectorAll('.backward-step-textarea')
    fireEvent.change(backwardTextareas[0], { target: { value: 'S0' } })

    fireEvent.click(screen.getByRole('button', { name: /添加倒推步骤/ }))
    const updatedBackward = container.querySelectorAll('.backward-step-textarea')
    fireEvent.change(updatedBackward[1], { target: { value: 'S1' } })

    // Flip to forward.
    fireEvent.click(screen.getByRole('button', { name: '翻转为正向证明' }))

    // We are back in forward mode.
    expect(screen.getByRole('tab', { name: '正向证明' })).toHaveAttribute('aria-selected', 'true')
    // The backward conclusion textarea is gone.
    expect(document.getElementById('backward-conclusion')).toBeNull()

    // Forward steps should be [S1, S0, C] (reversed backward + conclusion).
    const forwardTextareas = Array.from(
      container.querySelectorAll('.ddps-step-textarea'),
    ) as HTMLTextAreaElement[]
    expect(forwardTextareas).toHaveLength(3)
    expect(forwardTextareas.map(t => t.value)).toEqual(['S1', 'S0', 'C'])
  })

  it('keeps the 翻转为正向证明 button disabled while every backward step is empty', () => {
    const { container } = render(<ProofPanel />)

    fireEvent.click(screen.getByRole('tab', { name: '倒推模式' }))
    const conclusion = document.getElementById('backward-conclusion') as HTMLTextAreaElement
    fireEvent.change(conclusion, { target: { value: 'C' } })
    fireEvent.click(screen.getByRole('button', { name: '开始倒推' }))

    const flipBtn = screen.getByRole('button', { name: '翻转为正向证明' })
    expect(flipBtn).toBeDisabled()

    const textarea = container.querySelector('.backward-step-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'S0' } })
    expect(flipBtn).not.toBeDisabled()
  })

  // -------------------------------------------------------------------------
  // Submit verification
  // -------------------------------------------------------------------------

  it('calls submitProof with the selected theorem, steps and level when verifying', async () => {
    const { container } = render(<ProofPanel />)

    const textarea = container.querySelector('.ddps-step-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '因此结论成立' } })

    fireEvent.click(screen.getByRole('button', { name: '提交验证' }))

    expect(mockState.submitProof).toHaveBeenCalledTimes(1)
    expect(mockState.submitProof).toHaveBeenCalledWith(
      'lagrange_theorem',
      ['因此结论成立'],
      'group_theory',
    )
  })

  it('trims and drops empty steps before submitting', () => {
    const { container } = render(<ProofPanel />)

    const textarea = container.querySelector('.ddps-step-textarea') as HTMLTextAreaElement
    // Whitespace-only step should be filtered out.
    fireEvent.change(textarea, { target: { value: '   ' } })

    fireEvent.click(screen.getByRole('button', { name: '提交验证' }))

    expect(mockState.submitProof).not.toHaveBeenCalled()
    // An inline validation error is shown.
    expect(screen.getByText('请至少写一个证明步骤')).toBeInTheDocument()
  })

  it('does not submit when the verify button is disabled (no theorem)', () => {
    resetStore({
      proofState: {
        theorems: ['lagrange_theorem'],
        currentResult: null,
        selectedTheorem: null,
      },
      backendReady: false,
    })

    render(<ProofPanel />)
    const submitBtn = screen.getByRole('button', { name: '提交验证' })
    expect(submitBtn).toBeDisabled()
    fireEvent.click(submitBtn)
    expect(mockState.submitProof).not.toHaveBeenCalled()
  })

  it('uses userEvent to type and submit a proof step', async () => {
    const user = userEvent.setup()
    const { container } = render(<ProofPanel />)

    const textarea = container.querySelector('.ddps-step-textarea') as HTMLTextAreaElement
    await user.type(textarea, '由假设推出结论')

    await user.click(screen.getByRole('button', { name: '提交验证' }))

    expect(mockState.submitProof).toHaveBeenCalledWith(
      'lagrange_theorem',
      ['由假设推出结论'],
      'group_theory',
    )
  })

  // -------------------------------------------------------------------------
  // Curriculum level change
  // -------------------------------------------------------------------------

  it('resets the selected theorem when the curriculum level changes', () => {
    render(<ProofPanel />)

    const levelSelect = screen.getByLabelText('课程级别') as HTMLSelectElement
    fireEvent.change(levelSelect, { target: { value: 'number_theory' } })

    expect(mockState.fetchTheorems).toHaveBeenCalledWith('number_theory')
    expect(mockState.setSelectedTheorem).toHaveBeenCalledWith(null)
  })

  // -------------------------------------------------------------------------
  // Verification results rendering
  // -------------------------------------------------------------------------

  it('renders verification results from the store proofState.currentResult', () => {
    resetStore({
      proofState: {
        theorems: ['lagrange_theorem'],
        selectedTheorem: 'lagrange_theorem',
        currentResult: {
          theorem_name: 'lagrange_theorem',
          steps: [
            {
              step_number: 1,
              claim: '第一步',
              justification: 'because',
              is_valid: true,
              feedback: 'good',
              matched_expected: '',
              implicit_steps: [],
            },
          ],
          is_complete: false,
          missing_steps: ['缺少的一步'],
          socratic_hint: '想一想逆否命题',
          overall_feedback: '继续努力',
          progress: '1/3',
        },
      },
    })

    render(<ProofPanel />)

    expect(screen.getByText('验证结果')).toBeInTheDocument()
    expect(screen.getByText('继续努力')).toBeInTheDocument()
    expect(screen.getByText(/进度 1\/3 步/)).toBeInTheDocument()
    expect(screen.getByText('第 1 步')).toBeInTheDocument()
    // Missing step is rendered as a clickable item.
    expect(screen.getByText('缺少的一步')).toBeInTheDocument()
    // Socratic hint is shown.
    expect(screen.getByText('苏格拉底提示')).toBeInTheDocument()
  })
})
