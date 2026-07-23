/**
 * DagGraph.tsx
 * ---------------------------------------------------------------------------
 * SVG-based Directed Acyclic Graph visualization for the MathWeaver concept map.
 *
 * Replaces the flat `DagTree` list with a true graph layout:
 *   - nodes are positioned by `abstraction_level` on the Y-axis (foundational
 *     concepts at the bottom, advanced concepts at the top) and spread
 *     horizontally within each level;
 *   - edges are drawn as curved cubic-bezier paths with arrowheads;
 *   - nodes are color-coded by learning status, sized by milestone flag, and
 *     carry an optional mastery arc;
 *   - the current node pulses, the selected node wears an ink selection ring.
 *
 * The component is fully self-contained: all graph-specific CSS lives inside an
 * inline SVG `<style>` element so it can be dropped in next to `DagTree.tsx`
 * without touching `index.css`.
 *
 * Backwards compatibility
 * -----------------------
 * The primary props follow the new graph shape returned by
 * `VisualDataBuilder.build_dag_progress` (nodes + edges + currentNodeId).
 * It also accepts the legacy flat node list served by `/api/dag`, where every
 * node carries a `prerequisites: string[]` array and there is no separate edges
 * collection — in that case the component derives edges from `prerequisites`
 * and falls back to `activeNode` for the selection state.
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react'

/* ============================================================================
 * Types
 * ==========================================================================*/

export type DagNodeStatus =
  | 'mastered'
  | 'needs_review'
  | 'skipped'
  | 'current'
  | 'locked'

/** Canonical node shape produced by the backend `build_dag_progress`. */
export interface DagNode {
  id: string
  name: string
  description: string
  mastery: number
  status: DagNodeStatus
  is_current: boolean
  is_milestone: boolean
  difficulty: number
  domain: string
  abstraction_level: number
}

/** Explicit directed edge (prerequisite -> dependent). */
export interface DagEdge {
  source: string
  target: string
}

/** Legacy flat-list node shape from `/api/dag` (carries `prerequisites`). */
export interface LegacyDagNode {
  id: string
  name: string
  description?: string
  prerequisites?: string[]
  abstraction_level: number
  difficulty: number
  is_milestone: boolean
  // tolerate new-style fields too, so a mixed payload type-checks
  mastery?: number
  status?: DagNodeStatus
  is_current?: boolean
  domain?: string
}

type AnyDagNode = DagNode | LegacyDagNode

interface Props {
  /** Concept nodes (new graph shape or legacy flat shape). */
  nodes: AnyDagNode[]
  /** Explicit edges. If omitted, edges are derived from each node's
   *  legacy `prerequisites` array. */
  edges?: DagEdge[]
  /** The currently-selected node id (new style). */
  currentNodeId?: string | null
  /** Legacy active-node id (old DagTree prop). Used when currentNodeId is null. */
  activeNode?: string
  /** Click / select handler. */
  onSelect: (nodeId: string) => void
}

/* ============================================================================
 * Layout constants
 * ==========================================================================*/

const NODE_R = 24 // regular node radius
const MILESTONE_R = 33 // milestone nodes are larger
const H_SPACING = 132 // horizontal distance between node centers in a level
const V_SPACING = 134 // vertical distance between abstraction levels
const TOP_PAD = 56 // top padding (room for topmost labels)
const BOTTOM_PAD = 16
const LEFT_PAD = 66 // left padding (room for level labels)
const RIGHT_PAD = 30
const MIN_INNER_W = 600 // minimum drawable width

/* ============================================================================
 * Normalization helpers (legacy -> canonical)
 * ==========================================================================*/

function normalizeNode(raw: AnyDagNode): DagNode {
  const legacy = raw as LegacyDagNode
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    mastery: (raw as DagNode).mastery ?? 0,
    status: ((raw as DagNode).status ?? 'locked') as DagNodeStatus,
    is_current: (raw as DagNode).is_current ?? false,
    is_milestone: raw.is_milestone ?? false,
    difficulty: raw.difficulty ?? 0,
    domain: (raw as DagNode).domain ?? '',
    abstraction_level: raw.abstraction_level ?? 0,
  }
}

