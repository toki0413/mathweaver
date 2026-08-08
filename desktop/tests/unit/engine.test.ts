import { describe, it, expect } from 'vitest'
import {
  SimpleConceptDAG,
  SimpleGrillSession,
  validateProofStep,
  evaluateAnswer,
  extractKeyTerms,
} from '../../electron/backend/orchestrator/engine'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Recommended answer for grill question g2 (单位元唯一性) — used to verify
// keyword-based evaluation and explicit-override behaviour.
const G2_RECOMMENDED = '若 e 和 f 都是单位元，则 e = e·f = f，由传递性得 e = f。'

/** Helper: read the adaptive sub-object from a grill session summary. */
function adaptiveOf(session: SimpleGrillSession): {
  streak_correct: number
  streak_wrong: number
  total_questions: number
  current_difficulty: number
  should_increase: boolean
  should_decrease: boolean
  accuracy_rate: number
} {
  return session.getSummary().adaptive as ReturnType<typeof adaptiveOf>
}

// ===========================================================================
// 1. SimpleConceptDAG
// ===========================================================================

describe('SimpleConceptDAG', () => {
  it('getNode returns the correct node', () => {
    const dag = new SimpleConceptDAG()
    const node = dag.getNode('group_definition')
    expect(node).toBeDefined()
    expect(node?.id).toBe('group_definition')
    expect(node?.name).toBe('群的定义')
    expect(node?.domain).toBe('group_theory')
    expect(node?.prerequisites).toEqual([])
  })

  it('getNode returns undefined for a non-existent id', () => {
    const dag = new SimpleConceptDAG()
    expect(dag.getNode('does_not_exist')).toBeUndefined()
  })

  it('getAllNodes returns every node', () => {
    const dag = new SimpleConceptDAG()
    const nodes = dag.getAllNodes()
    expect(nodes.length).toBe(dag.getNodeCount())
    for (const node of nodes) {
      expect(typeof node.id).toBe('string')
      expect(typeof node.name).toBe('string')
      expect(Array.isArray(node.prerequisites)).toBe(true)
    }
    // Every node id should be retrievable via getNode
    for (const node of nodes) {
      expect(dag.getNode(node.id)?.id).toBe(node.id)
    }
  })

  it('getNodeCount returns the correct count', () => {
    const dag = new SimpleConceptDAG()
    // Default DAG ships with 6 group-theory nodes
    expect(dag.getNodeCount()).toBe(6)
    expect(dag.getNodeCount()).toBe(dag.getAllNodes().length)
  })

  it('checkPrerequisites returns gaps when mastery is below the threshold', () => {
    const dag = new SimpleConceptDAG()
    // subgroup depends on group_definition; with empty mastery the gap appears
    const gaps = dag.checkPrerequisites('subgroup', {})
    expect(gaps).toContain('group_definition')

    // lagrange_theorem depends on subgroup + cyclic_group
    const gaps2 = dag.checkPrerequisites('lagrange_theorem', {})
    expect(gaps2).toContain('subgroup')
    expect(gaps2).toContain('cyclic_group')

    // Mastery below 0.6 still counts as a gap
    const gaps3 = dag.checkPrerequisites('subgroup', { group_definition: 0.5 })
    expect(gaps3).toContain('group_definition')
  })

  it('checkPrerequisites returns an empty array when mastery is sufficient', () => {
    const dag = new SimpleConceptDAG()
    // 0.6 is the boundary; (0.6 ?? 0) < 0.6 is false → no gap
    const gaps = dag.checkPrerequisites('subgroup', { group_definition: 0.6 })
    expect(gaps).toEqual([])

    // Fully mastered prerequisites
    const gaps2 = dag.checkPrerequisites('lagrange_theorem', {
      subgroup: 0.9,
      cyclic_group: 0.8,
    })
    expect(gaps2).toEqual([])

    // Node with no prerequisites → always empty
    expect(dag.checkPrerequisites('group_definition', {})).toEqual([])
  })

  it('getLearningPath returns prerequisites followed by the target', () => {
    const dag = new SimpleConceptDAG()
    const path = dag.getLearningPath('lagrange_theorem', {})
    // prerequisites come first, target last
    expect(path).toEqual(['subgroup', 'cyclic_group', 'lagrange_theorem'])
    expect(path[path.length - 1]).toBe('lagrange_theorem')

    // Single-prerequisite node
    const path2 = dag.getLearningPath('subgroup', {})
    expect(path2).toEqual(['group_definition', 'subgroup'])

    // Non-existent target → empty path
    expect(dag.getLearningPath('missing', {})).toEqual([])
  })

  it('getDependents returns the child nodes that depend on the given id', () => {
    const dag = new SimpleConceptDAG()
    // group_definition is a prerequisite of subgroup, cyclic_group,
    // abelian_group and symmetric_group
    const deps = dag.getDependents('group_definition')
    expect(deps).toContain('subgroup')
    expect(deps).toContain('cyclic_group')
    expect(deps).toContain('abelian_group')
    expect(deps).toContain('symmetric_group')
    expect(deps).toHaveLength(4)

    // subgroup is depended on by lagrange_theorem
    const deps2 = dag.getDependents('subgroup')
    expect(deps2).toContain('lagrange_theorem')

    // Leaf node (no children) → empty array
    const leaf = dag.getDependents('lagrange_theorem')
    expect(leaf).toEqual([])
  })

  it('getCurriculumSummary returns correct stats', () => {
    const dag = new SimpleConceptDAG()
    const summary = dag.getCurriculumSummary()
    expect(summary.total_nodes).toBe(6)
    expect(Array.isArray(summary.domains)).toBe(true)
    expect(summary.domains).toContain('group_theory')
    // Max abstraction level across default nodes is 3
    expect(summary.levels).toBe(3)
  })

  it('accepts a custom node list', () => {
    const customNodes = [
      {
        id: 'a',
        name: 'Node A',
        description: 'first',
        prerequisites: [],
        abstraction_level: 0,
        domain: 'test',
      },
      {
        id: 'b',
        name: 'Node B',
        description: 'second',
        prerequisites: ['a'],
        abstraction_level: 1,
        domain: 'test',
      },
    ]
    const dag = new SimpleConceptDAG(customNodes)
    expect(dag.getNodeCount()).toBe(2)
    expect(dag.getNode('a')?.name).toBe('Node A')
    expect(dag.getDependents('a')).toContain('b')
    expect(dag.getCurriculumSummary().total_nodes).toBe(2)
  })
})

