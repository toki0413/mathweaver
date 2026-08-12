import { useState, useEffect } from 'react'
import { useStore } from '../stores/sessionStore'
import { AgeSelector } from './AgeSelector'
import { CoachMarks } from './CoachMarks'
import type { CoachMarkStep } from './CoachMarks'
import { t } from '../utils/ageAdapt'
import type { AgeLevel } from '../utils/ageAdapt'

interface OnboardingOverlayProps {
  open: boolean
  onClose: () => void
  onComplete: () => void
  ageLevel: AgeLevel
  onAgeChange: (level: AgeLevel) => void
  onFinish?: () => void
  /**
   * 可选的交互式教练标记步骤。
   * 若提供，则静态引导卡片走完后会进入 CoachMarks 阶段，
   * 高亮页面中真实的 UI 元素；不提供时保持原有纯静态流程（向后兼容）。
   */
  interactiveSteps?: CoachMarkStep[]
}

/** 不同年龄段的引导步骤数 */
const STEP_COUNTS: Record<AgeLevel, number> = {
  kids: 3,
  tweens: 4,
  teens: 5,
}

const OVERLAY_CSS = `
.onboarding-root {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: onboarding-fade 0.2s ease;
}
@keyframes onboarding-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.onboarding-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
}
.onboarding-card {
  position: relative;
  background: var(--bg, #fff);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 12px;
  max-width: 560px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  padding: 32px 36px 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  animation: onboarding-pop 0.25s ease;
}
@keyframes onboarding-pop {
  from { transform: scale(0.96); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.onboarding-sub {
  font-size: 12px;
  color: var(--muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}
.onboarding-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--ink, #222);
  margin-bottom: 16px;
  line-height: 1.3;
}
.onboarding-body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink, #333);
}
.onboarding-body .muted {
  color: var(--muted, #888);
  font-size: 13px;
}
.onboarding-flow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 14px;
  background: var(--bg2, #f8f8f8);
  border-radius: 8px;
}
.onboarding-flow-step {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 20px;
  background: var(--bg, #fff);
  white-space: nowrap;
}
.onboarding-flow-arrow {
  color: var(--accent, #3D4F7A);
  font-weight: 700;
}
.onboarding-kbd-row {
  display: flex;
  gap: 16px;
  margin-top: 14px;
}
.onboarding-kbd-item {
  flex: 1;
  text-align: center;
  padding: 12px 8px;
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 8px;
  background: var(--bg2, #f8f8f8);
}
.onboarding-kbd-item kbd {
  display: inline-block;
  font-family: var(--mono, monospace);
  font-size: 13px;
  font-weight: 700;
  padding: 2px 8px;
  border: 1px solid var(--border, #ccc);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg, #fff);
  margin-bottom: 4px;
}
.onboarding-kbd-item .kbd-desc {
  display: block;
  font-size: 11px;
  color: var(--muted, #888);
  margin-top: 4px;
}
.onboarding-feature-list {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.onboarding-feature {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 6px;
  font-size: 12px;
}
.onboarding-feature .feat-icon {
  font-size: 16px;
  flex-shrink: 0;
  line-height: 1;
  margin-top: 1px;
}
.onboarding-feature .feat-name {
  font-weight: 600;
}
.onboarding-feature .feat-desc {
  color: var(--muted, #888);
  font-size: 11px;
}
.onboarding-mock-warn {
  margin-top: 14px;
  padding: 12px 14px;
  background: #FEF3C7;
  border: 1px solid #F59E0B;
  border-radius: 8px;
  font-size: 13px;
  color: #92400E;
  line-height: 1.5;
}
.onboarding-mock-warn strong {
  display: block;
  margin-bottom: 4px;
}
.onboarding-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border, #e0e0e0);
}
.onboarding-dots {
  display: flex;
  gap: 6px;
}
.onboarding-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border, #ddd);
  transition: background 0.2s;
}
.onboarding-dot.active {
  background: var(--accent, #3D4F7A);
}
.onboarding-step-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted, #888);
  letter-spacing: 0.02em;
}
.onboarding-age-hint {
  margin-top: 14px;
  text-align: center;
  font-size: 13px;
  color: var(--accent, #3D4F7A);
  font-weight: 600;
}
.onboarding-actions {
  display: flex;
  gap: 8px;
}
.onboarding-actions .btn {
  font-size: 13px;
  padding: 6px 14px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--bg, #fff);
  cursor: pointer;
  transition: background 0.15s;
}
.onboarding-actions .btn:hover {
  background: var(--bg2, #f5f5f5);
}
.onboarding-actions .btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.onboarding-actions .btn-primary {
  background: var(--accent, #3D4F7A);
  color: #fff;
  border-color: var(--accent, #3D4F7A);
}
.onboarding-actions .btn-primary:hover {
  opacity: 0.9;
  background: var(--accent, #3D4F7A);
}
/* === AgeSelector full mode（引导/设置中使用，全局 CSS 中缺失，在此补齐） === */
.age-selector-full {
  margin-top: 4px;
}
.age-selector-question {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink, #222);
  margin-bottom: 12px;
  text-align: center;
}
.age-selector-cards {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}
.age-selector-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 10px;
  border: 2px solid var(--border, #e0e0e0);
  border-radius: 10px;
  background: var(--bg2, #f8f8f8);
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.age-selector-card:hover {
  border-color: var(--accent, #3D4F7A);
  background: var(--bg, #fff);
}
.age-selector-card.active {
  border-color: var(--accent, #3D4F7A);
  background: var(--bg, #fff);
  box-shadow: 0 0 0 3px rgba(61, 79, 122, 0.12);
}
.age-selector-card-emoji {
  font-size: 28px;
  line-height: 1;
}
.age-selector-card-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink, #222);
}
.age-selector-card-range {
  font-size: 11px;
  color: var(--muted, #888);
}
.age-selector-card-desc {
  font-size: 11px;
  color: var(--muted, #888);
  line-height: 1.4;
  margin-top: 2px;
}
@media (max-width: 600px) {
  .onboarding-feature-list { grid-template-columns: 1fr; }
  .onboarding-kbd-row { flex-direction: column; }
  .age-selector-cards { grid-template-columns: 1fr; }
}
`

