/**
 * Long-horizon teaching memory.
 *
 * Adapted for Socratic teaching from the "handoff summary" pattern used by
 * OpenAI Codex' local compaction path, and the "model-visible means logged"
 * principle of DeepSeek Harness:
 *
 *  - Recent turns are kept verbatim (bounded window, oldest folds out).
 *  - When the verbatim window reaches its budget, turns are folded into a
 *    rolling structured handoff summary written in "notes-to-self" register so
 *    a successor request resumes naturally instead of restarting (Codex
 *    "handoff > summary": forward-looking — progress / constraints / next steps).
 *  - Compaction can be LLM-driven via {@link TeachingMemory.compactWithLlm},
 *    matching Codex' local compaction path, or fall back to naive truncation.
 *  - Raw history is never destroyed: every turn is kept in an append-only log
 *    (Harness "model-visible means logged"); pruning only changes the surface
 *    the model sees, so audit/replay/persistence stay possible.
 *  - The emitted context block enforces a soft token budget (Codex
 *    `_enforce_token_budget`), keeping the newest, most task-relevant content.
 *
 * The model-visible block emitted by {@link TeachingMemory.toContextBlock} is
 * injected into both the routing LLM input and the Collaboration agent so the
 * teacher can recall what was already covered across a long session.
 */

/** A single completed teaching exchange. */
export interface TeachingTurn {
  /** What the student said (verbatim). */
  student: string
  /** What the teacher replied (the delivered response). */
  teacher: string
  /** Pedagogical action taken this turn. */
  action: string
  /** Hint level after this turn. */
  hintLevel: number
  /** Concept currently being worked on, if known. */
  concept?: string
}

export interface TeachingMemoryOptions {
  /** Max number of turns kept verbatim in the window. */
  maxVerbatimTurns?: number
  /** Max length (chars) of the folded rolling summary. */
  maxSummaryLength?: number
  /** Soft token budget for the whole session; negative disables the cap. */
  sessionTokenBudget?: number
  /** Soft token budget for the emitted model-visible block; <=0 disables. */
  maxBlockTokens?: number
}

/**
 * Handoff compaction prompt (adapted from Codex' context-checkpoint prompt).
 * Written to produce a forward-looking handoff, not a backward-looking recap.
 */
export const HANDOFF_PROMPT = `You are performing a CONTEXT CHECKPOINT for a long-running Socratic math teaching session.
Create a handoff summary for another LLM (the teacher) that will resume guiding this student.

Include:
- 已达成进度 (progress): what the student has accomplished and understood so far
- 关键决策与约束 (constraints): pedagogical decisions, difficulty calibration, pacing rules
- 学生状态 (student state): mastery level, common mistakes, emotional/engagement signals, learning habits
- 下一步 (next steps): what to teach next, which concepts remain uncovered

Write in concise notes-to-self register (Chinese), not exposition. Preserve any concrete facts (numbers, exact student phrasing) that the successor needs to continue accurately.`

