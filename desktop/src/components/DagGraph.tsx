/**
 * DagGraph.tsx
 * SVG-based Directed Acyclic Graph visualization for the MathWeaver concept map.
 *
 * Nodes are positioned by abstraction_level on the Y-axis (foundational at bottom,
 * advanced at top) and spread horizontally within each level.
 * Edges are drawn as curved cubic-bezier paths with arrowheads.
 * Nodes are color-coded by learning status, sized by milestone flag.
 *
 * Features:
 * - Horizontal scroll when graph exceeds container width
 * - Zoom controls (buttons + wheel)
 * - Drag-to-pan when zoomed in
 * - Fit-to-width default view
 */

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export type DagNodeStatus = 'mastered' | 'needs_review' | 'skipped' | 'current' | 'locked'

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

export interface DagEdge {
  source: string
  target: string
}

export interface LegacyDagNode {
  id: string
  name: string
  description?: string
  prerequisites?: string[]
  abstraction_level: number
  difficulty: number
  is_milestone: boolean
  mastery?: number
  status?: DagNodeStatus
  is_current?: boolean
  domain?: string
}

type AnyDagNode = DagNode | LegacyDagNode

interface Props {
  nodes: AnyDagNode[]
  edges?: DagEdge[]
  currentNodeId?: string | null
  activeNode?: string
  onSelect: (nodeId: string) => void
}

const NODE_R = 22
const MILESTONE_R = 30
const H_SPACING = 120
const V_SPACING = 120
const TOP_PAD = 50
const BOTTOM_PAD = 56  // accounts for node radius + label + meta text below last row
const LEFT_PAD = 56
const RIGHT_PAD = 28
const MIN_INNER_W = 280

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
  const byLevel = new Map<number, DagNode[]>()
  for (const n of allNodes) {
    const lvl = n.abstraction_level
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(n)
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b)

  const maxCount = Math.max(1, ...levels.map((l) => byLevel.get(l)!.length))
  const innerW = Math.max(MIN_INNER_W, (maxCount - 1) * H_SPACING)
  const width = LEFT_PAD + innerW + RIGHT_PAD
  const height = TOP_PAD + BOTTOM_PAD + Math.max(0, levels.length - 1) * V_SPACING

  const posById = new Map<string, PositionedNode>()
  const positioned: PositionedNode[] = []
  const levelMeta: LevelMeta[] = []

  levels.forEach((lvl, idx) => {
    const group = byLevel.get(lvl)!
    const y = TOP_PAD + (levels.length - 1 - idx) * V_SPACING
    levelMeta.push({ level: lvl, y })
    const span = (group.length - 1) * H_SPACING
    const startX = LEFT_PAD + (innerW - span) / 2
    group.forEach((n, i) => {
      const r = n.is_milestone ? MILESTONE_R : NODE_R
      const pn: PositionedNode = { ...n, x: startX + i * H_SPACING, y, r }
      posById.set(n.id, pn)
      positioned.push(pn)
    })
  })

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

function edgePath(x1: number, y1: number, x2: number, y2: number, r1: number, r2: number): string {
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
  return `M ${sx} ${sy} C ${sx} ${midY} ${tx} ${midY} ${tx} ${ty}`
}

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

const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.2

