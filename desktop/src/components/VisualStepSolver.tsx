import { useState, useCallback, memo } from 'react'
import { MathText } from './MathText'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Step {
  title: string
  expression: string
  explanation: string
  type: 'transform' | 'simplify' | 'substitute' | 'conclude'
}

export interface VisualStepSolverProps {
  /** 数学题目，可为 LaTeX 或纯文本。 */
  problem: string
  /** 可选的分步解答；未提供时显示「请求AI解答」按钮。 */
  steps?: Step[]
  /** 点击「请求AI解答」时的回调。 */
  onRequestSolution?: () => void
}

// ---------------------------------------------------------------------------
// VisualStepSolver
//
// 受 MathVizy 可视化引擎启发，逐步展示数学题的分步解答。每一步以动画卡片
// 形式淡入（下一步逐张出现，「显示全部」时级联出现），顶部进度条反映完成
// 度，底部提供「上一步 / 下一步 / 显示全部」导航，当前步骤带发光高亮边框。
// 未提供 steps 时展示空状态与「请求AI解答」按钮，调用 onRequestSolution。
//
// 样式类名统一以 `cw-vss-` 为前缀，通过组件内 <style> 注入，复用 MathWeaver
// 暗色主题 CSS 变量（--bg / --bg2 / --bg3 / --ink / --muted / --border /
// --accent / --accent2 / --mono 等），不写入 index.css。
// ---------------------------------------------------------------------------

/** 步骤类型对应的图标符号。 */
const STEP_ICONS: Record<Step['type'], string> = {
  transform: '→',
  simplify: '↓',
  substitute: '⊕',
  conclude: '✓',
}

/** 步骤类型的中文标签（用于角标与无障碍标题）。 */
const TYPE_LABELS: Record<Step['type'], string> = {
  transform: '变形',
  simplify: '化简',
  substitute: '代入',
  conclude: '结论',
}

/** 「显示全部」时相邻新卡片出现的间隔（ms），用于级联淡入。 */
const CASCADE_STEP_MS = 70

