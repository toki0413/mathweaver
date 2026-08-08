import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react'
import type { AgeLevel } from '../utils/ageAdapt'

// ---------------------------------------------------------------------------
// ModelingLab — 交互式数学建模实验室
//
// 设计理念（借鉴 tiwe0/GeoChat）：
//   1. 画板优先 (Canvas first) — 可视化画布是主工作区，控件框定而非争夺注意力
//   2. 解释数学路径 — 每次参数变化都展示「构造 + 推理 + 参数效应」
//   3. 可验证构造 — 模型从结构化定义生成，而非自由发挥
//   4. 运行快照 (Run Ledger) — 记录参数变化历史，支持回放与对比
//
// 数学建模可视化：
//   - 实时参数滑块 → 即时更新图形
//   - 预测-验证循环 — 先预测再绘图验证
//   - What-if 场景探索 — 对比不同参数集
//   - 模型预设覆盖动力系统、优化、群论可视化
// ---------------------------------------------------------------------------

// ── Types ──────────────────────────────────────────────────────────────────

interface Param {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit?: string
}

interface ModelPreset {
  id: string
  name: string
  nameEn: string
  category: 'dynamics' | 'physics' | 'epidemiology' | 'algebra'
  description: string
  equations: string[]
  params: Param[]
  /** 数值积分：给定参数和状态，返回下一步状态 (RK4) */
  step: (state: number[], params: Record<string, number>, dt: number) => number[]
  /** 初始状态 */
  initialState: (params: Record<string, number>) => number[]
  /** 在画布上渲染 */
  render: (
    ctx: CanvasRenderingContext2D,
    history: number[][],
    params: Record<string, number>,
    w: number,
    h: number,
  ) => void
  /** 解释当前参数状态 */
  explain: (params: Record<string, number>, history: number[][]) => string
  /** 状态变量名 */
  stateNames: string[]
  /** 守恒律验证：返回 { label, drift } 或 null */
  verifyConservation?: (
    history: number[][],
    params: Record<string, number>,
  ) => { label: string; drift: string } | null
}

interface Props {
  ageLevel?: AgeLevel
}

interface HistoryEntry {
  params: Record<string, number>
  timestamp: number
  label: string
}

// ── Simulation Constants ────────────────────────────────────────────────────
// 所有仿真参数集中管理，遵循零魔术数字原则

/** 帧间隔安全上限 [s] — 防止 tab 切换后 dt 过大导致数值发散 */
const DT_FRAME_CAP_S = 0.05
/** 仿真时间加速倍数 — 1 真实秒 = SIM_SPEED_MULTIPLIER 仿真秒 */
const SIM_SPEED_MULTIPLIER = 2
/** 历史缓冲最大长度 — 防止内存无限增长 */
const HISTORY_MAX_LENGTH = 500
/** 浮点等值比较容差 */
const FLOAT_EPSILON = 1e-6
/** Canvas 绘图常量 */
const CANVAS_PADDING = 40
const GRID_STEP_PX = 40
const NODE_RADIUS_PX = 18
const ARROWHEAD_SIZE_PX = 8
/** 画布默认尺寸 */
const CANVAS_WIDTH = 720
const CANVAS_HEIGHT = 480

// ── Numerical Integration (RK4) ────────────────────────────────────────────

function rk4(
  state: number[],
  fn: (s: number[], p: Record<string, number>) => number[],
  params: Record<string, number>,
  dt: number,
): number[] {
  const k1 = fn(state, params)
  const s2 = state.map((v, i) => v + (dt / 2) * k1[i])
  const k2 = fn(s2, params)
  const s3 = state.map((v, i) => v + (dt / 2) * k2[i])
  const k3 = fn(s3, params)
  const s4 = state.map((v, i) => v + dt * k3[i])
  const k4 = fn(s4, params)
  const result = state.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
  // 数值诚实性：检查发散，不掩盖错误
  for (const val of result) {
    if (!Number.isFinite(val)) {
      throw new Error(`RK4 发散: 状态包含 NaN/Infinity (dt=${dt})`)
    }
  }
  return result
}

// ── Color palette ──────────────────────────────────────────────────────────

