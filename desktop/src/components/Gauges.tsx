import { memo, useState, useRef, useEffect } from 'react'

/**
 * SVG visualization components for the four-field state model.
 *
 * Gauges make the invisible cognitive/emotional state of the student
 * visible at a glance — and interactive on hover.
 *
 * Color logic follows the dark theme palette:
 * - Low/good values: accent (purple)
 * - Medium: warn (yellow)
 * - High/bad: err (red)
 *
 * Each gauge supports:
 * - Hover tooltips with metric interpretation
 * - ARIA labels for screen readers
 * - Smooth animated transitions
 * - Keyboard focus for accessibility
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface MetricInfo {
  /** Human-readable interpretation of the current value */
  interpretation: string
  /** Suggestion or action to take */
  suggestion?: string
  /** Unit suffix, e.g. '%' or 'ms' */
  unit?: string
}

// ---------------------------------------------------------------------------
// Tooltip primitive — positioned absolutely within gauge wrapper
// ---------------------------------------------------------------------------

interface TooltipProps {
  visible: boolean
  x: number
  y: number
  title: string
  lines: string[]
  accentColor?: string
}

function GaugeTooltip({ visible, x, y, title, lines, accentColor }: TooltipProps) {
  if (!visible) return null
  return (
    <div
      className="gauge-tooltip"
      role="tooltip"
      style={{
        left: x,
        top: y,
        borderColor: accentColor || 'var(--accent)',
      }}
    >
      <div className="gauge-tooltip-title">{title}</div>
      {lines.map((line, i) => (
        <div key={i} className="gauge-tooltip-line">
          {line}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RadialGauge — a circular arc gauge for a single 0-1 metric
// ---------------------------------------------------------------------------

interface RadialGaugeProps {
  value: number
  label: string
  sublabel?: string
  invert?: boolean // when true, lower is worse (e.g., flow_score)
  size?: number
  /** Optional metric info for tooltip */
  metricInfo?: MetricInfo
  /** Historical values for mini sparkline [0..1] */
  history?: number[]
}

function bandColor(value: number, invert: boolean): string {
  const v = invert ? 1 - value : value
  if (v < 0.4) return 'var(--accent)'
  if (v < 0.7) return 'var(--warn)'
  return 'var(--err)'
}

function bandLabel(value: number, invert: boolean): string {
  const v = invert ? 1 - value : value
  if (v < 0.4) return '良好'
  if (v < 0.7) return '注意'
  return '警戒'
}

function RadialGaugeImpl({
  value,
  label,
  sublabel,
  invert,
  size = 80,
  metricInfo,
  history = [],
}: RadialGaugeProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [prevValue, setPrevValue] = useState(value)
  const [pulsing, setPulsing] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Detect significant value change for pulse animation
  useEffect(() => {
    if (Math.abs(value - prevValue) > 0.1) {
      setPulsing(true)
      const t = setTimeout(() => setPulsing(false), 1000)
      return () => clearTimeout(t)
    }
    setPrevValue(value)
    return undefined
  }, [value, prevValue])

  const clamped = Math.max(0, Math.min(1, value))
  const radius = size * 0.35
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  const arcFraction = 0.75
  const dashLength = circumference * arcFraction
  const filled = dashLength * clamped
  const color = bandColor(clamped, invert ?? false)
  const band = bandLabel(clamped, invert ?? false)
  const showActive = hovered || focused

  // Sparkline points
  const sparkPoints =
    history.length > 1
      ? history
          .map((h, i) => {
            const sx = (i / (history.length - 1)) * (size * 0.6) + size * 0.2
            const sy = size * 0.82 - h * size * 0.12
            return `${sx},${sy}`
          })
          .join(' ')
      : null

  const tooltipLines: string[] = [
    `数值: ${Math.round(clamped * 100)}${metricInfo?.unit || '%'}`,
    `区间: ${band}`,
  ]
  if (metricInfo?.interpretation) tooltipLines.push(metricInfo.interpretation)
  if (metricInfo?.suggestion) tooltipLines.push(`建议: ${metricInfo.suggestion}`)

  return (
    <div
      ref={wrapRef}
      className={`gauge-wrap ${showActive ? 'gauge-active' : ''} ${pulsing ? 'gauge-pulse' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      tabIndex={0}
      role="img"
      aria-label={`${label}: ${Math.round(clamped * 100)}%, ${band}`}
      aria-describedby={showActive ? `gauge-tip-${label}` : undefined}
    >
      <svg width={size} height={size * 0.9} viewBox={`0 0 ${size} ${size * 0.9}`}>
        {/* Background arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--bg3)"
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
          style={{
            transition: 'stroke-dasharray 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease',
            filter: showActive ? `drop-shadow(0 0 6px ${color})` : 'none',
          }}
        />
        {/* Tick marks at 0%, 50%, 100% */}
        {[0, 0.5, 1].map(tick => {
          const angle = 135 + 270 * tick * arcFraction
          const rad = (angle * Math.PI) / 180
          const inner = radius - size * 0.05
          const outer = radius + size * 0.05
          return (
            <line
              key={tick}
              x1={cx + inner * Math.cos(rad)}
              y1={cy + inner * Math.sin(rad)}
              x2={cx + outer * Math.cos(rad)}
              y2={cy + outer * Math.sin(rad)}
              stroke="var(--border)"
              strokeWidth={0.5}
              opacity={showActive ? 0.8 : 0.3}
            />
          )
        })}
        {/* Value text */}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="gauge-value"
          style={{
            fontSize: size * 0.18,
            fontWeight: 600,
            fill: showActive ? color : 'var(--ink)',
            transition: 'fill 0.2s ease',
          }}
        >
          {Math.round(clamped * 100)}
        </text>
        {/* Mini sparkline below value */}
        {sparkPoints && showActive && (
          <polyline points={sparkPoints} fill="none" stroke={color} strokeWidth={1} opacity={0.6} />
        )}
      </svg>
      <span
        className="gauge-label"
        style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: showActive ? 'var(--ink)' : 'var(--ink)',
          transition: 'color 0.2s',
        }}
      >
        {label}
      </span>
      {sublabel && (
        <span
          className="gauge-sublabel"
          style={{
            fontSize: '0.65rem',
            color: showActive ? color : 'var(--muted)',
            transition: 'color 0.2s',
          }}
        >
          {sublabel || band}
        </span>
      )}
      {!sublabel && (
        <span
          className="gauge-sublabel"
          style={{
            fontSize: '0.6rem',
            color,
            opacity: showActive ? 1 : 0.5,
            transition: 'opacity 0.2s',
          }}
        >
          {band}
        </span>
      )}
      <GaugeTooltip
        visible={showActive}
        x={size / 2}
        y={-8}
        title={label}
        lines={tooltipLines}
        accentColor={color}
      />
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
  /** Optional description for tooltip */
  description?: string
}

interface MasteryRadarProps {
  dimensions: RadarDimension[]
  overall: number
  size?: number
}

function MasteryRadarImpl({ dimensions, overall, size = 180 }: MasteryRadarProps) {
  const [hoveredDim, setHoveredDim] = useState<number | null>(null)
  const cx = size / 2
  const cy = size / 2
  const maxRadius = size * 0.38
  const n = dimensions.length
  const angleStep = (2 * Math.PI) / n
  const startAngle = -Math.PI / 2

  // Expand viewBox to give room for labels outside the grid
  const labelPad = Math.round(size * 0.08)
  const vbSize = size + labelPad * 2

  const gridLevels = [0.25, 0.5, 0.75, 1.0]
  const gridPolygons = gridLevels.map(level => {
    const pts = dimensions
      .map((_, i) => {
        const angle = startAngle + i * angleStep
        const r = maxRadius * level
        return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`
      })
      .join(' ')
    return pts
  })

  const dataPoints = dimensions.map((dim, i) => {
    const angle = startAngle + i * angleStep
    const r = maxRadius * Math.max(0, Math.min(1, dim.value))
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      angle,
      r,
    }
  })

  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ')

  const labels = dimensions.map((dim, i) => {
    const angle = startAngle + i * angleStep
    const labelR = maxRadius + size * 0.08
    return {
      x: cx + labelR * Math.cos(angle),
      y: cy + labelR * Math.sin(angle),
      text: dim.label,
      angle,
    }
  })

  // Tooltip for hovered dimension
  const hoveredData = hoveredDim !== null ? dimensions[hoveredDim] : null
  const hoveredPoint = hoveredDim !== null ? dataPoints[hoveredDim] : null

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg
        width={vbSize}
        height={vbSize}
        viewBox={`${-labelPad} ${-labelPad} ${vbSize} ${vbSize}`}
        role="img"
        aria-label={`能力雷达图，总评 ${Math.round(overall * 100)}%`}
      >
        {/* Grid polygons */}
        {gridPolygons.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill="none"
            stroke="var(--bg3)"
            strokeWidth={0.5}
            strokeDasharray={i === gridPolygons.length - 1 ? 'none' : '2 2'}
            opacity={hoveredDim !== null ? 0.3 : 1}
            style={{ transition: 'opacity 0.2s' }}
          />
        ))}
        {/* Axis lines */}
        {dimensions.map((_, i) => {
          const angle = startAngle + i * angleStep
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + maxRadius * Math.cos(angle)}
              y2={cy + maxRadius * Math.sin(angle)}
              stroke={hoveredDim === i ? 'var(--accent)' : 'var(--bg3)'}
              strokeWidth={hoveredDim === i ? 1 : 0.5}
              style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
            />
          )
        })}
        {/* Data polygon */}
        <polygon
          points={dataPolygon}
          fill="var(--accent)"
          fillOpacity={hoveredDim !== null ? 0.08 : 0.15}
          stroke="var(--accent)"
          strokeWidth={1.5}
          style={{ transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
        {/* Data points */}
        {dataPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoveredDim === i ? 5 : 2.5}
            fill="var(--accent)"
            stroke={hoveredDim === i ? 'var(--ink)' : 'none'}
            strokeWidth={1}
            style={{ transition: 'r 0.2s, stroke 0.2s', cursor: 'pointer' }}
            onMouseEnter={() => setHoveredDim(i)}
            onMouseLeave={() => setHoveredDim(null)}
          />
        ))}
        {/* Dim other vertices when one is hovered */}
        {dataPoints.map((p, i) =>
          hoveredDim !== null && hoveredDim !== i ? (
            <circle
              key={`dim-${i}`}
              cx={p.x}
              cy={p.y}
              r={2.5}
              fill="var(--accent)"
              opacity={0.25}
            />
          ) : null,
        )}
        {/* Labels */}
        {labels.map((lbl, i) => (
          <text
            key={i}
            x={lbl.x}
            y={lbl.y}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontSize: '0.6rem',
              fill: hoveredDim === i ? 'var(--accent)' : 'var(--muted)',
              fontFamily: 'var(--serif)',
              fontWeight: hoveredDim === i ? 600 : 400,
              transition: 'fill 0.2s, font-weight 0.2s',
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHoveredDim(i)}
            onMouseLeave={() => setHoveredDim(null)}
          >
            {lbl.text}
          </text>
        ))}
        {/* Center overall score */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: '0.75rem', fontWeight: 700, fill: 'var(--ink)' }}
        >
          {Math.round(overall * 100)}
        </text>
        <text
          x={cx}
          y={cy + 8}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: '0.5rem', fill: 'var(--muted)' }}
        >
          总评
        </text>
      </svg>
      {/* Tooltip for hovered dimension */}
      {hoveredData && hoveredPoint && (
        <div
          className="gauge-tooltip"
          style={{
            left: hoveredPoint.x + labelPad,
            top: hoveredPoint.y + labelPad - 10,
            transform: 'translate(-50%, -100%)',
            position: 'absolute',
          }}
        >
          <div className="gauge-tooltip-title">{hoveredData.label}</div>
          <div className="gauge-tooltip-line">得分: {Math.round(hoveredData.value * 100)}%</div>
          {hoveredData.description && (
            <div className="gauge-tooltip-line" style={{ maxWidth: '140px' }}>
              {hoveredData.description}
            </div>
          )}
        </div>
      )}
    </div>
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

