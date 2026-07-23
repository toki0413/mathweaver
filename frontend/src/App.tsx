import { useState, useEffect, useCallback } from 'react'
import { useStore, API_BASE } from './stores/sessionStore'
import { CayleyTable } from './components/CayleyTable'
import { FourFieldDashboard } from './components/FourFieldDashboard'
import { ChatPanel } from './components/ChatPanel'
import { DagGraph } from './components/DagGraph'
import { GrillPanel } from './components/GrillPanel'
import { ProofPanel } from './components/ProofPanel'
import { RadialGauge, MasteryRadar, DifficultyGauge } from './components/Gauges'
import { ConjectureTimeline } from './components/ConjectureTimeline'

type Mode = 'chat' | 'grill' | 'proof' | 'dag'

const MODE_TABS: { id: Mode; label: string }[] = [
  { id: 'chat', label: '对话' },
  { id: 'grill', label: '面试' },
  { id: 'proof', label: '证明' },
  { id: 'dag', label: '图谱' },
]

export default function App() {
  const { startSession, sendInput, sessionId, loading, fourFields, decision, phaseTrace, visualData } = useStore()
  const [tableSize, setTableSize] = useState(3)
  const [table, setTable] = useState<number[][]>([[0, 1, 2], [1, 2, 0], [2, 0, 1]])
  const [textInput, setTextInput] = useState('')
  const [dagNodes, setDagNodes] = useState<any[]>([])
  const [selectedNode, setSelectedNode] = useState('group_definition')
  const [studentId] = useState(`student_${Date.now().toString().slice(-6)}`)
  const [inputStartTime, setInputStartTime] = useState<number>(Date.now())
  const [mode, setMode] = useState<Mode>('chat')

  useEffect(() => {
    fetch(`${API_BASE}/api/dag`)
      .then(res => res.json())
      .then(data => setDagNodes(data.nodes || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!sessionId && selectedNode) {
      startSession(studentId, selectedNode)
    }
  }, [])

  const handleSendTable = useCallback(() => {
    const tableStr = JSON.stringify(table)
    const rt = Date.now() - inputStartTime
    sendInput(tableStr, rt)
    setInputStartTime(Date.now())
  }, [table, sendInput, inputStartTime])

  const handleSendText = useCallback(() => {
    if (!textInput.trim()) return
    const rt = Date.now() - inputStartTime
    sendInput(textInput, rt)
    setTextInput('')
    setInputStartTime(Date.now())
  }, [textInput, sendInput, inputStartTime])

  const handleTableChange = (row: number, col: number, value: number) => {
    const newTable = table.map(r => [...r])
    newTable[row][col] = value
    setTable(newTable)
  }

  const handleResize = (newSize: number) => {
    setTableSize(newSize)
    const newTable: number[][] = []
    for (let i = 0; i < newSize; i++) {
      newTable.push([])
      for (let j = 0; j < newSize; j++) {
        newTable[i].push((i + j) % newSize)
      }
    }
    setTable(newTable)
  }

  const loadPreset = (preset: string) => {
    switch (preset) {
      case 'z3':
        setTable([[0, 1, 2], [1, 2, 0], [2, 0, 1]]); setTableSize(3); break
      case 'klein':
        setTable([[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]]); setTableSize(4); break
      case 's3':
        setTable([[0,1,2,3,4,5],[1,0,4,5,2,3],[2,5,0,4,3,1],[3,4,5,0,1,2],[4,3,1,2,5,0],[5,2,3,1,0,4]]); setTableSize(6); break
      case 'non-group':
        setTable([[0, 1, 2], [1, 0, 1], [2, 1, 0]]); setTableSize(3); break
      case 'non-assoc':
        setTable([[0, 1, 2], [1, 1, 0], [2, 0, 2]]); setTableSize(3); break
    }
  }

  return (
    <div className="app stagger">
      <header className="app-header">
        <div className="app-title-group">
          <h1>MathWeaver</h1>
          <div className="subtitle">多智能体数学认知操作系统 — 发现式学习</div>
        </div>
        <div className="app-version">v0.1</div>
      </header>

      <nav className="mode-nav" role="tablist" aria-label="模式切换">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            className={`mode-tab ${mode === tab.id ? 'active' : ''}`}
            role="tab"
            aria-selected={mode === tab.id}
            onClick={() => setMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {mode === 'chat' && (
        <main className="main-grid">
          <div className="content-main">
            <article className="card">
              <h2>运算表</h2>
              <p className="card-desc">
                编辑下方 Cayley 运算表，点击单元格修改值，然后提交验证。系统会自动检测群公理的满足情况。
              </p>
              <CayleyTable table={table} size={tableSize} onCellChange={handleTableChange} />
              <div className="btn-row">
                <button className="btn btn-primary" onClick={handleSendTable} disabled={loading}>
                  {loading ? '验证中' : '提交验证'}
                </button>
                <button className="btn btn-secondary" onClick={() => handleResize(3)}>3 × 3</button>
                <button className="btn btn-secondary" onClick={() => handleResize(4)}>4 × 4</button>
                <button className="btn btn-secondary" onClick={() => handleResize(6)}>6 × 6</button>
              </div>

              <h3>预设示例</h3>
              <div className="btn-row">
                <button className="btn btn-secondary" onClick={() => loadPreset('z3')}>Z₃ 循环群</button>
                <button className="btn btn-secondary" onClick={() => loadPreset('klein')}>Klein 四元群</button>
                <button className="btn btn-secondary" onClick={() => loadPreset('s3')}>S₃ 对称群</button>
                <button className="btn btn-secondary" onClick={() => loadPreset('non-group')}>非群</button>
                <button className="btn btn-secondary" onClick={() => loadPreset('non-assoc')}>非结合</button>
              </div>
            </article>

            <article className="card">
              <h2>自然语言对话</h2>
              <p className="card-desc">
                输入你的疑问或猜想，也可以直接输入 Cayley 表格式。
              </p>
              <textarea
                className="text-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="例如：这个运算表是否满足结合律？或者 [[0,1,2],[1,2,0],[2,0,1]]"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText() } }}
              />
              <div className="btn-row">
                <button className="btn btn-primary" onClick={handleSendText} disabled={loading || !textInput.trim()}>
                  发送
                </button>
              </div>
            </article>

            <ChatPanel />
          </div>

          <aside className="content-aside">
            <article className="card">
              <h2>概念图谱</h2>
              <DagGraph
                nodes={dagNodes}
                currentNodeId={selectedNode}
                onSelect={(id) => { setSelectedNode(id); startSession(studentId, id) }}
              />
            </article>

            <FourFieldDashboard fields={fourFields} decision={decision} />

            {visualData?.dag_progress && (
              <section className="visual-section">
                {visualData.four_field_gauges && (
                  <div className="gauge-row">
                    <RadialGauge value={visualData.four_field_gauges.cognitive_load} label="认知负荷" sublabel={visualData.four_field_gauges.cognitive_state} />
                    <RadialGauge value={visualData.four_field_gauges.anxiety_index} label="焦虑指数" />
                    <RadialGauge value={visualData.four_field_gauges.flow_score} label="心流分数" invert />
                    <RadialGauge value={visualData.four_field_gauges.hint_dependency} label="提示依赖" />
                  </div>
                )}
                {visualData.mastery_radar && (
                  <MasteryRadar
                    dimensions={[
                      { label: '准确率', value: visualData.mastery_radar.accuracy },
                      { label: '猜想力', value: visualData.mastery_radar.conjecture },
                      { label: '独立性', value: visualData.mastery_radar.independence },
                      { label: '流畅度', value: visualData.mastery_radar.fluency },
                      { label: '抽象力', value: visualData.mastery_radar.abstraction },
                    ]}
                    overall={visualData.mastery_radar.overall}
                  />
                )}
              </section>
            )}

            <article className="card">
              <h2>Agent 协作轨迹</h2>
              {phaseTrace.length > 0 ? (
                <div className="phase-trace">
                  {phaseTrace.map((p, i) => (
                    <span key={i} className="phase-badge active">{p}</span>
                  ))}
                </div>
              ) : (
                <p className="empty-state">开始会话后显示六 Agent 协作过程</p>
              )}
            </article>
          </aside>
        </main>
      )}

      {mode === 'grill' && (
        <main className="single-panel">
          <GrillPanel />
          {visualData?.conjecture_journey && visualData.conjecture_journey.timeline && (
            <article className="card">
              <h2>猜想之旅</h2>
              <ConjectureTimeline
                timeline={visualData.conjecture_journey.timeline}
                refinementChains={visualData.conjecture_journey.refinement_chains}
                totalConjectures={visualData.conjecture_journey.total_conjectures}
                confirmed={visualData.conjecture_journey.confirmed}
                refuted={visualData.conjecture_journey.refuted}
              />
            </article>
          )}
          {visualData?.difficulty_gauge && (
            <article className="card">
              <h2>难度仪表</h2>
              <DifficultyGauge
                current={visualData.difficulty_gauge.current_difficulty}
                band={visualData.difficulty_gauge.difficulty_band}
                trend={visualData.difficulty_gauge.trend}
                accuracy={visualData.difficulty_gauge.accuracy_rate}
              />
            </article>
          )}
        </main>
      )}

      {mode === 'proof' && (
        <main className="single-panel">
          <ProofPanel />
        </main>
      )}

      {mode === 'dag' && (
        <main className="main-grid">
          <div className="content-main">
            <article className="card">
              <h2>概念图谱</h2>
              <DagGraph
                nodes={dagNodes}
                currentNodeId={selectedNode}
                onSelect={(id) => { setSelectedNode(id); startSession(studentId, id) }}
              />
            </article>
          </div>
          <aside className="content-aside">
            <FourFieldDashboard fields={fourFields} decision={decision} />

            <article className="card">
              <h2>Agent 协作轨迹</h2>
              {phaseTrace.length > 0 ? (
                <div className="phase-trace">
                  {phaseTrace.map((p, i) => (
                    <span key={i} className="phase-badge active">{p}</span>
                  ))}
                </div>
              ) : (
                <p className="empty-state">开始会话后显示六 Agent 协作过程</p>
              )}
            </article>
          </aside>
        </main>
      )}
    </div>
  )
}
