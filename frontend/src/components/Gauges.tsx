import { memo } from 'react'

/**
 * SVG visualization components for the four-field state model.
 *
 * Design principle: gauges are not decoration — they make the invisible
 * cognitive/emotional state of the student visible at a glance.
 *
 * Color logic follows the manuscript palette:
 * - Low/good values: neutral or accent
 * - Medium: warning
 * - High/bad: danger
 */

// ---------------------------------------------------------------------------
// RadialGauge — a circular arc gauge for a single 0-1 metric
// ---------------------------------------------------------------------------

interface RadialGaugeProps {
  value: number
  label: string
  sublabel?: string
  invert?: boolean // when true, lower is worse (e.g., flow_score)
  size?: number
}

function bandColor(value: number, invert: boolean): string {
  const v = invert ? 1 - value : value
  if (v < 0.4) return 'var(--accent)'
  if (v < 0.7) return 'var(--warning, #C8923A)'
  return 'var(--danger, #B04A30)'
}

function RadialGaugeImpl({ value, label, sublabel, invert, size = 80 }: RadialGaugeProps) {
  const clamped = Math.max(0, Math.min(1, value))
  const radius = size * 0.35
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  // Arc from 270° (top) going 3/4 of the circle
  const arcFraction = 0.75
  const dashLength = circumference * arcFraction
  const filled = dashLength * clamped
  const color = bandColor(clamped, invert ?? false)

  return (
    <div className="gauge-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size * 0.9} viewBox={`0 0 ${size} ${size * 0.9}`}>
        {/* Background arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--surface-sunk, #D5CFC0)"
          strokeWidth={size * 0.06}
          strokeDasharray={`${dashLength} ${circumference}`}
          strokeDashoffset={circumference * 0.125}
          strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cy})`}
        />
        {/* Filled arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={size * 0.06}
          strokeDasharray={`${filled} ${circumference}`}
          strokeDashoffset={circumference * 0.125}
          strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        {/* Value text */}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="gauge-value"
          style={{ fontSize: size * 0.18, fontWeight: 600, fill: 'var(--ink, #181715)' }}
        >
          {Math.round(clamped * 100)}
        </text>
      </svg>
      <span className="gauge-label" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ink, #181715)' }}>
        {label}
      </span>
      {sublabel && (
        <span className="gauge-sublabel" style={{ fontSize: '0.65rem', color: 'var(--ink-soft, #6B6155)' }}>
          {sublabel}
        </span>
      )}
    </div>
  )
}

export const RadialGauge = memo(RadialGaugeImpl)

// ---------------------------------------------------------------------------
// MasteryRadar — a pentagon radar chart for 5-dimensional mastery
// ---------------------------------------------------------------------------

interface RadarDimension {
  label: string
  value: number // 0-1
}

interface MasteryRadarProps {
  dimensions: RadarDimension[]
  overall: number
  size?: number
}

function MasteryRadarImpl({ dimensions, overall, size = 180 }: MasteryRadarProps) {
  const cx = size / 2
  const cy = size / 2
  const maxRadius = size * 0.38
  const n = dimensions.length
  const angleStep = (2 * Math.PI) / n
  const startAngle = -Math.PI / 2 // top

  // Pentagon points for each level (0.25, 0.5, 0.75, 1.0)
  const gridLevels = [0.25, 0.5, 0.75, 1.0]
  const gridPolygons = gridLevels.map(level => {
    const pts = dimensions.map((_, i) => {
      const angle = startAngle + i * angleStep
      const r = maxRadius * level
      return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`
    }).join(' ')
    return pts
  })

  // Data polygon
  const dataPoints = dimensions.map((dim, i) => {
    const angle = startAngle + i * angleStep
    const r = maxRadius * Math.max(0, Math.min(1, dim.value))
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  })
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ')

  // Axis labels
  const labels = dimensions.map((dim, i) => {
    const angle = startAngle + i * angleStep
    const labelR = maxRadius + size * 0.08
    return {
      x: cx + labelR * Math.cos(angle),
      y: cy + labelR * Math.sin(angle),
      text: dim.label,
    }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid polygons */}
      {gridPolygons.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill="none"
          stroke="var(--surface-sunk, #D5CFC0)"
          strokeWidth={0.5}
          strokeDasharray={i === gridPolygons.length - 1 ? 'none' : '2 2'}
        />
      ))}
      {/* Grid spokes */}
      {dimensions.map((_, i) => {
        const angle = startAngle + i * angleStep
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + maxRadius * Math.cos(angle)}
            y2={cy + maxRadius * Math.sin(angle)}
            stroke="var(--surface-sunk, #D5CFC0)"
            strokeWidth={0.5}
          />
        )
      })}
      {/* Data polygon */}
      <polygon
        points={dataPolygon}
        fill="var(--accent, #B04A30)"
        fillOpacity={0.15}
        stroke="var(--accent, #B04A30)"
        strokeWidth={1.5}
        style={{ transition: 'all 0.6s ease' }}
      />
      {/* Data points */}
      {dataPoints.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2.5}
          fill="var(--accent, #B04A30)"
        />
      ))}
      {/* Axis labels */}
      {labels.map((lbl, i) => (
        <text
          key={i}
          x={lbl.x}
          y={lbl.y}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: '0.6rem', fill: 'var(--ink-soft, #6B6155)', fontFamily: 'var(--font-body, sans-serif)' }}
        >
          {lbl.text}
        </text>
      ))}
      {/* Center overall score */}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: '0.75rem', fontWeight: 700, fill: 'var(--ink, #181715)' }}
      >
        {Math.round(overall * 100)}
      </text>
    </svg>
  )
}

export const MasteryRadar = memo(MasteryRadarImpl)

// ---------------------------------------------------------------------------
// DifficultyGauge — horizontal bar showing adaptive difficulty
// ---------------------------------------------------------------------------

interface DifficultyGaugeProps {
  current: number // 0-1
  band: string // warmup/foundation/standard/advanced/challenge
  trend: string // rising/falling/stable
  accuracy: number
  size?: number
}

function DifficultyGaugeImpl({ current, band, trend, accuracy, size = 180 }: DifficultyGaugeProps) {
  const barWidth = size * 0.85
  const barHeight = 8
  const filled = barWidth * Math.max(0, Math.min(1, current))

  const trendArrow = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→'

  return (
    <div className="difficulty-gauge-wrap">
      <svg width={size} height={50} viewBox={`0 0 ${size} 50`}>
        {/* Background bar */}
        <rect
          x={(size - barWidth) / 2}
          y={10}
          width={barWidth}
          height={barHeight}
          rx={barHeight / 2}
          fill="var(--surface-sunk, #D5CFC0)"
        />
        {/* Filled bar */}
        <rect
          x={(size - barWidth) / 2}
          y={10}
          width={filled}
          height={barHeight}
          rx={barHeight / 2}
          fill="var(--accent, #B04A30)"
          style={{ transition: 'width 0.6s ease' }}
        />
        {/* Difficulty band label */}
        <text
          x={size / 2}
          y={35}
          textAnchor="middle"
          style={{ fontSize: '0.7rem', fontWeight: 600, fill: 'var(--ink, #181715)' }}
        >
          {band} {trendArrow} · 准确率 {Math.round(accuracy * 100)}%
        </text>
      </svg>
    </div>
  )
}

export const DifficultyGauge = memo(DifficultyGaugeImpl)
