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

export function DagTree({ nodes, activeNode, onSelect }: Props) {
  const sorted = [...nodes].sort((a, b) => a.abstraction_level - b.abstraction_level)

  return (
    <nav aria-label="概念依赖图" className="dag-list">
      {sorted.map((node) => (
        <button
          key={node.id}
          type="button"
          className={`dag-node ${node.id === activeNode ? 'active' : ''} ${node.is_milestone ? 'milestone' : ''}`}
          onClick={() => onSelect(node.id)}
          style={{ '--dag-indent': `${node.abstraction_level * 12}px` } as React.CSSProperties}
          aria-pressed={node.id === activeNode}
          title={node.description}
        >
          <span>{node.name}</span>
          <span className="difficulty">
            L{node.abstraction_level} · {(node.difficulty * 100).toFixed(0)}%
          </span>
        </button>
      ))}
      {nodes.length === 0 && (
        <p className="empty-state">加载中</p>
      )}
    </nav>
  )
}