const COLORS = {
  bg: '#1a1a2e',
  grid: 'rgba(100, 120, 160, 0.12)',
  axis: 'rgba(160, 180, 220, 0.4)',
  text: 'rgba(220, 230, 245, 0.8)',
  textDim: 'rgba(160, 170, 190, 0.5)',
  series: ['#d97757', '#6a9bcc', '#788c5d', '#c4956a', '#9b7bcc', '#5db89e'],
  prediction: 'rgba(217, 119, 87, 0.3)',
  highlight: '#e8c468',
}

// ── Model Presets ──────────────────────────────────────────────────────────

/** LV 平衡点比值阈值 — 高于此值认为猎物占优 */
const LV_EQUILIBRIUM_RATIO_THRESHOLD = 10

const MODELS: ModelPreset[] = [
  // 1. Lotka-Volterra 捕食-被捕食模型
  {
    id: 'lotka-volterra',
    name: '捕食-被捕食模型',
    nameEn: 'Lotka-Volterra',
    category: 'dynamics',
    description: '经典捕食者-猎物动力学，展示种群振荡与生态平衡',
    equations: ['dx/dt = αx - βxy', 'dy/dt = δxy - γy'],
    params: [
      {
        key: 'alpha',
        label: 'α 猎物增长率',
        min: 0.1,
        max: 3,
        step: 0.05,
        default: 1.1,
        unit: '1/yr',
      },
      {
        key: 'beta',
        label: 'β 捕食率',
        min: 0.1,
        max: 3,
        step: 0.05,
        default: 0.4,
        unit: '1/(predator·yr)',
      },
      {
        key: 'gamma',
        label: 'γ 捕食者死亡率',
        min: 0.1,
        max: 3,
        step: 0.05,
        default: 0.4,
        unit: '1/yr',
      },
      {
        key: 'delta',
        label: 'δ 捕食转化率',
        min: 0.1,
        max: 3,
        step: 0.05,
        default: 0.1,
        unit: '1/(prey·yr)',
      },
    ],
    stateNames: ['猎物 x', '捕食者 y'],
    initialState: () => [40, 9], // [prey, predator] 初始种群 [个体]
    step: (state, p, dt) =>
      rk4(
        state,
        (s, pp) => [
          pp.alpha * s[0] - pp.beta * s[0] * s[1],
          pp.delta * s[0] * s[1] - pp.gamma * s[1],
        ],
        p,
        dt,
      ),
    render: (ctx, history, _p, w, h) => {
      drawTimeSeries(ctx, history, w, h, COLORS.series.slice(0, 2), ['猎物', '捕食者'])
    },
    explain: p => {
      const eq = Math.sqrt((p.alpha * p.gamma) / (p.beta * p.delta))
      return `当 α=${p.alpha.toFixed(2)}、β=${p.beta.toFixed(2)} 时，系统平衡点位于 (x*=${(p.gamma / p.delta).toFixed(1)}, y*=${(p.alpha / p.beta).toFixed(1)})。${eq > LV_EQUILIBRIUM_RATIO_THRESHOLD ? '猎物种群占优，捕食者依赖度高' : '两者数量接近，生态较稳定'}。增大 β 会压低猎物峰值、抬升捕食者低谷。`
    },
    verifyConservation: (history, p) => {
      if (history.length < 2) return null
      const V0 =
        p.delta * history[0][0] -
        p.gamma * Math.log(history[0][0]) +
        p.beta * history[0][1] -
        p.alpha * Math.log(history[0][1])
      const last = history[history.length - 1]
      const V =
        p.delta * last[0] -
        p.gamma * Math.log(Math.max(last[0], 1e-10)) +
        p.beta * last[1] -
        p.alpha * Math.log(Math.max(last[1], 1e-10))
      const drift = V0 > 0 ? ((V - V0) / V0) * 100 : 0
      return {
        label: '守恒量 V = δx − γln(x) + βy − αln(y)',
        drift: `${drift > 0 ? '+' : ''}${drift.toFixed(3)}%`,
      }
    },
  },

  // 2. SIR 传染病模型
  {
    id: 'sir',
    name: 'SIR 传染病模型',
    nameEn: 'SIR Epidemic Model',
    category: 'epidemiology',
    description: '易感-感染-恢复三仓室模型，模拟疫情传播与群体免疫',
    equations: ['dS/dt = -βSI/N', 'dI/dt = βSI/N - γI', 'dR/dt = γI'],
    params: [
      {
        key: 'beta',
        label: 'β 传染率',
        min: 0.05,
        max: 1.5,
        step: 0.01,
        default: 0.35,
        unit: '1/day',
      },
      {
        key: 'gamma',
        label: 'γ 恢复率',
        min: 0.05,
        max: 0.5,
        step: 0.01,
        default: 0.1,
        unit: '1/day',
      },
      { key: 'N', label: 'N 总人口', min: 100, max: 10000, step: 100, default: 1000, unit: '人' },
    ],
    stateNames: ['易感 S', '感染 I', '恢复 R'],
    initialState: p => [p.N - 1, 1, 0], // [S, I, R] 初始: 1 感染者 [人]
    step: (state, p, dt) =>
      rk4(
        state,
        (s, pp) => {
          if (!pp.N || pp.N <= 0) throw new Error('SIR: N 必须为正数')
          const N = pp.N
          return [
            (-pp.beta * s[0] * s[1]) / N,
            (pp.beta * s[0] * s[1]) / N - pp.gamma * s[1],
            pp.gamma * s[1],
          ]
        },
        p,
        dt,
      ),
    render: (ctx, history, _p, w, h) => {
      drawTimeSeries(ctx, history, w, h, COLORS.series.slice(0, 3), ['S', 'I', 'R'])
    },
    explain: p => {
      const R0 = p.beta / p.gamma
      const herd = R0 > 1 ? (1 - 1 / R0) * 100 : 0
      return `基本再生数 R₀ = β/γ = ${R0.toFixed(2)}。${R0 > 1 ? `疫情会爆发，需 ${herd.toFixed(0)}% 群体免疫才能阻断传播` : '疫情自然消退，不会大规模爆发'}。降低 β（戴口罩/隔离）或提高 γ（早治疗）可直接压低 R₀。`
    },
    verifyConservation: (history, _p) => {
      if (history.length < 2) return null
      const N0 = history[0][0] + history[0][1] + history[0][2]
      const last = history[history.length - 1]
      const N = last[0] + last[1] + last[2]
      const drift = N0 > 0 ? ((N - N0) / N0) * 100 : 0
      return { label: '总人口 S+I+R ≡ N', drift: `${drift > 0 ? '+' : ''}${drift.toFixed(3)}%` }
    },
  },

  // 3. 阻尼谐振子
  {
    id: 'oscillator',
    name: '阻尼谐振子',
    nameEn: 'Damped Oscillator',
    category: 'physics',
    description: '弹簧-质量-阻尼系统，展示欠阻尼、临界阻尼与过阻尼',
    equations: ['m·ẍ + c·ẋ + k·x = 0'],
    params: [
      { key: 'm', label: 'm 质量', min: 0.1, max: 5, step: 0.1, default: 1, unit: 'kg' },
      { key: 'k', label: 'k 弹性系数', min: 1, max: 50, step: 0.5, default: 10, unit: 'N/m' },
      { key: 'c', label: 'c 阻尼系数', min: 0, max: 10, step: 0.1, default: 0.5, unit: 'N·s/m' },
    ],
    stateNames: ['位移 x', '速度 v'],
    initialState: () => [1, 0], // [x, v] 初始位移 1m, 初速 0 [m, m/s]
    step: (state, p, dt) =>
      rk4(state, (s, pp) => [s[1], -(pp.k / pp.m) * s[0] - (pp.c / pp.m) * s[1]], p, dt),
    render: (ctx, history, _p, w, h) => {
      drawPhasePortrait(ctx, history, w, h, COLORS.series[0], COLORS.series[1])
    },
    explain: p => {
      const omega0 = Math.sqrt(p.k / p.m)
      const zeta = p.c / (2 * Math.sqrt(p.k * p.m))
      const regime =
        zeta < 1
          ? '欠阻尼（振荡衰减）'
          : Math.abs(zeta - 1) < FLOAT_EPSILON
            ? '临界阻尼'
            : '过阻尼（无振荡）'
      return `固有频率 ω₀ = ${omega0.toFixed(2)} rad/s，阻尼比 ζ = ${zeta.toFixed(3)}。系统处于${regime}状态。${zeta < 1 ? `振荡频率 ωd = ${(omega0 * Math.sqrt(1 - zeta * zeta)).toFixed(2)} rad/s` : '返回平衡点最快且不振荡'}。`
    },
    verifyConservation: (history, p) => {
      if (history.length < 2 || p.c > 0) return null // 仅无阻尼时验证
      const E0 = 0.5 * p.m * history[0][1] ** 2 + 0.5 * p.k * history[0][0] ** 2
      const last = history[history.length - 1]
      const E = 0.5 * p.m * last[1] ** 2 + 0.5 * p.k * last[0] ** 2
      const drift = E0 > 0 ? ((E - E0) / E0) * 100 : 0
      return {
        label: '机械能 E = ½mv² + ½kx²',
        drift: `${drift > 0 ? '+' : ''}${drift.toFixed(3)}%`,
      }
    },
  },

  // 4. Logistic 增长
  {
    id: 'logistic',
    name: 'Logistic 增长模型',
    nameEn: 'Logistic Growth',
    category: 'dynamics',
    description: '带环境承载力的种群增长，展示 S 形曲线与稳定性',
    equations: ['dP/dt = rP(1 - P/K)'],
    params: [
      { key: 'r', label: 'r 增长率', min: 0.05, max: 1, step: 0.01, default: 0.3, unit: '1/yr' },
      { key: 'K', label: 'K 环境承载力', min: 50, max: 2000, step: 10, default: 500, unit: '个体' },
      { key: 'P0', label: 'P₀ 初始种群', min: 1, max: 500, step: 1, default: 10, unit: '个体' },
    ],
    stateNames: ['种群 P'],
    initialState: p => [p.P0],
    step: (state, p, dt) => rk4(state, (s, pp) => [pp.r * s[0] * (1 - s[0] / pp.K)], p, dt),
    render: (ctx, history, _p, w, h) => {
      drawTimeSeries(ctx, history, w, h, [COLORS.series[2]], ['P(t)'])
    },
    explain: p => {
      const tHalfK = (1 / p.r) * Math.log((p.K - p.P0) / p.P0)
      return `增长率 r=${p.r.toFixed(2)} 1/时间，承载力 K=${p.K}。种群从 P₀=${p.P0} 出发，约 t=${tHalfK.toFixed(1)} 时达到 K/2（拐点，增长最快）。之后增速放缓，渐近趋近 K。增大 r 使拐点提前；增大 K 抬高终值。`
    },
  },

  // 5. Cayley 图 — 群论可视化（连接 MathWeaver 核心）
  {
    id: 'cayley-graph',
    name: 'Cayley 图可视化',
    nameEn: 'Cayley Graph',
    category: 'algebra',
    description: '将群结构可视化为有向图：节点=群元素，边=生成元乘法',
    equations: ['⟨S | R⟩ → Graph(V, E)'],
    params: [
      { key: 'n', label: 'n 循环群阶', min: 3, max: 12, step: 1, default: 6 },
      { key: 'gen', label: '生成元 a', min: 1, max: 6, step: 1, default: 1 },
      { key: 'gen2', label: '生成元 b（0=单生成元）', min: 0, max: 6, step: 1, default: 0 },
    ],
    stateNames: ['节点 0..n-1'],
    initialState: () => [0],
    step: (state, _p, _dt) => state,
    render: (ctx, _history, p, w, h) => {
      drawCayleyGraph(ctx, p.n, p.gen, p.gen2, w, h)
    },
    explain: p => {
      if (p.gen2 === 0) {
        return `Z_${p.n} 的 Cayley 图：${p.n} 个节点排成环，生成元 a=${p.gen} 对应的边连接 i → (i+${p.gen}) mod ${p.n}。每个节点恰好有一条 a-边出、一条 a-边入，形成 ${gcd(p.n, p.gen) === 1 ? '单个循环（生成元有效）' : `${Math.floor(p.n / gcd(p.n, p.gen))} 个不连通环（生成元不生成全群）`}。`
      }
      return `Z_${p.n} 由 a=${p.gen} 和 b=${p.gen2} 生成。双生成元 Cayley 图使用两种颜色的有向边，展示更丰富的群结构。改变生成元会改变图的拓扑。`
    },
  },
]

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

