/**
 * Math concept DAG with multi-level curriculum support.
 *
 * Ported from Python backend (backend/mathweaver/dag/concept_dag.py).
 *
 * 从 JSON 数据文件加载概念依赖图。支持八个课程级别：
 *   - elementary (小学, grades 1-6)
 *   - middle_school (初中, grades 7-9)
 *   - high_school (高中, grades 10-12)
 *   - calculus (积分学, university year 1)
 *   - linear_algebra (线性代数, university year 1)
 *   - discrete_math (离散数学, university year 1-2)
 *   - number_theory (数论, university year 2)
 *   - group_theory (大学抽象代数, university year 2-3)
 *
 * 每个级别对应 data/ 目录下的一个独立 JSON 文件。
 */

import * as fs from 'fs'
import * as path from 'path'
import type { ConceptNode } from '../types'
import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('ConceptDAG')

// ---------------------------------------------------------------------------
// 数据文件目录
// ---------------------------------------------------------------------------

// 数据文件目录：相对于本模块的 ../data/
// Electron 主进程中 __dirname 可用（见 main/index.ts 中的用法）
const DATA_DIR = path.resolve(__dirname, '..', 'data')

// ---------------------------------------------------------------------------
// 课程级别常量
// ---------------------------------------------------------------------------

// 支持的课程级别，按进阶顺序排列
export const CURRICULUM_LEVELS: string[] = [
  'elementary',
  'middle_school',
  'high_school',
  'calculus',
  'linear_algebra',
  'discrete_math',
  'number_theory',
  'group_theory',
  'physics',
  'chemistry',
]

// 每个级别的人类可读标签
export const CURRICULUM_LABELS: Record<string, string> = {
  elementary: '小学数学',
  middle_school: '初中数学',
  high_school: '高中数学',
  calculus: '积分学（大学）',
  linear_algebra: '线性代数（大学）',
  discrete_math: '离散数学（大学）',
  number_theory: '数论（大学）',
  group_theory: '群论（大学）',
  physics: '物理（数学的延伸）',
  chemistry: '化学（数学的延伸）',
}

// ---------------------------------------------------------------------------
// 群论种子数据（JSON 文件不可用时的回退）
// ---------------------------------------------------------------------------

// 仅包含核心字段，缺失字段由 normalizeConceptNode 填充默认值
const GROUP_THEORY_SEED: Partial<ConceptNode>[] = [
  {
    id: 'set_basics',
    name: '集合基础',
    description: '集合的概念、运算（并、交、补）与映射',
    prerequisites: [],
    abstraction_level: 0,
    domain: 'foundations',
    difficulty: 0.2,
    is_milestone: true,
  },
  {
    id: 'binary_operation',
    name: '二元运算',
    description: '集合上的封闭二元运算，运算表（Cayley 表）',
    prerequisites: ['set_basics'],
    abstraction_level: 1,
    domain: 'algebra',
    difficulty: 0.3,
    is_milestone: false,
  },
  {
    id: 'associativity',
    name: '结合律',
    description: '运算的结合性质，与运算顺序无关',
    prerequisites: ['binary_operation'],
    abstraction_level: 1,
    domain: 'algebra',
    difficulty: 0.35,
    is_milestone: false,
  },
  {
    id: 'identity_element',
    name: '单位元',
    description: '使运算保持不变的元素 e：e·a = a·e = a',
    prerequisites: ['binary_operation', 'associativity'],
    abstraction_level: 2,
    domain: 'algebra',
    difficulty: 0.4,
    is_milestone: true,
  },
  {
    id: 'inverse_element',
    name: '逆元',
    description: '对每个元素 a，存在 a⁻¹ 使 a·a⁻¹ = e',
    prerequisites: ['identity_element', 'associativity'],
    abstraction_level: 2,
    domain: 'algebra',
    difficulty: 0.45,
    is_milestone: true,
  },
  {
    id: 'group_definition',
    name: '群的定义',
    description: '封闭性 + 结合律 + 单位元 + 逆元 = 群',
    prerequisites: ['binary_operation', 'associativity', 'identity_element', 'inverse_element'],
    abstraction_level: 3,
    domain: 'algebra',
    difficulty: 0.55,
    is_milestone: true,
  },
  {
    id: 'abelian_group',
    name: '交换群（Abel 群）',
    description: '满足交换律 a·b = b·a 的群',
    prerequisites: ['group_definition'],
    abstraction_level: 3,
    domain: 'algebra',
    difficulty: 0.5,
    is_milestone: false,
  },
  {
    id: 'cyclic_group',
    name: '循环群',
    description: '由单个元素生成的群：⟨g⟩ = {gⁿ | n ∈ ℤ}',
    prerequisites: ['group_definition'],
    abstraction_level: 4,
    domain: 'algebra',
    difficulty: 0.6,
    is_milestone: false,
  },
  {
    id: 'subgroup',
    name: '子群',
    description: '群的子集自身构成群',
    prerequisites: ['group_definition'],
    abstraction_level: 4,
    domain: 'algebra',
    difficulty: 0.6,
    is_milestone: true,
  },
  {
    id: 'lagrange_theorem',
    name: '拉格朗日定理',
    description: '子群的阶整除群的阶',
    prerequisites: ['subgroup', 'cyclic_group'],
    abstraction_level: 5,
    domain: 'algebra',
    difficulty: 0.75,
    is_milestone: true,
  },
]

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 将部分 JSON 条目规范化为完整的 ConceptNode，填充缺失字段的默认值。
 *
 * 对应 Python 版本中 ConceptNode(**entry) 的行为——Pydantic 模型为缺失字段
 * 提供默认值。TypeScript 中接口不提供运行时默认值，故在此显式填充。
 */
