import { describe, it, expect } from 'vitest'
import { buildSessionSnapshotHtml } from '../../src/utils/exportSnapshot'

const sampleChat = [
  { role: 'user' as const, content: '所有群都是交换群吗？', phase: undefined },
  { role: 'system' as const, content: '一个好的猜想！让我们验证 $S_3$。', phase: 'VERIFY' },
]

const sampleViz = {
  conjecture_journey: {
    timeline: [
      { step: 1, claim: '所有群可交换', verdict: 'refuted' as const, counter_example: 'S_3' },
    ],
    total_conjectures: 1,
    confirmed: 0,
    refuted: 1,
  },
  four_field_gauges: { cognitive_load: 0.4, flow_score: 0.7 },
}

describe('buildSessionSnapshotHtml', () => {
  it('produces a self-contained HTML string', () => {
    const html = buildSessionSnapshotHtml({
      studentId: 'stu-1',
      targetNode: 'symmetric_group',
      chat: sampleChat,
      fourFields: null,
      phaseTrace: ['PERCEIVE', 'VERIFY', 'DELIVER'],
      savedAt: '2026-08-14T00:00:00.000Z',
      visualData: null,
    })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('MathWeaver')
    expect(html).toContain('所有群都是交换群吗？')
  })

  it('escapes user content to prevent HTML injection', () => {
    const html = buildSessionSnapshotHtml({
      studentId: 'x',
      targetNode: 'n',
      chat: [{ role: 'user', content: '<script>alert(1)</script>', phase: undefined }],
      fourFields: null,
      phaseTrace: [],
      savedAt: '',
      visualData: null,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders conjecture journey stats when present', () => {
    const html = buildSessionSnapshotHtml({
      studentId: 'x',
      targetNode: 'symmetric_group',
      chat: [],
      fourFields: null,
      phaseTrace: [],
      savedAt: '',
      visualData: sampleViz,
    })
    expect(html).toContain('猜想旅程')
    expect(html).toContain('S_3')
  })
})