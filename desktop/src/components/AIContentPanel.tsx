import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useStore } from '../stores/sessionStore'
import type { AgeLevel } from '../utils/ageAdapt'

/**
 * AI 内容生成面板 — LLM 驱动的动态内容生成
 *
 * AI 时代的新数学运动核心组件之一：不再把内容预先写死，而是由 LLM 根据当前
 * 运算表、年龄等级、难度与主题，实时生成三类教学素材：
 *   - exercise  (习题): 问题 + 提示 + 答案 + 解析
 *   - story     (故事): 标题 + 正文 + 可视化描述 + 数学钩子
 *   - challenge (挑战): 标题 + 任务 + 提示 + 成功标准 + 步骤
 *
 * 设计理念：
 *   - 三层年龄适配（kids / tweens / teens），从游戏化隐喻到完整学术术语
 *   - 主题预设按钮 + 自定义输入，覆盖群论核心概念
 *   - 难度滑块 0~1，控制生成内容的认知负荷
 *   - 优雅的加载、错误与历史状态
 *   - 全部 CSS 内联，复用既有设计系统变量
 *
 * 数据流：useStore.getState().generateContent(...) -> 后端 LLM -> store.dynamicContent
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface AIContentPanelProps {
  ageLevel: AgeLevel
  tableSize: number
  table: number[][]
}

type ContentType = 'exercise' | 'story' | 'challenge'

interface GeneratedItem {
  type: ContentType
  item: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 常量：年龄适配的主题预设、标签
// ---------------------------------------------------------------------------

/** 各年龄段的主题预设按钮 */
const TOPIC_PRESETS: Record<AgeLevel, string[]> = {
  kids: ['碰一碰规则', '找老大', '好搭档', '换位置', '绕圈圈'],
  tweens: ['闭合性', '单位元', '逆元', '结合律', '交换律', '循环子群', 'Lagrange定理'],
  teens: [
    'Group Axioms',
    'Subgroups',
    'Cosets',
    'Lagrange Theorem',
    'Homomorphism',
    'Isomorphism',
    'Normal Subgroups',
  ],
}

/** 内容类型 Tab 配置 */
const TYPE_TABS: { id: ContentType; icon: string; label: Record<AgeLevel, string> }[] = [
  { id: 'exercise', icon: '✏️', label: { kids: '习题', tweens: '习题', teens: 'Exercise' } },
  { id: 'story', icon: '📖', label: { kids: '故事', tweens: '故事', teens: 'Story' } },
  { id: 'challenge', icon: '🎯', label: { kids: '挑战', tweens: '挑战', teens: 'Challenge' } },
]

