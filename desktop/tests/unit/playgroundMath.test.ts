import { describe, it, expect } from 'vitest'
import {
  areInverses,
  findIdentity,
  getInverseMap,
  getPairKey,
  isTableSymmetric,
  lookupValue,
} from '@/utils/playgroundMath'

// Z2 — cyclic group of order 2. Identity 0; both elements self-inverse.
const Z2: number[][] = [
  [0, 1],
  [1, 0],
]

// Z3 — cyclic group of order 3. Identity 0; inverses 0↔0, 1↔2.
const Z3: number[][] = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
]

// S3 — symmetric group on 3 letters (6x6), non-commutative.
const S3: number[][] = [
  [0, 1, 2, 3, 4, 5],
  [1, 0, 4, 5, 2, 3],
  [2, 5, 0, 4, 3, 1],
  [3, 4, 5, 0, 1, 2],
  [4, 3, 1, 2, 5, 0],
  [5, 2, 3, 1, 0, 4],
]

// Closed but not commutative: table[1][0]=0 ≠ table[0][1]=1.
const NON_COMMUTATIVE: number[][] = [
  [0, 1, 2],
  [0, 2, 1],
  [2, 1, 0],
]

// No row maps j → j, so no identity exists.
const NO_IDENTITY: number[][] = [
  [0, 0],
  [1, 1],
]

// A value (5) outside the valid range [0, size-1].
const NOT_CLOSED: number[][] = [
  [0, 1, 5],
  [1, 2, 0],
  [2, 0, 1],
]

describe('findIdentity', () => {
  it('returns 0 for Z3 (identity element 0)', () => {
    expect(findIdentity(Z3, 3)).toBe(0)
  })

  it('returns 0 for Z2', () => {
    expect(findIdentity(Z2, 2)).toBe(0)
  })

  it('finds the identity row in S3', () => {
    expect(findIdentity(S3, 6)).toBe(0)
  })

  it('returns -1 when no row is an identity row', () => {
    expect(findIdentity(NO_IDENTITY, 2)).toBe(-1)
  })

  it('returns -1 for an empty/zero-size table', () => {
    expect(findIdentity([], 0)).toBe(-1)
  })

  it('compares against j for every column (row must be the permutation j→j)', () => {
    // Row 1 of Z3 is [1, 2, 0] — table[1][0]=1 ≠ 0, so identity is NOT 1.
    expect(findIdentity(Z3, 3)).not.toBe(1)
  })
})

describe('lookupValue', () => {
  it('returns the product for in-range indices', () => {
    expect(lookupValue(Z3, 3, 1, 2)).toBe(0) // 1∗2 = 0 in Z3
    expect(lookupValue(S3, 6, 1, 2)).toBe(4)
  })

  it('returns a value even when it renders as 0 (not falsy-collapsed)', () => {
    expect(lookupValue(Z3, 3, 1, 2)).toBe(0)
  })

  it('returns null when the row is missing', () => {
    expect(lookupValue(Z3, 3, 5, 0)).toBeNull()
  })

  it('returns null when the column is out of range', () => {
    expect(lookupValue(Z3, 3, 0, 5)).toBeNull()
  })

  it('returns null when the value is not a number', () => {
    expect(
      lookupValue(
        [
          [0, 'x'],
          [1, 0],
        ],
        2,
        0,
        1,
      ),
    ).toBeNull()
  })

  it('returns null when the value is outside the valid range (not closed)', () => {
    expect(lookupValue(NOT_CLOSED, 3, 0, 2)).toBeNull() // 5 ≥ size
  })

  it('returns null for negative indices', () => {
    expect(lookupValue(Z3, 3, -1, 0)).toBeNull()
    expect(lookupValue(Z3, 3, 0, -1)).toBeNull()
  })
})

describe('getPairKey', () => {
  it('is order-independent (a,b) == (b,a)', () => {
    expect(getPairKey(2, 3)).toBe('2:3')
    expect(getPairKey(3, 2)).toBe('2:3')
  })

  it('handles equal elements', () => {
    expect(getPairKey(4, 4)).toBe('4:4')
  })
})

describe('getInverseMap', () => {
  it('maps each element to its inverse in Z3', () => {
    const map = getInverseMap(Z3, 3, 0)
    expect(map.get(0)).toBe(0) // identity is self-inverse
    expect(map.get(1)).toBe(2)
    expect(map.get(2)).toBe(1)
  })

  it('maps everything to itself in Z2 (all self-inverse)', () => {
    const map = getInverseMap(Z2, 2, 0)
    expect(map.get(0)).toBe(0)
    expect(map.get(1)).toBe(1)
  })

  it('returns an empty map when identity is -1', () => {
    expect(getInverseMap(Z3, 3, -1).size).toBe(0)
  })

  it('keeps only the first partner found per element', () => {
    const map = getInverseMap(Z3, 3, 0)
    expect(map.size).toBe(3)
  })
})

describe('isTableSymmetric', () => {
  it('returns true for Z3 (commutative)', () => {
    expect(isTableSymmetric(Z3, 3)).toBe(true)
  })

  it('returns true for Z2 (commutative)', () => {
    expect(isTableSymmetric(Z2, 2)).toBe(true)
  })

  it('returns false for S3 (non-commutative)', () => {
    expect(isTableSymmetric(S3, 6)).toBe(false)
  })

  it('returns false for a non-commutative table', () => {
    expect(isTableSymmetric(NON_COMMUTATIVE, 3)).toBe(false)
  })

  it('treats a 1x1 table as symmetric', () => {
    expect(isTableSymmetric([[0]], 1)).toBe(true)
  })
})

describe('areInverses', () => {
  it('returns true when b is the recorded inverse of a', () => {
    const map = new Map<number, number>([[1, 2]])
    expect(areInverses(map, 1, 2)).toBe(true)
  })

  it('is directional — only checks map.get(a) === b', () => {
    const map = new Map<number, number>([[1, 2]])
    expect(areInverses(map, 2, 1)).toBe(false)
  })

  it('returns false for an unknown element', () => {
    const map = new Map<number, number>([[1, 2]])
    expect(areInverses(map, 7, 7)).toBe(false)
  })
})