function normalizeConceptNode(entry: Partial<ConceptNode>): ConceptNode {
  return {
    id: entry.id ?? '',
    name: entry.name ?? '',
    description: entry.description ?? '',
    prerequisites: entry.prerequisites ?? [],
    abstraction_level: entry.abstraction_level ?? 0,
    domain: entry.domain ?? 'general',
    difficulty: entry.difficulty ?? 0.5,
    is_milestone: entry.is_milestone ?? false,
    learning_objectives: entry.learning_objectives ?? [],
    examples: entry.examples ?? [],
    assessment_criteria: entry.assessment_criteria ?? [],
    estimated_minutes: entry.estimated_minutes ?? 0,
    historical_context: entry.historical_context ?? '',
    related_theorems: entry.related_theorems ?? [],
    common_misconceptions: entry.common_misconceptions ?? [],
  }
}

/**
 * 从 JSON 文件加载指定级别的课程数据。
 *
 * 当 JSON 文件不可用时，仅 group_theory 级别回退到内置种子数据；
 * 其他级别直接抛出 FileNotFoundError 以暴露错误。
 */
function loadCurriculum(level: string = 'group_theory'): Partial<ConceptNode>[] {
  const curriculumPath = path.join(DATA_DIR, `${level}_curriculum.json`)

  if (fs.existsSync(curriculumPath)) {
    try {
      const raw = fs.readFileSync(curriculumPath, 'utf-8')
      const data = JSON.parse(raw) as Partial<ConceptNode>[]
      log.info('Loaded curriculum', {
        level,
        conceptCount: data.length,
        path: curriculumPath,
      })
      return data
    } catch (e) {
      log.warn('Failed to load curriculum JSON, using fallback', {
        level,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // 回退：内置种子数据（仅 group_theory 存在）
  if (level === 'group_theory') {
    return GROUP_THEORY_SEED
  }

  // 其他级别无回退——抛出异常以暴露错误
  throw new Error(`Curriculum file not found for level '${level}': ${curriculumPath}`)
}

/**
 * 列出所有可用课程级别及其元数据。
 *
 * 返回一个对象数组，每个对象包含 level、label、concept_count、file_exists 等字段。
 */
export function getAvailableCurricula(): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []

  for (const level of CURRICULUM_LEVELS) {
    const filePath = path.join(DATA_DIR, `${level}_curriculum.json`)
    const fileExists = fs.existsSync(filePath)

    const entry: Record<string, unknown> = {
      level,
      label: CURRICULUM_LABELS[level] ?? level,
      file: filePath,
      file_exists: fileExists,
    }

    if (fileExists) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw) as Partial<ConceptNode>[]
        entry['concept_count'] = data.length
        // 提取所有域
        const domains = new Set<string>()
        for (const c of data) {
          domains.add(c.domain ?? 'general')
        }
        entry['domains'] = Array.from(domains).sort()
      } catch {
        entry['concept_count'] = 0
        entry['domains'] = []
      }
    } else {
      entry['concept_count'] = 0
      entry['domains'] = []
    }

    result.push(entry)
  }

  return result
}

// ---------------------------------------------------------------------------
// ConceptDAG 类
// ---------------------------------------------------------------------------

/**
 * 内存中的概念依赖图。
 *
 * 支持从任意课程级别加载。level 字段用于内省和 UI 显示。
 */
export class ConceptDAG {
  /** 课程级别标识 */
  readonly level: string

  /** 节点映射表：node_id → ConceptNode */
  private _nodes: Map<string, ConceptNode> = new Map()

  /** 邻接表：node_id → 前置节点 ID 列表 */
  private _adjacency: Map<string, string[]> = new Map()

  /**
   * @param seedData  可选的种子数据。若为 undefined，则从 JSON 文件加载。
   * @param level     课程级别，默认 'group_theory'。
   */
  constructor(seedData?: Partial<ConceptNode>[], level: string = 'group_theory') {
    this.level = level
    const data = seedData ?? loadCurriculum(level)

    for (const entry of data) {
      const node = normalizeConceptNode(entry)
      this._nodes.set(node.id, node)
      this._adjacency.set(node.id, [...node.prerequisites])
    }
  }

  /** 获取指定节点，不存在时返回 undefined。 */
  getNode(nodeId: string): ConceptNode | undefined {
    return this._nodes.get(nodeId)
  }

  /** 获取指定节点的前置依赖列表。 */
  getPrerequisites(nodeId: string): string[] {
    return this._adjacency.get(nodeId) ?? []
  }