function deriveEdges(nodes: AnyDagNode[], explicit?: DagEdge[]): DagEdge[] {
  if (explicit && explicit.length > 0) return explicit
  const edges: DagEdge[] = []
  for (const n of nodes) {
    const prereqs = (n as LegacyDagNode).prerequisites
    if (Array.isArray(prereqs)) {
      for (const p of prereqs) {
        if (p) edges.push({ source: p, target: n.id })
      }
    }
  }
  return edges
}

/* ============================================================================
 * Layout algorithm
 * ==========================================================================*/

interface PositionedNode extends DagNode {
  x: number
  y: number
  r: number
}

interface LaidOutEdge {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
  r1: number
  r2: number
  targetStatus: DagNodeStatus
}

interface LevelMeta {
  level: number
  y: number
}

interface Layout {
  nodes: PositionedNode[]
  edges: LaidOutEdge[]
  width: number
  height: number
  levels: LevelMeta[]
}

function computeLayout(allNodes: DagNode[], allEdges: DagEdge[]): Layout {
  // 1. Group nodes by abstraction_level.
  const byLevel = new Map<number, DagNode[]>()
  for (const n of allNodes) {
    const lvl = n.abstraction_level
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(n)
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b)

  // 2. Determine canvas width from the widest level.
  const maxCount = Math.max(1, ...levels.map((l) => byLevel.get(l)!.length))
  const innerW = Math.max(MIN_INNER_W, (maxCount - 1) * H_SPACING)
  const width = LEFT_PAD + innerW + RIGHT_PAD
  const height =
    TOP_PAD + BOTTOM_PAD + Math.max(0, levels.length - 1) * V_SPACING

  // 3. Assign coordinates. Foundational (low abstraction_level) at the bottom,
  //    advanced (high) at the top — knowledge builds upward.
  const posById = new Map<string, PositionedNode>()
  const positioned: PositionedNode[] = []
  const levelMeta: LevelMeta[] = []

  levels.forEach((lvl, idx) => {
    const group = byLevel.get(lvl)!
    const y = TOP_PAD + (levels.length - 1 - idx) * V_SPACING
    levelMeta.push({ level: lvl, y })
    const span = (group.length - 1) * H_SPACING
    const startX = LEFT_PAD + (innerW - span) / 2 // center the row
    group.forEach((n, i) => {
      const r = n.is_milestone ? MILESTONE_R : NODE_R
      const pn: PositionedNode = { ...n, x: startX + i * H_SPACING, y, r }
      posById.set(n.id, pn)
      positioned.push(pn)
    })
  })

  // 4. Project edges onto node positions (skip dangling refs).
  const laidEdges: LaidOutEdge[] = []
  allEdges.forEach((e, i) => {
    const s = posById.get(e.source)
    const t = posById.get(e.target)
    if (!s || !t) return
    laidEdges.push({
      key: `${e.source}->${e.target}-${i}`,
      x1: s.x,
      y1: s.y,
      x2: t.x,
      y2: t.y,
      r1: s.r,
      r2: t.r,
      targetStatus: t.status,
    })
  })

  return { nodes: positioned, edges: laidEdges, width, height, levels: levelMeta }
}

/* ============================================================================
 * Geometry helpers
 * ==========================================================================*/

/** Cubic-bezier path between two nodes, trimmed to each node's radius so the
 *  endpoints sit on the node boundary (arrowhead lands cleanly on the edge). */
function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r1: number,
  r2: number,
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const sx = x1 + ux * r1
  const sy = y1 + uy * r1
  const tx = x2 - ux * r2
  const ty = y2 - uy * r2
  const midY = (sy + ty) / 2
  // vertical-leaning S-curve — reads naturally for a layered DAG
  return `M ${sx} ${sy} C ${sx} ${midY} ${tx} ${midY} ${tx} ${ty}`
}

