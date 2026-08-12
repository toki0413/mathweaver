import { memo, useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { getElementColor } from './StudentPlayground'

interface CayleyTableProps {
  table: number[][]
  size: number
  onChange: (row: number, col: number, value: number) => void
  /** External highlight request — e.g. from GroupOperationVisualizer or verification animation */
  highlightCell?: { row: number; col: number; type: 'computation' | 'identity' | 'symmetry' } | null
  /** Verification animation trigger — when this changes, animate checking axioms */
  verifyTrigger?: number
  /** When true, cells are colored by their value instead of showing plain numbers */
  colorMode?: boolean
  /** Toggle button to switch color mode on/off */
  onToggleColorMode?: () => void
  /** Fired when a group axiom transitions from not-satisfied to satisfied */
  onDiscovery?: (property: string) => void
}

interface CellPos {
  row: number
  col: number
}

/**
 * Pick a readable text color (dark ink or white) based on the luminance of the
 * given hex background. Prevents white-on-light-color legibility issues when
 * colorMode paints cells with light element colors.
 */
function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1a1a2e' : '#ffffff'
}

function CayleyTableBase({
  table,
  size,
  onChange,
  highlightCell,
  verifyTrigger,
  colorMode = false,
  onToggleColorMode,
  onDiscovery,
}: CayleyTableProps) {
  const [focusedCell, setFocusedCell] = useState<CellPos | null>(null)
  const [hoveredCell, setHoveredCell] = useState<CellPos | null>(null)
  // Local editing buffer so a cell's number input can be temporarily cleared
  // (empty string) without parseInt coercing it back to 0 on every keystroke.
  // `null` means "not editing"; the displayed value falls back to `val`.
  const [editingCell, setEditingCell] = useState<string | null>(null)
  // Animated verification: cells being checked light up sequentially
  const [verifyAnim, setVerifyAnim] = useState<{ row: number; col: number; type: string } | null>(
    null,
  )
  const [violatingTriple, setViolatingTriple] = useState<[number, number, number] | null>(null)
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track previous axiom states to detect discovery moments
  const prevAxiomsRef = useRef({
    isClosed: false,
    isAssociative: false,
    hasIdentity: false,
    hasInverses: false,
    isCommutative: false,
  })
  // Whether the discovery effect has run at least once. The first run is
  // skipped so that a pre-filled valid table (e.g. the default Z₃ table)
  // does not spuriously fire every discovery toast on mount — discoveries
  // should only fire when the user's edits or a preset load transition an
  // axiom from unsatisfied to satisfied. This also keeps mount-time toasts
  // from overlapping and blocking the onboarding dialog in E2E tests.
  const hasMountedRef = useRef(false)

  const handleMouseEnter = useCallback((row: number, col: number) => {
    setHoveredCell({ row, col })
  }, [])

  const handleMouseLeave = useCallback(() => setHoveredCell(null), [])

  // (1) Real-time closure check
  const { isClosed, invalidSet } = useMemo(() => {
    let closed = true
    const invalid = new Set<string>()
    for (let i = 0; i < size; i++) {
      const row = table[i]
      if (!row) continue
      for (let j = 0; j < size; j++) {
        const v = row[j]
        if (typeof v !== 'number' || v < 0 || v > size - 1) {
          closed = false
          invalid.add(`${i}:${j}`)
        }
      }
    }
    return { isClosed: closed, invalidSet: invalid }
  }, [table, size])

  // (3) Identity row/col detection
  const { identityRows, identityCols } = useMemo(() => {
    const rows = new Set<number>()
    const cols = new Set<number>()
    for (let i = 0; i < size; i++) {
      const row = table[i]
      if (!row) continue
      let isIdentity = true
      for (let j = 0; j < size; j++) {
        if (row[j] !== j) {
          isIdentity = false
          break
        }
      }
      if (isIdentity) rows.add(i)
    }
    for (let j = 0; j < size; j++) {
      let isIdentity = true
      for (let i = 0; i < size; i++) {
        const row = table[i]
        if (!row || row[j] !== i) {
          isIdentity = false
          break
        }
      }
      if (isIdentity) cols.add(j)
    }
    return { identityRows: rows, identityCols: cols }
  }, [table, size])

  // (4) Associativity check — with violation triple extraction
  const { isAssociative, assocViolation } = useMemo(() => {
    if (!isClosed)
      return { isAssociative: false, assocViolation: null as [number, number, number] | null }
    const get = (a: number, b: number): number | null => {
      const v = table[a]?.[b]
      if (typeof v !== 'number' || v < 0 || v > size - 1) return null
      return v
    }
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        const ab = get(a, b)
        if (ab === null) return { isAssociative: false, assocViolation: null }
        for (let c = 0; c < size; c++) {
          const bc = get(b, c)
          if (bc === null) return { isAssociative: false, assocViolation: null }
          const left = get(ab, c)
          if (left === null) return { isAssociative: false, assocViolation: null }
          const right = get(a, bc)
          if (right === null) return { isAssociative: false, assocViolation: null }
          if (left !== right) {
            return { isAssociative: false, assocViolation: [a, b, c] as [number, number, number] }
          }
        }
      }
    }
    return { isAssociative: true, assocViolation: null }
  }, [table, size, isClosed])

  // (5) Commutativity check — with violating pair
  const { isCommutative, commViolation } = useMemo(() => {
    if (!isClosed) return { isCommutative: false, commViolation: null as [number, number] | null }
    for (let a = 0; a < size; a++) {
      for (let b = a + 1; b < size; b++) {
        if (table[a]?.[b] !== table[b]?.[a]) {
          return { isCommutative: false, commViolation: [a, b] as [number, number] }
        }
      }
    }
    return { isCommutative: true, commViolation: null }
  }, [table, size, isClosed])

  // (6) Inverse element check — for each element, find if an inverse exists
  const { hasInverses, inverseMap, noInverseElements } = useMemo(() => {
    if (!isClosed || identityRows.size === 0) {
      return {
        hasInverses: false,
        inverseMap: new Map<number, number>(),
        noInverseElements: [] as number[],
      }
    }
    const identity = [...identityRows][0]
    const invMap = new Map<number, number>()
    const missing: number[] = []
    for (let a = 0; a < size; a++) {
      let found = false
      for (let b = 0; b < size; b++) {
        if (table[a]?.[b] === identity && table[b]?.[a] === identity) {
          invMap.set(a, b)
          found = true
          break
        }
      }
      if (!found) missing.push(a)
    }
    return { hasInverses: missing.length === 0, inverseMap: invMap, noInverseElements: missing }
  }, [table, size, isClosed, identityRows])

  // (7) Count satisfied axioms for progress bar
  const axiomProgress = useMemo(() => {
    let count = 0
    const total = 5 // closure, associativity, identity, inverses, commutativity
    if (isClosed) count++
    if (isAssociative) count++
    if (identityRows.size > 0) count++
    if (hasInverses) count++
    if (isCommutative) count++
    return { count, total }
  }, [isClosed, isAssociative, identityRows, hasInverses, isCommutative])

  // (8) Discovery detection — fire callback when an axiom transitions to satisfied
  const currentAxioms = {
    isClosed,
    isAssociative,
    hasIdentity: identityRows.size > 0,
    hasInverses,
    isCommutative,
  }
  useEffect(() => {
    if (!onDiscovery) return
    const prev = prevAxiomsRef.current
    // Skip the initial mount: a pre-filled valid table is not a "discovery".
    // Discoveries should only fire when the user's edits (or a preset load)
    // transition an axiom from unsatisfied to satisfied.
    if (hasMountedRef.current) {
      const discoveries: string[] = []
      if (!prev.isClosed && currentAxioms.isClosed) discoveries.push('closure')
      if (!prev.isAssociative && currentAxioms.isAssociative) discoveries.push('associativity')
      if (!prev.hasIdentity && currentAxioms.hasIdentity) discoveries.push('identity')
      if (!prev.hasInverses && currentAxioms.hasInverses) discoveries.push('inverses')
      if (!prev.isCommutative && currentAxioms.isCommutative) discoveries.push('commutativity')
      if (discoveries.length > 0) {
        discoveries.forEach(d => onDiscovery(d))
      }
    }
    prevAxiomsRef.current = { ...currentAxioms }
    hasMountedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed, isAssociative, identityRows.size, hasInverses, isCommutative, onDiscovery])

  // Active property filter — when user clicks a badge, highlight relevant cells
  const [activeProperty, setActiveProperty] = useState<string | null>(null)

  // Verification animation: when verifyTrigger changes, sweep through cells
  useEffect(() => {
    if (verifyTrigger === undefined || verifyTrigger === 0) return
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)

    let step = 0
    const animateStep = () => {
      if (step < size * size) {
        const row = Math.floor(step / size)
        const col = step % size
        setVerifyAnim({ row, col, type: 'closure-check' })
        verifyTimerRef.current = setTimeout(animateStep, 50)
        step++
      } else if (!isAssociative && assocViolation) {
        // Highlight the violating triple
        const [a, b, c] = assocViolation
        setViolatingTriple([a, b, c])
        setVerifyAnim({ row: a, col: b, type: 'assoc-violation' })
        verifyTimerRef.current = setTimeout(() => {
          setVerifyAnim(null)
        }, 3000)
      } else {
        setVerifyAnim(null)
      }
    }
    animateStep()

    return () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
    }
  }, [verifyTrigger, size, isAssociative, assocViolation])

  const activeCell = focusedCell ?? hoveredCell
  const externalHighlight = highlightCell
  // Hoist the first identity row out of the per-cell render loop — otherwise
  // `[...identityRows][0]` is re-spread on every single cell.
  const firstIdentityRow = identityRows.size > 0 ? [...identityRows][0] : null

  return (
    <>
      <table
        className="cayley-table"
        onMouseLeave={handleMouseLeave}
        aria-label={`${size}×${size} 运算表`}
        role="grid"
      >
        <thead>
          <tr>
            <th scope="col">*</th>
            {Array.from({ length: size }).map((_, j) => (
              <th
                key={j}
                scope="col"
                className={
                  commViolation && (commViolation[0] === j || commViolation[1] === j)
                    ? 'col-highlight-violation'
                    : ''
                }
              >
                {j}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.map((row, i) => (
            <tr key={i}>
              <th
                scope="row"
                className={
                  commViolation && (commViolation[0] === i || commViolation[1] === i)
                    ? 'row-highlight-violation'
                    : ''
                }
              >
                {i}
              </th>
              {row.map((val, j) => {
                const classes = ['cayley-cell']
                // out-of-range => red
                if (invalidSet.has(`${i}:${j}`)) classes.push('cell-invalid')
                // identity row/col
                if (identityRows.has(i) || identityCols.has(j)) classes.push('cell-identity')
                // symmetric pair highlight
                if (activeCell && i === activeCell.col && j === activeCell.row) {
                  classes.push('cell-symmetry-pair')
                }
                // external highlight (from GroupOperationVisualizer)
                if (
                  externalHighlight &&
                  i === externalHighlight.row &&
                  j === externalHighlight.col
                ) {
                  classes.push(`cell-ext-highlight-${externalHighlight.type}`)
                }
                // verification animation
                if (verifyAnim && verifyAnim.row === i && verifyAnim.col === j) {
                  classes.push('cell-verify-anim')
                }
                // commutativity violation pair
                if (
                  commViolation &&
                  ((commViolation[0] === i && commViolation[1] === j) ||
                    (commViolation[1] === i && commViolation[0] === j))
                ) {
                  classes.push('cell-comm-violation')
                }
                // associativity violation triple
                if (
                  violatingTriple &&
                  (violatingTriple[0] === i || violatingTriple[1] === i || violatingTriple[2] === i)
                ) {
                  classes.push('cell-assoc-violation')
                }
                // inverse pair highlight — when activeProperty is 'inverses'
                if (activeProperty === 'inverses') {
                  const inv = inverseMap.get(i)
                  if (inv !== undefined && j === inv && table[i]?.[j] === firstIdentityRow) {
                    classes.push('cell-inverse-pair')
                  }
                  // Highlight elements without inverses
                  if (noInverseElements.includes(i)) {
                    classes.push('cell-no-inverse')
                  }
                }
                return (
                  <td
                    key={j}
                    className={classes.join(' ')}
                    onMouseEnter={() => handleMouseEnter(i, j)}
                    role="gridcell"
                    style={
                      colorMode
                        ? {
                            background: getElementColor(val),
                            borderRadius: '3px',
                          }
                        : undefined
                    }
                  >
                    <input
                      type="number"
                      min={0}
                      max={size - 1}
                      value={
                        editingCell !== null && focusedCell?.row === i && focusedCell?.col === j
                          ? editingCell
                          : String(val)
                      }
                      onChange={e => {
                        const raw = e.target.value
                        setEditingCell(raw)
                        // Commit valid integers immediately — including
                        // out-of-range values, which the real-time closure
                        // check flags as invalid (red cell + "× 未闭合"
                        // badge). The editing buffer still lets the cell be
                        // temporarily cleared (empty string → NaN → no commit)
                        // so the user can retype freely without parseInt
                        // coercing the value back to 0 on every keystroke.
                        const n = parseInt(raw, 10)
                        if (!Number.isNaN(n)) onChange(i, j, n)
                      }}
                      onFocus={() => {
                        setFocusedCell({ row: i, col: j })
                        setEditingCell(String(val))
                      }}
                      onBlur={() => {
                        setEditingCell(null)
                        setFocusedCell(null)
                      }}
                      aria-label={`元素 ${i} 与元素 ${j} 的运算结果`}
                      style={
                        colorMode
                          ? {
                              color: getContrastColor(getElementColor(val)),
                              fontWeight: 700,
                              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                            }
                          : undefined
                      }
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Color mode toggle + Axiom progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0' }}>
        {onToggleColorMode && (
          <button
            onClick={onToggleColorMode}
            style={{
              padding: '4px 10px',
              border: `1px solid ${colorMode ? 'var(--accent, #3D4F7A)' : 'var(--border, #ddd)'}`,
              borderRadius: '6px',
              background: colorMode ? 'rgba(61, 79, 122, 0.08)' : 'var(--bg2, #f5f0e8)',
              color: colorMode ? 'var(--accent, #3D4F7A)' : 'var(--muted)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
            title="切换颜色视图"
          >
            {colorMode ? '颜色' : ' OFF'}
          </button>
        )}
        <div
          className="cayley-axiom-progress"
          style={{
            flex: 1,
            padding: '6px 10px',
            background: 'var(--bg3, #f5f0e8)',
            borderRadius: '8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '4px',
              fontSize: '12px',
            }}
          >
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>群公理满足度</span>
            <span
              style={{
                fontWeight: 700,
                color: axiomProgress.count === axiomProgress.total ? 'var(--ok)' : 'var(--accent)',
              }}
            >
              {axiomProgress.count}/{axiomProgress.total}
            </span>
          </div>
          <div
            style={{
              height: '6px',
              background: 'var(--bg2, #fff)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(axiomProgress.count / axiomProgress.total) * 100}%`,
                background:
                  axiomProgress.count === axiomProgress.total
                    ? 'linear-gradient(90deg, var(--ok), var(--accent2))'
                    : 'linear-gradient(90deg, var(--accent), var(--accent2))',
                borderRadius: '3px',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* Verification badges — clickable to highlight relevant cells */}
      <div
        className="cayley-badges"
        role="status"
        aria-live="polite"
        aria-label={`验证结果：${isClosed ? '闭合' : '未闭合'}，${isAssociative ? '满足结合律' : '不满足结合律'}，${isCommutative ? '可交换' : '不可交换'}，${hasInverses ? '存在逆元' : '缺失逆元'}`}
      >
        <span
          className={isClosed ? 'closure-check-pass' : 'closure-check-fail'}
          style={{
            cursor: 'pointer',
            opacity: activeProperty && activeProperty !== 'closure' ? 0.5 : 1,
          }}
          role="button"
          tabIndex={0}
          onClick={() => setActiveProperty(activeProperty === 'closure' ? null : 'closure')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ')
              setActiveProperty(activeProperty === 'closure' ? null : 'closure')
          }}
          title="点击高亮无效单元格"
        >
          {isClosed ? '✓ 闭合' : '× 未闭合'}
        </span>
        <span
          className={isAssociative ? 'assoc-check-pass' : 'assoc-check-fail'}
          style={{
            cursor: 'pointer',
            opacity: activeProperty && activeProperty !== 'associativity' ? 0.5 : 1,
          }}
          role="button"
          tabIndex={0}
          onClick={() =>
            setActiveProperty(activeProperty === 'associativity' ? null : 'associativity')
          }
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ')
              setActiveProperty(activeProperty === 'associativity' ? null : 'associativity')
          }}
          title="点击高亮违反结合律的单元格"
        >
          {isAssociative ? '✓ 结合律' : '× 非结合律'}
        </span>
        <span
          className={identityRows.size > 0 ? 'closure-check-pass' : 'closure-check-fail'}
          style={{
            cursor: 'pointer',
            opacity: activeProperty && activeProperty !== 'identity' ? 0.5 : 1,
          }}
          role="button"
          tabIndex={0}
          onClick={() => setActiveProperty(activeProperty === 'identity' ? null : 'identity')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ')
              setActiveProperty(activeProperty === 'identity' ? null : 'identity')
          }}
          title="点击高亮单位元"
        >
          {identityRows.size > 0 ? `✓ 单位元=${[...identityRows][0]}` : '× 无单位元'}
        </span>
        <span
          className={hasInverses ? 'closure-check-pass' : 'closure-check-fail'}
          style={{
            cursor: 'pointer',
            opacity: activeProperty && activeProperty !== 'inverses' ? 0.5 : 1,
          }}
          role="button"
          tabIndex={0}
          onClick={() => setActiveProperty(activeProperty === 'inverses' ? null : 'inverses')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ')
              setActiveProperty(activeProperty === 'inverses' ? null : 'inverses')
          }}
          title="点击高亮逆元对"
        >
          {hasInverses
            ? '✓ 逆元'
            : `× 逆元缺失${noInverseElements.length > 0 ? `(${noInverseElements.join(',')})` : ''}`}
        </span>
        <span
          className={isCommutative ? 'closure-check-pass' : 'assoc-check-fail'}
          style={{
            cursor: 'pointer',
            opacity: activeProperty && activeProperty !== 'commutativity' ? 0.5 : 1,
          }}
          role="button"
          tabIndex={0}
          onClick={() =>
            setActiveProperty(activeProperty === 'commutativity' ? null : 'commutativity')
          }
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ')
              setActiveProperty(activeProperty === 'commutativity' ? null : 'commutativity')
          }}
          title="点击高亮不交换的对称对"
        >
          {isCommutative ? '✓ 交换律' : '× 非交换'}
        </span>
      </div>

      {/* Detailed violation feedback */}
      {!isClosed && (
        <div className="cayley-violation-detail">
          <strong>未闭合：</strong>表格中存在超出范围的值（红色高亮）。每个运算结果必须在 0 到{' '}
          {size - 1} 之间。
        </div>
      )}
      {!isAssociative && assocViolation && (
        <div className="cayley-violation-detail">
          <strong>结合律违反：</strong>令 a={assocViolation[0]}, b={assocViolation[1]}, c=
          {assocViolation[2]}， 则 (a∗b)∗c ≠ a∗(b∗c)。查看高亮的行/列了解具体值。
        </div>
      )}
      {!isCommutative && commViolation && (
        <div className="cayley-violation-detail">
          <strong>交换律违反：</strong>
          元素 {commViolation[0]} ∗ {commViolation[1]} ≠ {commViolation[1]} ∗ {commViolation[0]}。
          对称对高亮显示了不交换的位置。
        </div>
      )}
      {!hasInverses && isClosed && identityRows.size > 0 && noInverseElements.length > 0 && (
        <div className="cayley-violation-detail">
          <strong>逆元缺失：</strong>元素 {noInverseElements.join(', ')} 找不到对应的逆元。 逆元 b
          满足 a∗b = b∗a = e（单位元）。点击"逆元"徽章高亮已有的逆元对。
        </div>
      )}
      {isClosed && isAssociative && isCommutative && hasInverses && identityRows.size > 0 && (
        <div className="cayley-success-detail">
          ✓ 运算表定义了一个交换群。单位元为元素 {[...identityRows][0]}，所有元素均有逆元。
        </div>
      )}
      {isClosed && isAssociative && !isCommutative && hasInverses && identityRows.size > 0 && (
        <div className="cayley-success-detail">
          ✓ 运算表定义了一个群（非交换群）。单位元为元素 {[...identityRows][0]}。
        </div>
      )}
    </>
  )
}

export const CayleyTable = memo(CayleyTableBase)
