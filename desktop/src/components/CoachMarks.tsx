import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import type { CSSProperties } from 'react'

export interface CoachMarkStep {
  selector: string
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right'
}

export interface CoachMarksProps {
  steps: CoachMarkStep[]
  onComplete: () => void
  onSkip: () => void
}

/**
 * MathWeaver 默认教练标记步骤。
 *
 * 高亮 App.tsx 中真实存在的 UI 元素，引导新用户认识核心交互区。
 * 注意：header 中的 AgeSelector 以 compact 模式渲染（类名 .age-selector-compact），
 * 因此第 3 步同时匹配 .age-selector 与 .age-selector-compact —— 既指向真实元素，
 * 又兼容未来可能改用的 .age-selector 类名。
 */
// eslint-disable-next-line react-refresh/only-export-components
export const MATHWEAVER_COACH_STEPS: CoachMarkStep[] = [
  {
    selector: '.mode-nav',
    title: '模式切换',
    description: '在这里切换学习模式：对话、挑战、证明和知识地图。',
    position: 'bottom',
  },
  {
    selector: '.text-input',
    title: '提问区',
    description: '在这里输入任何数学问题，我会帮你解答。',
    position: 'top',
  },
  {
    selector: '.age-selector, .age-selector-compact',
    title: '年龄适配',
    description: '选择你的年龄段，系统会自动调整语言和难度。',
    position: 'bottom',
  },
  {
    selector: '.mode-tab',
    title: '开始探索',
    description: '点击「对话」模式开始你的数学之旅！',
    position: 'bottom',
  },
]

const COACH_CSS = `
.coach-root {
  position: fixed;
  inset: 0;
  z-index: 10000;
}
/* 全屏点击遮罩：透明，仅用于拦截背景交互（高亮区由 spotlight 的 box-shadow 视觉遮罩负责） */
.coach-guard {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: transparent;
  pointer-events: auto;
}
/* 元素缺失 / 首次定位前，整体变暗以保持模态感 */
.coach-guard.is-dim {
  background: rgba(0, 0, 0, 0.55);
}
/* 高亮"挖洞"层：box-shadow 向外铺 9999px 半透明黑，形成除目标外全屏变暗的效果 */
.coach-spotlight {
  position: fixed;
  z-index: 10001;
  box-sizing: border-box;
  pointer-events: none;
  background: transparent;
  border: 2px solid var(--accent, #3D4F7A);
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  transition:
    top 0.3s ease,
    left 0.3s ease,
    width 0.3s ease,
    height 0.3s ease,
    border-radius 0.3s ease;
}
.coach-tooltip {
  position: fixed;
  z-index: 10002;
  box-sizing: border-box;
  width: 300px;
  max-width: calc(100vw - 24px);
  padding: 14px 16px;
  pointer-events: auto;
  background: var(--bg2, #fff);
  color: var(--ink, #222);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  animation: coach-tip-in 0.2s ease;
}
@keyframes coach-tip-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
.coach-tip-step {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent, #3D4F7A);
  margin-bottom: 4px;
}
.coach-tip-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink, #222);
  margin-bottom: 6px;
  line-height: 1.3;
}
.coach-tip-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted, #555);
}
.coach-tip-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.coach-tip-dots {
  display: flex;
  gap: 6px;
}
.coach-tip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border, #ddd);
  transition: background 0.2s;
}
.coach-tip-dot.active {
  background: var(--accent, #3D4F7A);
}
.coach-tip-actions {
  display: flex;
  gap: 8px;
}
.coach-tip-btn {
  font-size: 12px;
  padding: 5px 12px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--bg, #fff);
  color: var(--ink, #222);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.coach-tip-btn:hover {
  background: var(--bg3, #f1f1f1);
}
.coach-tip-btn.primary {
  background: var(--accent, #3D4F7A);
  color: #fff;
  border-color: var(--accent, #3D4F7A);
}
.coach-tip-btn.primary:hover {
  background: var(--accent-hover, #2f3d5e);
}
.coach-missing-msg {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10003;
  padding: 10px 16px;
  font-size: 14px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 8px;
  pointer-events: none;
}
@media (max-width: 480px) {
  .coach-tooltip {
    width: calc(100vw - 24px);
  }
}
`

interface RectLike {
  top: number
  left: number
  width: number
  height: number
  bottom: number
  right: number
}

interface TipSize {
  w: number
  h: number
}

/**
 * 根据目标元素矩形、期望方向与提示卡尺寸，计算提示卡的最终坐标。
 * 若期望方向放不下会自动翻转到对侧，最后做视口边界裁剪。
 */
function placeTooltip(
  rect: RectLike,
  pos: CoachMarkStep['position'],
  tip: TipSize,
  vw: number,
  vh: number,
  margin = 8,
  spacing = 14,
): { top: number; left: number } {
  let top: number
  let left: number
  if (pos === 'bottom') {
    top = rect.bottom + spacing
    left = rect.left + rect.width / 2 - tip.w / 2
    if (top + tip.h > vh - margin) {
      top = rect.top - tip.h - spacing
    }
  } else if (pos === 'top') {
    top = rect.top - tip.h - spacing
    left = rect.left + rect.width / 2 - tip.w / 2
    if (top < margin) {
      top = rect.bottom + spacing
    }
  } else if (pos === 'right') {
    left = rect.right + spacing
    top = rect.top + rect.height / 2 - tip.h / 2
    if (left + tip.w > vw - margin) {
      left = rect.left - tip.w - spacing
    }
  } else {
    // left
    left = rect.left - tip.w - spacing
    top = rect.top + rect.height / 2 - tip.h / 2
    if (left < margin) {
      left = rect.right + spacing
    }
  }
  left = Math.max(margin, Math.min(left, vw - tip.w - margin))
  top = Math.max(margin, Math.min(top, vh - tip.h - margin))
  return { top, left }
}