  /** 获取依赖指定节点的后续节点列表（即哪些节点以此为前置）。 */
  getDependents(nodeId: string): string[] {
    const result: string[] = []
    for (const [nid, prereqs] of this._adjacency) {
      if (prereqs.includes(nodeId)) {
        result.push(nid)
      }
    }
    return result
  }

  /**
   * 检查前置条件是否满足。
   *
   * @param nodeId   目标节点 ID。
   * @param mastery  掌握度映射表：node_id → 0~1 的掌握度。
   * @returns 未满足的前置节点 ID 列表（掌握度 < 0.6 视为未满足）。
   */
  checkPrerequisites(nodeId: string, mastery: Record<string, number>): string[] {
    const gaps: string[] = []
    for (const prereq of this.getPrerequisites(nodeId)) {
      if ((mastery[prereq] ?? 0.0) < 0.6) {
        gaps.push(prereq)
      }
    }
    return gaps
  }

  /**
   * 计算到达目标节点的学习路径，填充知识缺口。
   *
   * 使用深度优先遍历：对目标节点的每个未满足前置条件递归访问，
   * 最终返回一条从基础到目标的学习路径（掌握度 < 0.6 的节点）。
   *
   * @param targetNodeId  目标节点 ID。
   * @param mastery       掌握度映射表。
   * @returns 学习路径节点 ID 列表（按依赖顺序排列）。
   */
  getLearningPath(targetNodeId: string, mastery: Record<string, number>): string[] {
    const path: string[] = []
    const visited = new Set<string>()

    const visit = (nid: string): void => {
      if (visited.has(nid)) return
      visited.add(nid)

      for (const prereq of this.getPrerequisites(nid)) {
        if ((mastery[prereq] ?? 0.0) < 0.6) {
          visit(prereq)
        }
      }

      if ((mastery[nid] ?? 0.0) < 0.6) {
        path.push(nid)
      }
    }

    visit(targetNodeId)
    return path
  }

  /** 获取所有节点列表。 */
  getAllNodes(): ConceptNode[] {
    return Array.from(this._nodes.values())
  }

  /** 获取所有里程碑节点（is_milestone === true）。 */
  getMilestoneNodes(): ConceptNode[] {
    return Array.from(this._nodes.values()).filter(n => n.is_milestone)
  }

  /** 获取节点总数。 */
  getNodeCount(): number {
    return this._nodes.size
  }

  /**
   * 返回课程摘要，用于可视化。
   *
   * 包含级别、标签、总概念数、里程碑数、最大抽象层级、预计总时长、域列表。
   */
  getCurriculumSummary(): Record<string, unknown> {
    const nodes = Array.from(this._nodes.values())
    const maxAbstraction = nodes.reduce((max, n) => Math.max(max, n.abstraction_level), 0)
    const totalMinutes = nodes.reduce((sum, n) => sum + n.estimated_minutes, 0)
    const domains = new Set(nodes.map(n => n.domain))

    return {
      level: this.level,
      label: CURRICULUM_LABELS[this.level] ?? this.level,
      total_concepts: this._nodes.size,
      milestones: this.getMilestoneNodes().length,
      max_abstraction_level: maxAbstraction,
      total_estimated_minutes: totalMinutes,
      domains: Array.from(domains).sort(),
    }
  }

  /** 返回当前 DAG 的课程级别。 */
  getLevel(): string {
    return this.level
  }
}

// ---------------------------------------------------------------------------
// 多级别单例管理
// ---------------------------------------------------------------------------

// 每个课程级别拥有独立的单例 DAG
const _dags: Map<string, ConceptDAG> = new Map()

// 默认课程级别（向后兼容：无参数调用 getDag() 时使用此级别）
let DEFAULT_LEVEL = 'group_theory'

/**
 * 获取指定课程级别的单例 DAG。
 *
 * @param level  课程级别。若为 undefined，使用默认级别（group_theory）。
 * @returns 该级别的 ConceptDAG 单例。
 */
export function getDag(level?: string): ConceptDAG {
  const lvl = level ?? DEFAULT_LEVEL
  if (!_dags.has(lvl)) {
    _dags.set(lvl, new ConceptDAG(undefined, lvl))
  }
  return _dags.get(lvl)!
}

/**
 * 重置单例 DAG。
 *
 * @param level  若指定，仅重置该级别的 DAG；否则重置所有缓存的 DAG。
 */
export function resetDag(level?: string): void {
  if (level !== undefined) {
    _dags.delete(level)
  } else {
    _dags.clear()
  }
}

/**
 * 更改默认课程级别。
 *
 * 调用后，无参数的 getDag() 将返回新默认级别的 DAG。
 *
 * @throws Error 若 level 不在 CURRICULUM_LEVELS 中。
 */
export function setDefaultLevel(level: string): void {
  if (!CURRICULUM_LEVELS.includes(level)) {
    throw new Error(
      `Unknown curriculum level: ${level}. Available: ${CURRICULUM_LEVELS.join(', ')}`,
    )
  }
  DEFAULT_LEVEL = level
  log.info('Default curriculum level set', { level })
}