/** 组件内联样式：所有 `cw-vss-` 前缀类名集中于此。 */
const STYLES = `
.cw-vss-root {
  /* 本地别名：--accent2 在全局未定义时回退到青色，与紫色 --accent 互补。 */
  --cw-vss-accent2: var(--accent2, hsl(190, 60%, 64%));
  --cw-vss-fade: 320ms;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--ink);
  font-family: var(--sans, system-ui, sans-serif);
}

/* === 题目区 === */
.cw-vss-problem {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
}
.cw-vss-problem-label {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.cw-vss-problem-body {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink);
  overflow-x: auto;
}
.cw-vss-problem-body .katex { font-size: 1.05em; }

/* === 进度条 === */
.cw-vss-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cw-vss-progress-track {
  flex: 1;
  height: 6px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.cw-vss-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--cw-vss-accent2));
  border-radius: 999px;
  transition: width var(--cw-vss-fade) cubic-bezier(0.2, 0.7, 0.2, 1);
}
.cw-vss-progress-text {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}

/* === 步骤卡片列表 === */
.cw-vss-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cw-vss-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border-subtle, var(--border));
  border-radius: 8px;
  color: var(--ink);
  opacity: 0;
  animation: cw-vss-fade-in var(--cw-vss-fade) ease both;
}
@keyframes cw-vss-fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 类型色：左侧色条 */
.cw-vss-card.cw-vss-type-transform  { border-left-color: var(--accent); }
.cw-vss-card.cw-vss-type-simplify   { border-left-color: var(--cw-vss-accent2); }
.cw-vss-card.cw-vss-type-substitute { border-left-color: var(--info, hsl(210, 60%, 68%)); }
.cw-vss-card.cw-vss-type-conclude   { border-left-color: var(--ok, hsl(142, 45%, 62%)); }

.cw-vss-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.cw-vss-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.cw-vss-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
}
.cw-vss-icon[data-type="transform"]  { color: var(--accent); background: var(--accent-subtle); }
.cw-vss-icon[data-type="simplify"]   { color: var(--cw-vss-accent2); background: color-mix(in srgb, var(--cw-vss-accent2) 15%, transparent); }
.cw-vss-icon[data-type="substitute"] { color: var(--info, hsl(210, 60%, 68%)); background: var(--info-bg, rgba(110, 176, 224, 0.12)); }
.cw-vss-icon[data-type="conclude"]   { color: var(--ok, hsl(142, 45%, 62%)); background: var(--ok-bg, rgba(98, 200, 133, 0.12)); }

.cw-vss-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  min-width: 0;
}
.cw-vss-type-tag {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.cw-vss-expr {
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow-x: auto;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink);
}
.cw-vss-expr .katex-display { margin: 0; }
.cw-vss-expr .katex { color: var(--ink); }

.cw-vss-explain {
  font-size: 13px;
  line-height: 1.65;
  color: var(--muted);
}

/* 当前步骤高亮：发光边框（置于类型规则之后以保证优先级） */
.cw-vss-card.cw-vss-current {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 22px -4px color-mix(in srgb, var(--accent) 60%, transparent);
  animation:
    cw-vss-fade-in var(--cw-vss-fade) ease both,
    cw-vss-glow 2.6s ease-in-out var(--cw-vss-fade) infinite;
}
@keyframes cw-vss-glow {
  0%, 100% { box-shadow: 0 0 0 1px var(--accent), 0 0 16px -6px color-mix(in srgb, var(--accent) 45%, transparent); }
  50%      { box-shadow: 0 0 0 1px var(--accent), 0 0 28px -3px color-mix(in srgb, var(--accent) 72%, transparent); }
}

/* === 导航控件 === */
.cw-vss-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.cw-vss-btn {
  appearance: none;
  cursor: pointer;
  padding: 8px 16px;
  min-width: 92px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.02em;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 120ms ease;
}
.cw-vss-btn:hover:not(:disabled) {
  background: var(--bg2);
  border-color: var(--border-strong, var(--border));
}
.cw-vss-btn:active:not(:disabled) { transform: translateY(1px); }
.cw-vss-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cw-vss-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.cw-vss-btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: hsl(222, 20%, 10%);
  font-weight: 600;
}
.cw-vss-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, var(--accent));
  border-color: var(--accent-hover, var(--accent));
}

/* === 空状态：请求 AI 解答 === */
.cw-vss-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 18px;
  text-align: center;
  background: var(--bg2);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.cw-vss-empty-icon {
  font-family: var(--serif, Georgia, serif);
  font-size: 34px;
  line-height: 1;
  color: var(--accent);
}
.cw-vss-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.cw-vss-empty-desc {
  max-width: 360px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
}
.cw-vss-request { margin-top: 6px; min-width: 140px; }
.cw-vss-empty-hint {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  opacity: 0.8;
}

/* === 响应式：窄屏 === */
@media (max-width: 560px) {
  .cw-vss-root { padding: 12px; gap: 12px; border-radius: 8px; }
  .cw-vss-card { padding: 12px; }
  .cw-vss-expr { padding: 8px 10px; font-size: 14px; }
  .cw-vss-title { font-size: 13px; }
  .cw-vss-type-tag { display: none; }
  .cw-vss-btn { min-width: 0; flex: 1; padding: 8px 10px; font-size: 11px; }
  .cw-vss-nav { gap: 6px; }
  .cw-vss-progress-text { font-size: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .cw-vss-card,
  .cw-vss-card.cw-vss-current {
    animation: none !important;
    opacity: 1 !important;
  }
  .cw-vss-progress-fill { transition: none; }
}
`

