import { useState, useEffect, useRef, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { getCommandIcon, type IconProps, SparkleIcon, TrophyIcon, InfoIcon, AlertIcon } from './Icons'

export interface ToastItem {
  id: string
  type: 'achievement' | 'milestone' | 'info' | 'warning' | 'error'
  title: string
  message?: string
  icon?: string // icon name (maps to SVG component)
  duration?: number // ms，默认 4000
}

interface ToastSystemProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

const DEFAULT_DURATION = 4000
const TICK_MS = 50 // 进度条刷新间隔
const EXIT_DURATION_MS = 300 // 滑出动画时长，结束后真正移除 DOM

// 各类型默认图标名
const DEFAULT_ICONS: Record<ToastItem['type'], string> = {
  achievement: 'TrophyIcon',
  milestone: 'SparkleIcon',
  info: 'InfoIcon',
  warning: 'AlertIcon',
  error: 'AlertIcon',
}

// 类型 -> 左边框颜色 / 进度条颜色所用的 className
const TYPE_CLASS: Record<ToastItem['type'], string> = {
  achievement: 'toast-achievement',
  milestone: 'toast-milestone',
  info: 'toast-info',
  warning: 'toast-warning',
  error: 'toast-error',
}

/** Resolve an icon name string to a renderable SVG component */
function renderToastIcon(iconName: string): React.ReactNode {
  const IconComp = getCommandIcon(iconName)
  if (IconComp) return <IconComp size={16} />
  // Direct mapping for toast-only icons
  const direct: Record<string, React.FC<IconProps>> = {
    TrophyIcon, SparkleIcon, InfoIcon, AlertIcon,
  }
  const Comp = direct[iconName]
  if (Comp) return <Comp size={16} />
  return <InfoIcon size={16} />
}

/**
 * 自包含的 Toast 样式（不写入 index.css）。
 * 复用全局主题变量（--bg2 / --ink / --muted / --accent / --ok / --warn / --err /
 * --border / --serif / --mono），与 ErrorBanner 等组件保持视觉一致。
 */
const TOAST_CSS = `
.toast-container {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;   /* 最旧在上、最新在下，整体自底向上堆叠 */
  gap: 10px;
  pointer-events: none;     /* 容器空白不拦截底层点击，单条卡片重新启用 */
  max-width: calc(100vw - 32px);
}

.toast-card {
  pointer-events: auto;
  position: relative;
  width: 340px;
  max-width: calc(100vw - 32px);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-left-width: 4px;
  border-radius: 3px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  overflow: hidden;          /* 裁剪底部进度条的圆角 */
  animation: mw-toast-slide-in 0.3s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.toast-card.toast-exiting {
  animation: mw-toast-slide-out 0.3s ease forwards;
}

@keyframes mw-toast-slide-in {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

@keyframes mw-toast-slide-out {
  from { transform: translateX(0);    opacity: 1; }
  to   { transform: translateX(100%); opacity: 0; }
}

/* 类型 -> 左边框色 */
.toast-achievement { border-left-color: var(--ok); }
.toast-milestone   { border-left-color: var(--accent); }
.toast-info        { border-left-color: #61afef; }
.toast-warning     { border-left-color: var(--warn); }
.toast-error       { border-left-color: var(--err); }

.toast-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 3px;
  background: var(--bg3);
}

.toast-achievement .toast-icon { background: var(--ok-bg); color: var(--ok); }
.toast-milestone   .toast-icon { background: var(--accent-subtle); color: var(--accent); }
.toast-info        .toast-icon { background: var(--info-bg); color: var(--info); }
.toast-warning     .toast-icon { background: var(--warn-bg); color: var(--warn); }
.toast-error       .toast-icon { background: var(--err-bg); color: var(--err); }

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-family: var(--serif);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.3;
}

.toast-message {
  margin-top: 2px;
  font-family: var(--serif);
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
  word-break: break-word;
}

.toast-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.toast-close:hover {
  color: var(--ink);
  background: var(--bg3);
}

/* 底部进度条：剩余时间随倒计时从满到空 */
.toast-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
}

.toast-progress-fill {
  height: 100%;
  width: 100%;
  transition: width 50ms linear; /* 与 50ms 刷新节拍对齐，避免阶梯感 */
}

/* 类型 -> 进度条颜色 */
.toast-achievement .toast-progress-fill { background: var(--ok); }
.toast-milestone   .toast-progress-fill { background: var(--accent); }
.toast-info        .toast-progress-fill { background: #61afef; }
.toast-warning     .toast-progress-fill { background: var(--warn); }
.toast-error       .toast-progress-fill { background: var(--err); }

/* 尊重“减少动效”：滑入/滑出即时完成，退出态直接隐藏 */
@media (prefers-reduced-motion: reduce) {
  .toast-card,
  .toast-card.toast-exiting { animation: none !important; }
  .toast-card.toast-exiting { opacity: 0; }
  .toast-progress-fill { transition: none !important; }
}
`

/**
 * 单条 Toast 卡片：自管理倒计时与进度条。
 *
 * - `progress`：1 -> 0，代表剩余时间比例，驱动底部进度条宽度
 * - `isPaused`：鼠标悬停时暂停倒计时，移出后恢复
 * - `isExiting`：进度归零或点击关闭后进入滑出态，动画结束再调用 onDismiss 真正卸载
 *
 * 倒计时以 50ms 为节拍递减 progress；progress 归零时触发退出。
 * 关闭按钮与自动消失走同一条 startExit 路径，保证滑出动画一致。
 */
export function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: string) => void
}) {
  const duration = toast.duration ?? DEFAULT_DURATION

  const [progress, setProgress] = useState(1) // 1 = 满，0 = 耗尽
  const [isPaused, setIsPaused] = useState(false)
  const [isExiting, setIsExiting] = useState(false)

  // 退出定时器引用；同时充当“已进入退出态”的同步守卫，避免重复排定
  const exitTimerRef = useRef<number | null>(null)
  // 始终指向最新的 onDismiss，使延迟回调调用最新引用
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  const startExit = useCallback(() => {
    // 已在退出流程中则跳过，保证只排定一次移除
    if (exitTimerRef.current !== null) return
    exitTimerRef.current = window.setTimeout(() => {
      onDismissRef.current(toast.id)
    }, EXIT_DURATION_MS)
    setIsExiting(true)
  }, [toast.id])

  // 倒计时：每 50ms 递减 progress；暂停或退出时不计时
  useEffect(() => {
    if (isPaused || isExiting) return
    const intervalId = window.setInterval(() => {
      setProgress((prev) => {
        const next = prev - TICK_MS / duration
        return next <= 0 ? 0 : next
      })
    }, TICK_MS)
    return () => window.clearInterval(intervalId)
  }, [isPaused, isExiting, duration])

  // progress 归零时触发退出
  useEffect(() => {
    if (progress <= 0 && !isExiting) {
      startExit()
    }
  }, [progress, isExiting, startExit])

  // 卸载时清理退出定时器，防止泄漏
  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }
  }, [])

  const iconName = toast.icon ?? DEFAULT_ICONS[toast.type]
  const typeClass = TYPE_CLASS[toast.type]
  const role = toast.type === 'error' ? 'alert' : 'status'

  const fillStyle: CSSProperties = {
    width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
  }

  return (
    <div
      className={`toast-card ${typeClass}${isExiting ? ' toast-exiting' : ''}`}
      role={role}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="toast-icon" aria-hidden="true">
        {renderToastIcon(iconName)}
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        {toast.message && <div className="toast-message">{toast.message}</div>}
      </div>
      <button
        className="toast-close"
        type="button"
        onClick={startExit}
        aria-label="关闭通知"
      >
        <CloseIcon />
      </button>
      <div className="toast-progress">
        <div className="toast-progress-fill" style={fillStyle} />
      </div>
    </div>
  )
}

/**
 * Toast 通知系统：固定在视口右下角，自底向上堆叠（最新者在最底部）。
 *
 * 容器始终渲染（即使为空），以便内联样式常驻；容器自身 `pointer-events: none`，
 * 不阻挡底层交互，单条卡片重新启用指针事件。
 *
 * 样式以内联 `<style>` 注入，未写入 index.css。
 */
export function ToastSystem({ toasts, onDismiss }: ToastSystemProps) {
  return (
    <>
      <style>{TOAST_CSS}</style>
      <div
        className="toast-container"
        role="region"
        aria-label="通知中心"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </>
  )
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M3 3 L11 11 M11 3 L3 11" />
    </svg>
  )
}