// ===========================================================================
// 2. validateProofStep
// ===========================================================================

describe('validateProofStep', () => {
  it('returns invalid for an empty claim', () => {
    const result = validateProofStep('', 'some justification', 'expected step', 0, [
      'expected step',
    ])
    expect(result.isValid).toBe(false)
    expect(result.feedback).toContain('为空')
    expect(result.implicitSteps).toEqual([])

    // Whitespace-only claim is also treated as empty
    const ws = validateProofStep('   ', '', 'expected', 0, [])
    expect(ws.isValid).toBe(false)
  })

  it('returns valid for a step that matches the expected terms', () => {
    // Expected step "e·f = f（e 是单位元）" yields key term "是单位元".
    // The claim repeats that term, so matchRatio >= 0.4 → valid.
    const result = validateProofStep(
      'e·f = f，因为 e 是单位元',
      'e 是单位元',
      'e·f = f（e 是单位元）',
      0,
      ['e·f = f（e 是单位元）'],
    )
    expect(result.isValid).toBe(true)
    expect(result.feedback).toContain('有效')
  })

  it('returns valid with a suggestion for a partial match', () => {
    // 5 expected key terms, claim matches only 1 → ratio 0.2 (partial band)
    // but the direction is correct → valid with suggestion.
    const expected = '结合律 单位元 逆元 封闭性 交换律'
    const result = validateProofStep('结合律成立', '', expected, 0, [expected])
    expect(result.isValid).toBe(true)
    expect(result.feedback).toContain('方向正确')
  })

  it('returns invalid when the step does not match the expected terms', () => {
    const expected = '结合律 单位元 逆元 封闭性 交换律'
    const result = validateProofStep('完全无关的内容xyz', '', expected, 0, [expected])
    expect(result.isValid).toBe(false)
    expect(result.feedback).toContain('步骤无效')
  })

  it('returns valid for an extra step that contains mathematical content', () => {
    // No expected step at this index (extra step). Claim contains "=" → math content.
    const result = validateProofStep('a·b = c', '由定义', '', 5, ['s1', 's2'])
    expect(result.isValid).toBe(true)
    expect(result.feedback).toContain('额外步骤')

    // A claim with a number also counts as math content
    const numeric = validateProofStep('考虑 3 阶群', '', '', 5, [])
    expect(numeric.isValid).toBe(true)
  })

  it('returns invalid for an extra step without any math content', () => {
    // Claim made entirely of stop words → no key terms, no math symbols.
    const result = validateProofStep('一个 如果', '', '', 5, [])
    expect(result.isValid).toBe(false)
    expect(result.feedback).toContain('缺乏数学内容')
  })
})