/** Truncate a label by approximated display width (CJK glyphs count double). */
function truncateLabel(s: string, maxWidth: number): string {
  const cjk = /[\u3000-\u9fff\uff00-\uffef]/
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = cjk.test(ch) ? 2 : 1
    if (w + cw > maxWidth) return out + '\u2026'
    w += cw
    out += ch
  }
  return s
}

const STATUS_LABEL: Record<DagNodeStatus, string> = {
  mastered: '已掌握',
  current: '当前',
  needs_review: '需复习',
  skipped: '跳过',
  locked: '未解锁',
}

/* ============================================================================
 * Component
 * ==========================================================================*/

export function DagGraph({
  nodes,
  edges,
  currentNodeId = null,
  activeNode,
  onSelect,
}: Props) {
  // Resolve selection: prefer new prop, fall back to legacy, then is_current.
  const selectedId = currentNodeId ?? activeNode ?? null

  const layout = useMemo(() => {
    const normalized = nodes.map(normalizeNode)
    const derived = deriveEdges(nodes, edges)
    return computeLayout(normalized, derived)
  }, [nodes, edges])

  if (layout.nodes.length === 0) {
    return (
      <nav aria-label="概念依赖图" className="dag-graph-wrap">
        <p className="empty-state">加载中</p>
      </nav>
    )
  }

  return (
    <nav aria-label="概念依赖图" className="dag-graph-wrap">
      <svg
        className="dag-graph"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="概念依赖图谱"
      >
        <defs>
          {/* ---- self-contained manuscript styling ------------------------ */}
          <style>{`
            .dag-graph {
              display: block;
              width: 100%;
              height: auto;
              font-family: var(--font-display);
              overflow: visible;
            }

            /* level guides */
            .dag-level-line {
              stroke: var(--border);
              stroke-width: 1;
              stroke-dasharray: 2 5;
              opacity: 0.45;
            }
            .dag-level-label {
              font-family: var(--font-mono);
              font-size: 10px;
              fill: var(--muted);
              letter-spacing: 0.1em;
            }

            /* edges — colored by the target node's status */
            .dag-edge { fill: none; transition: stroke 0.2s ease, opacity 0.2s ease; }
            .dag-edge.to-mastered { stroke: var(--accent); stroke-width: 1.6; opacity: 0.6; }
            .dag-edge.to-current   { stroke: var(--accent); stroke-width: 2.2; opacity: 0.95; }
            .dag-edge.to-needs_review { stroke: var(--warning); stroke-width: 1.6; opacity: 0.7; }
            .dag-edge.to-skipped   { stroke: var(--muted); stroke-width: 1.3; opacity: 0.5; stroke-dasharray: 5 4; }
            .dag-edge.to-locked    { stroke: var(--border-strong); stroke-width: 1.3; opacity: 0.4; }

            /* node groups */
            .dag-node-group { cursor: pointer; }
            .dag-node-group .node-fill { transition: filter 0.18s ease; }
            .dag-node-group .node-stroke { fill: none; }
            .dag-node-group:hover .node-fill { filter: brightness(1.07); }
            .dag-node-group:hover .node-label { fill: var(--accent); }

            /* status fills & strokes */
            .s-mastered .node-fill { fill: var(--accent); }
            .s-mastered .node-stroke { stroke: var(--accent); stroke-width: 2; }
            .s-current .node-fill { fill: var(--surface-elev); }
            .s-current .node-stroke { stroke: var(--accent); stroke-width: 3; }
            .s-locked .node-fill { fill: var(--surface-sunk); }
            .s-locked .node-stroke { stroke: var(--border-strong); stroke-width: 1.4; }
            .s-needs_review .node-fill { fill: var(--warning-soft); }
            .s-needs_review .node-stroke { stroke: var(--warning); stroke-width: 2; }
            .s-skipped .node-fill { fill: var(--surface-sunk); }
            .s-skipped .node-stroke { stroke: var(--muted); stroke-width: 1.4; stroke-dasharray: 5 3; }
            .s-locked { opacity: 0.78; }

            /* selection ring (click-selected node) */
            .node-select-ring {
              fill: none;
              stroke: var(--ink);
              stroke-width: 2;
              opacity: 0.85;
            }

            /* milestone inner mark */
            .milestone-ring {
              fill: none;
              stroke: var(--ink);
              stroke-width: 1.4;
              opacity: 0.8;
            }

            /* skipped strikethrough */
            .node-strike {
              stroke: var(--muted);
              stroke-width: 2;
              stroke-linecap: round;
              opacity: 0.85;
            }

            /* mastery progress arc */
            .mastery-track {
              fill: none;
              stroke: var(--border);
              stroke-width: 2;
              opacity: 0.55;
            }
            .mastery-fill {
              fill: none;
              stroke: var(--accent);
              stroke-width: 2;
              stroke-linecap: round;
              transition: stroke-dasharray 0.5s ease;
            }

            /* current-node pulsing halo */
            .dag-halo {
              fill: none;
              stroke: var(--accent);
              stroke-width: 2;
            }
            .dag-halo-pulse {
              transform-box: fill-box;
              transform-origin: center;
              animation: dagHaloPulse 1.8s ease-out infinite;
            }
            @keyframes dagHaloPulse {
              0%   { opacity: 0.55; transform: scale(1); }
              100% { opacity: 0;    transform: scale(1.7); }
            }

            /* node labels */
            .node-label {
              font-family: var(--font-display);
              font-size: 13px;
              font-variation-settings: 'opsz' 14;
              fill: var(--ink-2);
              text-anchor: middle;
              pointer-events: none;
            }
            .node-label.milestone { font-weight: 600; fill: var(--ink); }
            .node-label.locked { fill: var(--muted); }
            .node-meta {
              font-family: var(--font-mono);
              font-size: 9px;
              fill: var(--muted);
              text-anchor: middle;
              letter-spacing: 0.04em;
              pointer-events: none;
            }

            /* legend */
            .dag-legend {
              display: flex;
              flex-wrap: wrap;
              gap: 6px 14px;
              margin-top: 10px;
              padding: 0 4px;
              font-family: var(--font-body);
              font-size: 11px;
              color: var(--muted);
            }
            .dag-legend-item { display: inline-flex; align-items: center; gap: 5px; }
            .dag-legend-item .sw {
              width: 11px; height: 11px; border-radius: 50%;
              display: inline-block; border: 1.5px solid transparent;
            }
            .sw.mastered { background: var(--accent); }
            .sw.current  { background: var(--surface-elev); border-color: var(--accent); border-width: 2.5px; }
            .sw.review   { background: var(--warning-soft); border-color: var(--warning); }
            .sw.skipped  { background: var(--surface-sunk); border-color: var(--muted); border-style: dashed; }
            .sw.locked   { background: var(--surface-sunk); border-color: var(--border-strong); opacity: 0.6; }

            @media (prefers-reduced-motion: reduce) {
              .dag-halo-pulse { animation: none; }
            }
          `}</style>

          {/* arrowheads — one per edge color family */}
          <marker
            id="dag-arrow-accent"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--accent)' }} />
          </marker>
          <marker
            id="dag-arrow-warning"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--warning)' }} />
          </marker>
          <marker
            id="dag-arrow-muted"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--border-strong)' }} />
          </marker>
        </defs>

        {/* ---------- level guides ---------- */}
        {layout.levels.map((lv) => (
          <g key={`lvl-${lv.level}`}>
            <line
              className="dag-level-line"
              x1={LEFT_PAD - 8}
              y1={lv.y}
              x2={layout.width - RIGHT_PAD + 8}
              y2={lv.y}
            />
            <text
              className="dag-level-label"
              x={LEFT_PAD - 22}
              y={lv.y + 3}
              textAnchor="end"
            >
              L{lv.level}
            </text>
          </g>
        ))}

        {/* ---------- edges (drawn before nodes so nodes sit on top) ---------- */}
        {layout.edges.map((e) => {
          const cls = `dag-edge to-${e.targetStatus}`
          const marker =
            e.targetStatus === 'mastered' || e.targetStatus === 'current'
              ? 'url(#dag-arrow-accent)'
              : e.targetStatus === 'needs_review'
                ? 'url(#dag-arrow-warning)'
                : 'url(#dag-arrow-muted)'
          return (
            <path
              key={e.key}
              className={cls}
              d={edgePath(e.x1, e.y1, e.x2, e.y2, e.r1, e.r2)}
              markerEnd={marker}
            />
          )
        })}

        {/* ---------- nodes ---------- */}
        {layout.nodes.map((n) => {
          const isSelected = n.id === selectedId
          const showMastery =
            n.mastery > 0.01 && n.status !== 'mastered'
          const ringR = n.r + 5
          const circ = 2 * Math.PI * ringR
          const dash = Math.min(1, Math.max(0, n.mastery)) * circ
          const statusKey = n.status

          return (
            <g
              key={n.id}
              className={`dag-node-group s-${statusKey} ${n.is_milestone ? 'is-milestone' : ''} ${isSelected ? 'is-selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${n.name} — ${STATUS_LABEL[statusKey]}`}
              onClick={() => onSelect(n.id)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  onSelect(n.id)
                }
              }}
            >
              <title>
                {`${n.name}\n${n.description}\n状态: ${STATUS_LABEL[statusKey]} · 掌握度: ${(n.mastery * 100).toFixed(0)}% · 难度: ${(n.difficulty * 100).toFixed(0)}% · L${n.abstraction_level}`}
              </title>

              {/* pulsing halo for the current node */}
              {statusKey === 'current' && (
                <circle
                  className="dag-halo dag-halo-pulse"
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                />
              )}

              {/* selection ring */}
              {isSelected && (
                <circle
                  className="node-select-ring"
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 6}
                />
              )}

              {/* mastery progress arc */}
              {showMastery && (
                <>
                  <circle
                    className="mastery-track"
                    cx={n.x}
                    cy={n.y}
                    r={ringR}
                    transform={`rotate(-90 ${n.x} ${n.y})`}
                  />
                  <circle
                    className="mastery-fill"
                    cx={n.x}
                    cy={n.y}
                    r={ringR}
                    strokeDasharray={`${dash} ${circ}`}
                    transform={`rotate(-90 ${n.x} ${n.y})`}
                  />
                </>
              )}

              {/* node body */}
              <circle className="node-fill" cx={n.x} cy={n.y} r={n.r} />
              <circle className="node-stroke" cx={n.x} cy={n.y} r={n.r} />

              {/* milestone inner mark */}
              {n.is_milestone && (
                <circle
                  className="milestone-ring"
                  cx={n.x}
                  cy={n.y}
                  r={n.r - 9}
                />
              )}

              {/* skipped strikethrough */}
              {statusKey === 'skipped' && (
                <line
                  className="node-strike"
                  x1={n.x - n.r * 0.7}
                  y1={n.y - n.r * 0.7}
                  x2={n.x + n.r * 0.7}
                  y2={n.y + n.r * 0.7}
                />
              )}

              {/* label + meta */}
              <text
                className={`node-label ${n.is_milestone ? 'milestone' : ''} ${statusKey === 'locked' ? 'locked' : ''}`}
                x={n.x}
                y={n.y + n.r + 18}
              >
                {truncateLabel(n.name, 14)}
              </text>
              <text className="node-meta" x={n.x} y={n.y + n.r + 32}>
                {`L${n.abstraction_level} · ${(n.difficulty * 100).toFixed(0)}%`}
              </text>
            </g>
          )
        })}
      </svg>

      {/* ---------- legend ---------- */}
      <div className="dag-legend">
        <span className="dag-legend-item"><i className="sw mastered" />已掌握</span>
        <span className="dag-legend-item"><i className="sw current" />当前</span>
        <span className="dag-legend-item"><i className="sw review" />需复习</span>
        <span className="dag-legend-item"><i className="sw skipped" />跳过</span>
        <span className="dag-legend-item"><i className="sw locked" />未解锁</span>
      </div>
    </nav>
  )
}

export default DagGraph
