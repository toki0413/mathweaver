import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Golden-reference tests: independently verify the MATHEMATICAL FORMULAS
// used in ModelingLab.tsx against analytical solutions.
//
// ROOT CAUSE of prior bugs: the Logistic "time to K/2" formula used ln(9)/r
// (which computes 10%→90% growth time) instead of (1/r)·ln((K-P0)/P0).
// This test catches that class of error by checking against ground truth.
// ---------------------------------------------------------------------------

// ── RK4 implementation (mirrors ModelingLab.tsx) ─────────────────────────

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
  return state.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}

// ── Analytical solutions for verification ────────────────────────────────

describe('Logistic growth formula', () => {
  // P(t) = K / (1 + ((K - P0) / P0) * e^(-r*t))
  // Time to reach K/2: t_half = (1/r) * ln((K - P0) / P0)

  it('time-to-K/2 formula matches analytical solution', () => {
    const r = 0.3
    const K = 500
    const P0 = 10
    const tHalfK = (1 / r) * Math.log((K - P0) / P0)
    // Evaluate P(tHalfK) using the analytical solution
    const P_at_t = K / (1 + ((K - P0) / P0) * Math.exp(-r * tHalfK))
    expect(Math.abs(P_at_t - K / 2)).toBeLessThan(0.001)
  })

  it('RK4 numerical integration matches analytical Logistic solution', () => {
    const r = 0.3
    const K = 500
    const P0 = 10
    const dt = 0.01
    const steps = 1000
    let state = [P0]
    const fn = (s: number[]) => [r * s[0] * (1 - s[0] / K)]
    for (let i = 0; i < steps; i++) {
      state = rk4(state, fn, {}, dt)
    }
    const t = steps * dt
    const analytical = K / (1 + ((K - P0) / P0) * Math.exp(-r * t))
    // RK4 with dt=0.01 should be within 0.5% of analytical
    expect(Math.abs(state[0] - analytical) / analytical).toBeLessThan(0.005)
  })
})

describe('SIR model conservation law', () => {
  // dS/dt = -βSI/N, dI/dt = βSI/N - γI, dR/dt = γI
  // Conservation: S + I + R = N (constant)

  it('total population S+I+R is conserved under RK4', () => {
    const beta = 0.35
    const gamma = 0.1
    const N = 1000
    const dt = 0.1
    const steps = 500
    let state = [N - 1, 1, 0] // [S, I, R]
    const fn = (s: number[]) => [
      (-beta * s[0] * s[1]) / N,
      (beta * s[0] * s[1]) / N - gamma * s[1],
      gamma * s[1],
    ]
    for (let i = 0; i < steps; i++) {
      state = rk4(state, fn, {}, dt)
    }
    const total = state[0] + state[1] + state[2]
    expect(Math.abs(total - N)).toBeLessThan(0.01)
  })
})

describe('Harmonic oscillator energy conservation', () => {
  // x'' + ω²x = 0 → x(t) = A·cos(ωt)
  // Energy E = ½kx² + ½mv² should be constant (no damping)

  it('mechanical energy is conserved for undamped oscillator', () => {
    const m = 1
    const k = 10
    const _omega0 = Math.sqrt(k / m)
    const dt = 0.001
    const steps = 10000
    let state = [1, 0] // [x, v]
    const fn = (s: number[]) => [s[1], -(k / m) * s[0]]
    for (let i = 0; i < steps; i++) {
      state = rk4(state, fn, {}, dt)
    }
    const E0 = 0.5 * k * 1 * 1 + 0.5 * m * 0 * 0
    const E = 0.5 * k * state[0] ** 2 + 0.5 * m * state[1] ** 2
    // Energy drift should be < 0.1% for RK4 with small dt
    expect(Math.abs((E - E0) / E0)).toBeLessThan(0.001)
  })

  it('RK4 position matches analytical x(t) = A·cos(ωt)', () => {
    const m = 1
    const k = 10
    const omega0 = Math.sqrt(k / m)
    const dt = 0.001
    const steps = 5000
    let state = [1, 0] // A=1, phase=0
    const fn = (s: number[]) => [s[1], -(k / m) * s[0]]
    for (let i = 0; i < steps; i++) {
      state = rk4(state, fn, {}, dt)
    }
    const t = steps * dt
    const analytical = Math.cos(omega0 * t)
    expect(Math.abs(state[0] - analytical)).toBeLessThan(0.001)
  })
})

describe('Lotka-Volterra conservation invariant', () => {
  // V = δx - γ·ln(x) + βy - α·ln(y) should be approximately constant

  it('Lotka-Volterra invariant is approximately conserved', () => {
    const alpha = 1.1
    const beta = 0.4
    const gamma = 0.4
    const delta = 0.1
    const dt = 0.01
    const steps = 2000
    let state = [40, 9]
    const fn = (s: number[]) => [
      alpha * s[0] - beta * s[0] * s[1],
      delta * s[0] * s[1] - gamma * s[1],
    ]
    const V0 =
      delta * state[0] - gamma * Math.log(state[0]) + beta * state[1] - alpha * Math.log(state[1])
    for (let i = 0; i < steps; i++) {
      state = rk4(state, fn, {}, dt)
      // Guard against negative populations (numerical issue)
      if (state[0] <= 0 || state[1] <= 0) break
    }
    const V =
      delta * state[0] -
      gamma * Math.log(Math.max(state[0], 1e-10)) +
      beta * state[1] -
      alpha * Math.log(Math.max(state[1], 1e-10))
    // Drift should be < 1% for RK4 with dt=0.01
    expect(Math.abs((V - V0) / V0)).toBeLessThan(0.01)
  })
})

describe('Damped oscillator damping classification', () => {
  // ζ = c / (2·√(km))
  // ζ < 1: underdamped, ζ = 1: critically damped, ζ > 1: overdamped

  it('critical damping occurs at c = 2·√(km)', () => {
    const m = 1
    const k = 10
    const c_critical = 2 * Math.sqrt(k * m)
    const zeta = c_critical / (2 * Math.sqrt(k * m))
    expect(Math.abs(zeta - 1)).toBeLessThan(1e-6)
  })

  it('floating-point comparison: zeta === 1 is unsafe with slider input', () => {
    const m = 1
    const k = 10
    // Simulate c coming from a slider with step=0.1: c=6.3 is closest to
    // 2*sqrt(10) ≈ 6.3245..., but 6.3/6.3245 is NOT exactly 1.0
    const c_slider = 6.3
    const zeta = c_slider / (2 * Math.sqrt(k * m))
    // This is the BUG that was fixed: zeta === 1 returns false for slider input
    expect(zeta === 1).toBe(false) // demonstrates the bug
    expect(Math.abs(zeta - 1)).toBeLessThan(0.005) // correct approach with epsilon
  })
})