function VisualStepSolverImpl({
  problem,
  steps,
  onRequestSolution,
}: VisualStepSolverProps) {
  const total = steps?.length ?? 0
  const hasSteps = total > 0

  // current：当前已揭示并高亮的步骤下标（0-based），同时也是已展示步骤的边界。
  const [current, setCurrent] = useState(0)
  // cascadeStart：批量展示（「显示全部」）时首个新卡片下标；为 null 表示单步
  //   揭示模式，新卡片立即淡入。借此实现「逐张出现」的级联，无需定时器。
  const [cascadeStart, setCascadeStart] = useState<number | null>(null)

  // 防御性裁剪：steps 变化导致 current 越界时回退到最后一步。
  const safeCurrent = Math.min(current, Math.max(0, total - 1))
  const atStart = safeCurrent <= 0
  const atEnd = safeCurrent >= total - 1
  const progressPct = total > 0 ? ((safeCurrent + 1) / total) * 100 : 0

  const handlePrev = useCallback(() => {
    setCascadeStart(null)
    setCurrent((c) => Math.max(0, c - 1))
  }, [])

  const handleNext = useCallback(() => {
    setCascadeStart(null)
    setCurrent((c) => Math.min(total - 1, c + 1))
  }, [total])

  const handleShowAll = useCallback(() => {
    if (total <= 0) return
    // 记录批量起点 = 下一张新卡片下标，随后一次性揭示至末尾；新卡片按
    // (index - cascadeStart) 计算延迟，呈现逐张淡入的级联效果。
    const from = Math.min(current, total - 1) + 1
    setCascadeStart(from)
    setCurrent(total - 1)
  }, [total, current])

  const handleRequest = useCallback(() => {
    onRequestSolution?.()
  }, [onRequestSolution])

  // 仅渲染已揭示范围 [0 .. safeCurrent] 内的步骤。
  const visible = hasSteps ? steps!.slice(0, safeCurrent + 1) : []

  return (
    <div className="cw-vss-root">
      <style>{STYLES}</style>

      {/* 题目区 */}
      <section className="cw-vss-problem">
        <div className="cw-vss-problem-label">题目</div>
        <div className="cw-vss-problem-body">
          <MathText>{problem}</MathText>
        </div>
      </section>

      {hasSteps ? (
        <>
          {/* 进度条 */}
          <div
            className="cw-vss-progress"
            role="progressbar"
            aria-valuenow={safeCurrent + 1}
            aria-valuemin={1}
            aria-valuemax={total}
            aria-label="解答进度"
          >
            <div className="cw-vss-progress-track">
              <div
                className="cw-vss-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="cw-vss-progress-text">
              第 {safeCurrent + 1} / {total} 步
            </div>
          </div>

          {/* 步骤卡片列表 */}
          <div className="cw-vss-steps">
            {visible.map((step, i) => {
              const isCurrent = i === safeCurrent
              const delay =
                cascadeStart !== null && i >= cascadeStart
                  ? `${(i - cascadeStart) * CASCADE_STEP_MS}ms`
                  : '0ms'
              const cardClass = [
                'cw-vss-card',
                `cw-vss-type-${step.type}`,
                isCurrent ? 'cw-vss-current' : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <div
                  key={i}
                  className={cardClass}
                  style={{ animationDelay: delay }}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <div className="cw-vss-card-head">
                    <span className="cw-vss-badge" aria-label={`第 ${i + 1} 步`}>
                      {i + 1}
                    </span>
                    <span
                      className="cw-vss-icon"
                      data-type={step.type}
                      title={TYPE_LABELS[step.type]}
                      aria-hidden="true"
                    >
                      {STEP_ICONS[step.type]}
                    </span>
                    <span className="cw-vss-title">{step.title}</span>
                    <span className="cw-vss-type-tag">
                      {TYPE_LABELS[step.type]}
                    </span>
                  </div>

                  <div className="cw-vss-expr">
                    <MathText>{step.expression}</MathText>
                  </div>

                  {step.explanation ? (
                    <div className="cw-vss-explain">{step.explanation}</div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* 导航控件 */}
          <div className="cw-vss-nav">
            <button
              type="button"
              className="cw-vss-btn"
              onClick={handlePrev}
              disabled={atStart}
            >
              上一步
            </button>
            <button
              type="button"
              className="cw-vss-btn cw-vss-btn-primary"
              onClick={handleNext}
              disabled={atEnd}
            >
              下一步
            </button>
            <button
              type="button"
              className="cw-vss-btn"
              onClick={handleShowAll}
              disabled={atEnd}
            >
              显示全部
            </button>
          </div>
        </>
      ) : (
        /* 无步骤：请求 AI 解答 */
        <div className="cw-vss-empty">
          <div className="cw-vss-empty-icon" aria-hidden="true">∑</div>
          <div className="cw-vss-empty-title">暂无解答步骤</div>
          <div className="cw-vss-empty-desc">
            点击下方按钮，让 AI 为你生成这道题的可视化分步解答。
          </div>
          <button
            type="button"
            className="cw-vss-btn cw-vss-btn-primary cw-vss-request"
            onClick={handleRequest}
            disabled={!onRequestSolution}
            title={
              onRequestSolution
                ? '请求 AI 生成分步解答'
                : '未提供解答请求回调'
            }
          >
            请求AI解答
          </button>
          {!onRequestSolution ? (
            <div className="cw-vss-empty-hint">未配置解答请求回调</div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export const VisualStepSolver = memo(VisualStepSolverImpl)
VisualStepSolver.displayName = 'VisualStepSolver'
