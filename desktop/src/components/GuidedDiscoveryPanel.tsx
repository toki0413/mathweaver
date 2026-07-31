import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useStore } from '../stores/sessionStore'
import type { AgeLevel, KnowledgeCard, AchievementDef } from '../utils/ageAdapt'
import {
  getMissions,
  getEncouragement,
  PHASE_META,
  getUnlockedCards,
  checkAchievements,
  ACHIEVEMENTS,
} from '../utils/ageAdapt'
import { soundSystem } from '../utils/sound'

/**
 * 游戏化引导发现面板
 *
 * AI 时代的新数学运动：不是把群论「简化」，而是「翻译」成孩子能玩的语言。
 *
 * 根据年龄等级动态生成任务序列：
 *   - kids (8-10): 魔法密码表冒险故事，完全游戏化
 *   - tweens (11-13): 半学术过渡，保留直觉入口
 *   - teens (14+): 完整 Lakatos 发现循环
 *
 * 互动性增强：
 *   - 每步完成后有庆祝动画 + 音效文字
 *   - 收集星星徽章
 *   - 根据认知状态自适应调整（用年龄适配语言表达）
 *   - 故事化叙事，每一步都有场景
 */

interface GuidedDiscoveryPanelProps {
  tableSize: number
  ageLevel: AgeLevel
  onJumpToCayley: () => void
  onJumpToChat: () => void
  onJumpToConjecture: () => void
  onJumpToExplore: () => void
  /** 已完成的运算模式数（用于成就判定，默认 0） */
  completedModes?: number
  /** 进度变化回调：传出已完成任务数、星星数、模式数，供外部成就系统使用 */
  onProgressChange?: (completed: number, stars: number, modes: number) => void
}