// ── Canvas Drawing Helpers ─────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  const step = GRID_STEP_PX
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  xLabel: string,
  yLabel: string,
) {
  const pad = CANVAS_PADDING
  ctx.strokeStyle = COLORS.axis
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(pad, h - pad)
  ctx.lineTo(w - 10, h - pad)
  ctx.moveTo(pad, h - pad)
  ctx.lineTo(pad, 10)
  ctx.stroke()
  ctx.fillStyle = COLORS.textDim
  ctx.font = '13px JetBrains Mono, monospace'
  ctx.fillText(xLabel, w - 60, h - pad + 18)
  ctx.save()
  ctx.translate(12, 30)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(yLabel, 0, 0)
  ctx.restore()
}

function drawTimeSeries(
  ctx: CanvasRenderingContext2D,
  history: number[][],
  w: number,
  h: number,
  colors: string[],
  labels: string[],
) {
  drawGrid(ctx, w, h)
  const pad = CANVAS_PADDING
  const plotW = w - pad - 10
  const plotH = h - pad - 20

  drawAxes(ctx, w, h, '时间 t', '值')

  if (history.length < 2) return

  const numSeries = Math.min(colors.length, history[0]?.length || 0)
  let maxVal = 0
  for (const row of history) {
    for (let i = 0; i < numSeries; i++) {
      if (Math.abs(row[i]) > maxVal) maxVal = Math.abs(row[i])
    }
  }
  maxVal = Math.max(maxVal * 1.1, 1) // 10% padding, min=1 for zero data

  const tMax = history.length
  for (let s = 0; s < numSeries; s++) {
    ctx.strokeStyle = colors[s]
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < history.length; i++) {
      const x = pad + (i / tMax) * plotW
      const y = h - pad - (history[i][s] / maxVal) * plotH
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Legend
  ctx.font = '12px JetBrains Mono, monospace'
  for (let s = 0; s < numSeries; s++) {
    ctx.fillStyle = colors[s]
    ctx.fillRect(w - 100, 15 + s * 20, 12, 12)
    ctx.fillStyle = COLORS.text
    ctx.fillText(labels[s], w - 82, 25 + s * 20)
  }
}

function drawPhasePortrait(
  ctx: CanvasRenderingContext2D,
  history: number[][],
  w: number,
  h: number,
  color1: string,
  color2: string,
) {
  drawGrid(ctx, w, h)
  const pad = CANVAS_PADDING
  const plotW = w - pad * 2
  const plotH = h - pad * 2

  drawAxes(ctx, w, h, '位移 x', '速度 v')

  if (history.length < 2) return

  let maxX = 0
  for (const row of history) {
    if (Math.abs(row[0]) > maxX) maxX = Math.abs(row[0])
    if (Math.abs(row[1]) > maxX) maxX = Math.abs(row[1])
  }
  maxX = Math.max(maxX * 1.1, 0.1)

  // Trajectory
  ctx.strokeStyle = color1
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.8
  ctx.beginPath()
  for (let i = 0; i < history.length; i++) {
    const x = pad + ((history[i][0] + maxX) / (2 * maxX)) * plotW
    const y = h - pad - ((history[i][1] + maxX) / (2 * maxX)) * plotH
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.globalAlpha = 1

  // Current point
  const last = history[history.length - 1]
  const cx = pad + ((last[0] + maxX) / (2 * maxX)) * plotW
  const cy = h - pad - ((last[1] + maxX) / (2 * maxX)) * plotH
  ctx.fillStyle = color2
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fill()

  // Equilibrium
  ctx.fillStyle = COLORS.highlight
  ctx.beginPath()
  ctx.arc(pad + plotW / 2, h - pad - plotH / 2, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = COLORS.textDim
  ctx.font = '11px JetBrains Mono, monospace'
  ctx.fillText('平衡点', pad + plotW / 2 + 8, h - pad - plotH / 2 + 4)
}

function drawCayleyGraph(
  ctx: CanvasRenderingContext2D,
  n: number,
  genA: number,
  genB: number,
  w: number,
  h: number,
) {
  drawGrid(ctx, w, h)
  const cx = w / 2
  const cy = h / 2
  const radius = Math.min(w, h) / 2 - 60

  // Compute node positions
  const nodes: { x: number; y: number; label: string }[] = []
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2
    nodes.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      label: String(i),
    })
  }

  // Draw edges for generator a
  ctx.strokeStyle = COLORS.series[0]
  ctx.lineWidth = 2
  for (let i = 0; i < n; i++) {
    const j = (i + genA) % n
    if (j === i) continue
    drawArrow(ctx, nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y)
  }

  // Draw edges for generator b (if enabled)
  if (genB > 0 && genB !== genA) {
    ctx.strokeStyle = COLORS.series[1]
    ctx.setLineDash([5, 4])
    for (let i = 0; i < n; i++) {
      const j = (i + genB) % n
      if (j === i) continue
      drawArrow(ctx, nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y)
    }
    ctx.setLineDash([])
  }

  // Draw nodes
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = COLORS.bg
    ctx.strokeStyle = COLORS.series[2]
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(nodes[i].x, nodes[i].y, 18, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 14px JetBrains Mono, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(nodes[i].label, nodes[i].x, nodes[i].y)
  }

  // Legend
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '12px JetBrains Mono, monospace'
  ctx.fillStyle = COLORS.series[0]
  ctx.fillRect(15, 15, 12, 3)
  ctx.fillStyle = COLORS.text
  ctx.fillText(`a = ${genA}`, 35, 20)
  if (genB > 0 && genB !== genA) {
    ctx.fillStyle = COLORS.series[1]
    ctx.fillRect(15, 35, 12, 3)
    ctx.fillStyle = COLORS.text
    ctx.fillText(`b = ${genB}`, 35, 40)
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 5) return
  const ux = dx / len
  const uy = dy / len
  const r = NODE_RADIUS_PX
  const sx = x1 + ux * r
  const sy = y1 + uy * r
  const ex = x2 - ux * r
  const ey = y2 - uy * r

  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(ex, ey)
  ctx.stroke()

  // Arrowhead
  const ah = ARROWHEAD_SIZE_PX
  const angle = Math.atan2(dy, dx)
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - ah * Math.cos(angle - 0.4), ey - ah * Math.sin(angle - 0.4))
  ctx.lineTo(ex - ah * Math.cos(angle + 0.4), ey - ah * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fillStyle = ctx.strokeStyle as string
  ctx.fill()
}

