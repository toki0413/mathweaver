import { memo, useCallback, useState, useMemo } from 'react'

interface CayleyTableProps {
  table: number[][]
  size: number
  onChange: (row: number, col: number, value: number) => void
}

interface CellPos {
  row: number
  col: number
}

function CayleyTableBase({ table, size, onChange }: CayleyTableProps) {
  // Track focused (keyboard) and hovered (mouse) cells separately so that
  // leaving the table with the mouse does not clear a keyboard-focused
  // cell's symmetric-pair highlight.
  const [focusedCell, setFocusedCell] = useState<CellPos | null>(null)
  const [hoveredCell, setHoveredCell] = useState<CellPos | null>(null)

  // react-native-skills: list-performance-callbacks — stabilize callback.
  // NOTE: we intentionally do NOT clamp here. Passing the raw parsed value
  // upstream lets us detect out-of-range entries and render `cell-invalid`.
  const handleChange = useCallback((row: number, col: number, rawValue: string) => {
    const v = parseInt(rawValue, 10)
    onChange(row, col, Number.isNaN(v) ? 0 : v)
  }, [onChange])

  const handleFocus = useCallback((row: number, col: number) => {
    setFocusedCell({ row, col })
  }, [])

  const handleBlur = useCallback(() => {
    setFocusedCell(null)
  }, [])

  const handleMouseEnter = useCallback((row: number, col: number) => {
    setHoveredCell({ row, col })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoveredCell(null)
  }, [])

  // (1) Real-time closure check + (5) closure badge data.
  // A cell is valid iff its value is an integer in [0, size - 1].
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

  // (3) Identity row/col detection.
  // Row i is an identity row  iff table[i][j] === j for every column j
  //   (element i is a left identity: i * j = j).
  // Col j is an identity col  iff table[i][j] === i for every row i
  //   (element j is a right identity: i * j = i).
  const { identityRows, identityCols } = useMemo(() => {
    const rows = new Set<number>()
    const cols = new Set<number>()
    for (let i = 0; i < size; i++) {
      const row = table[i]
      if (!row) continue
      let rowIsIdentity = true
      for (let j = 0; j < size; j++) {
        if (row[j] !== j) {
          rowIsIdentity = false
          break
        }
      }
      if (rowIsIdentity) rows.add(i)
    }
    for (let j = 0; j < size; j++) {
      let colIsIdentity = true
      for (let i = 0; i < size; i++) {
        const row = table[i]
        if (!row || row[j] !== i) {
          colIsIdentity = false
          break
        }
      }
      if (colIsIdentity) cols.add(j)
    }
    return { identityRows: rows, identityCols: cols }
  }, [table, size])

  // (4) Associativity check — full O(n³) verification for all table sizes.
  // For n ≤ 12 this is at most 1,728 iterations, which completes in < 1ms.
  // Verifies (a*b)*c === a*(b*c) for all a, b, c in [0, size-1].
  // Any out-of-range intermediate makes the operation ill-defined => fail.
  const isAssociative = useMemo(() => {
    if (!isClosed) return false
    const get = (a: number, b: number): number | null => {
      const v = table[a]?.[b]
      if (typeof v !== 'number' || v < 0 || v > size - 1) return null
      return v
    }
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        const ab = get(a, b)
        if (ab === null) return false
        for (let c = 0; c < size; c++) {
          const bc = get(b, c)
          if (bc === null) return false
          const left = get(ab, c)
          if (left === null) return false
          const right = get(a, bc)
          if (right === null) return false
          if (left !== right) return false
        }
      }
    }
    return true
  }, [table, size, isClosed])

  // The currently "active" cell drives the symmetric-pair highlight.
  // Focus takes priority over hover.
  const activeCell = focusedCell ?? hoveredCell

  return (
    <>
      <table className="cayley-table" onMouseLeave={handleMouseLeave} aria-label={`${size}×${size} 运算表`} role="grid">
        <thead>
          <tr>
            <th scope="col">*</th>
            {Array.from({ length: size }).map((_, j) => (
              <th key={j} scope="col">{j}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.map((row, i) => (
            <tr key={i}>
              <th scope="row">{i}</th>
              {row.map((val, j) => {
                const classes = ['cayley-cell']
                // (1) out-of-range => red shake
                if (invalidSet.has(`${i}:${j}`)) classes.push('cell-invalid')
                // (3) lies on an identity row or identity column
                if (identityRows.has(i) || identityCols.has(j)) classes.push('cell-identity')
                // (2) symmetric counterpart of the active cell is (activeCol, activeRow)
                if (activeCell && i === activeCell.col && j === activeCell.row) {
                  classes.push('cell-symmetry-pair')
                }
                return (
                  <td
                    key={j}
                    className={classes.join(' ')}
                    onMouseEnter={() => handleMouseEnter(i, j)}
                    role="gridcell"
                  >
                    <input
                      type="number"
                      min={0}
                      max={size - 1}
                      value={val}
                      onChange={(e) => handleChange(i, j, e.target.value)}
                      onFocus={() => handleFocus(i, j)}
                      onBlur={handleBlur}
                      aria-label={`元素 ${i} 与元素 ${j} 的运算结果`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* (4) + (5) quick-check badges */}
      <div className="cayley-badges" role="status" aria-live="polite" aria-label={`运算表验证结果：${isClosed ? '闭合' : '未闭合'}，${isAssociative ? '满足结合律' : '不满足结合律'}`}>
        <span className={isClosed ? 'closure-check-pass' : 'closure-check-fail'}>
          {isClosed ? '✓ 闭合' : '✗ 未闭合'}
        </span>
        <span className={isAssociative ? 'assoc-check-pass' : 'assoc-check-fail'}>
          {isAssociative ? '✓ 结合律' : '✗ 非结合律'}
        </span>
      </div>
    </>
  )
}

// react-native-skills: list-performance-item-memo
export const CayleyTable = memo(CayleyTableBase)
