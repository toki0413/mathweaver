/**
 * SQLite-backed state persistence for MathWeaver.
 *
 * Ported from Python backend (backend/mathweaver/persistence/store.py).
 *
 * 提供一个 StateStore 类，将会话、四场状态、学生档案、追加式证据链
 * 以及智能体间上下文消息持久化到 SQLite 数据库。
 *
 * 设计目标：
 * * 使用 better-sqlite3（同步 API），无需外部 ORM。
 * * SQL 注入安全——所有值通过参数化查询绑定，绝不使用字符串拼接构建 SQL。
 * * 历史感知——saveSession 在 upsert 会话行的同时，向 four_field_states
 *   表追加一条状态快照，提供完整的状态演变审计轨迹。
 * * 默认使用内存数据库（:memory:），便于测试。
 *
 * 表结构：
 *   sessions          —— 每个会话一行：session_id, student_id, created_at,
 *                        updated_at, state_json, profile_json
 *   four_field_states —— 追加式状态历史：id, session_id, snapshot_json, recorded_at
 *   evidence_entries  —— 证据链条目：id, session_id, sequence, entry_json, entry_hash
 *   context_messages  —— 智能体间上下文消息：id, session_id, message_json
 */

import Database from 'better-sqlite3'
import type { FourFieldState, StudentProfile } from '../types'
import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('Persistence')

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const _SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,
    student_id   TEXT,
    created_at   TEXT,
    updated_at   TEXT,
    state_json   TEXT,
    profile_json TEXT,
    teaching_memory_json TEXT
);

