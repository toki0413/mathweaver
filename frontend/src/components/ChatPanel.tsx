import { useStore } from '../stores/sessionStore'
import { MathText } from './MathText'

export function ChatPanel() {
  const { chat, loading } = useStore()

  return (
    <article className="card">
      <h2>教学对话</h2>
      <p className="card-desc">
        六智能体协作响应，按阶段标注推理过程。
      </p>
      <div className="chat-box">
        {chat.length === 0 && (
          <p className="empty-state">
            提交运算表或输入问题，开始与系统对话
          </p>
        )}
        {chat.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
            <div className="role">
              {msg.role === 'user' ? '学生' : 'MathWeaver'}
              {msg.phase && msg.role === 'system' && (
                <span className="badge badge-muted">{msg.phase}</span>
              )}
            </div>
            <div className="chat-content">
              {msg.role === 'system' ? (
                <MathText>{msg.content}</MathText>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="loading">
            <div className="spinner" />
            六 Agent 协作中
          </div>
        )}
      </div>
    </article>
  )
}
