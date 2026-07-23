import { memo } from 'react'
import { useStore } from '../stores/sessionStore'

function ChatPanelBase() {
  const chat = useStore((s) => s.chat)
  const loading = useStore((s) => s.loading)

  return (
    <div className="card">
      <h2>记录</h2>
      <div className="chat-box">
        {chat.length === 0 && (
          <p className="desc">提交运算表或输入问题开始</p>
        )}
        {chat.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
            <div className="role">
              {msg.role === 'user' ? 'student' : 'system'}
              {msg.phase && msg.role === 'system' && (
                <span className="badge badge-warning" style={{ marginLeft: '6px' }}>{msg.phase}</span>
              )}
            </div>
            <div className="content">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="loading">
            <div className="spinner" />
            处理中
          </div>
        )}
      </div>
    </div>
  )
}

export const ChatPanel = memo(ChatPanelBase)
