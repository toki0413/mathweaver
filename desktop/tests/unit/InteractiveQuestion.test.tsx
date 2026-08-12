import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InteractiveQuestion } from '@/components/InteractiveQuestion'

// MathText tokenizes Chinese text into multiple spans, so the default
// getByText matcher can't reliably find a plain string. Query the interactive
// role="button" items and match on their textContent instead.
function findItem(text: string): HTMLElement {
  const items = screen.getAllByRole('button')
  const el = items.find(b => b.textContent?.includes(text))
  if (!el) throw new Error(`no interactive item containing "${text}"`)
  return el
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderQuestion({
  question,
  recommendedAnswer,
  disabled,
  onSubmit,
}: {
  question: string
  recommendedAnswer?: string
  disabled?: boolean
  onSubmit?: (a: string) => void
}) {
  const handle = onSubmit ?? vi.fn()
  const utils = render(
    <InteractiveQuestion
      question={question}
      recommendedAnswer={recommendedAnswer}
      onSubmit={handle}
      disabled={disabled}
    />,
  )
  return { handle, ...utils }
}

// ---------------------------------------------------------------------------
// Choice questions
// ---------------------------------------------------------------------------

describe('InteractiveQuestion — choice', () => {
  const CHOICE_Q = '下列哪个是群？A. 整数加法 B. 自然数加法 C. 空集 D. 以上都不是'

  it('detects a choice question and renders the badge + options', () => {
    renderQuestion({ question: CHOICE_Q })
    expect(screen.getByText('🔘 选择题')).toBeInTheDocument()
    expect(screen.getByText('整数加法')).toBeInTheDocument()
    expect(screen.getByText('自然数加法')).toBeInTheDocument()
    expect(screen.getByText('空集')).toBeInTheDocument()
    expect(screen.getByText('以上都不是')).toBeInTheDocument()
  })

  it('submit is disabled until an option is selected', async () => {
    const user = userEvent.setup()
    renderQuestion({ question: CHOICE_Q })
    const submit = screen.getByRole('button', { name: '提交选择' })
    expect(submit).toBeDisabled()

    const option = screen.getByText('整数加法').closest('[role="button"]')!
    await user.click(option)
    expect(submit).toBeEnabled()
  })

  it('submits the selected option label on submit', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({ question: CHOICE_Q })

    const option = screen.getByText('整数加法').closest('[role="button"]')!
    await user.click(option)
    await user.click(screen.getByRole('button', { name: '提交选择' }))

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith('A')
  })

  it('submits the label for circled-number options', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({
      question: '① 交换律 ② 结合律 ③ 分配律 ④ 消去律',
    })
    expect(screen.getByText('🔘 选择题')).toBeInTheDocument()
    const option = screen.getByText('结合律').closest('[role="button"]')!
    await user.click(option)
    await user.click(screen.getByRole('button', { name: '提交选择' }))
    expect(handle).toHaveBeenCalledWith('B')
  })

  it('falls back to an open input when choice parsing fails', () => {
    renderQuestion({ question: '请说明什么使一个集合成为群。' })
    // No choice submit button; instead an open answer textarea appears.
    expect(screen.queryByRole('button', { name: '提交选择' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('输入你的回答...')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// True / False questions
// ---------------------------------------------------------------------------

describe('InteractiveQuestion — true/false', () => {
  const TF_Q = '判断正误：整数加法封闭。'

  it('detects a true/false question and renders both buttons', () => {
    renderQuestion({ question: TF_Q })
    expect(screen.getByText('⚖ 判断题')).toBeInTheDocument()
    expect(screen.getByText('正确')).toBeInTheDocument()
    expect(screen.getByText('错误')).toBeInTheDocument()
  })

  it('submits "正确" when the true button is chosen', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({ question: TF_Q })

    const trueBtn = screen.getByText('正确').closest('[role="button"]')!
    await user.click(trueBtn)
    await user.click(screen.getByRole('button', { name: '确认判断' }))

    expect(handle).toHaveBeenCalledWith('正确')
  })

  it('submits "错误" when the false button is chosen', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({ question: TF_Q })

    const falseBtn = screen.getByText('错误').closest('[role="button"]')!
    await user.click(falseBtn)
    await user.click(screen.getByRole('button', { name: '确认判断' }))

    expect(handle).toHaveBeenCalledWith('错误')
  })

  it('detects true/false from a short recommended answer when no question keyword matches', () => {
    renderQuestion({
      question: '关于群的定义，给出你的判断。',
      recommendedAnswer: '是',
    })
    expect(screen.getByText('⚖ 判断题')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Matching questions
// ---------------------------------------------------------------------------

describe('InteractiveQuestion — matching', () => {
  // The naive paragraph parser treats "：" as a separator, so the keyword line
  // must not end with a colon. "连线" keys the matching detector; each pair is
  // a clean "X → Y" line.
  const MATCH_Q = '连线题 加法 → 交换律\n乘法 → 结合律'

  it('renders left and right columns', () => {
    renderQuestion({ question: MATCH_Q })
    expect(screen.getByText('🔗 匹配题')).toBeInTheDocument()
    // Left column entries render as interactive items.
    expect(findItem('加法')).toBeInTheDocument()
    expect(findItem('乘法')).toBeInTheDocument()
  })

  it('matches a left item to a right answer and submits the pairing', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({ question: MATCH_Q })

    await user.click(findItem('加法'))
    await user.click(findItem('交换律'))

    // Now match the second pair.
    await user.click(findItem('乘法'))
    await user.click(findItem('结合律'))

    const submit = screen.getByRole('button', { name: /提交配对/ })
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(handle).toHaveBeenCalledOnce()
    const answer = handle.mock.calls[0][0] as string
    expect(answer).toContain('加法 → 交换律')
    expect(answer).toContain('乘法 → 结合律')
  })

  it('falls back to an open input when matching parsing fails', () => {
    renderQuestion({ question: '请用文字描述二元运算的性质。' })
    expect(screen.getByPlaceholderText('输入你的回答...')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Open-ended questions
// ---------------------------------------------------------------------------

describe('InteractiveQuestion — open', () => {
  it('renders an open answer input and submits the trimmed value', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({
      question: '请解释什么叫结合律。',
    })

    expect(screen.getByText('✍ 简答题')).toBeInTheDocument()
    const textarea = screen.getByPlaceholderText('输入你的回答...')
    const submit = screen.getByRole('button', { name: '提交回答' })
    expect(submit).toBeDisabled()

    await user.type(textarea, '  结合律是运算满足 (ab)c=a(bc)。  ')
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(handle).toHaveBeenCalledWith('结合律是运算满足 (ab)c=a(bc)。')
  })

  it('submits on Enter without an added newline', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({ question: '请解释什么叫封闭。' })

    const textarea = screen.getByPlaceholderText('输入你的回答...')
    await user.type(textarea, '封闭就是结果仍在集合内')
    await user.keyboard('{Enter}')

    expect(handle).toHaveBeenCalledWith('封闭就是结果仍在集合内')
  })

  it('textarea is disabled when the component is disabled', () => {
    renderQuestion({ question: '请说明单位元的定义。', disabled: true })
    expect(screen.getByPlaceholderText('输入你的回答...')).toBeDisabled()
    expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Mode toggle — switching to free input and back
// ---------------------------------------------------------------------------

describe('InteractiveQuestion — mode toggle', () => {
  it('lets a choice question switch to open then back to interactive', async () => {
    const user = userEvent.setup()
    const CHOICE_Q = '群的阶是指？A. 元素个数 B. 运算次数 C. 零元素 D. 单位元'

    renderQuestion({ question: CHOICE_Q })
    expect(screen.getByText('🔘 选择题')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '✍ 自由输入' }))
    expect(screen.getByPlaceholderText('输入你的回答...')).toBeInTheDocument()

    const backBtn = screen.getByRole('button', { name: '← 返回交互模式' })
    await user.click(backBtn)
    expect(screen.getByRole('button', { name: '提交选择' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Keyboard interaction (a11y)
// ---------------------------------------------------------------------------

describe('InteractiveQuestion — keyboard', () => {
  it('selects a choice option via Enter key', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({
      question: '下列哪个运算满足交换律？A. 减法 B. 加法',
    })

    const option = screen.getByText('减法').closest('[role="button"]')!
    option.focus()
    await user.keyboard('{Enter}')

    const submit = screen.getByRole('button', { name: '提交选择' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(handle).toHaveBeenCalledWith('A')
  })

  it('selects the true/false button via Space key', async () => {
    const user = userEvent.setup()
    const { handle } = renderQuestion({ question: '判断正误：自然数乘法封闭。' })

    const falseBtn = screen.getByText('错误').closest('[role="button"]')!
    falseBtn.focus()
    await user.keyboard(' ')

    await user.click(screen.getByRole('button', { name: '确认判断' }))
    expect(handle).toHaveBeenCalledWith('错误')
  })
})