/**
 * Rough token estimate used for block-budget enforcement. CJK-heavy text runs
 * ~1 token per character; latin ~4 chars/token. Dividing by 4 is a safe,
 * over-estimating heuristic that keeps the block under budget.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export class TeachingMemory {
  readonly maxVerbatimTurns: number
  readonly maxSummaryLength: number
  readonly sessionTokenBudget: number
  readonly maxBlockTokens: number

  private recentTurns: TeachingTurn[] = []
  /** Append-only log of every turn (Harness: raw history is never destroyed). */
  private allTurns: TeachingTurn[] = []
  private rollingSummary = ''
  private coveredConcepts: string[] = []
  private hintLevel = 0
  private totalTokensUsed = 0

  constructor(opts: TeachingMemoryOptions = {}) {
    this.maxVerbatimTurns = opts.maxVerbatimTurns ?? 6
    this.maxSummaryLength = opts.maxSummaryLength ?? 1200
    this.sessionTokenBudget = opts.sessionTokenBudget ?? -1
    this.maxBlockTokens = opts.maxBlockTokens ?? -1
  }

  /** Acknowledged concepts, deduplicated, in first-seen order. */
  get concepts(): string[] {
    return [...new Set(this.coveredConcepts)]
  }

  /** Current hint level (latest turn). */
  get currentHintLevel(): number {
    return this.hintLevel
  }

  /** Cumulative tokens consumed by LLM calls this session. */
  get tokensUsed(): number {
    return this.totalTokensUsed
  }

  /** Whether the session has exceeded its configured soft token budget. */
  get overBudget(): boolean {
    return this.sessionTokenBudget >= 0 && this.totalTokensUsed > this.sessionTokenBudget
  }

  /** Number of turns currently held verbatim. */
  get verbatimTurnCount(): number {
    return this.recentTurns.length
  }

  /** Read-only copy of the append-only log (all turns, never pruned). */
  get log(): ReadonlyArray<TeachingTurn> {
    return this.allTurns
  }

  /** Number of turns ever recorded (== log length). */
  get totalTurnCount(): number {
    return this.allTurns.length
  }

  /**
   * Preventive compaction trigger (Codex: compact before the window fills,
   * not reactively after overflow). True once the verbatim window is at or
   * beyond its budget, meaning the next turn would start folding.
   */
  shouldCompact(): boolean {
    return this.recentTurns.length >= this.maxVerbatimTurns
  }

  /** Record one completed teaching turn and fold/trim as needed. */
  recordTurn(turn: TeachingTurn, usageTokens = 0): void {
    this.totalTokensUsed += usageTokens
    this.allTurns.push(turn)
    this.recentTurns.push(turn)
    if (turn.concept) {
      this.coveredConcepts.push(turn.concept)
    }
    this.hintLevel = turn.hintLevel
    this.prune()
  }

  /**
   * LLM-driven handoff compaction (Codex local compaction path): fold the whole
   * verbatim window into a structured handoff summary via the provided
   * summarizer, so a successor request resumes naturally. Falls back to naive
   * truncation when the summarizer returns nothing or throws.
   *
   * @returns the folded rolling summary.
   */
  async compactWithLlm(
    summarizer: (prompt: string, turns: ReadonlyArray<TeachingTurn>) => Promise<string> | string,
  ): Promise<string> {
    if (this.recentTurns.length === 0) return this.rollingSummary
    const turns = this.recentTurns.splice(0, this.recentTurns.length)
    let folded = ''
    try {
      const summary = await summarizer(HANDOFF_PROMPT, turns)
      folded = typeof summary === 'string' ? summary.trim() : ''
    } catch {
      folded = ''
    }
    if (folded) {
      this.rollingSummary = this.rollingSummary
        ? `${this.rollingSummary}\n---\n${folded}`
        : folded
    } else {
      // Fallback: naive fold of the evicted turns.
      for (const t of turns) {
        const line = `学生: ${t.student}\n教师: ${t.teacher}（${t.action}）`
        this.rollingSummary = this.rollingSummary ? `${this.rollingSummary}\n---\n${line}` : line
      }
    }
    this.trimSummary()
    return this.rollingSummary
  }

  /** Fold the oldest turns into the rolling summary until the window fits. */
  private prune(): void {
    while (this.recentTurns.length > this.maxVerbatimTurns) {
      const oldest = this.recentTurns.shift()!
      const line = `学生: ${oldest.student}\n教师: ${oldest.teacher}（${oldest.action}）`
      this.rollingSummary = this.rollingSummary
        ? `${this.rollingSummary}\n---\n${line}`
        : line
    }
    this.trimSummary()
  }

  /** Keep the summary within a bounded window (newest tail). */
  private trimSummary(): void {
    if (this.rollingSummary.length > this.maxSummaryLength) {
      this.rollingSummary = this.rollingSummary.slice(-this.maxSummaryLength)
    }
  }

  /** Reset the memory (used when a new session starts). */
  reset(): void {
    this.recentTurns = []
    this.allTurns = []
    this.rollingSummary = ''
    this.coveredConcepts = []
    this.hintLevel = 0
    this.totalTokensUsed = 0
  }

  /**
   * Model-visible context block. Injected into LLM prompts so both the routing
   * decision and the teacher's synthesis can recall prior turns. When
   * `maxTokens > 0`, the block is trimmed to that soft budget keeping the
   * newest, most task-relevant content (concepts + hint level always survive).
   */
  toContextBlock(maxTokens = this.maxBlockTokens): string {
    const head: string[] = []
    const concepts = this.concepts
    if (concepts.length > 0) head.push(`已覆盖概念: ${concepts.join(', ')}`)
    head.push(`当前提示等级: ${this.hintLevel}`)

    let summary = this.rollingSummary
    let recent = [...this.recentTurns]

    const render = (): string => {
      const parts = [...head]
      if (summary) parts.push(`较早对话摘要:\n${summary}`)
      if (recent.length > 0) {
        parts.push('近几轮对话:')
        for (const t of recent) parts.push(`- 学生: ${t.student}\n  教师: ${t.teacher}`)
      }
      return parts.join('\n')
    }

    if (maxTokens > 0) {
      // 1) Shrink the folded summary (newest tail kept) until it fits.
      while (summary && estimateTokens(render()) > maxTokens) {
        summary = summary.slice(Math.max(0, Math.floor(summary.length * 0.6)))
      }
      // 2) Drop the oldest verbatim turns until it fits.
      while (recent.length > 0 && estimateTokens(render()) > maxTokens) {
        recent.shift()
      }
    }
    return render()
  }

  /**
   * 序列化为可持久化的普通对象（跨会话恢复）。
   *
   * 输出包含追加式轮次日志 allTurns 与滚动摘要，写入 StateStore 后可在新的
   * 会话中重建，实现长周期教学任务的续接（对应 Harness "模型可见即已记录"
   * —— 原始历史不因压缩而丢失）。
   */
  toJSON(): TeachingMemorySnapshot {
    return {
      recentTurns: this.recentTurns,
      allTurns: this.allTurns,
      rollingSummary: this.rollingSummary,
      coveredConcepts: this.coveredConcepts,
      hintLevel: this.hintLevel,
      totalTokensUsed: this.totalTokensUsed,
    }
  }

  /**
   * 从持久化快照重建教学记忆（配合 {@link toJSON}）。
   *
   * 对缺失/畸形字段做防御性兜底，即使旧版本数据也能安全恢复，不会抛错。
   */
  static fromJSON(data: Partial<TeachingMemorySnapshot>, opts: TeachingMemoryOptions = {}): TeachingMemory {
    const m = new TeachingMemory(opts)
    m.recentTurns = Array.isArray(data.recentTurns) ? data.recentTurns : []
    m.allTurns = Array.isArray(data.allTurns) ? data.allTurns : []
    m.rollingSummary = typeof data.rollingSummary === 'string' ? data.rollingSummary : ''
    m.coveredConcepts = Array.isArray(data.coveredConcepts) ? data.coveredConcepts : []
    m.hintLevel = typeof data.hintLevel === 'number' ? data.hintLevel : 0
    m.totalTokensUsed = typeof data.totalTokensUsed === 'number' ? data.totalTokensUsed : 0
    return m
  }
}

/** TeachingMemory 的可序列化快照（用于跨会话持久化）。 */
export interface TeachingMemorySnapshot {
  recentTurns: TeachingTurn[]
  allTurns: TeachingTurn[]
  rollingSummary: string
  coveredConcepts: string[]
  hintLevel: number
  totalTokensUsed: number
}