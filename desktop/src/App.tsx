import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore, initBackendUrl } from './stores/sessionStore'
import { CayleyTable } from './components/CayleyTable'
import { FourFieldDashboard } from './components/FourFieldDashboard'
import { ChatPanel } from './components/ChatPanel'
import { DagTree } from './components/DagTree'

const presetTables: Record<string, { table: number[][]; size: number }> = {
  z3: { table: [[0, 1, 2], [1, 2, 0], [2, 0, 1]], size: 3 },
  klein: { table: [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]], size: 4 },
  s3: { table: [[0,1,2,3,4,5],[1,0,4,5,2,3],[2,5,0,4,3,1],[3,4,5,0,1,2],[4,3,1,2,5,0],[5,2,3,1,0,4]], size: 6 },
  'non-group': { table: [[0, 1, 2], [1, 0, 1], [2, 1, 0]], size: 3 },
  'non-assoc': { table: [[0, 1, 2], [1, 1, 0], [2, 0, 2]], size: 3 },
}

function makeIdentityTable(n: number): number[][] {
  const t: number[][] = []
  for (let i = 0; i < n; i++) {
    t.push([])
    for (let j = 0; j < n; j++) {
      t[i].push((i + j) % n)
    }
  }
  return t
}

export default function App() {
  const startSession = useStore((s) => s.startSession)
  const sendInput = useStore((s) => s.sendInput)
  const sessionId = useStore((s) => s.sessionId)
  const loading = useStore((s) => s.loading)
  const fourFields = useStore((s) => s.fourFields)
  const decision = useStore((s) => s.decision)
  const phaseTrace = useStore((s) => s.phaseTrace)
  const backendReady = useStore((s) => s.backendReady)
  const checkBackend = useStore((s) => s.checkBackend)
  const fetchDagNodes = useStore((s) => s.fetchDagNodes)
  const dagNodes = useStore((s) => s.dagNodes)
  const saveSession = useStore((s) => s.saveSession)
  const loadSession = useStore((s) => s.loadSession)

  const [tableSize, setTableSize] = useState(3)
  const [table, setTable] = useState<number[][]>([[0, 1, 2], [1, 2, 0], [2, 0, 1]])
  const [textInput, setTextInput] = useState('')
  const [selectedNode, setSelectedNode] = useState('group_definition')
  const [studentId] = useState(`student_${Date.now().toString().slice(-6)}`)
  const [inputStartTime, setInputStartTime] = useState<number>(Date.now())
  const [appVersion, setAppVersion] = useState('0.1.0')
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const init = async () => {
      await initBackendUrl()
      await checkBackend()
      await fetchDagNodes()
    }
    init()
  }, [])

  useEffect(() => {
    if (backendReady && !sessionId) {
      startSession(studentId, selectedNode)
    }
  }, [backendReady])

  useEffect(() => {
    if (!window.electronAPI) return

    const cleanupSave = window.electronAPI.on('menu:save-session', async () => {
      const path = await saveSession()
      if (path) {
        setSaveStatus(`已保存: ${path}`)
        setTimeout(() => setSaveStatus(null), 3000)
      }
    })

    const cleanupLoad = window.electronAPI.on('menu:load-session', async () => {
      const ok = await loadSession()
      if (ok) {
        setSaveStatus('会话已加载')
        setTimeout(() => setSaveStatus(null), 3000)
      }
    })

    window.electronAPI.getAppInfo().then((info: Record<string, unknown>) => {
      if (info && 'version' in info && typeof info.version === 'string') {
        setAppVersion(info.version)
      }
    }).catch(() => {})

    return () => {
      cleanupSave()
      cleanupLoad()
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => checkBackend(), 15000)
    return () => clearInterval(interval)
  }, [])

  const handleSendTable = useCallback(() => {
    const rt = Date.now() - inputStartTime
    sendInput(JSON.stringify(table), rt)
    setInputStartTime(Date.now())
  }, [table, sendInput, inputStartTime])

  const handleSendText = useCallback(() => {
    if (!textInput.trim()) return
    const rt = Date.now() - inputStartTime
    sendInput(textInput, rt)
    setTextInput('')
    setInputStartTime(Date.now())
  }, [textInput, sendInput, inputStartTime])

  const handleTableChange = useCallback((row: number, col: number, value: number) => {
    setTable((prev) => {
      const next = prev.map(r => [...r])
      next[row][col] = value
      return next
    })
  }, [])

  const handleResize = useCallback((n: number) => {
    setTableSize(n)
    setTable(makeIdentityTable(n))
  }, [])

  const handleNodeSelect = useCallback((id: string) => {
    setSelectedNode(id)
    if (backendReady) startSession(studentId, id)
  }, [backendReady, startSession, studentId])

  const loadPreset = useCallback((preset: string) => {
    const p = presetTables[preset]
    if (p) {
      setTable(p.table)
      setTableSize(p.size)
    }
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>MathWeaver</h1>
          <div className="subtitle">v{appVersion}</div>
        </div>
        <div className="header-right">
          <div className={`backend-status ${backendReady ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {backendReady ? '127.0.0.1:18765' : 'offline'}
          </div>
        </div>
      </header>

      {saveStatus && <div className="save-status-bar">{saveStatus}</div>}

      {!backendReady && (
        <div className="backend-warning">
          <div className="spinner" style={{ width: '12px', height: '12px' }} />
          正在启动后端 (port 18765)
        </div>
      )}

      <div className="main-grid">
        <div>
          <div className="card">
            <h2>运算表</h2>
            <p className="desc">编辑单元格后提交验证。值范围 0 ~ n-1。</p>
            <CayleyTable table={table} size={tableSize} onChange={handleTableChange} />
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSendTable} disabled={loading || !backendReady}>
                {loading ? '验证中' : '提交'}
              </button>
              <button className="btn" onClick={() => handleResize(3)}>3</button>
              <button className="btn" onClick={() => handleResize(4)}>4</button>
              <button className="btn" onClick={() => handleResize(6)}>6</button>
            </div>
            <h3>预设</h3>
            <div className="btn-row">
              <button className="btn" onClick={() => loadPreset('z3')}>Z3</button>
              <button className="btn" onClick={() => loadPreset('klein')}>Klein</button>
              <button className="btn" onClick={() => loadPreset('s3')}>S3</button>
              <button className="btn" onClick={() => loadPreset('non-group')}>非群</button>
              <button className="btn" onClick={() => loadPreset('non-assoc')}>非结合</button>
            </div>
          </div>

          <div className="card">
            <h2>对话</h2>
            <textarea
              className="text-input"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="输入问题或 Cayley 表 JSON..."
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText() } }}
            />
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSendText} disabled={loading || !textInput.trim() || !backendReady}>
                发送
              </button>
            </div>
          </div>

          <ChatPanel />
        </div>

        <div>
          <div className="card">
            <h2>概念图</h2>
            <DagTree nodes={dagNodes} activeNode={selectedNode} onSelect={handleNodeSelect} />
          </div>

          <FourFieldDashboard fields={fourFields} decision={decision} />

          <div className="card">
            <h2>协作流程</h2>
            <div className="phase-trace">
              {phaseTrace.length === 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '12px' }}>提交后显示</span>
              )}
              {phaseTrace.map((p, i) => (
                <span key={i} className="phase-badge active">{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