/** 年龄适配文案表 */
const L = {
  panelTitle: { kids: 'AI 魔法工厂', tweens: 'AI 内容生成', teens: 'AI Content Studio' } as Record<
    AgeLevel,
    string
  >,
  topicLabel: { kids: '想学什么？', tweens: '选择主题', teens: 'Topic' } as Record<
    AgeLevel,
    string
  >,
  topicPlaceholder: {
    kids: '输入你想探索的内容…',
    tweens: '输入或选择主题…',
    teens: 'Type a topic…',
  } as Record<AgeLevel, string>,
  difficultyLabel: { kids: '难度', tweens: '难度', teens: 'Difficulty' } as Record<
    AgeLevel,
    string
  >,
  generate: { kids: '✨ 让 AI 变魔法', tweens: '✨ 生成内容', teens: '✨ Generate' } as Record<
    AgeLevel,
    string
  >,
  generating: { kids: '✨ 让 AI 变魔法', tweens: '✨ 生成内容', teens: '✨ Generate' } as Record<
    AgeLevel,
    string
  >,
  loading: {
    kids: 'AI 正在想题目... 🤔',
    tweens: 'AI 正在生成内容...',
    teens: 'Generating content...',
  } as Record<AgeLevel, string>,
  showHint: { kids: '💡 显示提示', tweens: '💡 显示提示', teens: '💡 Show Hint' } as Record<
    AgeLevel,
    string
  >,
  hideHint: { kids: '🙈 收起提示', tweens: '🙈 收起提示', teens: '🙈 Hide Hint' } as Record<
    AgeLevel,
    string
  >,
  showAnswer: { kids: '👀 显示答案', tweens: '👀 显示答案', teens: '👀 Show Answer' } as Record<
    AgeLevel,
    string
  >,
  hideAnswer: { kids: '🙈 收起答案', tweens: '🙈 收起答案', teens: '🙈 Hide Answer' } as Record<
    AgeLevel,
    string
  >,
  history: { kids: '最近生成', tweens: '历史记录', teens: 'History' } as Record<AgeLevel, string>,
  errorTitle: {
    kids: '哎呀，出错了！',
    tweens: '生成失败，请重试',
    teens: 'Generation failed',
  } as Record<AgeLevel, string>,
  retry: { kids: '🔁 再试一次', tweens: '🔁 重试', teens: '🔁 Retry' } as Record<AgeLevel, string>,
  empty: {
    kids: '选一个主题，点「让 AI 变魔法」吧！',
    tweens: '选择主题后点击生成，AI 会为你创建内容。',
    teens: 'Pick a topic and click Generate to create content.',
  } as Record<AgeLevel, string>,
  aiBadge: { kids: 'AI 生成', tweens: 'AI 生成', teens: 'AI' } as Record<AgeLevel, string>,
  fallbackBadge: { kids: '备用', tweens: '备用内容', teens: 'fallback' } as Record<
    AgeLevel,
    string
  >,
  storyVisual: { kids: '画面', tweens: '可视化', teens: 'Visual' } as Record<AgeLevel, string>,
  mathHook: { kids: '数学小秘密', tweens: '数学要点', teens: 'Math Hook' } as Record<
    AgeLevel,
    string
  >,
  successCriteria: { kids: '怎样算成功', tweens: '成功标准', teens: 'Success Criteria' } as Record<
    AgeLevel,
    string
  >,
  steps: { kids: '步骤', tweens: '步骤', teens: 'Steps' } as Record<AgeLevel, string>,
  task: { kids: '你的任务', tweens: '任务', teens: 'Task' } as Record<AgeLevel, string>,
  question: { kids: '题目', tweens: '题目', teens: 'Question' } as Record<AgeLevel, string>,
  explanation: { kids: '解释', tweens: '解析', teens: 'Explanation' } as Record<AgeLevel, string>,
  answer: { kids: '答案', tweens: '答案', teens: 'Answer' } as Record<AgeLevel, string>,
  hint: { kids: '提示', tweens: '提示', teens: 'Hint' } as Record<AgeLevel, string>,
  difficultyBands: {
    kids: ['超简单', '简单', '刚刚好', '有点难', '超级难'],
    tweens: ['入门', '基础', '适中', '进阶', '挑战'],
    teens: ['Trivial', 'Easy', 'Medium', 'Hard', 'Expert'],
  } as Record<AgeLevel, string[]>,
}

// ---------------------------------------------------------------------------
// 字段提取工具：后端返回 Record<string, unknown>，需安全取值
// ---------------------------------------------------------------------------

function pickStr(obj: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!obj) return ''
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'number') return String(v)
  }
  return ''
}

function pickList(obj: Record<string, unknown> | null | undefined, ...keys: string[]): string[] {
  if (!obj) return []
  for (const k of keys) {
    const v = obj[k]
    if (Array.isArray(v)) {
      return v
        .map(x => (typeof x === 'string' ? x : x == null ? '' : String(x)))
        .map(s => s.trim())
        .filter(Boolean)
    }
    if (typeof v === 'string' && v.trim()) {
      return v
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
    }
  }
  return []
}