// ===========================================================================
// 3. SimpleGrillSession
// ===========================================================================

describe('SimpleGrillSession', () => {
  it('recordAnswer with a correct answer increments the streak', () => {
    const session = new SimpleGrillSession()
    session.activate()
    const result = session.recordAnswer('g1', '群是集合配运算满足公理', true)
    expect(result).toBe(true)

    const ad = adaptiveOf(session)
    expect(ad.streak_correct).toBe(1)
    expect(ad.streak_wrong).toBe(0)
    // A single correct answer is not yet enough to raise difficulty
    expect(ad.should_increase).toBe(false)
  })

  it('recordAnswer with a wrong answer resets the streak and decreases difficulty', () => {
    const session = new SimpleGrillSession()
    session.activate()

    // Build up a correct streak (difficulty rises to 0.55)
    session.recordAnswer('g1', 'x', true)
    session.recordAnswer('g1', 'x', true)
    expect(adaptiveOf(session).current_difficulty).toBeCloseTo(0.55)

    // Two consecutive wrong answers reset the correct streak and lower difficulty
    session.recordAnswer('g1', 'x', false)
    expect(adaptiveOf(session).streak_correct).toBe(0)
    expect(adaptiveOf(session).streak_wrong).toBe(1)

    session.recordAnswer('g1', 'x', false)
    const ad = adaptiveOf(session)
    expect(ad.streak_correct).toBe(0)
    expect(ad.streak_wrong).toBe(2)
    // Difficulty dropped from 0.55 → 0.45
    expect(ad.current_difficulty).toBeLessThan(0.55)
    expect(ad.current_difficulty).toBeCloseTo(0.45)
  })

  it('recordAnswer with explicit isCorrect overrides keyword evaluation', () => {
    // Baseline: what keyword evaluation alone would produce
    expect(evaluateAnswer('完全错误的答案', G2_RECOMMENDED)).toBe(false)
    expect(evaluateAnswer('都是单位元，由传递性得', G2_RECOMMENDED)).toBe(true)

    // Override: wrong text forced to correct
    const s1 = new SimpleGrillSession()
    s1.activate()
    expect(s1.recordAnswer('g2', '完全错误的答案', true)).toBe(true)

    // Override: correct text forced to wrong
    const s2 = new SimpleGrillSession()
    s2.activate()
    expect(s2.recordAnswer('g2', '都是单位元，由传递性得', false)).toBe(false)
  })

  it('increases difficulty after 2 consecutive correct answers', () => {
    const session = new SimpleGrillSession()
    session.activate()

    const d0 = adaptiveOf(session).current_difficulty // 0.4

    // First correct answer: streak 1, no increase yet
    session.recordAnswer('g1', 'x', true)
    const d1 = adaptiveOf(session).current_difficulty
    expect(d1).toBe(d0)
    expect(adaptiveOf(session).should_increase).toBe(false)

    // Second correct answer: streak 2 → increase
    session.recordAnswer('g1', 'x', true)
    const d2 = adaptiveOf(session).current_difficulty
    expect(d2).toBeGreaterThan(d1)
    expect(d2).toBeCloseTo(0.55)
    expect(adaptiveOf(session).should_increase).toBe(true)
  })

  it('decreases difficulty after 2 consecutive wrong answers', () => {
    const session = new SimpleGrillSession()
    session.activate()

    const d0 = adaptiveOf(session).current_difficulty // 0.4

    // First wrong answer: streak 1, no decrease yet
    session.recordAnswer('g1', 'x', false)
    const d1 = adaptiveOf(session).current_difficulty
    expect(d1).toBe(d0)
    expect(adaptiveOf(session).should_decrease).toBe(false)

    // Second wrong answer: streak 2 → decrease
    session.recordAnswer('g1', 'x', false)
    const d2 = adaptiveOf(session).current_difficulty
    expect(d2).toBeLessThan(d1)
    expect(d2).toBeCloseTo(0.3)
    expect(adaptiveOf(session).should_decrease).toBe(true)
  })

  it('keeps difficulty within the bounds [0.2, 0.9]', () => {
    const session = new SimpleGrillSession()
    session.activate()

    // Drive difficulty upward with many consecutive correct answers
    for (let i = 0; i < 10; i++) {
      session.recordAnswer('g1', 'x', true)
      const d = adaptiveOf(session).current_difficulty
      expect(d).toBeLessThanOrEqual(0.9)
    }
    expect(adaptiveOf(session).current_difficulty).toBeCloseTo(0.9)

    // Drive difficulty downward with many consecutive wrong answers
    for (let i = 0; i < 20; i++) {
      session.recordAnswer('g1', 'x', false)
      const d = adaptiveOf(session).current_difficulty
      expect(d).toBeGreaterThanOrEqual(0.2)
    }
    expect(adaptiveOf(session).current_difficulty).toBeCloseTo(0.2)
  })

  it('exposes question progression via nextQuestion and advance', () => {
    const session = new SimpleGrillSession()
    session.activate()
    const q0 = session.nextQuestion()
    expect(q0).not.toBeNull()
    expect(q0?.qid).toBe('g1')

    session.advance()
    const q1 = session.nextQuestion()
    expect(q1?.qid).toBe('g2')

    // Advance past the end
    session.currentIndex = 100
    expect(session.nextQuestion()).toBeNull()
  })
})