export function DagGraph({ nodes, edges, currentNodeId = null, activeNode, onSelect }: Props) {
  const selectedId = currentNodeId ?? activeNode ?? null

  const layout = useMemo(() => {
    const normalized = nodes.map(normalizeNode)
    const derived = deriveEdges(nodes, edges)
    return computeLayout(normalized, derived)
  }, [nodes, edges])

  // Zoom & pan state
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)

  // Touch: track active pointers for pinch-to-zoom
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStartDistRef = useRef<number>(0)
  const pinchStartZoomRef = useRef<number>(1)

  // Measure container width for fit-to-width calculation
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const measure = () => setContainerW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Compute the fit-to-width zoom (graph fits container width at zoom=1 → scale down)
  const fitZoom = useMemo(() => {
    if (containerW === 0 || layout.width === 0) return 1
    return Math.min(1, containerW / layout.width)
  }, [containerW, layout.width])

  // Effective zoom = user zoom × fitZoom (so zoom=1 means "fit to width")
  const effectiveZoom = zoom * fitZoom

  const svgWidth = layout.width * effectiveZoom
  const svgHeight = layout.height * effectiveZoom

  // Reset view when nodes change
  useEffect(() => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }, [nodes])

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
  }, [])

  const handleReset = useCallback(() => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
  }, [])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Only zoom when Ctrl/Cmd is held, otherwise let the page scroll
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)))
    },
    []
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Track pointer for pinch-to-zoom
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointersRef.current.size === 2) {
        // Start pinch-to-zoom
        const pts = [...pointersRef.current.values()]
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        pinchStartDistRef.current = dist
        pinchStartZoomRef.current = zoom
        setIsDragging(false)
        dragStart.current = null
        return
      }

      // Single pointer: drag-pan (allow always on touch, only when zoomed on mouse)
      if (e.pointerType === 'touch' || effectiveZoom > fitZoom * 1.01 || panX !== 0 || panY !== 0) {
        setIsDragging(true)
        dragStart.current = { x: e.clientX, y: e.clientY, panX, panY }
      }
    },
    [effectiveZoom, fitZoom, panX, panY, zoom]
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Update tracked pointer position
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      }

      // Pinch-to-zoom
      if (pointersRef.current.size === 2 && pinchStartDistRef.current > 0) {
        const pts = [...pointersRef.current.values()]
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const scale = dist / pinchStartDistRef.current
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoomRef.current * scale))
        setZoom(newZoom)
        return
      }

      // Single-pointer drag-pan
      if (!isDragging || !dragStart.current) return
      e.preventDefault()
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setPanX(dragStart.current.panX + dx)
      setPanY(dragStart.current.panY + dy)
    },
    [isDragging]
  )

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size < 2) {
        pinchStartDistRef.current = 0
      }
      if (pointersRef.current.size === 0) {
        setIsDragging(false)
        dragStart.current = null
      }
    },
    []
  )

  if (layout.nodes.length === 0) {
    return (
      <nav aria-label="概念依赖图" className="dag-graph-wrap">
        <p style={{ color: 'var(--muted)', fontSize: '12px', padding: '8px' }}>加载中</p>
      </nav>
    )
  }

  const zoomPct = Math.round(effectiveZoom / fitZoom * 100)

  return (
    <nav aria-label="概念依赖图" className="dag-graph-wrap">
      {/* Zoom toolbar */}
      <div className="dag-toolbar">
        <button
          className="dag-zoom-btn"
          onClick={handleZoomOut}
          disabled={zoom <= MIN_ZOOM}
          aria-label="缩小"
          title="缩小"
        >
          {'\u2212'}
        </button>
        <span className="dag-zoom-label">{zoomPct}%</span>
        <button
          className="dag-zoom-btn"
          onClick={handleZoomIn}
          disabled={zoom >= MAX_ZOOM}
          aria-label="放大"
          title="放大"
        >
          {'\u002B'}
        </button>
        <button
          className="dag-zoom-btn dag-zoom-reset"
          onClick={handleReset}
          aria-label="重置视图"
          title="重置视图 (适配宽度)"
        >
          {'1:1'}
        </button>
        <span className="dag-zoom-hint">Ctrl + 滚轮缩放</span>
      </div>

      {/* Scrollable graph container */}
      <div
        ref={containerRef}
        className="dag-scroll-container"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: isDragging ? 'grabbing' : (effectiveZoom > fitZoom ? 'grab' : 'default'),
          touchAction: 'none',
        }}
      >
      <svg
        className="dag-graph"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={svgWidth}
        height={svgHeight}
        style={{
          transform: `translate(${panX}px, ${panY}px)`,
          flexShrink: 0,
        }}
        role="img"
        aria-label="概念依赖图谱"
      >
        <defs>
          <style>{`
            .dag-scroll-container .dag-graph {
              display: block;
              font-family: var(--serif);
              overflow: visible;
            }

            .dag-level-line {
              stroke: var(--border);
              stroke-width: 1;
              stroke-dasharray: 2 5;
              opacity: 0.4;
            }
            .dag-level-label {
              font-family: var(--mono);
              font-size: 10px;
              fill: var(--muted);
              letter-spacing: 0.1em;
            }

            .dag-edge { fill: none; transition: stroke 0.2s ease, opacity 0.2s ease; }
            .dag-edge.to-mastered { stroke: var(--accent); stroke-width: 1.6; opacity: 0.6; }
            .dag-edge.to-current   { stroke: var(--accent); stroke-width: 2.2; opacity: 0.95; }
            .dag-edge.to-needs_review { stroke: var(--warn); stroke-width: 1.6; opacity: 0.7; }
            .dag-edge.to-skipped   { stroke: var(--muted); stroke-width: 1.3; opacity: 0.5; stroke-dasharray: 5 4; }
            .dag-edge.to-locked    { stroke: var(--border); stroke-width: 1.3; opacity: 0.4; }

            .dag-node-group { cursor: pointer; }
            .dag-node-group .node-fill { transition: filter 0.18s ease; }
            .dag-node-group .node-stroke { fill: none; }
            .dag-node-group:hover .node-fill { filter: brightness(1.15); }
            .dag-node-group:hover .node-label { fill: var(--accent); }

            .s-mastered .node-fill { fill: var(--accent); }
            .s-mastered .node-stroke { stroke: var(--accent); stroke-width: 2; }
            .s-current .node-fill { fill: var(--bg2); }
            .s-current .node-stroke { stroke: var(--accent); stroke-width: 3; }
            .s-locked .node-fill { fill: var(--bg3); }
            .s-locked .node-stroke { stroke: var(--border); stroke-width: 1.4; }
            .s-needs_review .node-fill { fill: rgba(229, 192, 123, 0.15); }
            .s-needs_review .node-stroke { stroke: var(--warn); stroke-width: 2; }
            .s-skipped .node-fill { fill: var(--bg3); }
            .s-skipped .node-stroke { stroke: var(--muted); stroke-width: 1.4; stroke-dasharray: 5 3; }
            .s-locked { opacity: 0.78; }

            .node-select-ring {
              fill: none;
              stroke: var(--ink);
              stroke-width: 2;
              opacity: 0.85;
            }

            .milestone-ring {
              fill: none;
              stroke: var(--ink);
              stroke-width: 1.4;
              opacity: 0.8;
            }

            .node-strike {
              stroke: var(--muted);
              stroke-width: 2;
              stroke-linecap: round;
              opacity: 0.85;
            }

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

            .node-label {
              font-family: var(--serif);
              font-size: 13px;
              fill: var(--ink);
              text-anchor: middle;
              pointer-events: none;
            }
            .node-label.milestone { font-weight: 600; fill: var(--ink); }
            .node-label.locked { fill: var(--muted); }
            .node-meta {
              font-family: var(--mono);
              font-size: 9px;
              fill: var(--muted);
              text-anchor: middle;
              letter-spacing: 0.04em;
              pointer-events: none;
            }

            .dag-legend {
              display: flex;
              flex-wrap: wrap;
              gap: 6px 14px;
              margin-top: 10px;
              padding: 0 4px;
              font-family: var(--serif);
              font-size: 11px;
              color: var(--muted);
            }
            .dag-legend-item { display: inline-flex; align-items: center; gap: 5px; }
            .dag-legend-item .sw {
              width: 11px; height: 11px; border-radius: 50%;
              display: inline-block; border: 1.5px solid transparent;
            }
            .sw.mastered { background: var(--accent); }
            .sw.current  { background: var(--bg2); border-color: var(--accent); border-width: 2.5px; }
            .sw.review   { background: rgba(229, 192, 123, 0.15); border-color: var(--warn); }
            .sw.skipped  { background: var(--bg3); border-color: var(--muted); border-style: dashed; }
            .sw.locked   { background: var(--bg3); border-color: var(--border); opacity: 0.6; }

            @media (prefers-reduced-motion: reduce) {
              .dag-halo-pulse { animation: none; }
            }
          `}</style>

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
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--warn)' }} />
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
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--border)' }} />
          </marker>
        </defs>

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

        {layout.nodes.map((n) => {
          const isSelected = n.id === selectedId
          const showMastery = n.mastery > 0.01 && n.status !== 'mastered'
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

              {statusKey === 'current' && (
                <circle
                  className="dag-halo dag-halo-pulse"
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                />
              )}

              {isSelected && (
                <circle
                  className="node-select-ring"
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 6}
                />
              )}

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

              <circle className="node-fill" cx={n.x} cy={n.y} r={n.r} />
              <circle className="node-stroke" cx={n.x} cy={n.y} r={n.r} />

              {n.is_milestone && (
                <circle
                  className="milestone-ring"
                  cx={n.x}
                  cy={n.y}
                  r={n.r - 9}
                />
              )}

              {statusKey === 'skipped' && (
                <line
                  className="node-strike"
                  x1={n.x - n.r * 0.7}
                  y1={n.y - n.r * 0.7}
                  x2={n.x + n.r * 0.7}
                  y2={n.y + n.r * 0.7}
                />
              )}

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
      </div>{/* /dag-scroll-container */}

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
