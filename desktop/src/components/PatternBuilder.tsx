import { memo, useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
import type { DragEvent } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pair {
  a: number
  b: number
  result: number
}

interface OperationEntry extends Pair {
  id: number
}

export interface PatternBuilderProps {
  /** 可用元素列表，例如 [0, 1, 2]，应与 0..size-1 对应。 */
  elements: number[]
  /** 群的阶（元素个数）。 */
  size: number
  /** Cayley 运算表，table[a][b] 表示 a * b。 */
  table: number[][]
  /** 每次产生新运算时回调，传入截至目前的所有运算对。 */
  onPatternComplete?: (pairs: Pair[]) => void
}

// ---------------------------------------------------------------------------
// PatternBuilder
//
// 可视化拖拽式模式发现器：学生从左侧「元素池」拖拽（或点选）元素块，放入中
// 间「运算工作台」的两个槽位 a、b，组件依据 Cayley 表自动计算 a * b，并以淡
// 入动画展示结果。所有运算被记录为时间线，并实时推导「发现模式」——已测试对
// 检查表、幺元发现（星标）、阿贝尔性判定。
//
// 交互方式：
//   1. HTML5 拖放：元素块 draggable，槽位 onDrop 读取 dataTransfer。
//   2. 点击替代：点选元素高亮，再点击槽位放入。
// 样式类名统一以 `pb-` 为前缀，相关样式通过组件内 <style> 注入（不写入
// index.css）。
// ---------------------------------------------------------------------------

const pairKey = (a: number, b: number): string => `${a}:${b}`

/** 组件内联样式：所有 `pb-` 前缀类名的样式集中在此，避免污染 index.css。 */
const STYLES = `
.pb-root {
  display: flex;
  gap: 18px;
  padding: 16px;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1f2937;
  align-items: flex-start;
}
.pb-pool {
  width: 208px;
  flex-shrink: 0;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
}
.pb-panel-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
}
.pb-subtitle {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.pb-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #6b7280;
}
.pb-pool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 10px;
}
.pb-element-block {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  border: 2px solid #cbd5e1;
  border-radius: 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 18px;
  font-weight: 600;
  cursor: grab;
  user-select: none;
  padding: 0;
  transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
.pb-element-block:hover {
  border-color: #6366f1;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(99, 102, 175, 0.15);
}
.pb-element-block:active {
  cursor: grabbing;
  transform: translateY(0);
}
.pb-element-block-selected {
  border-color: #6366f1;
  background: #eef2ff;
  box-shadow: 0 0 0 3px rgba(99, 102, 175, 0.25);
}
.pb-element-block-identity {
  border-color: #f59e0b;
  background: #fffbeb;
}
.pb-element-value { line-height: 1; }
.pb-identity-star {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 14px;
  color: #f59e0b;
  line-height: 1;
}
.pb-workspace {
  flex: 1;
  min-width: 0;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pb-dropzone {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.pb-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease, border-style 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.pb-slot:hover { border-color: #94a3b8; }
.pb-slot:focus-visible { box-shadow: 0 0 0 3px rgba(99, 102, 175, 0.3); }
/* 拖拽悬停时高亮为虚线边框 */
.pb-slot-over {
  border: 2px dashed #6366f1;
  background: #eef2ff;
  transform: scale(1.04);
}
.pb-slot-filled {
  border: 2px solid #6366f1;
  background: #eef2ff;
  color: #312e81;
}
.pb-slot-label {
  font-size: 10px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.pb-slot-value {
  font-size: 24px;
  font-weight: 700;
}
.pb-operator,
.pb-equals {
  font-size: 22px;
  font-weight: 700;
  color: #475569;
}
.pb-result {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 72px;
  padding: 0 10px;
  border: 2px solid #10b981;
  border-radius: 12px;
  background: #ecfdf5;
  color: #065f46;
  font-size: 26px;
  font-weight: 700;
}
.pb-result-value {
  display: inline-block;
  animation: pb-fade-in 0.35s ease-out;
}
.pb-result-placeholder {
  color: #9ca3af;
  font-weight: 500;
  font-size: 24px;
}
@keyframes pb-fade-in {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}
.pb-formula {
  font-size: 13px;
  color: #6b7280;
  min-height: 18px;
}
.pb-log {
  border-top: 1px solid #f1f5f9;
  padding-top: 12px;
}
.pb-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.pb-clear {
  border: 1px solid #fca5a5;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.pb-clear:hover { background: #fee2e2; }
.pb-empty { font-size: 12px; color: #9ca3af; margin: 0; }
.pb-empty-inline { font-size: 12px; color: #9ca3af; }
.pb-log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pb-log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 8px;
  background: #f8fafc;
  border-radius: 8px;
  border-left: 3px solid #6366f1;
}
.pb-log-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #6366f1;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.pb-log-text { color: #334155; }
.pb-log-text strong { color: #065f46; }
.pb-discovery {
  border-top: 1px solid #f1f5f9;
  padding-top: 12px;
}
.pb-discovery-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.pb-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  min-width: 124px;
}
.pb-stat-label { font-size: 11px; color: #6b7280; }
.pb-stat-value { font-size: 14px; font-weight: 600; color: #1f2937; }
.pb-stat-value.pb-ok { color: #047857; }
.pb-stat-value.pb-pending { color: #b45309; }
.pb-stat-value.pb-fail { color: #b91c1c; }
.pb-discovery-identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.pb-identity-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 999px;
  font-weight: 600;
  color: #92400e;
  font-size: 13px;
}
.pb-tested-grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pb-tested-grid {
  display: grid;
  gap: 3px;
  width: fit-content;
  max-width: 100%;
  overflow: auto;
}
.pb-tested-corner,
.pb-tested-head,
.pb-tested-rowhead {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #6b7280;
  font-weight: 600;
  padding: 2px;
}
.pb-tested-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: #ffffff;
  font-size: 12px;
  color: #9ca3af;
}
.pb-tested-cell-on {
  background: #ecfdf5;
  border-color: #10b981;
  color: #047857;
  font-weight: 700;
}
`

function PatternBuilderBase({ elements, size, table, onPatternComplete }: PatternBuilderProps) {
  // --- 核心状态（useState）---
  const [droppedA, setDroppedA] = useState<number | null>(null)
  const [droppedB, setDroppedB] = useState<number | null>(null)
  const [operationLog, setOperationLog] = useState<OperationEntry[]>([])
  const [testedPairs, setTestedPairs] = useState<Set<string>>(() => new Set())

  // --- 交互辅助状态 ---
  // 点击替代拖拽：当前被点选的元素。
  const [selectedElement, setSelectedElement] = useState<number | null>(null)
  // 当前被拖拽悬停的槽位，用于虚线高亮。
  const [dragOverSlot, setDragOverSlot] = useState<'a' | 'b' | null>(null)
  // 日志条目自增 id（用 ref 避免 setState 依赖循环）。
  const idRef = useRef(0)

  // --- 派生：当前槽位的运算结果 ---
  const result = useMemo<number | null>(() => {
    if (droppedA === null || droppedB === null) return null
    const r = table[droppedA]?.[droppedB]
    return typeof r === 'number' ? r : null
  }, [droppedA, droppedB, table])

  // 记录一次运算：追加日志 + 标记已测试对。结果非法时静默忽略。
  const logOperation = useCallback(
    (a: number, b: number) => {
      const r = table[a]?.[b]
      if (typeof r !== 'number') return
      const entry: OperationEntry = { id: idRef.current++, a, b, result: r }
      setOperationLog(prev => [...prev, entry])
      setTestedPairs(prev => {
        const next = new Set(prev)
        next.add(pairKey(a, b))
        return next
      })
    },
    [table],
  )

  // 日志变化时通知父组件（传入完整运算对列表）。
  useEffect(() => {
    if (operationLog.length === 0) return
    onPatternComplete?.(operationLog.map(({ a, b, result }) => ({ a, b, result })))
  }, [operationLog, onPatternComplete])

  // 将元素放入指定槽位；若另一槽位已填，则自动记录运算。
  const placeElement = useCallback(
    (slot: 'a' | 'b', value: number) => {
      if (slot === 'a') {
        const otherB = droppedB
        setDroppedA(value)
        if (otherB !== null) logOperation(value, otherB)
      } else {
        const otherA = droppedA
        setDroppedB(value)
        if (otherA !== null) logOperation(otherA, value)
      }
      setSelectedElement(null)
    },
    [droppedA, droppedB, logOperation],
  )

  // --- HTML5 拖放处理器 ---
  const handleDragStart = useCallback((e: DragEvent<HTMLButtonElement>, value: number) => {
    e.dataTransfer.setData('text/plain', String(value))
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  const handleSlotDragOver = useCallback((e: DragEvent<HTMLDivElement>, slot: 'a' | 'b') => {
    e.preventDefault() // 允许放置
    e.dataTransfer.dropEffect = 'copy'
    setDragOverSlot(slot)
  }, [])

  const handleSlotDragLeave = useCallback((slot: 'a' | 'b') => {
    setDragOverSlot(cur => (cur === slot ? null : cur))
  }, [])

  const handleSlotDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, slot: 'a' | 'b') => {
      e.preventDefault()
      const raw = e.dataTransfer.getData('text/plain')
      setDragOverSlot(null)
      const v = parseInt(raw, 10)
      if (Number.isNaN(v) || v < 0 || v >= size) return
      placeElement(slot, v)
    },
    [size, placeElement],
  )

  // --- 点击替代拖拽 ---
  const handleElementClick = useCallback((value: number) => {
    setSelectedElement(cur => (cur === value ? null : value))
  }, [])

  const handleSlotClick = useCallback(
    (slot: 'a' | 'b') => {
      if (selectedElement === null) return
      placeElement(slot, selectedElement)
    },
    [selectedElement, placeElement],
  )

  // --- 清空记录 ---
  const handleClear = useCallback(() => {
    setDroppedA(null)
    setDroppedB(null)
    setOperationLog([])
    setTestedPairs(new Set())
    setSelectedElement(null)
    setDragOverSlot(null)
  }, [])

  // --- 发现模式（useMemo 派生）---
  // 幺元发现：基于已测运算，若元素 e 在所有涉及它的已测运算中均满足
  // e * x = x 与 x * e = x，且两侧均至少被测试过一次，则视为「已发现幺元」。
  const identityFound = useMemo<Set<number>>(() => {
    const found = new Set<number>()
    for (let e = 0; e < size; e++) {
      let leftTested = false
      let rightTested = false
      let allConsistent = true
      for (const op of operationLog) {
        if (op.a === e) {
          leftTested = true
          if (op.result !== op.b) {
            allConsistent = false
            break
          }
        }
        if (op.b === e) {
          rightTested = true
          if (op.result !== op.a) {
            allConsistent = false
            break
          }
        }
      }
      if (allConsistent && leftTested && rightTested) found.add(e)
    }
    return found
  }, [operationLog, size])

  // 阿贝尔性判定：检查所有「双向均已测试」的对是否可交换。
  // 若至少存在一对双向已测且全部满足 a*b === b*a，返回 true；若发现反例返回 false。
  const isAbelian = useMemo<boolean>(() => {
    let mutualCount = 0
    for (const op of operationLog) {
      if (testedPairs.has(pairKey(op.b, op.a))) {
        mutualCount++
        const rev = table[op.b]?.[op.a]
        if (typeof rev !== 'number' || rev !== op.result) return false
      }
    }
    return mutualCount > 0
  }, [operationLog, testedPairs, table])

  // 对角线 a*a 是否全部已测试（触发阿贝尔性判定的里程碑）。
  const allSquaresTested = useMemo<boolean>(() => {
    for (let a = 0; a < size; a++) {
      if (!testedPairs.has(pairKey(a, a))) return false
    }
    return true
  }, [testedPairs, size])

  const diagonalTestedCount = useMemo<number>(() => {
    let count = 0
    for (let a = 0; a < size; a++) {
      if (testedPairs.has(pairKey(a, a))) count++
    }
    return count
  }, [testedPairs, size])

  const totalPairs = size * size
  const testedCount = testedPairs.size
  const hasAnyTest = testedCount > 0

  // 交换性展示文案与状态色。
  const commutativity = (() => {
    if (!hasAnyTest) return { text: '待测试', cls: '' }
    if (isAbelian) return { text: '已测对均可交换 ✓', cls: 'pb-ok' }
    return { text: '存在不可交换对 ×', cls: 'pb-fail' }
  })()

  return (
    <div className="pb-root">
      <style>{STYLES}</style>

      {/* 左侧：元素池 */}
      <aside className="pb-pool">
        <h3 className="pb-panel-title">元素池</h3>
        <p className="pb-hint">拖拽或点选元素放入工作台</p>
        <div className="pb-pool-grid">
          {elements.map(el => {
            const isSelected = selectedElement === el
            const isIdentity = identityFound.has(el)
            const cls = [
              'pb-element-block',
              isSelected ? 'pb-element-block-selected' : '',
              isIdentity ? 'pb-element-block-identity' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={el}
                type="button"
                draggable
                onDragStart={e => handleDragStart(e, el)}
                onClick={() => handleElementClick(el)}
                className={cls}
                aria-label={`元素 ${el}${isIdentity ? '（已发现幺元）' : ''}`}
              >
                <span className="pb-element-value">{el}</span>
                {isIdentity && (
                  <span className="pb-identity-star" title="已发现幺元">
                    ★
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {selectedElement !== null && (
          <p className="pb-hint">已选择 {selectedElement}，点击工作台槽位放入</p>
        )}
      </aside>

      {/* 中间：运算工作台 */}
      <section className="pb-workspace">
        <h3 className="pb-panel-title">运算工作台</h3>

        <div className="pb-dropzone">
          {/* 槽位 a */}
          <div
            className={[
              'pb-slot',
              'pb-slot-a',
              dragOverSlot === 'a' ? 'pb-slot-over' : '',
              droppedA !== null ? 'pb-slot-filled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="button"
            tabIndex={0}
            onDragOver={e => handleSlotDragOver(e, 'a')}
            onDragLeave={() => handleSlotDragLeave('a')}
            onDrop={e => handleSlotDrop(e, 'a')}
            onClick={() => handleSlotClick('a')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') handleSlotClick('a')
            }}
          >
            <span className="pb-slot-label">a</span>
            <span className="pb-slot-value">{droppedA !== null ? droppedA : '—'}</span>
          </div>

          <span className="pb-operator">*</span>

          {/* 槽位 b */}
          <div
            className={[
              'pb-slot',
              'pb-slot-b',
              dragOverSlot === 'b' ? 'pb-slot-over' : '',
              droppedB !== null ? 'pb-slot-filled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="button"
            tabIndex={0}
            onDragOver={e => handleSlotDragOver(e, 'b')}
            onDragLeave={() => handleSlotDragLeave('b')}
            onDrop={e => handleSlotDrop(e, 'b')}
            onClick={() => handleSlotClick('b')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') handleSlotClick('b')
            }}
          >
            <span className="pb-slot-label">b</span>
            <span className="pb-slot-value">{droppedB !== null ? droppedB : '—'}</span>
          </div>

          <span className="pb-equals">=</span>

          {/* 结果（key 随槽位变化以重放淡入动画）*/}
          <div className="pb-result" key={`${droppedA ?? 'x'}-${droppedB ?? 'x'}`}>
            {result !== null ? (
              <span className="pb-result-value">{result}</span>
            ) : (
              <span className="pb-result-placeholder">?</span>
            )}
          </div>
        </div>

        <div className="pb-formula">
          {droppedA !== null && droppedB !== null && result !== null
            ? `${droppedA} * ${droppedB} = ${result}`
            : '将两个元素放入槽位以计算 a * b'}
        </div>

        {/* 记录时间线 */}
        <div className="pb-log">
          <div className="pb-log-header">
            <h4 className="pb-subtitle">记录</h4>
            <button type="button" className="pb-clear" onClick={handleClear}>
              清空记录
            </button>
          </div>
          {operationLog.length === 0 ? (
            <p className="pb-empty">尚无运算记录</p>
          ) : (
            <ul className="pb-log-list">
              {operationLog.map((op, idx) => (
                <li key={op.id} className="pb-log-entry">
                  <span className="pb-log-index">{idx + 1}</span>
                  <span className="pb-log-text">
                    {op.a} * {op.b} = <strong>{op.result}</strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 发现模式 */}
        <div className="pb-discovery">
          <h4 className="pb-subtitle">发现模式</h4>

          <div className="pb-discovery-stats">
            <div className="pb-stat">
              <span className="pb-stat-label">测试进度</span>
              <span className="pb-stat-value">
                {testedCount} / {totalPairs}
              </span>
            </div>
            <div className="pb-stat">
              <span className="pb-stat-label">对角线 a*a</span>
              <span className={`pb-stat-value ${allSquaresTested ? 'pb-ok' : ''}`}>
                {allSquaresTested ? '完整 ✓' : `${diagonalTestedCount} / ${size}`}
              </span>
            </div>
            <div className="pb-stat">
              <span className="pb-stat-label">
                {allSquaresTested ? '阿贝尔性' : '交换性（预判）'}
              </span>
              <span className={`pb-stat-value ${commutativity.cls}`}>{commutativity.text}</span>
            </div>
          </div>

          <div className="pb-discovery-identity">
            <span className="pb-stat-label">发现的幺元：</span>
            {identityFound.size === 0 ? (
              <span className="pb-empty-inline">尚未发现</span>
            ) : (
              Array.from(identityFound).map(e => (
                <span key={e} className="pb-identity-chip">
                  <span className="pb-identity-star">★</span>
                  {e}
                </span>
              ))
            )}
          </div>

          {/* 已测试对检查表（行 a × 列 b）*/}
          <div className="pb-tested-grid-wrap">
            <span className="pb-stat-label">已测试对（行 a × 列 b）</span>
            <div
              className="pb-tested-grid"
              style={{ gridTemplateColumns: `auto repeat(${size}, 1fr)` }}
            >
              <div className="pb-tested-corner">*</div>
              {Array.from({ length: size }, (_, b) => (
                <div key={`h-${b}`} className="pb-tested-head">
                  {b}
                </div>
              ))}
              {Array.from({ length: size }, (_, a) => (
                <Fragment key={`row-${a}`}>
                  <div className="pb-tested-rowhead">{a}</div>
                  {Array.from({ length: size }, (_, b) => {
                    const tested = testedPairs.has(pairKey(a, b))
                    return (
                      <div
                        key={`c-${a}-${b}`}
                        className={`pb-tested-cell ${tested ? 'pb-tested-cell-on' : ''}`}
                        title={`${a} * ${b}${tested ? '（已测试）' : ''}`}
                      >
                        {tested ? '✓' : ''}
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export const PatternBuilder = memo(PatternBuilderBase)
PatternBuilder.displayName = 'PatternBuilder'
