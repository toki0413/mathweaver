import { describe, it, expect } from 'vitest'
import {
  sanitizeCourseNodes,
  COURSE_JSON_SCHEMA_HINT,
} from '../../electron/backend/generator/courseGenerator'

describe('courseGenerator', () => {
  it('keeps valid nodes and drops ones without a name', () => {
    const raw = [
      { id: 'a', name: 'A', description: 'd', prerequisites: [] },
      { description: 'no name here', prerequisites: [] },
    ]
    const out = sanitizeCourseNodes(raw)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })

  it('regenerates a unique id for a name-bearing node with an invalid id', () => {
    const out = sanitizeCourseNodes([{ id: '', name: 'bad', description: 'x', prerequisites: [] }])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('bad')
    expect(out[0].id).toMatch(/^generated_/)
  })

  it('assigns unique ids when missing', () => {
    const out = sanitizeCourseNodes([{ name: 'only-name' }])
    expect(out[0].id).toBeTruthy()
    expect(out[0].name).toBe('only-name')
  })

  it('exposes a JSON schema hint for the LLM prompt', () => {
    expect(COURSE_JSON_SCHEMA_HINT).toContain('nodes')
  })

  it('normalizes all expected ConceptNode fields', () => {
    const out = sanitizeCourseNodes([
      { name: 'n', prerequisites: ['a'], estimated_minutes: 45 },
    ])
    expect(out[0].prerequisites).toEqual(['a'])
    expect(out[0].estimated_minutes).toBe(45)
    expect(out[0].is_milestone).toBe(false)
    expect(out[0].learning_objectives).toEqual([])
  })
})