/**
 * 检测当前平台，返回快捷键修饰键。
 * Mac 用 ⌘，Windows/Linux 用 Ctrl。
 */
function detectModKey(): string {
  // navigator.platform 已废弃，优先使用 userAgentData.platform，回退到 navigator.platform
  const platform =
    (typeof navigator !== 'undefined' &&
      ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ??
        navigator.platform)) ||
    ''
  if (platform) {
    if (/Mac|iPhone|iPad|iPod/i.test(platform)) return '⌘'
  }
  if (typeof process !== 'undefined' && process.platform) {
    if (process.platform === 'darwin') return '⌘'
  }
  return 'Ctrl'
}

/**
 * 全屏遮罩分步引导 —— 首次启动时自动显示。
 *
 * 第一步固定为年龄选择（AgeSelector full 模式），后续步骤数量与内容随
 * 年龄等级自适应：
 *   - kids   (3 步)：选年龄 → 玩第一个任务提示 → 遇到问题怎么办
 *   - tweens (4 步)：选年龄 → 核心功能 → 如何开始 → AI 配置（简化）
 *   - teens  (5 步)：选年龄 → 核心功能 → 高级功能 → 如何开始 → AI 配置（简化）
 *
 * 所有文案通过 ageAdapt 的 t() 函数做年龄适配。
 */
