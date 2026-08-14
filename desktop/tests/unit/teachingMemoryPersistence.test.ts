import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { StateStore } from '../../electron/backend/persistence/store'
import {
  TeachingMemory,
  type TeachingTurn,
} from '../../electron/backend/orchestrator/teachingMemory'
import { Orchestrator } from '../../electron/backend/orchestrator/engine'

function turn(n: number, concept?: string): TeachingTurn {
  return {
    student: `学生问题 ${n}`,
    teacher: `教师回应 ${n}`,
    action: 'hint',
    hintLevel: n % 3,
    ...(concept ? { concept } : {}),
  }
}

describe('TeachingMemory serialization (cross-session persistence)', () => {
  it('round-trips through toJSON / fromJSON preserving all state', () => {
    const m = new TeachingMemory({ maxVerbatimTurns: 2 })
    for (let i = 1; i <= 4; i++) m.recordTurn(turn(i, '单位元'), 50)
    const restored = TeachingMemory.fromJSON(m.toJSON())

    expect(restored.totalTurnCount).toBe(4)
    expect(restored.verbatimTurnCount).toBe(2)
    expect(restored.concepts).toEqual(['单位元'])
    expect(restored.currentHintLevel).toBe(1)
    expect(restored.tokensUsed).toBe(200)
    expect(restored.toContextBlock()).toBe(m.toContextBlock())
  })

  it('fromJSON tolerates missing / malformed fields (defensive)', () => {
    const m = TeachingMemory.fromJSON({} as never)
    expect(m.totalTurnCount).toBe(0)
    expect(m.toContextBlock()).toContain('当前提示等级')

    const m2 = TeachingMemory.fromJSON({ allTurns: 'garbage' } as never)
    expect(m2.totalTurnCount).toBe(0)
  })
})

describe('StateStore teaching memory persistence', () => {
  it('saveTeachingMemory / loadTeachingMemory round-trips', () => {
    const store = new StateStore(':memory:')
    store.saveSession('stu-1', 'stu-1', {} as never)

    const m = new TeachingMemory()
    m.recordTurn(turn(1, '逆元'), 30)
    store.saveTeachingMemory('stu-1', { memory: m.toJSON(), scheduling: { turnCount: 5 } })

    const loaded = store.loadTeachingMemory('stu-1')
    expect(loaded).not.toBeNull()
    expect(loaded!.scheduling).toEqual({ turnCount: 5 })
    expect((loaded!.memory as { totalTokensUsed: number }).totalTokensUsed).toBe(30)
  })

  it('loadTeachingMemory returns null when nothing saved', () => {
    const store = new StateStore(':memory:')
    store.saveSession('stu-1', 'stu-1', {} as never)
    expect(store.loadTeachingMemory('stu-1')).toBeNull()
  })

  it('migrates an old sessions table by adding teaching_memory_json column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-migrate-'))
    const file = join(dir, 'old.db')
    try {
      // 用旧 schema（无 teaching_memory_json 列）创建库文件。
      const db = new Database(file)
      db.exec(`CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        student_id TEXT, created_at TEXT, updated_at TEXT,
        state_json TEXT, profile_json TEXT
      )`)
      db.exec(
        `INSERT INTO sessions (session_id, student_id, created_at, updated_at)
         VALUES ('old-1', 'stu', '2026-01-01', '2026-01-01')`,
      )
      db.close()

      // 打开旧库：StateStore.initSchema 应补齐列迁移，使教学记忆可写入/读取。
      const store = new StateStore(file)
      store.saveTeachingMemory('old-1', { memory: { allTurns: [], rollingSummary: 's' } })
      expect(store.loadTeachingMemory('old-1')).not.toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Orchestrator cross-session resume (db-backed)', () => {
  it('restores teaching memory and scheduling counters on session resume', async () => {
    // 用共享临时文件库：两个引擎连同一个 SQLite 文件，才能模拟跨会话续接
    // （:memory: 是两个独立连接，互不可见）。
    const dir = mkdtempSync(join(tmpdir(), 'mw-resume-'))
    const dbPath = join(dir, 'resume.db')
    try {
      const first = new Orchestrator({ dbPath })
      first.startSession('stu-1', '小明', 'symmetric_group')
      const r1 = await first.processStudentInput('什么是对称群？')
      expect(r1.scheduling).toBeDefined()
      expect(r1.scheduling!.turn_count).toBe(1)

      // 模拟"新会话"：同一 dbPath 新建引擎（同 student 续接）。
      const second = new Orchestrator({ dbPath })
      const started = second.startSession('stu-1', '小明', 'symmetric_group')
      const r2 = await second.processStudentInput('S3 是群吗？')
      expect(r2.scheduling!.turn_count).toBe(2) // 跨会话累计
      expect(r2.scheduling!.restored).toBe(true) // 记忆被续接
      expect(second.teachingMemory.totalTurnCount).toBeGreaterThanOrEqual(1)
      expect(second.teachingMemory.toContextBlock()).toContain('近几轮对话')
      expect(started.session_id).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts fresh when no persisted memory exists', async () => {
    const o = new Orchestrator({ dbPath: ':memory:' })
    o.startSession('stu-new', '新同学', 'symmetric_group')
    const r = await o.processStudentInput('什么是单位元？')
    expect(r.scheduling!.turn_count).toBe(1)
    expect(r.scheduling!.restored).toBe(false)
  })
})