import React, { useState, useMemo, useCallback } from 'react'

interface Props {
  table: number[][]
  size: number
}

/**
 * GroupOperationVisualizer
 *
 * Visualizes binary operations on a finite group given by its Cayley table.
 * - Lets the user pick two elements a and b.
 * - Displays the operation result a * b = table[a][b].
 * - Draws the left-multiplication permutation of a (i -> table[a][i]) as an
 *   SVG mapping diagram with curved (cubic bezier) arrows.
 * - Animates arrow transitions (fade out old / fade in new) via CSS transitions
 *   driven by the `animating` state.
 * - Highlights commutativity of the selected pair and detects the identity element.
 */
export const GroupOperationVisualizer: React.FC<Props> = ({ table, size }) => {
  const [selectedA, setSelectedA] = useState<number>(0)
  const [selectedB, setSelectedB] = useState<number>(0)
  const [animating, setAnimating] = useState<boolean>(false)

  // Left-multiplication permutation for the selected element a: i -> table[a][i].
  const permutation = useMemo<number[]>(() => {
    const perm: number[] = []
    for (let i = 0; i < size; i++) {
      perm.push(table[selectedA]?.[i] ?? i)
    }
    return perm
  }, [table, selectedA, size])

  // Commutativity check for the selected pair (a, b): table[a][b] === table[b][a].
  const isCommutative = useMemo<boolean>(() => {
    if (size === 0) return false
    const ab = table[selectedA]?.[selectedB]
    const ba = table[selectedB]?.[selectedA]
    return ab !== undefined && ba !== undefined && ab === ba
  }, [table, selectedA, selectedB, size])

  // Identity detection: element e satisfying table[e][j] === j for all j.
  const identityElement = useMemo<number>(() => {
    for (let e = 0; e < size; e++) {
      let isIdentity = true
      for (let j = 0; j < size; j++) {
        if (table[e]?.[j] !== j) {
          isIdentity = false
          break
        }
      }
      if (isIdentity) return e
    }
    return -1
  }, [table, size])

  // Selecting a new `a` triggers the fade-out -> swap -> fade-in animation.
  const handleSelectA = useCallback(
    (idx: number) => {
      if (idx === selectedA) return
      setAnimating(true)
      window.setTimeout(() => {
        setSelectedA(idx)
        setAnimating(false)
      }, 300)
    },
    [selectedA],
  )

  const handleSelectB = useCallback((idx: number) => {
    setSelectedB(idx)
  }, [])

  const opResult = table[selectedA]?.[selectedB]

  // SVG layout constants.
  const svgWidth = 300
  const rowHeight = 30
  const svgHeight = rowHeight * Math.max(size, 1)
  const leftX = 40
  const rightX = svgWidth - 40
  const nodeRadius = 12
  const midX = svgWidth / 2

  const centerY = (i: number) => i * rowHeight + rowHeight / 2

  const renderSelectorRow = (label: string, selected: number, onSelect: (i: number) => void) => (
    <div>
      <span>{label}: </span>
      {Array.from({ length: size }, (_, i) => (
        <span key={`${label}-${i}`}>
          <button
            className={`element-btn${selected === i ? ' element-btn-selected' : ''}`}
            onClick={() => onSelect(i)}
          >
            {i}
          </button>
          {identityElement === i && <span className="identity-badge">幺元</span>}
        </span>
      ))}
    </div>
  )

  return (
    <div className="group-viz">
      <div className="element-selector">
        {renderSelectorRow('a', selectedA, handleSelectA)}
        {renderSelectorRow('b', selectedB, handleSelectB)}
      </div>

      <div className="op-result">
        <span>
          {selectedA} * {selectedB} = {opResult}
        </span>
        {isCommutative && <span className="commutative-badge">✓ 交换</span>}
      </div>

      <svg
        className="perm-diagram"
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      >
        <defs>
          <marker
            id="perm-arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,3 L0,6 Z" />
          </marker>
        </defs>

        {/* Curved arrows: i (left) -> table[a][i] (right) */}
        {permutation.map((target, i) => {
          const y1 = centerY(i)
          const y2 = centerY(target)
          const startX = leftX + nodeRadius
          const endX = rightX - nodeRadius
          const d = `M ${startX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${endX} ${y2}`
          return (
            <path
              key={`arrow-${i}`}
              className="perm-arrow"
              d={d}
              fill="none"
              markerEnd="url(#perm-arrowhead)"
              style={{
                opacity: animating ? 0 : 1,
                transition: 'opacity 0.3s ease-in-out',
              }}
            />
          )
        })}

        {/* Input elements on the left */}
        {Array.from({ length: size }, (_, i) => {
          const y = centerY(i)
          return (
            <g key={`left-${i}`}>
              <circle className="perm-node" cx={leftX} cy={y} r={nodeRadius} />
              <text
                className="perm-label"
                x={leftX}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {i}
              </text>
            </g>
          )
        })}

        {/* Output elements on the right */}
        {Array.from({ length: size }, (_, i) => {
          const y = centerY(i)
          return (
            <g key={`right-${i}`}>
              <circle className="perm-node" cx={rightX} cy={y} r={nodeRadius} />
              <text
                className="perm-label"
                x={rightX}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {i}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default GroupOperationVisualizer
