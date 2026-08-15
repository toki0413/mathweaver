import { describe, it, expect } from 'vitest'
import {
  TeachingMemory,
  type TeachingTurn,
  estimateTokens,
  HANDOFF_PROMPT,
} from '../../electron/backend/orchestrator/teachingMemory'

function turn(n: number, opts: Partial<TeachingTurn> = {}): TeachingTurn {
  return {
    student: `学生问题 ${n}`,
    teacher: `教师回应 ${n}`,
    action: 'hint',
    hintLevel: n % 3,
    ...opts,
  }
}

describe('TeachingMemory TLS teaching memory', () => {
  it('keeps recent turns verbatim up to the window budget', () => {
    const m = new TeachingMemory({ maxVerbatimTurns: 3 })
    for (let i = 1; i <= 5; i++) m.recordTurn(turn(i))
    expect(m.verbatimTurnCount).toBe(3)
    // Newest turns survive; oldest folded into the summary.
    expect(m.log.some(t => t.student === '学生问题 1')).toBe(true) // append-only log keeps them
    const block = m.toContextBlock()
    expect(block).toContain('学生问题 5')
    expect(block).toContain('较早对话摘要')
  })

  it('never destroys raw history: append-only log grows while the surface is pruned', () => {
    const m = new TeachingMemory({ maxVerbatimTurns: 2 })
    for (let i = 1; i <= 10; i++) m.recordTurn(turn(i))
    expect(m.verbatimTurnCount).toBe(2)
    expect(m.totalTurnCount).toBe(10)
    expect(m.log.map(t => t.student)).toEqual([
      '学生问题 1',
      '学生问题 2',
      '学生问题 3',
      '学生问题 4',
      '学生问题 5',
      '学生问题 6',
      '学生问题 7',
      '学生问题 8',
      '学生问题 9',
      '学生问题 10',
    ])
  })

  it('tracks cumulative token usage and exposes budget status', () => {
    const m = new TeachingMemory({ sessionTokenBudget: 100 })
    expect(m.tokensUsed).toBe(0)
    expect(m.overBudget).toBe(false)
    m.recordTurn(turn(1), 40)
    m.recordTurn(turn(2), 70)
    expect(m.tokensUsed).toBe(110)
    expect(m.overBudget).toBe(true)
  })

  it('deduplicates concepts and tracks the latest hint level', () => {
    const m = new TeachingMemory()
    m.recordTurn(turn(1, { concept: '单位元', hintLevel: 1 }))
    m.recordTurn(turn(2, { concept: '单位元', hintLevel: 2 }))
    m.recordTurn(turn(3, { concept: '逆元', hintLevel: 0 }))
    expect(m.concepts).toEqual(['单位元', '逆元'])
    expect(m.currentHintLevel).toBe(0)
  })

  it('shouldCompact triggers preventively once the window is at budget', () => {
    const m = new TeachingMemory({ maxVerbatimTurns: 3 })
    expect(m.shouldCompact()).toBe(false)
    m.recordTurn(turn(1))
    m.recordTurn(turn(2))
    expect(m.shouldCompact()).toBe(false)
    m.recordTurn(turn(3))
    expect(m.shouldCompact()).toBe(true)
  })

  it('compactWithLlm folds the window into a handoff summary via the summarizer', async () => {
    const m = new TeachingMemory({ maxVerbatimTurns: 2 })
    m.recordTurn(turn(1))
    m.recordTurn(turn(2))
    const prompt = await (async () => {
      let captured = ''
      const s = await m.compactWithLlm(async (p, turns) => {
        captured = p
        return `进度: 已覆盖 ${turns.length} 轮\n下一步: 逆元`
      })
      expect(s).toContain('下一步')
      expect(s).toContain('进度')
      return captured
    })()
    // The handoff prompt is forward-looking (Codex "handoff > summary").
    expect(prompt).toContain('CONTEXT CHECKPOINT')
    expect(prompt).toContain('下一步')
    // After compaction the verbatim window is empty.
    expect(m.verbatimTurnCount).toBe(0)
    expect(m.totalTurnCount).toBe(2)
  })

  it('compactWithLlm falls back to naive truncation when the summarizer throws', async () => {
    const m = new TeachingMemory({ maxVerbatimTurns: 1 })
    m.recordTurn(turn(1))
    m.recordTurn(turn(2))
    await m.compactWithLlm(() => {
      throw new Error('boom')
    })
    expect(m.rollingSummary?.length ?? 0).toBeGreaterThan(0)
    expect(m.verbatimTurnCount).toBe(0)
  })

  it('toContextBlock enforces a soft token budget keeping newest content', () => {
    const m = new TeachingMemory({ maxVerbatimTurns: 5 })
    for (let i = 1; i <= 5; i++) {
      m.recordTurn(turn(i, { concept: '群论' }))
    }
    const block = m.toContextBlock(20)
    expect(estimateTokens(block)).toBeLessThanOrEqual(20)
    // Concepts + hint level always survive.
    expect(block).toContain('已覆盖概念')
    expect(block).toContain('当前提示等级')
  })

  it('reset clears all state including the append-only log', () => {
    const m = new TeachingMemory()
    m.recordTurn(turn(1), 10)
    m.reset()
    expect(m.totalTurnCount).toBe(0)
    expect(m.tokensUsed).toBe(0)
    expect(m.concepts).toEqual([])
    expect(m.verbatimTurnCount).toBe(0)
    // The hint-level header is always emitted; nothing else survives reset.
    expect(m.toContextBlock()).toBe('当前提示等级: 0')
  })

  it('exposes a handoff compaction prompt constant', () => {
    expect(HANDOFF_PROMPT).toContain('已达成进度')
    expect(HANDOFF_PROMPT).toContain('下一步')
  })
})