export function GuidedDiscoveryPanel({
  tableSize,
  ageLevel,
  onJumpToCayley,
  onJumpToChat,
  onJumpToConjecture,
  onJumpToExplore,
  completedModes = 0,
  onProgressChange,
}: GuidedDiscoveryPanelProps) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  const [collectedStars, setCollectedStars] = useState(0)
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationText, setCelebrationText] = useState('')
  const [hintVisible, setHintVisible] = useState(false)
  const [adaptiveMsg, setAdaptiveMsg] = useState<string | null>(null)
  // 互动检查点状态
  const [showCheckpoint, setShowCheckpoint] = useState(false)
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)
  const [checkpointEncourage, setCheckpointEncourage] = useState<string | null>(null)
  // 知识卡片折叠
  const [cardsCollapsed, setCardsCollapsed] = useState(false)

  const visualData = useStore(s => s.visualData)
  const fourFields = useStore(s => s.fourFields)
  const prevLoadRef = useRef<number>(0)

  // 年龄等级变化时重置进度
  const missions = useMemo(() => getMissions(ageLevel), [ageLevel])
  useEffect(() => {
    setCurrentIdx(0)
    setCompletedSteps(new Set())
    setCollectedStars(0)
    setHintVisible(false)
  }, [ageLevel])

  const currentMission = missions[currentIdx]
  const isLast = currentIdx === missions.length - 1

  // 知识卡片：根据已完成的任务解锁（completedSteps 变化时重新计算）
  const unlockedCards: KnowledgeCard[] = useMemo(
    () => getUnlockedCards(completedSteps),
    [completedSteps],
  )

  // 成就徽章：根据完成任务数、星星数、完成模式数计算解锁情况
  const unlockedAchievements = useMemo(
    () =>
      new Set(
        checkAchievements(completedSteps.size, collectedStars, completedModes, missions.length),
      ),
    [completedSteps, collectedStars, completedModes, missions.length],
  )

  // 进度变化时通知父组件（供侧边栏 AchievementSystem 使用）
  useEffect(() => {
    onProgressChange?.(completedSteps.size, collectedStars, completedModes)
  }, [completedSteps, collectedStars, completedModes, onProgressChange])

  // 互动检查点：根据任务 ID 生成年龄适配的选择题（4 选项，实做验证）
  const checkpointQuestion = useMemo<{
    question: string
    choices: string[]
    correctIdx: number
  }>(() => {
    const id = currentMission.id
    const max = tableSize - 1
    const questions: Record<string, { question: string; choices: string[]; correctIdx: number }> = {
      'discover-1': {
        // 单位元
        question:
          ageLevel === 'kids'
            ? '老大碰谁不变？'
            : ageLevel === 'tweens'
              ? '单位元 e 跟谁碰，谁就不变？'
              : 'Identity: e∗a = ?',
        choices:
          ageLevel === 'kids'
            ? ['碰谁都不变', '碰谁都变大', '碰谁都变小', '没有老大']
            : ageLevel === 'tweens'
              ? ['跟谁碰都不变（e∗a = a）', '只跟 0 碰不变', '只跟自己碰不变', '跟谁碰都变大']
              : ['a  (e∗a = a for all a ∈ G)', 'e', '0', 'a²'],
        correctIdx: 0,
      },
      'discover-2': {
        // 逆元
        question:
          ageLevel === 'kids'
            ? '好搭档碰一碰变成什么？'
            : ageLevel === 'tweens'
              ? 'a 和逆元 a⁻¹ 碰一碰等于什么？'
              : 'a∗a⁻¹ = ?',
        choices:
          ageLevel === 'kids'
            ? ['变成老大！', '变成 1', '变成自己', '消失了']
            : ageLevel === 'tweens'
              ? ['单位元 e', 'a 自己', '0', 'a²']
              : ['e  (the identity element)', 'a', '0', 'a⁻²'],
        correctIdx: 0,
      },
      'play-2': {
        // 闭合性
        question:
          ageLevel === 'kids'
            ? '数字不能超过几？'
            : ageLevel === 'tweens'
              ? '运算结果的最大值是几？'
              : 'Closure: max valid element value?',
        choices:
          ageLevel === 'kids'
            ? [`${max}！`, `${max + 1}`, `${max - 1}`, '随便多少']
            : ageLevel === 'tweens'
              ? [`${max}（即 n-1）`, `${max + 1}`, `${max - 1}`, '没有限制']
              : [`n-1 = ${max}`, `n = ${max + 1}`, `n-2 = ${max - 1}`, 'unlimited'],
        correctIdx: 0,
      },
      'challenge-1': {
        // 交换律（Z₃ 是交换群）
        question:
          ageLevel === 'kids'
            ? '1 碰 2 和 2 碰 1 一样吗？'
            : ageLevel === 'tweens'
              ? 'a∗b 和 b∗a 一样吗？（Z₃ 交换群）'
              : 'Is a∗b = b∗a? (Z₃ is abelian)',
        choices:
          ageLevel === 'kids'
            ? ['一样！（在 Z₃ 里）', '不一样', '有时候一样', '没有 1 和 2']
            : ageLevel === 'tweens'
              ? ['一样（交换律成立）', '不一样', '只有 a=b 时一样', '不一定']
              : ['Yes (Z₃ is abelian)', 'No', 'Only when a=b', 'Sometimes'],
        correctIdx: 0,
      },
    }
    // 默认检查点
    return (
      questions[id] || {
        question:
          ageLevel === 'kids'
            ? '你完成这个任务了吗？'
            : ageLevel === 'tweens'
              ? '你完成此任务了吗？'
              : 'Did you complete this mission?',
        choices:
          ageLevel === 'kids'
            ? ['是的，完成啦！', '还没有', '需要帮助', '再想想']
            : ageLevel === 'tweens'
              ? ['是的，完成了。', '还没有', '需要提示', '再试一次']
              : ['Yes.', 'No', 'Need a hint', 'Not yet'],
        correctIdx: 0,
      }
    )
  }, [currentMission.id, ageLevel, tableSize])

  // 自适应：根据认知状态调整
  const cognitiveLoad = visualData?.four_field_gauges?.cognitive_load ?? 0
  const mastery = fourFields?.knowledge?.mastery_estimate ?? 0
  const anxiety = fourFields?.emotional?.anxiety_index ?? 0
  const isOverloaded = cognitiveLoad > 0.75 || anxiety > 0.6
  const isFlow = cognitiveLoad < 0.5 && mastery > 0.5 && anxiety < 0.3

  // 认知状态自适应提示
  useEffect(() => {
    const delta = cognitiveLoad - prevLoadRef.current
    if (delta > 0.2 && cognitiveLoad > 0.7) {
      const msg =
        ageLevel === 'kids'
          ? '嘿，你看起来有点累了！休息一下，或者重新看看之前的关卡～'
          : ageLevel === 'tweens'
            ? '脑力负担有点高，建议放慢节奏，先回顾已学概念。'
            : '认知负荷升高。建议回顾已学概念后再继续。'
      setAdaptiveMsg(msg)
      const timer = setTimeout(() => setAdaptiveMsg(null), 6000)
      return () => clearTimeout(timer)
    }
    if (isFlow && prevLoadRef.current > 0.5) {
      const msg =
        ageLevel === 'kids'
          ? '哇，你进入了超专注状态！试试更难的挑战吧！'
          : ageLevel === 'tweens'
            ? '你正处于心流状态！可以尝试更有挑战性的内容。'
            : 'Flow state detected. Consider attempting a more challenging conjecture.'
      setAdaptiveMsg(msg)
      const timer = setTimeout(() => setAdaptiveMsg(null), 5000)
      return () => clearTimeout(timer)
    }
    prevLoadRef.current = cognitiveLoad
    return undefined
  }, [cognitiveLoad, isFlow, ageLevel])

  const handleAction = useCallback(() => {
    const target = currentMission.actionTarget
    if (target === 'cayley') onJumpToCayley()
    else if (target === 'chat') onJumpToChat()
    else if (target === 'conjecture') onJumpToConjecture()
    else if (target === 'explore') onJumpToExplore()
  }, [currentMission, onJumpToCayley, onJumpToChat, onJumpToConjecture, onJumpToExplore])

  const triggerCelebration = useCallback((text: string) => {
    setCelebrationText(text)
    setShowCelebration(true)
    setTimeout(() => setShowCelebration(false), 3500)
  }, [])

  // 点击「完成」按钮 → 先弹出互动检查点（选择题）
  const handleCompleteClick = useCallback(() => {
    setShowCheckpoint(true)
    setSelectedChoice(null)
    setCheckpointEncourage(null)
  }, [])

  // 检查点：验证选择是否正确 → 答对则真正完成当前任务，答错给提示允许重试
  const handleCheckpointConfirm = useCallback(() => {
    if (selectedChoice === null) return
    if (selectedChoice === checkpointQuestion.correctIdx) {
      // 答对 → 完成任务
      setCompletedSteps(prev => new Set(prev).add(currentMission.id))
      setCollectedStars(s => s + 1)
      triggerCelebration(currentMission.successMsg)
      soundSystem.play('correct')
      setShowCheckpoint(false)
      setCheckpointEncourage(null)
      setSelectedChoice(null)

      if (!isLast) {
        setTimeout(() => setCurrentIdx(i => i + 1), 800)
      }
    } else {
      // 答错 → 给鼓励提示，不关闭，允许重试
      setCheckpointEncourage(getEncouragement(ageLevel, 'wrong'))
      soundSystem.play('wrong')
    }
  }, [selectedChoice, checkpointQuestion, currentMission, isLast, triggerCelebration, ageLevel])

  // 关闭检查点（取消）
  const handleCheckpointCancel = useCallback(() => {
    setShowCheckpoint(false)
    setSelectedChoice(null)
    setCheckpointEncourage(null)
  }, [])

  const handlePrev = useCallback(() => {
    setCurrentIdx(i => Math.max(0, i - 1))
    setHintVisible(false)
  }, [])

  const handleNext = useCallback(() => {
    setCompletedSteps(prev => new Set(prev).add(currentMission.id))
    setCurrentIdx(i => Math.min(missions.length - 1, i + 1))
    setHintVisible(false)
  }, [currentMission, missions.length])

  const phaseMeta = PHASE_META[currentMission.phase]
  const panelTitle =
    ageLevel === 'kids' ? '冒险之旅' : ageLevel === 'tweens' ? '发现之旅' : 'Discovery Journey'

  return (
    <>
      <style>{CSS}</style>
      <div className="gdp-root">
        {/* 庆祝弹窗 */}
        {showCelebration && (
          <div className="gdp-celebration">
            <div className="gdp-celebration-inner">
              <div className="gdp-celebration-stars">⭐</div>
              <div className="gdp-celebration-text">{celebrationText}</div>
              <div className="gdp-celebration-encouragement">
                {getEncouragement(ageLevel, 'milestone')}
              </div>
            </div>
          </div>
        )}

        {/* 头部：标题 + 星星收集 */}
        <div className="gdp-header">
          <span className="gdp-title">
            {ageLevel === 'kids' && '🗺️ '}
            {ageLevel === 'tweens' && '🧭 '}
            {ageLevel === 'teens' && ''}
            {panelTitle}
          </span>
          <div className="gdp-star-counter">
            <span className="gdp-star-icon">⭐</span>
            <span className="gdp-star-count">{collectedStars}</span>
          </div>
        </div>

        {/* 进度条 — 小学版用星星，其他用进度条 */}
        {ageLevel === 'kids' ? (
          <div className="gdp-progress-kids">
            {missions.map((m, i) => (
              <div
                key={m.id}
                className={`gdp-progress-star ${
                  i < currentIdx || completedSteps.has(m.id) ? 'earned' : ''
                } ${i === currentIdx ? 'current' : ''}`}
                title={m.title}
              >
                {i < currentIdx || completedSteps.has(m.id) ? '⭐' : '☆'}
              </div>
            ))}
          </div>
        ) : (
          <div className="gdp-progress-track">
            {missions.map((m, i) => (
              <div
                key={m.id}
                className={`gdp-progress-seg ${
                  i < currentIdx || completedSteps.has(m.id) ? 'done' : ''
                } ${i === currentIdx ? 'current' : ''}`}
                title={m.title}
              />
            ))}
          </div>
        )}

        {/* 当前任务卡片 */}
        <div className="gdp-step-card" key={currentMission.id}>
          {/* 阶段标签 */}
          <div className="gdp-step-header">
            <span className="gdp-phase-icon">{phaseMeta.icon}</span>
            <span className="gdp-phase-badge" style={{ background: phaseMeta.color }}>
              {phaseMeta.label[ageLevel]}
            </span>
            <span className="gdp-step-counter">
              {currentIdx + 1} / {missions.length}
            </span>
          </div>

          {/* 标题 */}
          <div className="gdp-step-title">{currentMission.title}</div>

          {/* 故事 */}
          <div className="gdp-step-story">{currentMission.story}</div>

          {/* 任务 */}
          <div className="gdp-step-task">
            <span className="gdp-task-icon">📋</span>
            {currentMission.task}
          </div>

          {/* 提示 — 点击展开 */}
          <button className="gdp-hint-toggle" onClick={() => setHintVisible(!hintVisible)}>
            {hintVisible ? '🙈 收起提示' : '💡 显示提示'}
          </button>
          {hintVisible && <div className="gdp-step-hint">{currentMission.hint}</div>}

          {/* 自适应状态 */}
          {adaptiveMsg && (
            <div className={`gdp-adaptive ${isOverloaded ? 'overload' : 'flow'}`}>
              {adaptiveMsg}
            </div>
          )}

          {/* 行动按钮 */}
          <button className="gdp-action-btn" onClick={handleAction}>
            <span>{currentMission.actionLabel}</span>
            <span className="gdp-action-arrow">→</span>
          </button>

          {/* 导航 */}
          <div className="gdp-nav-row">
            <button className="gdp-nav-btn" onClick={handlePrev} disabled={currentIdx === 0}>
              ← {ageLevel === 'kids' ? '上一关' : '上一步'}
            </button>
            <button className="gdp-nav-btn primary" onClick={handleCompleteClick}>
              {isLast
                ? `🎉 ${ageLevel === 'kids' ? '完成冒险' : ageLevel === 'tweens' ? '完成全部' : 'Complete'}`
                : `✓ ${ageLevel === 'kids' ? '完成这关' : ageLevel === 'tweens' ? '完成此步' : 'Done'}`}
            </button>
            <button className="gdp-nav-btn" onClick={handleNext} disabled={isLast}>
              {ageLevel === 'kids' ? '下一关 →' : '跳过 →'}
            </button>
          </div>
        </div>

        {/* 互动检查点 — 完成前的选择题验证 */}
        {showCheckpoint && (
          <div className="gdp-checkpoint">
            <div className="gdp-checkpoint-header">
              <span className="gdp-checkpoint-icon">🔐</span>
              <span className="gdp-checkpoint-title">
                {ageLevel === 'kids' ? '小测验' : ageLevel === 'tweens' ? '快速检查' : 'Checkpoint'}
              </span>
              <button
                className="gdp-checkpoint-close"
                onClick={handleCheckpointCancel}
                title={ageLevel === 'kids' ? '取消' : 'Cancel'}
              >
                ✕
              </button>
            </div>

            <div className="gdp-checkpoint-question">{checkpointQuestion.question}</div>

            {/* 4 个选项按钮 — 选中后点确认验证 */}
            <div className="gdp-checkpoint-choices">
              {checkpointQuestion.choices.map((choice, idx) => {
                const isSelected = selectedChoice === idx
                const isWrong = isSelected && checkpointEncourage !== null
                return (
                  <button
                    key={idx}
                    className={`gdp-checkpoint-choice ${isSelected && !isWrong ? 'selected' : ''} ${isWrong ? 'wrong' : ''}`}
                    onClick={() => {
                      setSelectedChoice(idx)
                      setCheckpointEncourage(null)
                    }}
                  >
                    {choice}
                  </button>
                )
              })}
            </div>

            <button
              className="gdp-checkpoint-submit"
              onClick={handleCheckpointConfirm}
              disabled={selectedChoice === null}
            >
              {ageLevel === 'kids' ? '✓ 确认' : ageLevel === 'tweens' ? '✓ 确认' : '✓ Confirm'}
            </button>

            {checkpointEncourage && (
              <div className="gdp-checkpoint-encourage">{checkpointEncourage}</div>
            )}
          </div>
        )}

        {/* 知识卡片 — 完成任务后解锁的概念详解（可折叠） */}
        {unlockedCards.length > 0 && (
          <div className="gdp-knowledge-cards">
            <button className="gdp-cards-toggle" onClick={() => setCardsCollapsed(!cardsCollapsed)}>
              <span>
                {ageLevel === 'kids'
                  ? '📚 已解锁的知识卡片'
                  : ageLevel === 'tweens'
                    ? '📚 已解锁知识卡片'
                    : '📚 Unlocked Knowledge Cards'}
                <span className="gdp-cards-count">({unlockedCards.length})</span>
              </span>
              <span className="gdp-cards-arrow">{cardsCollapsed ? '▸' : '▾'}</span>
            </button>
            {!cardsCollapsed && (
              <div className="gdp-cards-list">
                {unlockedCards.map(card => (
                  <div key={card.id} className="gdp-kcard">
                    <div className="gdp-kcard-header">
                      <span className="gdp-kcard-icon">{card.icon}</span>
                      <span className="gdp-kcard-title">{card.title[ageLevel]}</span>
                    </div>
                    <div className="gdp-kcard-body">{card.body[ageLevel]}</div>
                    <div className="gdp-kcard-example">
                      <span className="gdp-kcard-example-label">
                        {ageLevel === 'kids'
                          ? '💡 例子：'
                          : ageLevel === 'tweens'
                            ? '💡 例子：'
                            : '💡 Example: '}
                      </span>
                      {card.example[ageLevel]}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 成就徽章 — 解锁的亮显，未解锁的灰显 */}
        <div className="gdp-achievements">
          <div className="gdp-achievements-title">
            {ageLevel === 'kids'
              ? '🎖️ 成就徽章'
              : ageLevel === 'tweens'
                ? '🎖️ 成就徽章'
                : '🎖️ Achievements'}
          </div>
          <div className="gdp-achievements-grid">
            {ACHIEVEMENTS.map((a: AchievementDef) => {
              const unlocked = unlockedAchievements.has(a.id)
              return (
                <div
                  key={a.id}
                  className={`gdp-badge ${unlocked ? 'unlocked' : 'locked'}`}
                  title={`${a.title[ageLevel]} — ${a.desc[ageLevel]}`}
                >
                  <span className="gdp-badge-icon">{unlocked ? a.icon : '🔒'}</span>
                  <span className="gdp-badge-label">{a.title[ageLevel]}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 已完成的任务 */}
        {completedSteps.size > 0 && (
          <div className="gdp-completed-list">
            <div className="gdp-completed-title">
              {ageLevel === 'kids'
                ? '已获得的星星'
                : ageLevel === 'tweens'
                  ? '已完成'
                  : 'Completed'}
            </div>
            {missions
              .filter(m => completedSteps.has(m.id))
              .map(m => (
                <div key={m.id} className="gdp-completed-item">
                  <span className="gdp-check">{ageLevel === 'kids' ? '⭐' : '✓'}</span>
                  <span>
                    {PHASE_META[m.phase].icon} {m.title}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* 最终完成 */}
        {isLast && completedSteps.has(currentMission.id) && (
          <div className="gdp-finale">
            <div className="gdp-finale-trophy">
              {ageLevel === 'kids' ? '🏆' : ageLevel === 'tweens' ? '🎓' : '✓'}
            </div>
            <div className="gdp-finale-text">
              {ageLevel === 'kids'
                ? '恭喜你完成了全部冒险！你已经是一个真正的魔法数学家了！'
                : ageLevel === 'tweens'
                  ? '恭喜完成全部任务！你已经掌握了群论的基本结构。'
                  : 'Discovery cycle complete. You have constructed and verified a group from first principles.'}
            </div>
            <div className="gdp-finale-stars">{'⭐'.repeat(collectedStars)}</div>
          </div>
        )}
      </div>
    </>
  )
}

const CSS = `
.gdp-root {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
}

/* ── 庆祝弹窗 ── */
.gdp-celebration {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  pointer-events: none;
  animation: gdp-celebration-bg 0.3s ease;
}
.gdp-celebration-inner {
  background: var(--surface, #fff);
  border: 2px solid var(--accent, #3D4F7A);
  border-radius: 16px;
  padding: 24px 32px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
  animation: gdp-celebration-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  max-width: 360px;
}
.gdp-celebration-stars {
  font-size: 48px;
  animation: gdp-star-bounce 0.6s ease;
}
.gdp-celebration-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
  margin: 8px 0 4px;
  line-height: 1.4;
}
.gdp-celebration-encouragement {
  font-size: 13px;
  color: var(--muted);
}
@keyframes gdp-celebration-bg {
  from { background: rgba(0,0,0,0); }
  to { background: rgba(0,0,0,0.1); }
}
@keyframes gdp-celebration-pop {
  0% { transform: scale(0.5); opacity: 0; }
  60% { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes gdp-star-bounce {
  0% { transform: scale(0) rotate(-180deg); }
  50% { transform: scale(1.3) rotate(0deg); }
  100% { transform: scale(1) rotate(0deg); }
}

/* ── 头部 ── */
.gdp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.gdp-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.gdp-star-counter {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  background: rgba(255, 193, 7, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(255, 193, 7, 0.3);
}
.gdp-star-icon { font-size: 14px; }
.gdp-star-count {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent2, #8A6A1F);
  font-family: var(--mono);
}

/* ── 进度条（星星版 — 小学） ── */
.gdp-progress-kids {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  justify-content: center;
}
.gdp-progress-star {
  font-size: 18px;
  opacity: 0.3;
  transition: all 0.3s;
}
.gdp-progress-star.earned {
  opacity: 1;
  animation: gdp-star-earn 0.4s ease;
}
.gdp-progress-star.current {
  opacity: 1;
  animation: gdp-star-pulse 1.5s ease-in-out infinite;
}
@keyframes gdp-star-earn {
  0% { transform: scale(0) rotate(-180deg); }
  60% { transform: scale(1.3) rotate(10deg); }
  100% { transform: scale(1) rotate(0); }
}
@keyframes gdp-star-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}

/* ── 进度条（条形版） ── */
.gdp-progress-track {
  display: flex;
  gap: 3px;
  margin-bottom: 12px;
}
.gdp-progress-seg {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--border, #e0e0e0);
  transition: background 0.3s, transform 0.3s;
}
.gdp-progress-seg.done { background: var(--accent, #3D4F7A); }
.gdp-progress-seg.current {
  background: var(--accent, #3D4F7A);
  animation: gdp-seg-pulse 1.5s ease-in-out infinite;
}
@keyframes gdp-seg-pulse {
  0%, 100% { opacity: 1; transform: scaleY(1); }
  50% { opacity: 0.5; transform: scaleY(1.5); }
}

/* ── 任务卡片 ── */
.gdp-step-card {
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 10px;
  padding: 14px;
  background: var(--surface, #fff);
  animation: gdp-slide-in 0.4s ease-out;
}
@keyframes gdp-slide-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.gdp-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.gdp-phase-icon { font-size: 18px; line-height: 1; }
.gdp-phase-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #fff;
}
.gdp-step-counter {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
  font-family: var(--mono);
}
.gdp-step-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--ink);
  line-height: 1.3;
}

/* ── 故事 ── */
.gdp-step-story {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  margin-bottom: 10px;
  padding: 8px 10px;
  background: var(--bg2, #f5f5f5);
  border-radius: 6px;
  border-left: 3px solid var(--accent2, #8A6A1F);
}

/* ── 任务 ── */
.gdp-step-task {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink);
  margin-bottom: 10px;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}
.gdp-task-icon { flex-shrink: 0; }

/* ── 提示 ── */
.gdp-hint-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--bg2, #f5f5f5);
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  margin-bottom: 8px;
  transition: all 0.15s;
}
.gdp-hint-toggle:hover {
  border-color: var(--accent2, #8A6A1F);
  color: var(--accent2, #8A6A1F);
}
.gdp-step-hint {
  font-size: 12px;
  color: var(--ink);
  background: rgba(138, 106, 31, 0.06);
  padding: 8px 10px;
  border-radius: 6px;
  border-left: 3px solid var(--accent2, #8A6A1F);
  margin-bottom: 10px;
  line-height: 1.5;
  animation: gdp-hint-in 0.2s ease;
}
@keyframes gdp-hint-in {
  from { opacity: 0; max-height: 0; }
  to { opacity: 1; max-height: 200px; }
}

/* ── 自适应 ── */
.gdp-adaptive {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
}
.gdp-adaptive.overload {
  background: #FEF3C7;
  color: #92400E;
  border: 1px solid #F59E0B;
}
.gdp-adaptive.flow {
  background: #D1FAE5;
  color: #065F46;
  border: 1px solid #10B981;
}

/* ── 行动按钮 ── */
.gdp-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  justify-content: center;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: var(--accent, #3D4F7A);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  margin-bottom: 10px;
}
.gdp-action-btn:hover { opacity: 0.88; }
.gdp-action-btn:active { transform: scale(0.98); }
.gdp-action-arrow { transition: transform 0.15s; }
.gdp-action-btn:hover .gdp-action-arrow { transform: translateX(3px); }

/* ── 导航 ── */
.gdp-nav-row {
  display: flex;
  gap: 6px;
}
.gdp-nav-btn {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--surface, #fff);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.gdp-nav-btn:hover { background: var(--bg2, #f5f5f5); }
.gdp-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.gdp-nav-btn.primary {
  background: var(--accent, #3D4F7A);
  color: #fff;
  border-color: var(--accent, #3D4F7A);
  font-weight: 600;
}
.gdp-nav-btn.primary:hover { opacity: 0.88; background: var(--accent, #3D4F7A); }

/* ── 已完成列表 ── */
.gdp-completed-list {
  margin-top: 12px;
  border-top: 1px solid var(--border, #e0e0e0);
  padding-top: 8px;
}
.gdp-completed-title {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.gdp-completed-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
  color: var(--muted);
}
.gdp-completed-item .gdp-check {
  font-size: 12px;
}

/* ── 最终完成 ── */
.gdp-finale {
  margin-top: 12px;
  padding: 16px;
  text-align: center;
  background: linear-gradient(135deg, rgba(255,193,7,0.08), rgba(61,79,122,0.08));
  border-radius: 10px;
  border: 1px solid var(--accent, #3D4F7A);
  animation: gdp-finale-in 0.5s ease;
}
@keyframes gdp-finale-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
.gdp-finale-trophy {
  font-size: 36px;
  animation: gdp-trophy-bounce 0.6s ease;
}
@keyframes gdp-trophy-bounce {
  0% { transform: scale(0) rotate(-180deg); }
  60% { transform: scale(1.2) rotate(10deg); }
  100% { transform: scale(1) rotate(0); }
}
.gdp-finale-text {
  font-size: 13px;
  color: var(--ink);
  margin: 8px 0;
  line-height: 1.5;
  font-weight: 600;
}
.gdp-finale-stars {
  font-size: 18px;
  letter-spacing: 2px;
}

/* ── 互动检查点 ── */
.gdp-checkpoint {
  margin-top: 12px;
  border: 1px solid var(--accent, #3D4F7A);
  border-radius: 10px;
  padding: 12px;
  background: var(--surface, #fff);
  animation: gdp-slide-in 0.3s ease;
}
.gdp-checkpoint-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.gdp-checkpoint-icon { font-size: 16px; line-height: 1; }
.gdp-checkpoint-title {
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.gdp-checkpoint-close {
  border: none;
  background: none;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}
.gdp-checkpoint-close:hover { background: var(--bg2, #f5f5f5); }
.gdp-checkpoint-question {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.5;
  padding: 8px 10px;
  margin-bottom: 10px;
  background: var(--bg2, #f5f5f5);
  border-radius: 6px;
  border-left: 3px solid var(--accent, #3D4F7A);
}
.gdp-checkpoint-choices {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.gdp-checkpoint-choice {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--surface, #fff);
  font-size: 12px;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
}
.gdp-checkpoint-choice:hover {
  border-color: var(--accent, #3D4F7A);
  background: var(--bg2, #f5f5f5);
}
.gdp-checkpoint-choice:active { transform: scale(0.98); }
.gdp-checkpoint-choice.selected {
  border-color: var(--accent, #3D4F7A);
  background: rgba(61, 79, 122, 0.08);
  font-weight: 600;
}
.gdp-checkpoint-choice.wrong {
  border-color: #EF4444;
  background: rgba(239, 68, 68, 0.08);
  color: #991B1B;
  animation: gdp-shake 0.3s ease;
}
@keyframes gdp-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px); }
  75% { transform: translateX(3px); }
}
.gdp-checkpoint-submit {
  display: block;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: var(--accent, #3D4F7A);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.gdp-checkpoint-submit:hover:not(:disabled) { opacity: 0.88; }
.gdp-checkpoint-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.gdp-checkpoint-encourage {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #92400E;
  background: #FEF3C7;
  border: 1px solid #F59E0B;
  border-radius: 6px;
  animation: gdp-hint-in 0.2s ease;
}

/* ── 知识卡片 ── */
.gdp-knowledge-cards {
  margin-top: 12px;
  border-top: 1px solid var(--border, #e0e0e0);
  padding-top: 8px;
}
.gdp-cards-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s;
}
.gdp-cards-toggle:hover { background: var(--bg2, #f5f5f5); }
.gdp-cards-count {
  margin-left: 4px;
  color: var(--muted);
  font-weight: 400;
}
.gdp-cards-arrow { color: var(--muted); font-size: 11px; }
.gdp-cards-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  animation: gdp-hint-in 0.2s ease;
}
.gdp-kcard {
  padding: 10px;
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 8px;
  background: var(--bg2, #f9f9f9);
  animation: gdp-card-in 0.3s ease;
}
@keyframes gdp-card-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.gdp-kcard-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.gdp-kcard-icon { font-size: 18px; line-height: 1; }
.gdp-kcard-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.gdp-kcard-body {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink);
  margin-bottom: 8px;
}
.gdp-kcard-example {
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  padding: 6px 8px;
  background: var(--surface, #fff);
  border-radius: 6px;
  border-left: 3px solid var(--accent2, #8A6A1F);
}
.gdp-kcard-example-label {
  font-weight: 600;
  color: var(--accent2, #8A6A1F);
}

/* ── 成就徽章 ── */
.gdp-achievements {
  margin-top: 12px;
  border-top: 1px solid var(--border, #e0e0e0);
  padding-top: 8px;
}
.gdp-achievements-title {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.gdp-achievements-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.gdp-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 54px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border, #e0e0e0);
  background: var(--surface, #fff);
  transition: transform 0.2s;
  cursor: default;
}
.gdp-badge.unlocked {
  border-color: rgba(255, 193, 7, 0.4);
  background: rgba(255, 193, 7, 0.06);
  animation: gdp-badge-pop 0.4s ease;
}
.gdp-badge.unlocked:hover { transform: scale(1.06); }
@keyframes gdp-badge-pop {
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.1); }
  100% { transform: scale(1); opacity: 1; }
}
.gdp-badge.locked {
  opacity: 0.4;
  filter: grayscale(1);
}
.gdp-badge-icon { font-size: 18px; line-height: 1; }
.gdp-badge-label {
  font-size: 9px;
  line-height: 1.2;
  text-align: center;
  color: var(--muted);
}
.gdp-badge.unlocked .gdp-badge-label {
  color: var(--accent2, #8A6A1F);
  font-weight: 600;
}
`