/**
 * CoachMarks —— 交互式教练标记组件。
 *
 * 通过 box-shadow 技巧在全屏半透明遮罩上为目标元素"挖洞"高亮，
 * 并在目标附近显示提示卡片（title / description）。
 *
 * - 滚动 / 缩放时通过 getBoundingClientRect 重新定位
 * - 选择器匹配不到元素时自动跳到下一步（最后一个仍缺失则调用 onComplete）
 * - 支持 Esc 跳过、→ / Enter 下一步
 * - 全部步骤完成调用 onComplete；点击「跳过」调用 onSkip
 */
export function CoachMarks({ steps, onComplete, onSkip }: CoachMarksProps) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<RectLike | null>(null)
  const [radius, setRadius] = useState(8)
  const [missing, setMissing] = useState(false)
  const [tipSize, setTipSize] = useState<TipSize>({ w: 0, h: 0 })
  const tipRef = useRef<HTMLDivElement | null>(null)

  const current = steps[index]

  /** 查询并测量当前步骤的目标元素 */
  const measure = useCallback(() => {
    if (!current) {
      setMissing(true)
      setRect(null)
      return
    }
    const el = document.querySelector(current.selector) as HTMLElement | null
    if (!el) {
      setMissing(true)
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) {
      setMissing(true)
      setRect(null)
      return
    }
    setMissing(false)
    setRect({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
      bottom: r.bottom,
      right: r.right,
    })
    const cs = getComputedStyle(el)
    const parsed = parseInt(cs.borderTopLeftRadius, 10)
    setRadius(Number.isFinite(parsed) && parsed > 0 ? parsed : 8)
  }, [current])

  // 步骤切换 / 首次挂载时定位目标
  useEffect(() => {
    measure()
  }, [measure])

  // 滚动 / 缩放时重新定位
  useEffect(() => {
    const handler = () => measure()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [measure])

  // 目标不在视口内时滚动到可见位置（平滑滚动期间由上面的监听器持续重定位）
  useEffect(() => {
    if (!current) return
    const el = document.querySelector(current.selector) as HTMLElement | null
    if (!el) return
    const r = el.getBoundingClientRect()
    const inView = r.top >= 0 && r.bottom <= window.innerHeight
    if (!inView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [current])

  // 测量提示卡实际尺寸，用于精确定位与边界翻转
  useLayoutEffect(() => {
    if (!tipRef.current) return
    const r = tipRef.current.getBoundingClientRect()
    if (Math.abs(r.width - tipSize.w) > 0.5 || Math.abs(r.height - tipSize.h) > 0.5) {
      setTipSize({ w: r.width, h: r.height })
    }
  }, [current, rect, missing, tipSize.w, tipSize.h])

  // 元素缺失：自动跳到下一步（或完成）
  useEffect(() => {
    if (!missing) return
    const t = window.setTimeout(() => {
      if (index >= steps.length - 1) {
        onComplete()
      } else {
        setIndex(i => i + 1)
      }
    }, 350)
    return () => window.clearTimeout(t)
  }, [missing, index, steps.length, onComplete])

  const next = useCallback(() => {
    if (index >= steps.length - 1) {
      onComplete()
      return
    }
    setIndex(i => i + 1)
  }, [index, steps.length, onComplete])

  // 键盘：Esc 跳过，→ / Enter 下一步
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, onSkip])

  if (!current) return null

  const dim = missing || rect === null
  const guardClass = `coach-guard${dim ? ' is-dim' : ''}`

  const spotlightStyle: CSSProperties = rect
    ? {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        borderRadius: radius,
      }
    : { display: 'none' }

  let tooltipStyle: CSSProperties
  if (tipSize.w === 0) {
    // 尚未测得尺寸：先在屏幕外隐藏渲染以便测量
    tooltipStyle = { top: -9999, left: -9999, visibility: 'hidden' }
  } else if (rect) {
    const placed = placeTooltip(
      rect,
      current.position,
      tipSize,
      window.innerWidth,
      window.innerHeight,
    )
    tooltipStyle = { top: placed.top, left: placed.left }
  } else {
    tooltipStyle = { display: 'none' }
  }

  const showTooltip = rect !== null && !missing
  const isLast = index === steps.length - 1

  return (
    <>
      <style>{COACH_CSS}</style>
      <div className="coach-root" role="dialog" aria-modal="true" aria-label="功能引导">
        <div className={guardClass} />
        {rect && !missing && (
          <div className="coach-spotlight" style={spotlightStyle} aria-hidden="true" />
        )}
        {showTooltip && (
          <div
            key={index}
            ref={tipRef}
            className="coach-tooltip"
            style={tooltipStyle}
            role="tooltip"
          >
            <div className="coach-tip-step">
              第 {index + 1} / {steps.length} 步
            </div>
            <div className="coach-tip-title">{current.title}</div>
            <div className="coach-tip-desc">{current.description}</div>
            <div className="coach-tip-footer">
              <div className="coach-tip-dots">
                {steps.map((_, i) => (
                  <span key={i} className={`coach-tip-dot${i === index ? ' active' : ''}`} />
                ))}
              </div>
              <div className="coach-tip-actions">
                <button className="coach-tip-btn" onClick={onSkip}>
                  跳过
                </button>
                <button className="coach-tip-btn primary" onClick={next}>
                  {isLast ? '完成' : '下一步'}
                </button>
              </div>
            </div>
          </div>
        )}
        {missing && <div className="coach-missing-msg">正在定位引导元素…</div>}
      </div>
    </>
  )
}

export default CoachMarks
