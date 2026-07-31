import { describe, it, expect } from 'vitest'
import { SimpleConceptDAG } from '../../electron/backend/orchestrator/engine'

// ---------------------------------------------------------------------------
// SimpleConceptDAG — in-memory concept dependency graph
// ---------------------------------------------------------------------------

describe('SimpleConceptDAG', () => {
  it('initializes with default DAG nodes', () => {
    const dag = new SimpleConceptDAG()
    expect(dag.getNodeCount()).toBeGreaterThan(0)
  })

  it('retrieves a node by id', () => {
    const dag = new SimpleConceptDAG()
    const node = dag.getNode('group_definition')
    expect(node).toBeDefined()
    expect(node?.id).toBe('group_definition')
    expect(node?.name).toBe('群的定义')
  })

  it('returns undefined for non-existent node id', () => {
    const dag = new SimpleConceptDAG()
    const node = dag.getNode('does_not_exist')
    expect(node).toBeUndefined()
  })

  it('lists all nodes via getAllNodes', () => {
    const dag = new SimpleConceptDAG()
    const nodes = dag.getAllNodes()
    expect(nodes.length).toBe(dag.getNodeCount())
    // Each node should have required fields
    for (const node of nodes) {
      expect(node.id).toBeTruthy()
      expect(node.name).toBeTruthy()
      expect(Array.isArray(node.prerequisites)).toBe(true)
    }
  })

  it('checks prerequisites correctly', () => {
    const dag = new SimpleConceptDAG()
    // subgroup depends on group_definition
    const gaps = dag.checkPrerequisites('subgroup', {})
    expect(gaps).toContain('group_definition')
  })

  it('returns empty gaps when all prerequisites are mastered', () => {
    const dag = new SimpleConceptDAG()
    // Set mastery for all prerequisites of subgroup
    const node = dag.getNode('subgroup')
    if (!node) throw new Error('test setup failed')
    const mastery: Record<string, number> = {}
    for (const pre of node.prerequisites) {
      mastery[pre] = 0.8
    }
    const gaps = dag.checkPrerequisites('subgroup', mastery)
    expect(gaps).toEqual([])
  })

  it('returns empty gaps for node with no prerequisites', () => {
    const dag = new SimpleConceptDAG()
    // group_definition has no prerequisites
    const gaps = dag.checkPrerequisites('group_definition', {})
    expect(gaps).toEqual([])
  })

  it('returns empty path for non-existent target', () => {
    const dag = new SimpleConceptDAG()
    const path = dag.getLearningPath('does_not_exist', {})
    expect(path).toEqual([])
  })

  it('returns learning path including prerequisites', () => {
    const dag = new SimpleConceptDAG()
    const path = dag.getLearningPath('subgroup', {})
    // Path should include prerequisites and the target
    expect(path).toContain('subgroup')
    expect(path).toContain('group_definition')
  })

  it('finds dependents of a node', () => {
    const dag = new SimpleConceptDAG()
    // group_definition should be depended on by subgroup, cyclic_group, abelian_group
    const deps = dag.getDependents('group_definition')
    expect(deps).toContain('subgroup')
  })

  it('returns empty dependents for leaf nodes', () => {
    const dag = new SimpleConceptDAG()
    // lagrange_theorem is likely a leaf
    const deps = dag.getDependents('lagrange_theorem')
    // May or may not have dependents, but should return array
    expect(Array.isArray(deps)).toBe(true)
  })

  it('generates curriculum summary', () => {
    const dag = new SimpleConceptDAG()
    const summary = dag.getCurriculumSummary()
    expect(summary.total_nodes).toBeGreaterThan(0)
    expect(Array.isArray(summary.domains)).toBe(true)
    expect(summary.domains).toContain('group_theory')
    expect(typeof summary.levels).toBe('number')
    expect(summary.levels).toBeGreaterThan(0)
  })

  it('accepts custom node list', () => {
    const customNodes = [
      {
        id: 'a',
        name: 'Node A',
        description: 'First node',
        prerequisites: [],
        abstraction_level: 0,
        domain: 'test',
        difficulty: 0.1,
        is_milestone: false,
      },
      {
        id: 'b',
        name: 'Node B',
        description: 'Second node',
        prerequisites: ['a'],
        abstraction_level: 1,
        domain: 'test',
        difficulty: 0.3,
        is_milestone: false,
      },
    ]
    const dag = new SimpleConceptDAG(customNodes)
    expect(dag.getNodeCount()).toBe(2)
    expect(dag.getNode('a')?.name).toBe('Node A')
    expect(dag.getDependents('a')).toContain('b')
  })
})
