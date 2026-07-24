import { useState, useEffect } from 'react'
import { useStore } from '../stores/sessionStore'

interface OnboardingOverlayProps {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
}

const TOTAL_STEPS = 4

/**
 * 全屏遮罩分步引导 —— 首次启动时自动显示。
 *
 * 四步：欢迎 → 三种学习模式 → 如何开始 → 配置 AI。
 * 点击「开始使用」调用 store.completeOnboarding()。
 */
export function OnboardingOverlay({ open, onClose, onOpenSettings }: OnboardingOverlayProps) {
  const completeOnboarding = useStore((s) => s.completeOnboarding)
  const llmConfig = useStore((s) => s.llmConfig)

  const [step, setStep] = useState(0)

  // 每次打开都从第一步开始
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  const isMock = !llmConfig || (llmConfig.provider || '').toLowerCase() === 'mock'

  const finish = async () => {
    await completeOnboarding()
    onClose()
  }

  const goToSettings = async () => {
    await completeOnboarding()
    onOpenSettings()
  }

  if (!open) return null

  const isLast = step === TOTAL_STEPS - 1

  return (
    <>
      <div className="overlay-backdrop" />
      <div className="onboarding-card" role="dialog" aria-modal="true" aria-label="使用引导">
        {step === 0 && (
          <>
            <div className="onboarding-step-sub">第 1 步 / 共 4 步</div>
            <div className="onboarding-step-title">欢迎使用 MathWeaver</div>
            <div className="onboarding-step-body">
              这是你的<span style={{ color: 'var(--accent)' }}>数学认知操作系统</span>。
              <div className="muted" style={{ marginTop: '8px' }}>
                MathWeaver 通过可编辑的运算表、对话式诊断与自适应反馈，帮你建立扎实的抽象代数直觉——从群、环到证明，一步步追踪你的认知状态。
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="onboarding-step-sub">第 2 步 / 共 4 步</div>
            <div className="onboarding-step-title">三种学习模式</div>
            <div className="onboarding-step-body">
              切换顶部的标签，选择适合当前目标的学习方式：
              <div className="onboarding-mode-grid">
                <div className="onboarding-mode">
                  <div className="mode-icon">◑</div>
                  <div className="mode-name">对话</div>
                  <div className="mode-desc">自由提问，AI 诊断你的理解盲区</div>
                </div>
                <div className="onboarding-mode">
                  <div className="mode-icon">◍</div>
                  <div className="mode-name">面试</div>
                  <div className="mode-desc">即时追问，检验概念掌握程度</div>
                </div>
                <div className="onboarding-mode">
                  <div className="mode-icon">△</div>
                  <div className="mode-name">证明</div>
                  <div className="mode-desc">逐步验证，锤炼严谨推理链条</div>
                </div>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboarding-step-sub">第 3 步 / 共 4 步</div>
            <div className="onboarding-step-title">如何开始</div>
            <div className="onboarding-step-body">
              一个完整的学习闭环只需四步：
              <div className="onboarding-flow">
                <span className="onboarding-flow-step">选概念</span>
                <span className="onboarding-flow-arrow">→</span>
                <span className="onboarding-flow-step">编辑运算表</span>
                <span className="onboarding-flow-arrow">→</span>
                <span className="onboarding-flow-step">提交验证</span>
                <span className="onboarding-flow-arrow">→</span>
                <span className="onboarding-flow-step">查看反馈</span>
              </div>
              <div className="muted" style={{ marginTop: '12px' }}>
                右侧的四场域面板会实时展示你的知识掌握、认知负荷、情绪状态与互动节奏。
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onboarding-step-sub">第 4 步 / 共 4 步</div>
            <div className="onboarding-step-title">配置你的 AI</div>
            <div className="onboarding-step-body">
              MathWeaver 需要一个 LLM 来驱动诊断与反馈。
              {isMock ? (
                <div className="mock-notice">
                  当前处于 mock 模式——所有回复为占位内容。连接你自己的模型（DeepSeek / OpenAI / Ollama 等）以获得真实教学。
                </div>
              ) : (
                <div className="muted" style={{ marginTop: '8px' }}>
                  已检测到模型配置。你随时可以在设置中调整 Provider、密钥与参数。
                </div>
              )}
            </div>
          </>
        )}

        <div className="onboarding-footer">
          <div className="onboarding-dots">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <span key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
            ))}
          </div>
          <div className="onboarding-actions">
            <button
              className="btn"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              上一步
            </button>
            {isLast ? (
              <>
                <button className="btn" onClick={finish}>
                  跳过
                </button>
                <button className="btn" onClick={goToSettings}>
                  去设置
                </button>
                <button className="btn btn-primary" onClick={finish}>
                  开始使用
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
              >
                下一步
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