const BAND_LABELS: Record<string, string> = {
  warmup: '热身',
  foundation: '基础',
  standard: '标准',
  advanced: '进阶',
  challenge: '挑战',
}

const BAND_THRESHOLDS = [0.2, 0.4, 0.6, 0.8]

function DifficultyGaugeImpl({ current, band, trend, accuracy, size = 180 }: DifficultyGaugeProps) {
  const [hovered, setHovered] = useState(false)
  const barWidth = size * 0.85
  const barHeight = 8
  const barX = (size - barWidth) / 2
  const filled = barWidth * Math.max(0, Math.min(1, current))
  const bandLabel = BAND_LABELS[band] || band

  const trendArrow = trend === 'rising' ? '\u2191' : trend === 'falling' ? '\u2193' : '\u2192'
  const trendColor =
    trend === 'rising' ? 'var(--warn)' : trend === 'falling' ? 'var(--ok)' : 'var(--muted)'

  // Current position indicator
  const indicatorX = barX + filled

  const tooltipLines = [
    `难度: ${bandLabel} (${Math.round(current * 100)}%)`,
    `趋势: ${trend === 'rising' ? '上升' : trend === 'falling' ? '下降' : '稳定'}`,
    `准确率: ${Math.round(accuracy * 100)}%`,
  ]
  if (accuracy < 0.4) tooltipLines.push('准确率较低，考虑降低难度')
  if (accuracy > 0.85 && trend !== 'rising') tooltipLines.push('表现优秀，可以提升难度')

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      role="img"
      aria-label={`难度: ${bandLabel}, ${Math.round(current * 100)}%, 趋势${trend}, 准确率${Math.round(accuracy * 100)}%`}
    >
      <svg width={size} height={56} viewBox={`0 0 ${size} 56`}>
        {/* Band zone backgrounds */}
        {BAND_THRESHOLDS.map((thresh, i) => {
          const prev = i === 0 ? 0 : BAND_THRESHOLDS[i - 1]
          const x1 = barX + barWidth * prev
          const w = barWidth * (thresh - prev)
          const colors = [
            'rgba(152,195,121,0.06)',
            'rgba(198,120,221,0.06)',
            'rgba(229,192,123,0.06)',
            'rgba(224,108,117,0.06)',
          ]
          return (
            <rect
              key={i}
              x={x1}
              y={8}
              width={w}
              height={barHeight}
              fill={colors[i]}
              rx={i === 0 ? barHeight / 2 : 0}
            />
          )
        })}
        {/* Last zone */}
        <rect
          x={barX + barWidth * BAND_THRESHOLDS[3]}
          y={8}
          width={barWidth * (1 - BAND_THRESHOLDS[3])}
          height={barHeight}
          fill="rgba(224,108,117,0.08)"
          rx={0}
        />
        {/* Track background */}
        <rect
          x={barX}
          y={8}
          width={barWidth}
          height={barHeight}
          fill="none"
          stroke="var(--border)"
          strokeWidth={0.5}
          rx={barHeight / 2}
        />
        {/* Filled portion */}
        <rect
          x={barX}
          y={8}
          width={filled}
          height={barHeight}
          rx={barHeight / 2}
          fill="var(--accent)"
          style={{ transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
        {/* Threshold tick marks */}
        {BAND_THRESHOLDS.map((thresh, i) => (
          <line
            key={i}
            x1={barX + barWidth * thresh}
            y1={6}
            x2={barX + barWidth * thresh}
            y2={18}
            stroke="var(--border)"
            strokeWidth={0.8}
            opacity={hovered ? 0.8 : 0.4}
          />
        ))}
        {/* Current position indicator */}
        <circle
          cx={indicatorX}
          cy={12}
          r={hovered ? 5 : 3.5}
          fill="var(--ink)"
          stroke="var(--accent)"
          strokeWidth={1.5}
          style={{ transition: 'r 0.2s, cx 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
        {/* Glow on hover */}
        {hovered && (
          <circle
            cx={indicatorX}
            cy={12}
            r={8}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1}
            opacity={0.3}
          />
        )}
        {/* Trend arrow with animation */}
        <text
          x={size / 2}
          y={36}
          textAnchor="middle"
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            fill: hovered ? trendColor : 'var(--ink)',
            transition: 'fill 0.2s',
          }}
        >
          {bandLabel}{' '}
          <tspan
            fill={trendColor}
            style={{
              display: 'inline-block',
              animation:
                trend === 'rising'
                  ? 'trendBounceUp 1s ease infinite'
                  : trend === 'falling'
                    ? 'trendBounceDown 1s ease infinite'
                    : 'none',
            }}
          >
            {trendArrow}
          </tspan>
          {' \u00b7 准确率 '}
          <tspan
            fill={accuracy < 0.4 ? 'var(--err)' : accuracy > 0.85 ? 'var(--ok)' : 'var(--ink)'}
            fontWeight={700}
          >
            {Math.round(accuracy * 100)}%
          </tspan>
        </text>
        {/* Band labels on hover */}
        {hovered && (
          <g style={{ fontSize: '0.5rem', fill: 'var(--muted)' }}>
            <text x={barX + barWidth * 0.1} y={52} textAnchor="middle">
              热身
            </text>
            <text x={barX + barWidth * 0.3} y={52} textAnchor="middle">
              基础
            </text>
            <text x={barX + barWidth * 0.5} y={52} textAnchor="middle">
              标准
            </text>
            <text x={barX + barWidth * 0.7} y={52} textAnchor="middle">
              进阶
            </text>
            <text x={barX + barWidth * 0.9} y={52} textAnchor="middle">
              挑战
            </text>
          </g>
        )}
      </svg>
      <GaugeTooltip
        visible={hovered}
        x={indicatorX}
        y={0}
        title={`${bandLabel} 难度`}
        lines={tooltipLines}
        accentColor="var(--accent)"
      />
    </div>
  )
}

export const DifficultyGauge = memo(DifficultyGaugeImpl)