export function OnboardingOverlay({
  open,
  onClose,
  onComplete,
  ageLevel,
  onAgeChange,
  onFinish,
  interactiveSteps,
}: OnboardingOverlayProps) {
  const llmConfig = useStore(s => s.llmConfig)
  const [step, setStep] = useState(0)
  const [hasSelectedAge, setHasSelectedAge] = useState(false)
  const [phase, setPhase] = useState<'static' | 'interactive'>('static')

  const totalSteps = STEP_COUNTS[ageLevel]

  // 打开时重置到第一步
  useEffect(() => {
    if (open) {
      setStep(0)
      setHasSelectedAge(false)
      setPhase('static')
    }
  }, [open])

  // 年龄等级变化时，确保当前步骤不越界
  useEffect(() => {
    setStep(s => Math.min(s, totalSteps - 1))
  }, [totalSteps])

  // Esc 键关闭引导（组件无 allowSkip prop，因此 open 时统一允许跳过）
  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  const isMock = !llmConfig || (llmConfig.provider || '').toLowerCase() === 'mock'
  const isLast = step === totalSteps - 1
  const modKey = detectModKey()

  const welcomeTitle =
    ageLevel === 'kids'
      ? '欢迎来到魔法学院！'
      : ageLevel === 'tweens'
        ? '欢迎来到 MathWeaver！'
        : 'Welcome to MathWeaver'

  const handleAgeChange = (level: AgeLevel) => {
    onAgeChange(level)
    setHasSelectedAge(true)
  }

  const finish = () => {
    onComplete()
    onFinish?.()
    onClose()
  }

  /** 静态引导结束后：若有交互式步骤则进入 CoachMarks 阶段，否则直接完成（向后兼容） */
  const handleStaticFinish = () => {
    if (interactiveSteps && interactiveSteps.length > 0) {
      setPhase('interactive')
    } else {
      finish()
    }
  }

  const nextDisabled = step === 0 && !hasSelectedAge
  const backLabel = ageLevel === 'teens' ? 'Back' : '上一步'
  const nextLabel = ageLevel === 'teens' ? 'Next' : '下一步'
  const finishLabel =
    ageLevel === 'kids' ? '开始冒险' : ageLevel === 'tweens' ? '开始探索' : 'Get started'

  /** 步骤副标题（teens 用英文） */
  const stepSub = (n: number) =>
    ageLevel === 'teens' ? `Step ${n} / ${totalSteps}` : `第 ${n} 步 / 共 ${totalSteps} 步`

  // 交互式教练标记阶段：静态引导完成后高亮页面中真实的 UI 元素
  if (phase === 'interactive' && interactiveSteps && interactiveSteps.length > 0) {
    return <CoachMarks steps={interactiveSteps} onComplete={finish} onSkip={finish} />
  }

  return (
    <>
      <style>{OVERLAY_CSS}</style>
      <div className="onboarding-root">
        <div className="onboarding-backdrop" />
        <div className="onboarding-card" role="dialog" aria-modal="true" aria-label="使用引导">
          {/* ===== Step 0：年龄选择（所有年龄段通用） ===== */}
          {step === 0 && (
            <>
              <div className="onboarding-sub">{stepSub(1)}</div>
              <div className="onboarding-title">{welcomeTitle}</div>
              <div className="onboarding-body">
                <div style={{ marginBottom: '12px' }}>
                  {ageLevel === 'kids'
                    ? '选一选你的年龄，我们会为你准备最好玩的冒险！'
                    : ageLevel === 'tweens'
                      ? '选择你的年龄等级，系统会自动调整语言风格和内容深度。'
                      : 'Select your age level — terminology and depth will calibrate accordingly.'}
                </div>
                <AgeSelector level={ageLevel} onChange={handleAgeChange} />
                <div
                  className="onboarding-age-hint"
                  style={!hasSelectedAge ? { color: 'var(--muted, #888)' } : undefined}
                >
                  {!hasSelectedAge
                    ? ageLevel === 'teens'
                      ? 'Please select an age level to continue.'
                      : '请先选择年龄等级，再点击「下一步」'
                    : ageLevel === 'kids'
                      ? '太棒了！点击「下一步」开始冒险吧～'
                      : ageLevel === 'tweens'
                        ? '已选择！点击「下一步」继续 →'
                        : 'Selection saved. Click "Next" to continue.'}
                </div>
              </div>
            </>
          )}

          {/* ===== Kids Step 1：玩第一个任务提示 ===== */}
          {ageLevel === 'kids' && step === 1 && (
            <>
              <div className="onboarding-sub">{stepSub(2)}</div>
              <div className="onboarding-title">开始你的魔法冒险！</div>
              <div className="onboarding-body">
                进入后，你会看到一张
                <span style={{ color: 'var(--accent)' }}>{t('onboarding_cayley', ageLevel)}</span>。
                <div className="muted" style={{ marginTop: '8px' }}>
                  点一点表格里的数字，把它们改成别的数（0 到 2），看看会发生什么神奇的事情！试着改 5
                  个格子吧。
                </div>
                <div className="muted" style={{ marginTop: '8px' }}>
                  右边的
                  <span style={{ color: 'var(--accent)' }}>{t('four_field', ageLevel)}</span>
                  会告诉你：你有多厉害、{t('onboarding_cognitive_load', ageLevel)}
                  怎么样。放心玩，随便改都没关系！
                </div>
              </div>
            </>
          )}

          {/* ===== Kids Step 2：遇到问题怎么办 ===== */}
          {ageLevel === 'kids' && step === 2 && (
            <>
              <div className="onboarding-sub">{stepSub(3)}</div>
              <div className="onboarding-title">遇到困难怎么办？</div>
              <div className="onboarding-body">
                卡住了？没关系，每个魔法师都会遇到困难！
                <div className="onboarding-feature-list" style={{ marginTop: '12px' }}>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">点提示按钮</div>
                      <div className="feat-desc">卡住时点一下，就有线索啦</div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('llm', ageLevel)}帮你</div>
                      <div className="feat-desc">随时问问题，{t('llm', ageLevel)}会陪你</div>
                    </div>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: '10px' }}>
                  现在是{t('mock_mode', ageLevel)}，{t('llm', ageLevel)}
                  的回答是练习用的。等你想用真正的{t('llm', ageLevel)}
                  时，可以让爸爸妈妈帮忙在设置里配置。
                </div>
              </div>
            </>
          )}

          {/* ===== Tweens Step 1：核心功能 ===== */}
          {ageLevel === 'tweens' && step === 1 && (
            <>
              <div className="onboarding-sub">{stepSub(2)}</div>
              <div className="onboarding-title">核心功能速览</div>
              <div className="onboarding-body">
                这是你的
                <span style={{ color: 'var(--accent)' }}>{t('cognition_os', ageLevel)}</span>
                ，帮你{t('algebraic_intuition', ageLevel)}——{t('groups_to_proofs', ageLevel)}
                ，一步步来。
                <div className="onboarding-feature-list">
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('onboarding_cayley', ageLevel)}</div>
                      <div className="feat-desc">
                        可编辑的运算表，实时验证{t('group_axioms', ageLevel)}
                      </div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon">✓</span>
                    <div>
                      <div className="feat-name">{t('z3_engine', ageLevel)}</div>
                      <div className="feat-desc">自动检查你的运算是否满足群的规则</div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('conjecture_engine', ageLevel)}</div>
                      <div className="feat-desc">提出猜想，系统自动验证</div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('manim_anim', ageLevel)}</div>
                      <div className="feat-desc">群运算的可视化动画演示</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== Tweens Step 2：如何开始 ===== */}
          {ageLevel === 'tweens' && step === 2 && (
            <>
              <div className="onboarding-sub">{stepSub(3)}</div>
              <div className="onboarding-title">如何开始</div>
              <div className="onboarding-body">
                一个完整的学习闭环：
                <div className="onboarding-flow">
                  <span className="onboarding-flow-step">选概念</span>
                  <span className="onboarding-flow-arrow">→</span>
                  <span className="onboarding-flow-step">
                    编辑{t('onboarding_cayley', ageLevel)}
                  </span>
                  <span className="onboarding-flow-arrow">→</span>
                  <span className="onboarding-flow-step">提交验证</span>
                  <span className="onboarding-flow-arrow">→</span>
                  <span className="onboarding-flow-step">查看反馈</span>
                </div>
                <div className="muted" style={{ marginTop: '12px' }}>
                  右侧的{t('four_field', ageLevel)}会实时展示你的掌握度、
                  {t('onboarding_cognitive_load', ageLevel)}、情绪状态与互动节奏。
                </div>
                <div className="onboarding-kbd-row">
                  <div className="onboarding-kbd-item">
                    <kbd>{modKey} K</kbd>
                    <span className="kbd-desc">
                      命令面板
                      <br />
                      搜索、导航、执行
                    </span>
                  </div>
                  <div className="onboarding-kbd-item">
                    <kbd>?</kbd>
                    <span className="kbd-desc">
                      快捷键总览
                      <br />
                      查看所有键盘快捷键
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== Tweens Step 3：AI 配置（简化） ===== */}
          {ageLevel === 'tweens' && step === 3 && (
            <>
              <div className="onboarding-sub">{stepSub(4)}</div>
              <div className="onboarding-title">配置 {t('llm', ageLevel)}</div>
              <div className="onboarding-body">
                {isMock ? (
                  <div className="onboarding-mock-warn">
                    <strong>⚠ 当前处于{t('mock_mode', ageLevel)}</strong>
                    {t('llm', ageLevel)}的回复是占位内容。你可以在「设置」中连接自己的模型（支持
                    DeepSeek / OpenAI / Ollama 等）。
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: '8px' }}>
                    已检测到模型配置（{llmConfig?.model}）。
                  </div>
                )}
                <div className="muted" style={{ marginTop: '10px' }}>
                  不用现在配置也没关系——你可以随时在设置中配置 {t('llm', ageLevel)}
                  。点击右上角齿轮图标即可打开设置。
                </div>
              </div>
            </>
          )}

          {/* ===== Teens Step 1：Core Features ===== */}
          {ageLevel === 'teens' && step === 1 && (
            <>
              <div className="onboarding-sub">{stepSub(2)}</div>
              <div className="onboarding-title">Core Features</div>
              <div className="onboarding-body">
                This is your{' '}
                <span style={{ color: 'var(--accent)' }}>{t('cognition_os', ageLevel)}</span> —
                designed to help you {t('algebraic_intuition', ageLevel)}, from{' '}
                {t('groups_to_proofs', ageLevel)}.
                <div className="onboarding-feature-list">
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('onboarding_cayley', ageLevel)}</div>
                      <div className="feat-desc">
                        Editable operation table with live {t('group_axioms', ageLevel)} checking
                      </div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon">✓</span>
                    <div>
                      <div className="feat-name">{t('z3_engine', ageLevel)}</div>
                      <div className="feat-desc">Formal verification of group axioms via Z3</div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('conjecture_engine', ageLevel)}</div>
                      <div className="feat-desc">
                        Natural-language conjectures, automatically checked
                      </div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('manim_anim', ageLevel)}</div>
                      <div className="feat-desc">Animated visualizations of group operations</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== Teens Step 2：Advanced Features ===== */}
          {ageLevel === 'teens' && step === 2 && (
            <>
              <div className="onboarding-sub">{stepSub(3)}</div>
              <div className="onboarding-title">Advanced Features</div>
              <div className="onboarding-body">
                Beyond the basics:
                <div className="onboarding-feature-list">
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">3D Symmetry Groups</div>
                      <div className="feat-desc">
                        Rotate polyhedra to visualize {t('onboarding_permutation', ageLevel)}
                      </div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">{t('eye_tracking', ageLevel)}</div>
                      <div className="feat-desc">
                        Camera-based {t('onboarding_cognitive_load', ageLevel)} estimation
                      </div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon">·</span>
                    <div>
                      <div className="feat-name">{t('latex_render', ageLevel)}</div>
                      <div className="feat-desc">Live formula editing and preview</div>
                    </div>
                  </div>
                  <div className="onboarding-feature">
                    <span className="feat-icon"></span>
                    <div>
                      <div className="feat-name">Flashcards</div>
                      <div className="feat-desc">Spaced repetition for retention</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== Teens Step 3：Getting Started ===== */}
          {ageLevel === 'teens' && step === 3 && (
            <>
              <div className="onboarding-sub">{stepSub(4)}</div>
              <div className="onboarding-title">Getting Started</div>
              <div className="onboarding-body">
                A complete learning loop in four moves:
                <div className="onboarding-flow">
                  <span className="onboarding-flow-step">Pick concept</span>
                  <span className="onboarding-flow-arrow">→</span>
                  <span className="onboarding-flow-step">
                    Edit {t('onboarding_cayley', ageLevel)}
                  </span>
                  <span className="onboarding-flow-arrow">→</span>
                  <span className="onboarding-flow-step">Verify</span>
                  <span className="onboarding-flow-arrow">→</span>
                  <span className="onboarding-flow-step">Review feedback</span>
                </div>
                <div className="muted" style={{ marginTop: '12px' }}>
                  The {t('four_field', ageLevel)} tracks mastery,{' '}
                  {t('onboarding_cognitive_load', ageLevel)}, affect, and pacing in real time.
                </div>
                <div className="onboarding-kbd-row">
                  <div className="onboarding-kbd-item">
                    <kbd>{modKey} K</kbd>
                    <span className="kbd-desc">
                      Command palette
                      <br />
                      Search, navigate, execute
                    </span>
                  </div>
                  <div className="onboarding-kbd-item">
                    <kbd>?</kbd>
                    <span className="kbd-desc">
                      Shortcut overview
                      <br />
                      View all keyboard shortcuts
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== Teens Step 4：Configure AI (simplified) ===== */}
          {ageLevel === 'teens' && step === 4 && (
            <>
              <div className="onboarding-sub">{stepSub(5)}</div>
              <div className="onboarding-title">Configure {t('llm', ageLevel)}</div>
              <div className="onboarding-body">
                {isMock ? (
                  <div className="onboarding-mock-warn">
                    <strong>⚠ {t('mock_mode', ageLevel)} active</strong>
                    {t('llm', ageLevel)} responses are placeholders. Connect your own model in
                    Settings (DeepSeek / OpenAI / Ollama / LM Studio).
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: '8px' }}>
                    Model detected: {llmConfig?.model}.
                  </div>
                )}
                <div className="muted" style={{ marginTop: '10px' }}>
                  You can configure {t('llm', ageLevel)} later in Settings — no rush. Click the gear
                  icon top-right, or press{' '}
                  <kbd
                    style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      border: '1px solid #ccc',
                      borderRadius: '3px',
                    }}
                  >
                    {modKey} ,
                  </kbd>
                  .
                </div>
              </div>
            </>
          )}

          {/* ===== Footer：进度指示 + 操作按钮 ===== */}
          <div className="onboarding-footer">
            {ageLevel === 'kids' ? (
              <div className="onboarding-step-text">
                第 {step + 1} / {totalSteps} 步
              </div>
            ) : (
              <div className="onboarding-dots">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <span key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
                ))}
              </div>
            )}
            <div className="onboarding-actions">
              <button
                className="btn"
                onClick={() => setStep(s => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                {backLabel}
              </button>
              {isLast ? (
                <button className="btn btn-primary" onClick={handleStaticFinish}>
                  {finishLabel}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => setStep(s => Math.min(totalSteps - 1, s + 1))}
                  disabled={nextDisabled}
                >
                  {nextLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
