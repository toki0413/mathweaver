import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * ErrorBoundary — 全局错误边界组件
 *
 * 捕获子组件树中的 JavaScript 错误，防止整个应用白屏崩溃。
 * 提供友好的错误恢复界面，支持一键重试和错误详情展示。
 *
 * 安全最佳实践：
 * - 捕获所有未处理错误，防止信息泄露
 * - 错误详情默认折叠，避免暴露敏感堆栈
 * - 提供恢复路径，避免用户卡死
 */
interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
  retryCount: number
  remountKey: number
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      retryCount: 0,
      remountKey: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 结构化错误日志（如果 winston logger 可用则通过 IPC 发送，否则降级到 console）
    const errorPayload = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      retryCount: this.state.retryCount,
    }

    // 尝试通过 IPC 发送错误日志到主进程
    try {
      const api = (
        window as unknown as {
          api?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> }
        }
      ).api
      if (api?.invoke) {
        api.invoke('app:log-error', errorPayload).catch(() => {
          // IPC 不可用时降级到 console
          console.error('[ErrorBoundary]', error, errorInfo)
        })
      } else {
        console.error('[ErrorBoundary]', error, errorInfo)
      }
    } catch {
      console.error('[ErrorBoundary]', error, errorInfo)
    }
  }

  handleRetry = (): void => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      retryCount: prev.retryCount + 1,
      remountKey: prev.remountKey + 1,
    }))
  }

  handleReload = (): void => {
    window.location.reload()
  }

  toggleDetails = (): void => {
    this.setState(prev => ({ showDetails: !prev.showDetails }))
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return <div key={this.state.remountKey}>{this.props.children}</div>
    }

    const { error, errorInfo, showDetails, retryCount } = this.state

    const bg = 'var(--bg, #f5f0e6)'
    const surface = 'var(--bg2, #faf6ed)'
    const border = 'var(--border, rgba(26, 26, 26, 0.1))'
    const text = '#1a1a1a'
    const muted = 'var(--muted, #525252)'
    const accent = 'var(--accent, #c4392f)'
    const errColor = 'var(--danger, #9e2b22)'
    const fontStack = '"Noto Serif SC", "Songti SC", Georgia, "Iowan Old Style", serif'

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          background: bg,
          color: text,
          fontFamily: fontStack,
        }}
      >
        <div
          style={{
            maxWidth: '560px',
            width: '100%',
            background: surface,
            border: `1px solid ${border}`,
            borderRadius: '12px',
            padding: '2rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          {/* Error icon */}
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <svg
              width="56"
              height="56"
              viewBox="0 0 24 24"
              fill="none"
              stroke={errColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <h1
            style={{
              fontSize: '1.4rem',
              fontWeight: 600,
              textAlign: 'center',
              marginBottom: '0.5rem',
              color: text,
            }}
          >
            应用遇到了问题
          </h1>
          <p
            style={{
              textAlign: 'center',
              color: muted,
              fontSize: '0.9rem',
              marginBottom: '1.5rem',
            }}
          >
            MathWeaver 遇到了一个意外错误。您可以尝试重试或重新加载应用。
          </p>

          {retryCount > 0 && (
            <p
              style={{
                textAlign: 'center',
                color: accent,
                fontSize: '0.85rem',
                marginBottom: '1rem',
              }}
            >
              已重试 {retryCount} 次，如果问题持续出现，请重启应用。
            </p>
          )}

          {/* Action buttons */}
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              marginBottom: '1.5rem',
            }}
          >
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.6rem 1.5rem',
                background: accent,
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => ((e.target as HTMLButtonElement).style.opacity = '0.85')}
              onMouseLeave={e => ((e.target as HTMLButtonElement).style.opacity = '1')}
            >
              重试
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '0.6rem 1.5rem',
                background: 'transparent',
                color: text,
                border: `1px solid ${border}`,
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e =>
                ((e.target as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)')
              }
              onMouseLeave={e => ((e.target as HTMLButtonElement).style.background = 'transparent')}
            >
              重新加载
            </button>
          </div>

          {this.state.retryCount >= 3 && (
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
              多次重试后仍然出错。请尝试刷新页面，或检查应用日志。
            </p>
          )}

          {/* Error details toggle */}
          <div style={{ borderTop: `1px solid ${border}`, paddingTop: '1rem' }}>
            <button
              onClick={this.toggleDetails}
              style={{
                background: 'none',
                border: 'none',
                color: muted,
                fontSize: '0.85rem',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showDetails ? '▾ 隐藏错误详情' : '▸ 显示错误详情'}
            </button>

            {showDetails && (
              <pre
                style={{
                  marginTop: '0.75rem',
                  padding: '1rem',
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
                  color: errColor,
                  overflow: 'auto',
                  maxHeight: '300px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {error?.message}
                {'\n\n'}
                {error?.stack}
                {errorInfo?.componentStack && `\n\nComponent Stack:${errorInfo.componentStack}`}
              </pre>
            )}
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