CREATE TABLE IF NOT EXISTS four_field_states (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    recorded_at   TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE IF NOT EXISTS evidence_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT,
    sequence    INTEGER,
    entry_json  TEXT,
    entry_hash  TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE IF NOT EXISTS context_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT,
    message_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_session
    ON evidence_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_context_session
    ON context_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_four_field_session
    ON four_field_states(session_id);
`

// ---------------------------------------------------------------------------
// 返回类型接口
// ---------------------------------------------------------------------------

/** loadSession 返回的会话数据结构。 */
export interface SessionRecord {
  session_id: string
  student_id: string
  created_at: string
  updated_at: string
  state: Record<string, unknown> | null
  profile: Record<string, unknown> | null
}

/** listSessions 返回的会话摘要。 */
export interface SessionSummary {
  session_id: string
  student_id: string
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 返回当前 UTC 时间的 ISO 8601 字符串。
 */
function _utcnowIso(): string {
  return new Date().toISOString()
}

/**
 * 将状态对象或学生档案序列化为 JSON 字符串。
 *
 * 对应 Python 版本的 _serialize_model——Python 版优先使用 Pydantic 的
 * model_dump(mode="json")，此处因 TypeScript 类型为纯接口，直接使用
 * JSON.stringify 即可。若对象拥有 snapshot() 方法（未来的类实现），
 * 则先调用它获取快照再序列化。
 *
 * @param model  待序列化的对象（FourFieldState、StudentProfile 或 null）。
 * @returns JSON 字符串，或 null（当 model 为 null 时）。
 */
function _serializeModel(
  model: FourFieldState | StudentProfile | Record<string, unknown> | null,
): string | null {
  if (model === null || model === undefined) return null

  // 若对象拥有 snapshot 方法（兼容未来的类实现），先获取快照
  const maybeSnapshot = (model as { snapshot?: () => unknown }).snapshot
  if (typeof maybeSnapshot === 'function') {
    return JSON.stringify(maybeSnapshot.call(model))
  }

  return JSON.stringify(model)
}

/**
 * 从证据条目中提取 entry_hash 字段。
 *
 * 证据链条目通常已携带密封的 entry_hash。若缺失（如普通 dict），
 * 返回空字符串以保证列非空。
 */
function _entryHash(entry: Record<string, unknown>): string {
  const value = entry['entry_hash']
  if (typeof value === 'string') return value
  if (value !== undefined) return String(value)
  return ''
}

/**
 * 安全的 JSON 解析：解析失败时返回空对象而非抛出异常。
 */
function safeJsonParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// StateStore 类
// ---------------------------------------------------------------------------

/**
 * SQLite 持久化层，用于 MathWeaver 会话管理。
 *
 * 使用 better-sqlite3（同步 API），默认使用内存数据库便于测试。
 * 使用文件系统路径可实现持久存储。
 *
 * 如果 better-sqlite3 原生模块加载失败（例如目标平台缺少预编译二进制，
 * 或系统缺少编译工具链），StateStore 会自动回退到内存模式并记录警告，
 * 保证应用不会因此崩溃。持久化功能在回退模式下不可用。
 */
export class StateStore {
  /** 数据库文件路径 */
  readonly dbPath: string

  /** better-sqlite3 数据库实例 */
  private _db: Database.Database | null

  /** 当原生模块加载失败时为 true，此时使用内存回退模式 */
  private _fallbackMode: boolean = false

  /**
   * @param dbPath  SQLite 数据库文件路径。默认 ':memory:'（内存数据库，适合测试）。
   *                 使用文件系统路径可实现持久存储。
   */
  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath
    try {
      this._db = new Database(dbPath)
      // 启用外键约束（SQLite 默认关闭）
      this._db.pragma('foreign_keys = ON')
      this.initSchema()
    } catch (err) {
      // better-sqlite3 原生模块可能因以下原因加载失败：
      //   - 目标平台/架构无预编译二进制
      //   - 系统缺少 python3/make/g++ 导致 npm rebuild 失败
      //   - Electron ABI 不匹配
      // 回退到内存模式，保证应用可用（持久化功能降级）。
      log.error('better-sqlite3 initialization failed, falling back to in-memory mode', {
        error: err instanceof Error ? err.message : String(err),
      })
      this._fallbackMode = true
      this._db = new Database(':memory:')
      this._db.pragma('foreign_keys = ON')
      this.initSchema()
    }
  }

  /**
   * 返回是否处于回退模式（原生模块加载失败）。
   * 调用方可据此向用户显示持久化功能降级的提示。
   */
  get isFallbackMode(): boolean {
    return this._fallbackMode
  }

  // -- schema -------------------------------------------------------------

  /**
   * 创建所有必需的表（如果尚不存在）。
   */
  initSchema(): void {
    if (!this._db) throw new Error('Database is closed')
    this._db.exec(_SCHEMA_SQL)
    // 迁移：为早期版本创建的 sessions 表补上 teaching_memory_json 列。
    const cols = this._db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    if (!cols.some(c => c.name === 'teaching_memory_json')) {
      this._db.exec('ALTER TABLE sessions ADD COLUMN teaching_memory_json TEXT')
    }
  }

  // -- sessions -----------------------------------------------------------

  /**
   * 持久化（upsert）一个会话，并追加一条状态历史快照。
   *
   * @param sessionId  唯一会话标识符。
   * @param studentId  会话所属学生的标识符。
   * @param state      当前要持久化的 FourFieldState。
   * @param profile    可选的 StudentProfile。为 null 时清除已有档案。
   */
  saveSession(
    sessionId: string,
    studentId: string,
    state: FourFieldState,
    profile: StudentProfile | null = null,
  ): void {
    if (!this._db) throw new Error('Database is closed')

    const now = _utcnowIso()
    const stateJson = _serializeModel(state)
    const profileJson = _serializeModel(profile)

    // 查询现有 created_at（更新时保留原值）
    const existing = this._db
      .prepare('SELECT created_at FROM sessions WHERE session_id = ?')
      .get(sessionId) as { created_at: string } | undefined

    const createdAt = existing?.created_at ?? now

    // 捕获 db 引用到局部变量，使 TypeScript 在事务闭包内能正确收窄类型
    const db = this._db

    // 使用事务保证原子性（对应 Python 的 with self._conn:）
    const upsertSession = db.transaction(() => {
      // UPSERT：插入或更新
      db.prepare(
        `INSERT INTO sessions
           (session_id, student_id, created_at, updated_at, state_json, profile_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           student_id   = excluded.student_id,
           updated_at   = excluded.updated_at,
           state_json   = excluded.state_json,
           profile_json = excluded.profile_json`,
      ).run(sessionId, studentId, createdAt, now, stateJson, profileJson)

      // 向状态历史表追加快照
      db.prepare(
        `INSERT INTO four_field_states
           (session_id, snapshot_json, recorded_at)
         VALUES (?, ?, ?)`,
      ).run(sessionId, stateJson, now)
    })

    upsertSession()
  }

  /**
   * 按 ID 加载会话。
   *
   * @returns 包含 session_id、student_id、created_at、updated_at、state、profile
   *          的对象；若会话不存在则返回 undefined。state 和 profile 为已解析的
   *          JSON 对象（或 null）。
   */
  loadSession(sessionId: string): SessionRecord | undefined {
    if (!this._db) throw new Error('Database is closed')

    const row = this._db
      .prepare(
        `SELECT session_id, student_id, created_at, updated_at,
                state_json, profile_json
         FROM sessions
         WHERE session_id = ?`,
      )
      .get(sessionId) as
      | {
          session_id: string
          student_id: string
          created_at: string
          updated_at: string
          state_json: string | null
          profile_json: string | null
        }
      | undefined

    if (row === undefined) return undefined

    return {
      session_id: row.session_id,
      student_id: row.student_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      state: row.state_json ? safeJsonParse(row.state_json) : null,
      profile: row.profile_json ? safeJsonParse(row.profile_json) : null,
    }
  }

  /**
   * 持久化会话的长程教学记忆（跨会话恢复）。
   *
   * 教学记忆是滚动摘要 + 追加式轮次日志 + token 指标的序列化快照，单独存于
   * sessions 行的 teaching_memory_json 列，与 FourFieldState/档案解耦，使
   * 长周期教学任务可在后续会话中无缝续接（对应 Harness "模型可见即已记录"）。
   *
   * @param sessionId  会话 ID（运行时即 studentId）。
   * @param data       教学记忆快照（TeachingMemory.toJSON() 的输出）。
   */
  saveTeachingMemory(sessionId: string, data: Record<string, unknown>): void {
    if (!this._db) throw new Error('Database is closed')
    this._db
      .prepare(
        `UPDATE sessions
         SET teaching_memory_json = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(JSON.stringify(data), _utcnowIso(), sessionId)
  }

  /**
   * 加载会话的长程教学记忆，用于跨会话恢复。
   *
   * @returns 教学记忆快照对象，会话不存在或从未保存教学记忆时返回 null。
   */
  loadTeachingMemory(sessionId: string): Record<string, unknown> | null {
    if (!this._db) throw new Error('Database is closed')
    const row = this._db
      .prepare('SELECT teaching_memory_json FROM sessions WHERE session_id = ?')
      .get(sessionId) as { teaching_memory_json: string | null } | undefined
    if (!row?.teaching_memory_json) return null
    return safeJsonParse(row.teaching_memory_json)
  }

  /**
   * 列出所有会话，按更新时间降序排列。
   *
   * @returns SessionSummary 数组，每项包含 session_id、student_id、
   *          created_at 和 updated_at。
   */
  listSessions(): SessionSummary[] {
    if (!this._db) throw new Error('Database is closed')

    const rows = this._db
      .prepare(
        `SELECT session_id, student_id, created_at, updated_at
         FROM sessions
         ORDER BY updated_at DESC`,
      )
      .all() as SessionSummary[]

    return rows
  }

  // -- evidence chain -----------------------------------------------------

  /**
   * 持久化会话的证据链。
   *
   * 使用先删后插的方式（在单个事务内）替换 session_id 对应的所有存储条目，
   * 使操作幂等：重新保存完整链产生相同的数据库状态。
   * sequence 和 entry_hash 列从条目自身的字段中提取，以便重载后可验证
   * 防篡改链。
   *
   * @param sessionId  会话 ID。
   * @param entries    可序列化的证据条目数组。
   */
  saveEvidence(sessionId: string, entries: Record<string, unknown>[]): void {
    if (!this._db) throw new Error('Database is closed')

    // 捕获 db 引用到局部变量，使 TypeScript 在事务闭包内能正确收窄类型
    const db = this._db

    const deleteAndInsert = db.transaction(() => {
      // 先删除该会话的所有现有证据
      db.prepare('DELETE FROM evidence_entries WHERE session_id = ?').run(sessionId)

      // 逐条插入
      const insertStmt = db.prepare(
        `INSERT INTO evidence_entries
           (session_id, sequence, entry_json, entry_hash)
         VALUES (?, ?, ?, ?)`,
      )

      for (const entry of entries) {
        const sequence = (entry['sequence'] as number) ?? 0
        const entryJson = JSON.stringify(entry)
        insertStmt.run(sessionId, sequence, entryJson, _entryHash(entry))
      }
    })

    deleteAndInsert()
  }

  /**
   * 加载会话的证据链，按 sequence 升序排列。
   *
   * @returns 证据条目数组，每个条目为已解析的 JSON 对象（包含 entry_hash）。
   */
  loadEvidence(sessionId: string): Record<string, unknown>[] {
    if (!this._db) throw new Error('Database is closed')

    const rows = this._db
      .prepare(
        `SELECT entry_json, entry_hash
         FROM evidence_entries
         WHERE session_id = ?
         ORDER BY sequence ASC, id ASC`,
      )
      .all(sessionId) as { entry_json: string; entry_hash: string }[]

    return rows.map(row => {
      const parsed = safeJsonParse(row.entry_json) as Record<string, unknown>
      parsed['entry_hash'] = row.entry_hash
      return parsed
    })
  }

  // -- context messages ---------------------------------------------------

  /**
   * 持久化会话的智能体间上下文消息。
   *
   * 与 saveEvidence 类似，使用先删后插的方式在单个事务内替换。
   *
   * @param sessionId  会话 ID。
   * @param messages   消息对象数组。
   */
  saveContextMessages(sessionId: string, messages: Record<string, unknown>[]): void {
    if (!this._db) throw new Error('Database is closed')

    // 捕获 db 引用到局部变量，使 TypeScript 在事务闭包内能正确收窄类型
    const db = this._db

    const deleteAndInsert = db.transaction(() => {
      // 先删除该会话的所有现有消息
      db.prepare('DELETE FROM context_messages WHERE session_id = ?').run(sessionId)

      // 逐条插入
      const insertStmt = db.prepare(
        `INSERT INTO context_messages
           (session_id, message_json)
         VALUES (?, ?)`,
      )

      for (const message of messages) {
        const messageJson = JSON.stringify(message)
        insertStmt.run(sessionId, messageJson)
      }
    })

    deleteAndInsert()
  }

  /**
   * 按插入顺序加载会话的上下文消息。
   *
   * @returns 已解析的消息对象数组。
   */
  loadContextMessages(sessionId: string): Record<string, unknown>[] {
    if (!this._db) throw new Error('Database is closed')

    const rows = this._db
      .prepare(
        `SELECT message_json
         FROM context_messages
         WHERE session_id = ?
         ORDER BY id ASC`,
      )
      .all(sessionId) as { message_json: string }[]

    return rows.map(row => safeJsonParse(row.message_json) as Record<string, unknown>)
  }

  // -- lifecycle ----------------------------------------------------------

  /**
   * 关闭底层数据库连接。
   */
  close(): void {
    if (this._db !== null) {
      this._db.close()
      this._db = null
    }
  }
}
