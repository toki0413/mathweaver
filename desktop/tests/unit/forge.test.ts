import { describe, it, expect } from 'vitest'
import {
  verifyGroupAxiomsCayley,
  checkCommutativityCayley,
  checkAssociativityCayley,
  mkForgeResult,
  FallbackLevel,
} from '../../electron/backend/forge/forge'

// ---------------------------------------------------------------------------
// Test fixtures: well-known group theory Cayley tables
// ---------------------------------------------------------------------------

// Z3 — cyclic group of order 3 (addition mod 3)
const Z3: number[][] = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
]

// Z4 — cyclic group of order 4 (addition mod 4)
const Z4: number[][] = [
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [3, 0, 1, 2],
]

// Klein four-group V4 (Z2 × Z2)
const V4: number[][] = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [2, 3, 0, 1],
  [3, 2, 1, 0],
]

// S3 — symmetric group on 3 letters (order 6, non-abelian)
const S3: number[][] = [
  [0, 1, 2, 3, 4, 5],
  [1, 0, 4, 5, 2, 3],
  [2, 5, 0, 4, 3, 1],
  [3, 4, 5, 0, 1, 2],
  [4, 3, 1, 2, 5, 0],
  [5, 2, 3, 1, 0, 4],
]

// Non-group: closed but not associative
const NON_ASSOC: number[][] = [
  [0, 1, 2],
  [1, 1, 0],
  [2, 0, 2],
]

// Non-group: not closed (value 5 out of range for 3×3 table)
const NOT_CLOSED: number[][] = [
  [0, 1, 5],
  [1, 2, 0],
  [2, 0, 1],
]

// Non-group: associative but no identity (all-zero table = null semigroup)
const NO_IDENTITY: number[][] = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
]

// Empty table
const EMPTY: number[][] = []

// ---------------------------------------------------------------------------
// verifyGroupAxiomsCayley
// ---------------------------------------------------------------------------

describe('verifyGroupAxiomsCayley', () => {
  it('verifies Z3 as a valid group', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(Z3)
    expect(isGroup).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('verifies Z4 as a valid group', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(Z4)
    expect(isGroup).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('verifies Klein four-group V4 as a valid group', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(V4)
    expect(isGroup).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('verifies S3 (non-abelian, order 6) as a valid group', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(S3)
    expect(isGroup).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('rejects non-associative table', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(NON_ASSOC)
    expect(isGroup).toBe(false)
    expect(counterEx).toContain('Associativity violated')
  })

  it('rejects non-closed table with out-of-range values', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(NOT_CLOSED)
    expect(isGroup).toBe(false)
    expect(counterEx).toContain('out of range')
  })

  it('rejects table without identity element', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(NO_IDENTITY)
    expect(isGroup).toBe(false)
    expect(counterEx).toContain('identity')
  })

  it('rejects empty table', () => {
    const [isGroup, counterEx] = verifyGroupAxiomsCayley(EMPTY)
    expect(isGroup).toBe(false)
    expect(counterEx).toBe('Empty table')
  })
})

// ---------------------------------------------------------------------------
// checkCommutativityCayley
// ---------------------------------------------------------------------------

describe('checkCommutativityCayley', () => {
  it('confirms Z3 is commutative (abelian)', () => {
    const [isCommutative, counterEx] = checkCommutativityCayley(Z3)
    expect(isCommutative).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('confirms V4 is commutative (abelian)', () => {
    const [isCommutative, counterEx] = checkCommutativityCayley(V4)
    expect(isCommutative).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('detects S3 is non-commutative (non-abelian)', () => {
    const [isCommutative, counterEx] = checkCommutativityCayley(S3)
    expect(isCommutative).toBe(false)
    expect(counterEx).toContain('Not commutative')
  })
})

// ---------------------------------------------------------------------------
// checkAssociativityCayley
// ---------------------------------------------------------------------------

describe('checkAssociativityCayley', () => {
  it('confirms Z3 is associative', () => {
    const [isAssoc, counterEx] = checkAssociativityCayley(Z3)
    expect(isAssoc).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('confirms S3 is associative', () => {
    const [isAssoc, counterEx] = checkAssociativityCayley(S3)
    expect(isAssoc).toBe(true)
    expect(counterEx).toBeNull()
  })

  it('detects associativity violation with descriptive counter-example', () => {
    const [isAssoc, counterEx] = checkAssociativityCayley(NON_ASSOC)
    expect(isAssoc).toBe(false)
    expect(counterEx).toContain('but')
    // Counter-example should mention specific elements
    expect(counterEx).toMatch(/\d/)
  })
})

// ---------------------------------------------------------------------------
// mkForgeResult
// ---------------------------------------------------------------------------

describe('mkForgeResult', () => {
  it('creates a minimal result with defaults', () => {
    const result = mkForgeResult(true, FallbackLevel.L1_BRUTE_FORCE, 'All good')
    expect(result.success).toBe(true)
    expect(result.level).toBe(FallbackLevel.L1_BRUTE_FORCE)
    expect(result.explanation).toBe('All good')
    expect(result.counterExample).toBeNull()
    expect(result.z3Model).toBeNull()
    expect(result.metadata).toEqual({})
  })

  it('creates a result with counter-example and metadata', () => {
    const result = mkForgeResult(false, FallbackLevel.L1_BRUTE_FORCE, 'Found violation', {
      counterExample: '(0*1)*2 ≠ 0*(1*2)',
      z3Model: { a: 0, b: 1, c: 2 },
      metadata: { tableSize: 3, iterations: 27 },
    })
    expect(result.success).toBe(false)
    expect(result.counterExample).toBe('(0*1)*2 ≠ 0*(1*2)')
    expect(result.z3Model).toEqual({ a: 0, b: 1, c: 2 })
    expect(result.metadata).toEqual({ tableSize: 3, iterations: 27 })
  })

  it('supports all fallback levels', () => {
    const levels = [
      FallbackLevel.L1_BRUTE_FORCE,
      FallbackLevel.L2_LLM_VERIFY,
      FallbackLevel.L3_LLM_HEURISTIC,
      FallbackLevel.L4_LLM_ONLY,
    ]
    for (const level of levels) {
      const result = mkForgeResult(true, level, 'test')
      expect(result.level).toBe(level)
    }
  })
})
