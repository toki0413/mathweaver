import { memo, useCallback, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { MathText } from './MathText'

/**
 * CayleyTable — an editable Cayley (operation) table with structural
 * visualization tailored to the group-axiom exploration workflow.
 *
 * Structural features:
 *  - Identity element detection (two-sided) → `cayley-identity` headers.
 *  - Inverse pair highlighting on hover → `cayley-inverse` cell.
 *  - Row/column hover highlighting → `cayley-row-highlight` / `cayley-col-highlight`.
 *  - Closure violation marking (value ≥ size) → `cayley-violation` cell.
 *  - Commutativity indicator badge ("交换" / "非交换").
 *
 * The table remains fully editable through number inputs.
 */
export interface CayleyTableProps {
  table: number[][]
  size: number
  onCellChange: (row: number, col: number, value: number) => void
}

interface CayleyCellProps {
  row: number
  col: number
  value: number
  size: number
  isViolation: boolean
  isRowHighlight: boolean
  isColHighlight: boolean
  isInverse: boolean
  onCellChange: (row: number, col: number, value: number) => void
  onHover: (row: number, col: number) => void
}

/** A single editable cell. Memoized so that, during hover, only the cells
 *  whose visual flags actually change re-render. */
const CayleyCell = memo(function CayleyCell({
  row,
  col,
  value,
  size,
  isViolation,
  isRowHighlight,
  isColHighlight,
  isInverse,
  onCellChange,
  onHover,
}: CayleyCellProps) {
  const className = [
    isRowHighlight ? 'cayley-row-highlight' : '',
    isColHighlight ? 'cayley-col-highlight' : '',
    isInverse ? 'cayley-inverse' : '',
    isViolation ? 'cayley-violation' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '') {
      onCellChange(row, col, 0)
      return
    }
    const parsed = parseInt(raw, 10)
    // Keep element indices non-negative; allow values ≥ size so that closure
    // violations remain visible (flagged via `cayley-violation`).
    onCellChange(row, col, Number.isNaN(parsed) ? 0 : Math.max(0, parsed))
  }

  return (
    <td className={className} onMouseEnter={() => onHover(row, col)}>
      <input
        type="number"
        min={0}
        max={size - 1}
        value={value}
        aria-label={`元素 ${row} 与元素 ${col} 的运算结果`}
        onChange={handleChange}
      />
    </td>
  )
})

function CayleyTableImpl({ table, size, onCellChange }: CayleyTableProps) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null)

  const handleHover = useCallback((row: number, col: number) => {
    setHovered({ row, col })
  }, [])
  const handleLeave = useCallback(() => setHovered(null), [])

  // --- Structural analysis ------------------------------------------------

  /** Two-sided identity: index e is the identity iff
   *  table[e][j] == j  AND  table[j][e] == j  for every j. */
  const identityIndex = useMemo(() => {
    for (let e = 0; e < size; e++) {
      let isIdentity = true
      for (let j = 0; j < size; j++) {
        if (table[e]?.[j] !== j || table[j]?.[e] !== j) {
          isIdentity = false
          break
        }
      }
      if (isIdentity) return e
    }
    return -1
  }, [table, size])

  /** For each element a (row i), the column b with table[i][b] == identity,
   *  i.e. the right-inverse of a. -1 when no inverse exists. */
  const inverseMap = useMemo(() => {
    const map = new Array<number>(size).fill(-1)
    if (identityIndex < 0) return map
    for (let i = 0; i < size; i++) {
      const row = table[i]
      if (!row) continue
      for (let b = 0; b < size; b++) {
        if (row[b] === identityIndex) {
          map[i] = b
          break
        }
      }
    }
    return map
  }, [table, size, identityIndex])

  /** Commutative iff table[i][j] == table[j][i] for all i, j. */
  const isCommutative = useMemo(() => {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (table[i]?.[j] !== table[j]?.[i]) return false
      }
    }
    return true
  }, [table, size])

  // --- Derived hover state ------------------------------------------------

  const hoverRow = hovered?.row ?? -1
  const hoverCol = hovered?.col ?? -1
  const hoverInverse = hoverRow >= 0 ? inverseMap[hoverRow] ?? -1 : -1

  // --- Render -------------------------------------------------------------

  return (
    <figure className="cayley-figure">
      <div className="cayley-table-wrap" onMouseLeave={handleLeave}>
        <table className="cayley-table" aria-label="Cayley 运算表">
          <thead>
            <tr>
              <th scope="col" aria-label="二元运算符">
                <MathText>{'$\\ast$'}</MathText>
              </th>
              {Array.from({ length: size }, (_, j) => (
                <th
                  key={j}
                  scope="col"
                  className={[
                    j === identityIndex ? 'cayley-identity' : '',
                    j === hoverCol ? 'cayley-col-highlight' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {j}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: size }, (_, i) => (
              <tr key={i}>
                <th
                  scope="row"
                  className={[
                    i === identityIndex ? 'cayley-identity' : '',
                    i === hoverRow ? 'cayley-row-highlight' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {i}
                </th>
                {Array.from({ length: size }, (_, j) => {
                  const val = table[i]?.[j] ?? 0
                  return (
                    <CayleyCell
                      key={j}
                      row={i}
                      col={j}
                      value={val}
                      size={size}
                      isViolation={val < 0 || val >= size}
                      isRowHighlight={i === hoverRow}
                      isColHighlight={j === hoverCol}
                      isInverse={i === hoverRow && j === hoverInverse}
                      onCellChange={onCellChange}
                      onHover={handleHover}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="cayley-meta">
        <span className={`badge ${isCommutative ? 'badge-success' : 'badge-warning'}`}>
          {isCommutative ? '交换' : '非交换'}
        </span>

        {identityIndex >= 0 ? (
          <span className="cayley-annot">
            <MathText>{`$e = ${identityIndex}$`}</MathText>
          </span>
        ) : (
          <span className="badge badge-muted">无幺元</span>
        )}

        {hovered !== null && hoverInverse >= 0 && (
          <span className="cayley-annot">
            <MathText>{`$${hoverRow}^{-1} = ${hoverInverse}$`}</MathText>
          </span>
        )}
      </figcaption>
    </figure>
  )
}

export const CayleyTable = memo(CayleyTableImpl)