function pickSource(obj: Record<string, unknown> | null | undefined): 'llm' | 'fallback' {
  if (!obj) return 'fallback'
  const s = obj.source
  if (typeof s === 'string') return s === 'llm' ? 'llm' : 'fallback'
  if (obj.fallback === true || obj.is_fallback === true) return 'fallback'
  // 默认有内容即视为 LLM 生成
  return 'llm'
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

function AIContentPanel({ ageLevel, tableSize, table }: AIContentPanelProps) {
  // ── 订阅 store ──
  const dynamicContent = useStore(s => s.dynamicContent)
  const storeError = useStore(s => s.error)

  // ── 本地状态 ──
  const [currentType, setCurrentType] = useState<ContentType>('exercise')
  const [selectedTopic, setSelectedTopic] = useState<string>(TOPIC_PRESETS[ageLevel][0])
  const [difficulty, setDifficulty] = useState<number>(0.5)
  const [showHint, setShowHint] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [genFailed, setGenFailed] = useState(false)
  const [pinned, setPinned] = useState<GeneratedItem | null>(null)
  const [history, setHistory] = useState<GeneratedItem[]>([])

  const prevLensRef = useRef({ exercise: 0, story: 0, challenge: 0 })

  const topicPresets = TOPIC_PRESETS[ageLevel]
  const isLoading = dynamicContent.loading

  // ── 年龄等级变化时重置主题 ──
  useEffect(() => {
    setSelectedTopic(TOPIC_PRESETS[ageLevel][0])
  }, [ageLevel])

  // ── 检测新生成内容并入历史 ──
  useEffect(() => {
    const lens = {
      exercise: dynamicContent.exercises.length,
      story: dynamicContent.stories.length,
      challenge: dynamicContent.challenges.length,
    }
    const order: ContentType[] = ['challenge', 'story', 'exercise']
    for (const t of order) {
      if (lens[t] > prevLensRef.current[t]) {
        const arr =
          t === 'exercise'
            ? dynamicContent.exercises
            : t === 'story'
              ? dynamicContent.stories
              : dynamicContent.challenges
        const newItem = arr[arr.length - 1]
        if (newItem) {
          setHistory(h => [{ type: t, item: newItem }, ...h].slice(0, 3))
        }
        break
      }
    }
    prevLensRef.current = lens
  }, [dynamicContent])

  // ── 当前类型对应的最新内容 ──
  const latestForType = useMemo<Record<string, unknown> | null>(() => {
    const arr =
      currentType === 'exercise'
        ? dynamicContent.exercises
        : currentType === 'story'
          ? dynamicContent.stories
          : dynamicContent.challenges
    return arr.length > 0 ? arr[arr.length - 1] : null
  }, [currentType, dynamicContent])

  // 实际展示项：优先用「固定查看」的历史项，否则用当前类型最新项
  const displayItem: GeneratedItem | null = pinned
    ? pinned
    : latestForType
      ? { type: currentType, item: latestForType }
      : null

  // ── 展示项变化时重置提示/答案开关 ──
  useEffect(() => {
    setShowHint(false)
    setShowAnswer(false)
  }, [displayItem?.item, currentType])

  // ── 生成内容 ──
  const handleGenerate = useCallback(async () => {
    setGenFailed(false)
    setPinned(null)
    setShowHint(false)
    setShowAnswer(false)
    try {
      await useStore.getState().generateContent({
        type: currentType,
        topic: selectedTopic,
        ageLevel: ageLevel,
        difficulty: difficulty,
        currentTable: table,
        context: `Table size: ${tableSize}`,
      })
    } catch {
      setGenFailed(true)
      return
    }
    // generateContent 内部吞掉异常并写入 store.error，await 后检查
    if (useStore.getState().error) {
      setGenFailed(true)
    }
  }, [currentType, selectedTopic, ageLevel, difficulty, table, tableSize])

  const handleRetry = useCallback(() => {
    handleGenerate()
  }, [handleGenerate])

  const handleTabChange = useCallback((t: ContentType) => {
    setCurrentType(t)
    setPinned(null)
  }, [])

  const handleTopicPreset = useCallback((topic: string) => {
    setSelectedTopic(topic)
  }, [])

  const handleHistoryClick = useCallback((h: GeneratedItem) => {
    setPinned(h)
    setCurrentType(h.type)
  }, [])

  // 难度档位文案
  const bandIdx = Math.min(4, Math.max(0, Math.round(difficulty * 4)))
  const bandLabel = L.difficultyBands[ageLevel][bandIdx]

  const hasError = genFailed && !isLoading

  return (
    <>
      <style>{CSS}</style>
      <div className="aic-root">
        {/* ── 头部标题 ── */}
        <div className="aic-header">
          <span className="aic-title">
            {ageLevel === 'kids' && '🪄 '}
            {ageLevel === 'tweens' && '🧠 '}
            {ageLevel === 'teens' && '⚡ '}
            {L.panelTitle[ageLevel]}
          </span>
        </div>

        {/* ── 内容类型 Tab ── */}
        <div className="aic-tabs">
          {TYPE_TABS.map(tab => (
            <button
              key={tab.id}
              className={`aic-tab ${currentType === tab.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
              disabled={isLoading}
            >
              <span className="aic-tab-icon">{tab.icon}</span>
              <span className="aic-tab-label">{tab.label[ageLevel]}</span>
            </button>
          ))}
        </div>

        {/* ── 主题选择 ── */}
        <div className="aic-section">
          <div className="aic-section-label">{L.topicLabel[ageLevel]}</div>
          <input
            className="aic-topic-input"
            type="text"
            value={selectedTopic}
            placeholder={L.topicPlaceholder[ageLevel]}
            onChange={e => setSelectedTopic(e.target.value)}
            disabled={isLoading}
          />
          <div className="aic-topic-presets">
            {topicPresets.map(topic => (
              <button
                key={topic}
                className={`aic-topic-chip ${selectedTopic === topic ? 'active' : ''}`}
                onClick={() => handleTopicPreset(topic)}
                disabled={isLoading}
              >
                {topic}
              </button>
            ))}
          </div>
        </div>

        {/* ── 难度滑块 ── */}
        <div className="aic-section">
          <div className="aic-section-label">
            <span>{L.difficultyLabel[ageLevel]}</span>
            <span className="aic-difficulty-value">
              {bandLabel} · {Math.round(difficulty * 100)}%
            </span>
          </div>
          <input
            className="aic-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={difficulty}
            onChange={e => setDifficulty(parseFloat(e.target.value))}
            disabled={isLoading}
          />
        </div>

        {/* ── 生成按钮 ── */}
        <button
          className="aic-generate-btn"
          onClick={handleGenerate}
          disabled={isLoading || !selectedTopic.trim()}
        >
          {isLoading ? (
            <>
              <span className="aic-spinner" />
              {L.generating[ageLevel]}
            </>
          ) : (
            L.generate[ageLevel]
          )}
        </button>

        {/* ── 加载态 ── */}
        {isLoading && (
          <div className="aic-loading">
            <div className="aic-loading-spinner" />
            <span className="aic-loading-text">{L.loading[ageLevel]}</span>
          </div>
        )}

        {/* ── 错误态 ── */}
        {hasError && (
          <div className="aic-error">
            <div className="aic-error-icon">⚠️</div>
            <div className="aic-error-body">
              <div className="aic-error-title">{L.errorTitle[ageLevel]}</div>
              <div className="aic-error-detail">{storeError?.detail || storeError?.headline}</div>
              {storeError?.recovery && (
                <div className="aic-error-recovery">{storeError.recovery}</div>
              )}
            </div>
            <button className="aic-retry-btn" onClick={handleRetry}>
              {L.retry[ageLevel]}
            </button>
          </div>
        )}

        {/* ── 内容展示区 ── */}
        {!isLoading && !hasError && displayItem && (
          <div className="aic-content-card" key={JSON.stringify(displayItem.item).slice(0, 64)}>
            {renderContent(displayItem, ageLevel, showHint, showAnswer, setShowHint, setShowAnswer)}
          </div>
        )}

        {/* ── 空状态 ── */}
        {!isLoading && !hasError && !displayItem && (
          <div className="aic-empty">
            <div className="aic-empty-icon">
              {currentType === 'exercise' ? '✏️' : currentType === 'story' ? '📖' : '🎯'}
            </div>
            <div className="aic-empty-text">{L.empty[ageLevel]}</div>
          </div>
        )}

        {/* ── 历史记录 ── */}
        {history.length > 0 && (
          <div className="aic-history">
            <div className="aic-history-title">{L.history[ageLevel]}</div>
            {history.map((h, i) => {
              const src = pickSource(h.item)
              const tab = TYPE_TABS.find(t => t.id === h.type)
              const label =
                pickStr(h.item, 'title', 'question', 'task') ||
                pickStr(h.item, 'topic') ||
                (tab ? tab.label[ageLevel] : h.type)
              return (
                <button
                  key={i}
                  className="aic-history-item"
                  onClick={() => handleHistoryClick(h)}
                  title={label}
                >
                  <span className="aic-history-icon">{tab?.icon}</span>
                  <span className="aic-history-label">{label}</span>
                  <span className={`aic-history-badge ${src}`}>
                    {src === 'llm' ? L.aiBadge[ageLevel] : L.fallbackBadge[ageLevel]}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 内容渲染：根据类型渲染不同的卡片内容
// ---------------------------------------------------------------------------

function renderContent(
  data: GeneratedItem,
  ageLevel: AgeLevel,
  showHint: boolean,
  showAnswer: boolean,
  setShowHint: (v: boolean) => void,
  setShowAnswer: (v: boolean) => void,
) {
  const { type, item } = data
  const source = pickSource(item)

  const sourceBadge = (className: string) => (
    <span className={`aic-badge ${source} ${className}`}>
      {source === 'llm' ? L.aiBadge[ageLevel] : L.fallbackBadge[ageLevel]}
    </span>
  )

  // ── 习题 ──
  if (type === 'exercise') {
    const question = pickStr(item, 'question', 'problem', 'prompt')
    const hint = pickStr(item, 'hint', 'tip')
    const answer = pickStr(item, 'answer', 'solution')
    const explanation = pickStr(item, 'explanation', 'reasoning', 'explanation_text')
    return (
      <>
        <div className="aic-card-head">
          <span className="aic-card-type">
            {TYPE_TABS[0].icon} {TYPE_TABS[0].label[ageLevel]}
          </span>
          {sourceBadge('')}
        </div>
        <div className="aic-card-label">{L.question[ageLevel]}</div>
        <div className="aic-card-question">{question}</div>

        {hint && (
          <button className="aic-toggle-btn" onClick={() => setShowHint(!showHint)}>
            {showHint ? L.hideHint[ageLevel] : L.showHint[ageLevel]}
          </button>
        )}
        {hint && showHint && (
          <div className="aic-hint-box">
            <span className="aic-box-label">{L.hint[ageLevel]}</span>
            {hint}
          </div>
        )}

        {(answer || explanation) && (
          <button className="aic-toggle-btn answer" onClick={() => setShowAnswer(!showAnswer)}>
            {showAnswer ? L.hideAnswer[ageLevel] : L.showAnswer[ageLevel]}
          </button>
        )}
        {showAnswer && (
          <div className="aic-answer-box">
            {answer && (
              <>
                <span className="aic-box-label">{L.answer[ageLevel]}</span>
                <div className="aic-answer-text">{answer}</div>
              </>
            )}
            {explanation && (
              <>
                <span className="aic-box-label">{L.explanation[ageLevel]}</span>
                <div className="aic-explanation-text">{explanation}</div>
              </>
            )}
          </div>
        )}
      </>
    )
  }

  // ── 故事 ──
  if (type === 'story') {
    const title = pickStr(item, 'title', 'name', 'heading')
    const text = pickStr(item, 'text', 'body', 'content', 'story')
    const visual = pickStr(item, 'visual_description', 'visual', 'scene', 'description')
    const mathHook = pickStr(item, 'math_hook', 'mathHook', 'hook', 'concept')
    return (
      <>
        <div className="aic-card-head">
          <span className="aic-card-type">
            {TYPE_TABS[1].icon} {TYPE_TABS[1].label[ageLevel]}
          </span>
          {sourceBadge('')}
        </div>
        {title && <div className="aic-card-title">{title}</div>}
        {text && <div className="aic-card-text">{text}</div>}
        {visual && (
          <div className="aic-visual-block">
            <div className="aic-visual-label">{L.storyVisual[ageLevel]}</div>
            <pre className="aic-visual-pre">{visual}</pre>
          </div>
        )}
        {mathHook && (
          <div className="aic-math-hook">
            <span className="aic-hook-label">{L.mathHook[ageLevel]}</span>
            <span className="aic-hook-text">{mathHook}</span>
          </div>
        )}
      </>
    )
  }

  // ── 挑战 ──
  const title = pickStr(item, 'title', 'name', 'heading')
  const task = pickStr(item, 'task', 'challenge', 'prompt', 'mission')
  const hint = pickStr(item, 'hint', 'tip')
  const criteria = pickList(item, 'success_criteria', 'criteria', 'success', 'successCriteria')
  const steps = pickList(item, 'steps', 'instructions', 'guide')
  return (
    <>
      <div className="aic-card-head">
        <span className="aic-card-type">
          {TYPE_TABS[2].icon} {TYPE_TABS[2].label[ageLevel]}
        </span>
        {sourceBadge('')}
      </div>
      {title && <div className="aic-card-title">{title}</div>}
      {task && (
        <>
          <div className="aic-card-label">{L.task[ageLevel]}</div>
          <div className="aic-card-task">{task}</div>
        </>
      )}
      {hint && (
        <button className="aic-toggle-btn" onClick={() => setShowHint(!showHint)}>
          {showHint ? L.hideHint[ageLevel] : L.showHint[ageLevel]}
        </button>
      )}
      {hint && showHint && (
        <div className="aic-hint-box">
          <span className="aic-box-label">{L.hint[ageLevel]}</span>
          {hint}
        </div>
      )}
      {criteria.length > 0 && (
        <div className="aic-criteria">
          <div className="aic-card-label">{L.successCriteria[ageLevel]}</div>
          <ul className="aic-list">
            {criteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {steps.length > 0 && (
        <div className="aic-steps">
          <div className="aic-card-label">{L.steps[ageLevel]}</div>
          <ol className="aic-list ordered">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// CSS（内联，复用设计系统变量）
// ---------------------------------------------------------------------------

const CSS = `
.aic-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── 头部 ── */
.aic-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.aic-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

/* ── Tabs ── */
.aic-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg2, #f5f5f5);
  padding: 3px;
  border-radius: 9px;
  border: 1px solid var(--border, #e0e0e0);
}
.aic-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 6px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}
.aic-tab:hover:not(:disabled) {
  color: var(--ink);
}
.aic-tab.active {
  background: var(--surface, #fff);
  color: var(--accent, #3D4F7A);
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.aic-tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.aic-tab-icon { font-size: 13px; line-height: 1; }

/* ── 区块通用 ── */
.aic-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.aic-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ── 主题输入 ── */
.aic-topic-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 7px;
  background: var(--surface, #fff);
  color: var(--ink);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}
.aic-topic-input:focus {
  border-color: var(--accent, #3D4F7A);
  box-shadow: 0 0 0 3px rgba(61, 79, 122, 0.12);
}
.aic-topic-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.aic-topic-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.aic-topic-chip {
  padding: 4px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 14px;
  background: var(--surface, #fff);
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.aic-topic-chip:hover:not(:disabled) {
  border-color: var(--accent, #3D4F7A);
  color: var(--accent, #3D4F7A);
}
.aic-topic-chip.active {
  background: var(--accent, #3D4F7A);
  border-color: var(--accent, #3D4F7A);
  color: #fff;
}
.aic-topic-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── 难度滑块 ── */
.aic-difficulty-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent, #3D4F7A);
  font-family: var(--mono);
  text-transform: none;
  letter-spacing: 0;
}
.aic-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--border, #e0e0e0);
  outline: none;
  cursor: pointer;
}
.aic-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent, #3D4F7A);
  border: 2px solid var(--surface, #fff);
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  cursor: pointer;
  transition: transform 0.1s;
}
.aic-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}
.aic-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent, #3D4F7A);
  border: 2px solid var(--surface, #fff);
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  cursor: pointer;
}
.aic-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── 生成按钮 ── */
.aic-generate-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 11px 16px;
  border: none;
  border-radius: 8px;
  background: var(--accent, #3D4F7A);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}
.aic-generate-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.aic-generate-btn:active:not(:disabled) {
  transform: scale(0.985);
}
.aic-generate-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.aic-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: aic-spin 0.7s linear infinite;
  display: inline-block;
}
@keyframes aic-spin {
  to { transform: rotate(360deg); }
}

/* ── 加载态 ── */
.aic-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px;
  border: 1px dashed var(--border, #ddd);
  border-radius: 10px;
  background: var(--bg2, #f9f9f9);
  animation: aic-fade-in 0.3s ease;
}
.aic-loading-spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid var(--border, #e0e0e0);
  border-top-color: var(--accent, #3D4F7A);
  border-radius: 50%;
  animation: aic-spin 0.7s linear infinite;
  flex-shrink: 0;
}
.aic-loading-text {
  font-size: 13px;
  color: var(--muted);
  font-weight: 500;
}
@keyframes aic-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── 错误态 ── */
.aic-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border-radius: 10px;
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  animation: aic-fade-in 0.3s ease;
}
.aic-error-icon {
  font-size: 18px;
  line-height: 1.4;
  flex-shrink: 0;
}
.aic-error-body {
  flex: 1;
  min-width: 0;
}
.aic-error-title {
  font-size: 13px;
  font-weight: 700;
  color: #991B1B;
  margin-bottom: 3px;
}
.aic-error-detail {
  font-size: 11px;
  color: #B91C1C;
  line-height: 1.5;
  word-break: break-word;
}
.aic-error-recovery {
  font-size: 11px;
  color: #7F1D1D;
  margin-top: 4px;
  font-style: italic;
}
.aic-retry-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid #DC2626;
  border-radius: 6px;
  background: #DC2626;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.aic-retry-btn:hover {
  opacity: 0.88;
}

/* ── 内容卡片 ── */
.aic-content-card {
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 10px;
  padding: 14px;
  background: var(--surface, #fff);
  animation: aic-card-reveal 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes aic-card-reveal {
  from { opacity: 0; transform: translateY(10px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.aic-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.aic-card-type {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent, #3D4F7A);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.aic-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.aic-badge.llm {
  background: rgba(16, 185, 129, 0.12);
  color: #065F46;
  border: 1px solid rgba(16, 185, 129, 0.4);
}
.aic-badge.fallback {
  background: rgba(138, 106, 31, 0.1);
  color: var(--accent2, #8A6A1F);
  border: 1px solid rgba(138, 106, 31, 0.3);
}
.aic-card-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 8px;
  margin-bottom: 3px;
}
.aic-card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.3;
  margin-bottom: 4px;
}
.aic-card-question,
.aic-card-text,
.aic-card-task {
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink);
  white-space: pre-wrap;
}

/* ── 提示/答案切换按钮 ── */
.aic-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--bg2, #f5f5f5);
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  margin-top: 9px;
  transition: all 0.15s;
}
.aic-toggle-btn:hover {
  border-color: var(--accent2, #8A6A1F);
  color: var(--accent2, #8A6A1F);
}
.aic-toggle-btn.answer {
  border-color: rgba(16, 185, 129, 0.4);
  color: #065F46;
}
.aic-toggle-btn.answer:hover {
  background: rgba(16, 185, 129, 0.08);
}

/* ── 提示框 ── */
.aic-hint-box {
  font-size: 12px;
  color: var(--ink);
  background: rgba(138, 106, 31, 0.06);
  padding: 9px 11px;
  border-radius: 7px;
  border-left: 3px solid var(--accent2, #8A6A1F);
  margin-top: 7px;
  line-height: 1.55;
  animation: aic-box-in 0.25s ease;
}
.aic-box-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 3px;
}

/* ── 答案框 ── */
.aic-answer-box {
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 7px;
  padding: 9px 11px;
  margin-top: 7px;
  animation: aic-box-in 0.25s ease;
}
.aic-answer-text {
  font-size: 13px;
  font-weight: 700;
  color: #065F46;
  line-height: 1.5;
  margin-bottom: 6px;
  white-space: pre-wrap;
}
.aic-explanation-text {
  font-size: 12px;
  color: var(--ink);
  line-height: 1.6;
  white-space: pre-wrap;
}
@keyframes aic-box-in {
  from { opacity: 0; max-height: 0; transform: translateY(-4px); }
  to { opacity: 1; max-height: 400px; transform: translateY(0); }
}

/* ── 故事可视化 ── */
.aic-visual-block {
  margin-top: 9px;
}
.aic-visual-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}
.aic-visual-pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--bg2, #f5f5f5);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 7px;
  font-family: var(--mono, monospace);
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink);
  white-space: pre;
  overflow-x: auto;
}

/* ── 数学钩子 ── */
.aic-math-hook {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 9px;
  padding: 9px 11px;
  background: linear-gradient(135deg, rgba(61,79,122,0.06), rgba(138,106,31,0.06));
  border-radius: 7px;
  border: 1px solid var(--border, #e0e0e0);
}
.aic-hook-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--accent, #3D4F7A);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  padding-top: 1px;
}
.aic-hook-text {
  font-size: 12px;
  color: var(--ink);
  line-height: 1.55;
  white-space: pre-wrap;
}

/* ── 挑战：标准/步骤 ── */
.aic-list {
  margin: 4px 0 0;
  padding-left: 18px;
}
.aic-list li {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink);
  margin-bottom: 3px;
}
.aic-list.ordered {
  padding-left: 22px;
}
.aic-list.ordered li {
  color: var(--ink);
}
.aic-list.ordered li::marker {
  color: var(--accent, #3D4F7A);
  font-weight: 700;
  font-family: var(--mono);
}
.aic-criteria,
.aic-steps {
  margin-top: 6px;
}

/* ── 空状态 ── */
.aic-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  border: 1px dashed var(--border, #ddd);
  border-radius: 10px;
  background: var(--bg2, #f9f9f9);
  animation: aic-fade-in 0.3s ease;
}
.aic-empty-icon {
  font-size: 30px;
  opacity: 0.7;
  animation: aic-float 2.5s ease-in-out infinite;
}
.aic-empty-text {
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  line-height: 1.5;
}
@keyframes aic-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

/* ── 历史记录 ── */
.aic-history {
  margin-top: 6px;
  border-top: 1px solid var(--border, #e0e0e0);
  padding-top: 9px;
}
.aic-history-title {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.aic-history-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--border, #eee);
  border-radius: 7px;
  background: var(--surface, #fff);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 4px;
  text-align: left;
}
.aic-history-item:hover {
  border-color: var(--accent, #3D4F7A);
  background: var(--bg2, #f5f5f5);
}
.aic-history-icon {
  flex-shrink: 0;
  font-size: 13px;
}
.aic-history-label {
  flex: 1;
  min-width: 0;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aic-history-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.aic-history-badge.llm {
  background: rgba(16, 185, 129, 0.12);
  color: #065F46;
}
.aic-history-badge.fallback {
  background: rgba(138, 106, 31, 0.1);
  color: var(--accent2, #8A6A1F);
}
`

export default AIContentPanel