// ===========================================================================
// 4. evaluateAnswer
// ===========================================================================

describe('evaluateAnswer', () => {
  it('returns false for an empty answer', () => {
    expect(evaluateAnswer('', G2_RECOMMENDED)).toBe(false)
    expect(evaluateAnswer('   ', G2_RECOMMENDED)).toBe(false)
    expect(evaluateAnswer('\t\n', G2_RECOMMENDED)).toBe(false)
  })

  it('returns true when the answer covers 60%+ of the key terms', () => {
    // G2 key terms are "都是单位元" and "由传递性得" (2 terms).
    // An answer containing both → 100% match.
    expect(evaluateAnswer('都是单位元，由传递性得', G2_RECOMMENDED)).toBe(true)
    expect(evaluateAnswer('e 和 f 都是单位元，由传递性得 e = f', G2_RECOMMENDED)).toBe(true)
  })

  it('returns false when the answer covers <60% of the key terms', () => {
    // Only 1 of 2 key terms → 50% < 60%
    expect(evaluateAnswer('都是单位元', G2_RECOMMENDED)).toBe(false)
    expect(evaluateAnswer('由传递性得', G2_RECOMMENDED)).toBe(false)
    expect(evaluateAnswer('完全无关的内容', G2_RECOMMENDED)).toBe(false)
  })

  it('falls back to a length check when the recommended answer has no key terms', () => {
    // "a b c" → only single-char Latin terms, all filtered out → no key terms.
    const recommended = 'a b c'

    // Long enough answer → true
    expect(evaluateAnswer('a b c d e f g', recommended)).toBe(true)

    // Too short → false
    expect(evaluateAnswer('a', recommended)).toBe(false)
  })
})

// ===========================================================================
// 5. extractKeyTerms
// ===========================================================================

describe('extractKeyTerms', () => {
  it('extracts Chinese terms (2-6 chars)', () => {
    const terms = extractKeyTerms('群论 结合律')
    expect(terms).toContain('群论')
    expect(terms).toContain('结合律')

    // A single Chinese character is below the 2-char minimum and is ignored
    expect(extractKeyTerms('群')).toEqual([])
  })

  it('extracts Latin terms (2+ chars)', () => {
    const terms = extractKeyTerms('Lagrange ab')
    expect(terms).toContain('Lagrange')
    expect(terms).toContain('ab')

    // Single-char Latin tokens are filtered out
    expect(extractKeyTerms('a b c')).toEqual([])

    // Subscript-bearing tokens such as "S₃" are captured as a single term
    expect(extractKeyTerms('S₃')).toContain('S₃')
  })

  it('extracts numbers', () => {
    const terms = extractKeyTerms('阶为 3 和 4')
    expect(terms).toContain('3')
    expect(terms).toContain('4')
  })

  it('removes stop words', () => {
    const terms = extractKeyTerms('一个 因为 所以 群论')
    expect(terms).toContain('群论')
    expect(terms).not.toContain('一个')
    expect(terms).not.toContain('因为')
    expect(terms).not.toContain('所以')
  })

  it('returns unique terms (deduplicated)', () => {
    const terms = extractKeyTerms('群论 群论 结合律 结合律')
    expect(terms).toHaveLength(2)
    expect(terms).toContain('群论')
    expect(terms).toContain('结合律')
  })
})
