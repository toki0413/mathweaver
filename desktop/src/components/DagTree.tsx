import { memo, useMemo } from 'react'

interface DagNode {
  id: string
  name: string
  description: string
  prerequisites: string[]
  abstraction_level: number
  difficulty: number
  is_milestone: boolean
}

interface Props {
  nodes: DagNode[]
  activeNode: string
  onSelect: (id: string) => void
}

function DagTreeBase({ nodes, activeNode, onSelect }: Props) {
  // react-native-skills: list-performance-item-expensive — move sort outside render
  const sorted = useMemo(
    () => [...nodes].sort((a, b) => a.abstraction_level - b.abstraction_level),
    [nodes],
  )

  if (nodes.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: '0.85rem', padding: '8px' }}>加载中...</p>
  }

  return (
    <div>
      {sorted.map(node => (
        <div
          key={node.id}
          className={`dag-node ${node.id === activeNode ? 'active' : ''} ${node.is_milestone ? 'milestone' : ''}`}
          onClick={() => onSelect(node.id)}
          style={{ paddingLeft: `${12 + node.abstraction_level * 12}px` }}
        >
          <span>{node.name}</span>
          <span className="difficulty">
            L{node.abstraction_level} · {(node.difficulty * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// react-native-skills: list-performance-item-memo
export const DagTree = memo(DagTreeBase)
