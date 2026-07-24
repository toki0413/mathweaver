import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../stores/sessionStore'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

type TestState = 'idle' | 'testing' | 'success' | 'error'

/**
 * LLM 模型配置面板 —— 从右侧滑入的抽屉。
 *
 * 数据来源：store.llmConfig / store.llmPresets。
 * 打开时自动拉取配置与预设，选中预设会自动填充表单字段。
 */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const llmConfig = useStore((s) => s.llmConfig)
  const llmPresets = useStore((s) => s.llmPresets)
  const fetchLLMConfig = useStore((s) => s.fetchLLMConfig)
  const fetchLLMPresets = useStore((s) => s.fetchLLMPresets)
  const saveLLMConfig = useStore((s) => s.saveLLMConfig)

  const [provider, setProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)

  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  // 打开时刷新后端配置与预设列表
  useEffect(() => {
    if (!open) return
    fetchLLMConfig()
    fetchLLMPresets()
    setTestState('idle')
    setTestMessage('')
    setSaveMessage('')
  }, [open, fetchLLMConfig, fetchLLMPresets])

  // 当配置加载后填充表单
  useEffect(() => {
    if (!llmConfig) return
    setProvider(llmConfig.provider || '')
    setApiKey(llmConfig.apiKey || '')
    setBaseUrl(llmConfig.baseUrl || '')
    setModel(llmConfig.model || '')
    setTemperature(typeof llmConfig.temperature === 'number' ? llmConfig.temperature : 0.7)
    setMaxTokens(typeof llmConfig.maxTokens === 'number' ? llmConfig.maxTokens : 2048)
    setSelectedPresetId('')
  }, [llmConfig])

  const selectedPreset = useMemo(
    () => llmPresets.find((p) => p.id === selectedPresetId) || null,
    [llmPresets, selectedPresetId]
  )

  const handlePresetSelect = (presetId: string) => {
    const preset = llmPresets.find((p) => p.id === presetId)
    if (!preset) return
    setSelectedPresetId(preset.id)
    setProvider(preset.provider)
    setBaseUrl(preset.baseUrl)
    if (preset.defaultModel) setModel(preset.defaultModel)
  }

  // 调用 api.health() 检查后端状态
  const handleTestConnection = async () => {
    setTestState('testing')
    setTestMessage('正在测试连接...')
    try {
      const api = window.api
      if (!api) {
        setTestState('error')
        setTestMessage('IPC 桥接不可用')
        return
      }
      const result = await api.health()
      if (result) {
        setTestState('success')
        setTestMessage('连接成功，引擎响应正常')
      } else {
        setTestState('error')
        setTestMessage('引擎未响应')
      }
    } catch (e) {
      setTestState('error')
      setTestMessage(`连接失败: ${String(e)}`)
    }
  }

  // 调用 store.saveLLMConfig() 保存配置
  const handleSave = async () => {
    setSaving(true)
    setSaveMessage('')
    try {
      await saveLLMConfig({ provider, apiKey, baseUrl, model, temperature, maxTokens })
      setSaveMessage('配置已保存')
      window.setTimeout(() => setSaveMessage(''), 3000)
    } catch (e) {
      setSaveMessage(`保存失败: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  // 当前 LLM 配置状态
  const statusInfo = (() => {
    if (!llmConfig) return { label: '未配置', cls: 'status-pill warn' }
    const prov = (llmConfig.provider || '').toLowerCase()
    if (prov === 'mock') return { label: 'mock 模式', cls: 'status-pill warn' }
    return { label: '已配置', cls: 'status-pill ok' }
  })()

  // 底部统一的状态消息（成功为绿，错误为红）
  const footerMessage =
    testState === 'error'
      ? testMessage
      : testState === 'success'
        ? testMessage
        : saveMessage
  const footerColor =
    testState === 'error' ? 'var(--err)' : undefined

  if (!open) return null

  return (
    <>
      <div className="overlay-backdrop" onClick={onClose} />
      <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="LLM 模型配置">
        <div className="drawer-header">
          <div className="drawer-header-left">
            <span className="drawer-title">LLM 模型配置</span>
            <span className={statusInfo.cls}>{statusInfo.label}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer-body">
          <div className="section-label">预设模型</div>
          <div className="preset-grid">
            {llmPresets.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  color: 'var(--muted)',
                  fontFamily: 'var(--mono)',
                  fontSize: '11px',
                }}
              >
                暂无可用预设
              </div>
            )}
            {llmPresets.map((p) => (
              <div
                key={p.id}
                className={`preset-card ${selectedPresetId === p.id ? 'active' : ''}`}
                onClick={() => handlePresetSelect(p.id)}
              >
                <div className="preset-label">{p.label}</div>
                <div className="preset-desc">{p.description}</div>
              </div>
            ))}
          </div>

          <div className="section-label">连接配置</div>

          <div className="form-group">
            <label className="form-label">Provider 类型</label>
            <div className="form-value-readonly">
              {selectedPreset ? selectedPreset.label : provider || '—'}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">API Base URL</label>
            <input
              className="text-input"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div className="form-group">
            <label className="form-label">API Key</label>
            <div className="api-key-row">
              <input
                className="text-input"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={selectedPreset && selectedPreset.requiresApiKey ? '必填' : '选填'}
              />
              <button className="toggle-btn" onClick={() => setShowApiKey((v) => !v)}>
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
            {selectedPreset && selectedPreset.helpUrl && (
              <a
                className="help-link"
                href={selectedPreset.helpUrl}
                target="_blank"
                rel="noreferrer"
              >
                获取 API Key ↗
              </a>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">模型名称</label>
            <input
              className="text-input"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model-name"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Temperature</label>
            <div className="slider-row">
              <input
                className="slider"
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
              <span className="slider-value">{temperature.toFixed(1)}</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Max Tokens</label>
            <input
              className="text-input"
              type="number"
              min={1}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="drawer-footer">
          <button className="btn" onClick={handleTestConnection} disabled={testState === 'testing'}>
            {testState === 'testing' ? '测试中...' : '测试连接'}
          </button>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          {footerMessage && (
            <span className="footer-msg" style={{ color: footerColor }}>
              {footerMessage}
            </span>
          )}
        </div>
      </aside>
    </>
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
