import { memo, useCallback } from 'react'

interface CayleyTableProps {
  table: number[][]
  size: number
  onChange: (row: number, col: number, value: number) => void
}

function CayleyTableBase({ table, size, onChange }: CayleyTableProps) {
  // react-native-skills: list-performance-callbacks — stabilize callback
  const handleChange = useCallback((row: number, col: number, rawValue: string) => {
    const v = parseInt(rawValue) || 0
    onChange(row, col, Math.max(0, Math.min(size - 1, v)))
  }, [onChange, size])

  return (
    <table className="cayley-table">
      <thead>
        <tr>
          <th>*</th>
          {Array.from({ length: size }).map((_, j) => (
            <th key={j}>{j}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.map((row, i) => (
          <tr key={i}>
            <th>{i}</th>
            {row.map((val, j) => (
              <td key={j}>
                <input
                  type="number"
                  min={0}
                  max={size - 1}
                  value={val}
                  onChange={(e) => handleChange(i, j, e.target.value)}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// react-native-skills: list-performance-item-memo
export const CayleyTable = memo(CayleyTableBase)
