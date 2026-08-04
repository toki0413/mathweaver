import { useEffect } from 'react'
import { useStore } from '../stores/sessionStore'

type ErrorLevel = 'error' | 'warn' | 'info'

// store 的 ErrorState 没有显式 type 字段，根据 message/headline 推断错误级别
function inferErrorLevel(message: string, headline: string): ErrorLevel {
  const text = `${message} ${headline}`.toLowerCase()
  if (text.includes('warn') || text.includes('警告') || text.includes('图谱')) return 'warn'
  if (text.includes('info') || text.includes('提示') || text.includes('notice')) return 'info'
  return 'error'
}

/**
 * 顶部错误提示条 —— 从 store.error 读取状态。
 *
 * 显示 headline / detail / recovery，5 秒后自动消失或手动关闭。
 * 左侧边框颜色随错误类型变化（error 红 / warn 黄 / info 紫）。
 */
export function ErrorBanner() {
  const error = useStore(s => s.error)
  const clearError = useStore(s => s.clearError)

  // 自动消失：info/warn 5 秒后消失，error 持续显示需手动关闭
  useEffect(() => {
    if (!error) return
    const level = inferErrorLevel(error.message || '', error.headline || '')
    if (level === 'error') return // error 不自动消失
    const timer = window.setTimeout(() => clearError(), 5000)
    return () => window.clearTimeout(timer)
  }, [error, clearError])

  if (!error) return null

  const level = inferErrorLevel(error.message || '', error.headline || '')

  return (
    <div className={`error-banner level-${level}`} role={level === 'error' ? 'alert' : 'status'}>
      <div className="error-banner-content">
        <div className="error-banner-headline">{error.headline}</div>
        {error.detail && <div className="error-banner-detail">{error.detail}</div>}
        {error.recovery && <div className="error-banner-recovery">{error.recovery}</div>}
      </div>
      <button className="icon-btn" onClick={clearError} aria-label="关闭错误提示">
        <CloseIcon />
      </button>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M3 3 L11 11 M11 3 L3 11" />
    </svg>
  )
}