// ── Component ───────────────────────────────────────────────────────────────

function ModelingLabInner({ ageLevel: _ageLevel = 'tweens' }: Props) {
  const [modelId, setModelId] = useState(MODELS[0].id)
  const [params, setParams] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {}
    for (const m of MODELS[0].params) p[m.key] = m.default
    return p
  })
  const [running, setRunning] = useState(true)
  const [history, setHistory] = useState<number[][]>([])
  const [simTimeDisplay, setSimTimeDisplay] = useState(0)
  const [prediction, setPrediction] = useState<string>('')
  const [showPrediction, setShowPrediction] = useState(false)
  const [ledger, setLedger] = useState<HistoryEntry[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const stateRef = useRef<number[]>([])
  const simTimeRef = useRef(0)

  const model = useMemo(() => MODELS.find(m => m.id === modelId)!, [modelId])

  // Reset when model changes
  useEffect(() => {
    const newParams: Record<string, number> = {}
    for (const p of model.params) newParams[p.key] = p.default
    setParams(newParams)
    stateRef.current = model.initialState(newParams)
    simTimeRef.current = 0
    setHistory([stateRef.current])
    setLedger([{ params: { ...newParams }, timestamp: Date.now(), label: `初始化 ${model.name}` }])
  }, [model])

  // Simulation loop
  useEffect(() => {
    if (!running) return
    let lastTime = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, DT_FRAME_CAP_S)
      lastTime = now
      const dtSim = dt * SIM_SPEED_MULTIPLIER
      simTimeRef.current += dtSim
      setSimTimeDisplay(simTimeRef.current)
      try {
        stateRef.current = model.step(stateRef.current, params, dtSim)
      } catch (e) {
        setRunning(false)
        console.error('仿真发散:', e)
        return
      }
      setHistory(prev => {
        const next = [...prev, [...stateRef.current]]
        return next.length > HISTORY_MAX_LENGTH ? next.slice(-HISTORY_MAX_LENGTH) : next
      })
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [running, model, params])

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    model.render(ctx, history, params, w, h)
  }, [history, model, params])

  const handleParamChange = useCallback((key: string, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleReset = useCallback(() => {
    stateRef.current = model.initialState(params)
    simTimeRef.current = 0
    setHistory([stateRef.current])
    setRunning(true)
  }, [model, params])

  const handleSnapshot = useCallback(() => {
    setLedger(prev => [
      ...prev,
      { params: { ...params }, timestamp: Date.now(), label: `快照 #${prev.length + 1}` },
    ])
  }, [params])

  const handleRestore = useCallback(
    (entry: HistoryEntry) => {
      setParams({ ...entry.params })
      stateRef.current = model.initialState(entry.params)
      setHistory([stateRef.current])
    },
    [model],
  )

  const explanation = useMemo(
    () => model.explain(params, history.slice(-20)),
    [model, params, history],
  )

  const categoryColors: Record<string, string> = {
    dynamics: '#d97757',
    physics: 'var(--accent-2, #6a9bcc)',
    epidemiology: 'var(--accent-3, #788c5d)',
    algebra: '#9b7bcc',
  }

  return (
    <div className="ml-container">
      <style>{`
        .ml-container {
          display: flex;
          height: 100%;
          gap: 0;
          background: var(--surface-2, #161620);
          border-radius: var(--radius, 8px);
          overflow: hidden;
        }
        .ml-canvas-area {
          flex: 1;
          position: relative;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .ml-canvas-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          min-height: 0;
        }
        .ml-canvas-wrap canvas {
          border-radius: 6px;
          max-width: 100%;
          max-height: 100%;
        }
        .ml-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
          background: var(--surface, #1a1a28);
          flex-shrink: 0;
        }
        .ml-btn {
          padding: 6px 14px;
          border-radius: 4px;
          border: 1px solid var(--border, rgba(255,255,255,0.12));
          background: var(--surface-2, #222230);
          color: var(--text-1, #e0e0e8);
          font-size: 13px;
          font-family: var(--font-sans, sans-serif);
          cursor: pointer;
          transition: background 0.15s;
        }
        .ml-btn:hover { background: var(--surface, #2a2a38); }
        .ml-btn.active { background: #b85a3a; border-color: #b85a3a; color: #fff; }
        .ml-sidebar {
          width: 300px;
          flex-shrink: 0;
          border-left: 1px solid var(--border, rgba(255,255,255,0.08));
          background: var(--surface, #1a1a28);
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .ml-section {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
        }
        .ml-section-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #9ca3af;
          margin: 0 0 10px;
        }
        .ml-model-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .ml-model-btn {
          padding: 8px;
          border-radius: 4px;
          border: 1px solid var(--border, rgba(255,255,255,0.1));
          background: var(--surface-2, #222230);
          color: #b0b8c8;
          font-size: 12px;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
        }
        .ml-model-btn:hover { border-color: #d97757; }
        .ml-model-btn.active {
          border-color: #d97757;
          background: rgba(217, 119, 87, 0.12);
          color: var(--text-1, #e0e0e8);
        }
        .ml-slider-row {
          margin-bottom: 12px;
        }
        .ml-slider-label {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #b0b8c8;
          margin-bottom: 4px;
          font-family: var(--font-mono, monospace);
        }
        .ml-slider-val {
          color: #d97757;
          font-weight: 600;
        }
        .ml-slider {
          width: 100%;
          -webkit-appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--border, rgba(255,255,255,0.15));
          outline: none;
        }
        .ml-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #d97757;
          cursor: pointer;
        }
        .ml-explain {
          font-size: 13px;
          line-height: 1.6;
          color: #b0b8c8;
          font-family: var(--font-serif, serif);
          padding: 12px;
          background: var(--surface-2, #222230);
          border-radius: 6px;
          border-left: 3px solid #d97757;
        }
        .ml-eq {
          font-family: var(--font-mono, monospace);
          font-size: 13px;
          color: var(--text-1, #e0e0e8);
          padding: 6px 0;
        }
        .ml-prediction {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }
        .ml-pred-input {
          flex: 1;
          padding: 6px 8px;
          border-radius: 4px;
          border: 1px solid var(--border, rgba(255,255,255,0.12));
          background: var(--surface-2, #222230);
          color: var(--text-1, #e0e0e8);
          font-size: 12px;
        }
        .ml-ledger-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 8px;
          border-radius: 4px;
          font-size: 11px;
          color: #9ca3af;
          cursor: pointer;
          transition: background 0.1s;
        }
        .ml-ledger-item:hover { background: var(--surface-2, #222230); }
        .ml-cat-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 2px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        @media (max-width: 900px) {
          .ml-container { flex-direction: column; }
          .ml-sidebar { width: 100%; max-height: 280px; border-left: none; border-top: 1px solid var(--border, rgba(255,255,255,0.08)); }
        }
      `}</style>

      {/* Canvas-first layout: visualization is the primary workspace */}
      <div className="ml-canvas-area">
        <div className="ml-toolbar">
          <button
            className={`ml-btn ${running ? 'active' : ''}`}
            onClick={() => setRunning(r => !r)}
            aria-label={running ? '暂停' : '播放'}
          >
            {running ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button className="ml-btn" onClick={handleReset} aria-label="重置">
            ↻ 重置
          </button>
          <button className="ml-btn" onClick={handleSnapshot} aria-label="保存快照">
            📸 快照
          </button>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 12,
              color: '#9ca3af',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            t = {simTimeDisplay.toFixed(1)}s · {history.length} pts
          </span>
        </div>
        <div className="ml-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            role="img"
            aria-label={`${model.name} 可视化`}
          />
        </div>
      </div>

      {/* Sidebar: controls + explanation (frames the canvas, doesn't compete) */}
      <div className="ml-sidebar">
        {/* Model selection */}
        <div className="ml-section">
          <p className="ml-section-title">模型预设</p>
          <div className="ml-model-grid">
            {MODELS.map(m => (
              <button
                key={m.id}
                className={`ml-model-btn ${m.id === modelId ? 'active' : ''}`}
                onClick={() => setModelId(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>

        {/* Current model info */}
        <div className="ml-section">
          <span
            className="ml-cat-badge"
            style={{
              background: `${categoryColors[model.category]}22`,
              color: categoryColors[model.category],
            }}
          >
            {model.category}
          </span>
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-1, #e0e0e8)',
              margin: '0 0 4px',
            }}
          >
            {model.name} · {model.nameEn}
          </p>
          <p
            style={{
              fontSize: 12,
              color: '#9ca3af',
              margin: '0 0 8px',
              lineHeight: 1.5,
            }}
          >
            {model.description}
          </p>
          {model.equations.map((eq, i) => (
            <div key={i} className="ml-eq">
              {eq}
            </div>
          ))}
        </div>

        {/* Parameter sliders */}
        <div className="ml-section">
          <p className="ml-section-title">参数控制 · 实时</p>
          {model.params.map(p => (
            <div key={p.key} className="ml-slider-row">
              <div className="ml-slider-label">
                <span>{p.label}</span>
                <span className="ml-slider-val">
                  {params[p.key]?.toFixed(p.step < 1 ? 2 : 0)}
                  {p.unit ? ` ${p.unit}` : ''}
                </span>
              </div>
              <input
                type="range"
                className="ml-slider"
                min={p.min}
                max={p.max}
                step={p.step}
                value={params[p.key] ?? p.default}
                onChange={e => handleParamChange(p.key, parseFloat(e.target.value))}
                aria-label={p.label}
              />
            </div>
          ))}
        </div>

        {/* Prediction-verification loop (GeoChat inspired) */}
        <div className="ml-section">
          <p className="ml-section-title">预测 → 验证</p>
          <div className="ml-prediction">
            <input
              className="ml-pred-input"
              placeholder="预测参数变化后的结果..."
              value={prediction}
              onChange={e => setPrediction(e.target.value)}
              aria-label="预测结果"
            />
            <button
              className="ml-btn"
              onClick={() => setShowPrediction(s => !s)}
              aria-label="对比预测"
            >
              ✓
            </button>
          </div>
          {showPrediction && prediction && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--accent-2, #6a9bcc)',
                fontStyle: 'italic',
                padding: '4px 0',
              }}
            >
              你的预测：{prediction}
            </div>
          )}
        </div>

        {/* Explain the math path (GeoChat core principle) */}
        <div className="ml-section">
          <p className="ml-section-title">解释数学路径</p>
          <div className="ml-explain">{explanation}</div>
        </div>

        {/* Conservation law verification (Fifth Law) */}
        {(() => {
          const cons = model.verifyConservation?.(history, params)
          if (!cons) return null
          return (
            <div className="ml-section">
              <p className="ml-section-title">守恒律验证</p>
              <div className="ml-explain" style={{ borderLeftColor: '#7bc693' }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>{cons.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#7bc693' }}>
                  漂移: {cons.drift}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Run Ledger (snapshot history) */}
        {ledger.length > 1 && (
          <div className="ml-section">
            <p className="ml-section-title">运行快照 · Run Ledger</p>
            {ledger.map((entry, i) => (
              <div
                key={i}
                className="ml-ledger-item"
                role="button"
                tabIndex={0}
                onClick={() => handleRestore(entry)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') handleRestore(entry)
                }}
                title="点击恢复此参数集"
              >
                <span>{entry.label}</span>
                <span>
                  {new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const ModelingLab = memo(ModelingLabInner)
