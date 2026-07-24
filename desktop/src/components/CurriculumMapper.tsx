import { useState, useMemo, memo } from 'react'

// ---------------------------------------------------------------------------
// CurriculumMapper
//
// 将 MathWeaver 的概念 DAG（抽象代数 / 群论部分）映射到标准课程框架。
// 灵感源于 MathVizy 的教材集成思路：把抽象的数学概念结构与真实的课程
// 标准（中国课程标准、Common Core）对应起来，便于教师按学段备课，也便
// 于学习者定位某个概念在正式课程中的位置与难度。
//
// 功能要点：
// - 内置两套课程框架数据（中国课程标准 / Common Core (US)）
// - 框架下拉切换 / 关键字搜索（概念名或课程主题）/ 难度筛选
// - 表头点击排序（概念、课程主题、年级、难度），难度按 入门<中级<高级 排序
// - 行可展开，显示该概念的前置依赖（对应 DAG 中的入边概念）
//
// 样式类名统一以 `cw-cm-` 为前缀，通过组件内 <style> 注入，复用全局暗色
// 主题 CSS 变量（--bg / --bg2 / --bg3 / --ink / --muted / --border /
// --accent / --accent2 / --mono 等）。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface CurriculumEntry {
  conceptId: string
  conceptName: string
  curriculumTopic: string
  grade: string
  standard: string
  difficulty: string
  /** 前置依赖概念名称（对应 DAG 中指向该节点的入边）。 */
  prerequisites?: string[]
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 难度排序权重，未匹配值靠后。 */
const DIFFICULTY_ORDER: Record<string, number> = {
  入门: 0,
  中级: 1,
  高级: 2,
}

/** 难度筛选项（全部 / 入门 / 中级 / 高级）。 */
const DIFFICULTY_FILTERS: string[] = ['全部', '入门', '中级', '高级']

/** 可排序字段。 */
type SortKey = 'conceptName' | 'curriculumTopic' | 'grade' | 'difficulty'
type SortDir = 'asc' | 'desc'

const COLUMN_LABELS: { key: SortKey; label: string }[] = [
  { key: 'conceptName', label: '概念' },
  { key: 'curriculumTopic', label: '课程主题' },
  { key: 'grade', label: '年级' },
  { key: 'difficulty', label: '难度' },
]

// ---------------------------------------------------------------------------
// 内置课程数据
//
// 每套框架覆盖至少 8 个群论核心概念：群的定义、子群、循环群、陪集与商群、
// 对称群、置换、同态与同构、直积（另含正规子群、拉格朗日定理以丰富结构）。
// ---------------------------------------------------------------------------

const CURRICULUM_DATA: Record<string, CurriculumEntry[]> = {
  '中国课程标准': [
    {
      conceptId: 'group_definition',
      conceptName: '群的定义',
      curriculumTopic: '代数学基础',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §1',
      difficulty: '入门',
      prerequisites: ['集合与映射', '二元运算', '等价关系'],
    },
    {
      conceptId: 'subgroup',
      conceptName: '子群',
      curriculumTopic: '子结构与判定',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §2',
      difficulty: '入门',
      prerequisites: ['群的定义'],
    },
    {
      conceptId: 'cyclic_group',
      conceptName: '循环群',
      curriculumTopic: '循环结构',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §3',
      difficulty: '中级',
      prerequisites: ['群的定义', '子群', '同余与剩余系'],
    },
    {
      conceptId: 'coset_quotient',
      conceptName: '陪集与商群',
      curriculumTopic: '划分与商结构',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §4',
      difficulty: '高级',
      prerequisites: ['子群', '正规子群', '陪集'],
    },
    {
      conceptId: 'symmetric_group',
      conceptName: '对称群',
      curriculumTopic: '对称与变换',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §5',
      difficulty: '中级',
      prerequisites: ['群的定义', '置换', '双射'],
    },
    {
      conceptId: 'permutation',
      conceptName: '置换',
      curriculumTopic: '排列与置换',
      grade: '高中 / 大学本科',
      standard: '课标·高中·计数原理',
      difficulty: '中级',
      prerequisites: ['排列组合', '双射'],
    },
    {
      conceptId: 'homomorphism_isomorphism',
      conceptName: '同态与同构',
      curriculumTopic: '群映射与结构定理',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §6',
      difficulty: '高级',
      prerequisites: ['群的定义', '正规子群', '满射与单射'],
    },
    {
      conceptId: 'direct_product',
      conceptName: '直积',
      curriculumTopic: '群的构造',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §7',
      difficulty: '中级',
      prerequisites: ['群的定义', '子群'],
    },
    {
      conceptId: 'normal_subgroup',
      conceptName: '正规子群',
      curriculumTopic: '共轭与正规性',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §4.1',
      difficulty: '中级',
      prerequisites: ['子群', '陪集'],
    },
    {
      conceptId: 'lagrange_theorem',
      conceptName: '拉格朗日定理',
      curriculumTopic: '计数定理',
      grade: '大学本科',
      standard: '课标·高教·抽象代数 §4.2',
      difficulty: '高级',
      prerequisites: ['陪集', '子群的阶'],
    },
  ],

  'Common Core (US)': [
    {
      conceptId: 'group_definition',
      conceptName: '群的定义',
      curriculumTopic: '代数结构',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.1',
      difficulty: '入门',
      prerequisites: ['集合与映射', '二元运算', '等价关系'],
    },
    {
      conceptId: 'subgroup',
      conceptName: '子群',
      curriculumTopic: '子结构与判定',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.2',
      difficulty: '入门',
      prerequisites: ['群的定义'],
    },
    {
      conceptId: 'cyclic_group',
      conceptName: '循环群',
      curriculumTopic: '循环结构',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.3',
      difficulty: '中级',
      prerequisites: ['群的定义', '子群', '模运算'],
    },
    {
      conceptId: 'coset_quotient',
      conceptName: '陪集与商群',
      curriculumTopic: '划分与商结构',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.4',
      difficulty: '高级',
      prerequisites: ['子群', '正规子群', '陪集'],
    },
    {
      conceptId: 'symmetric_group',
      conceptName: '对称群',
      curriculumTopic: '对称与变换',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.5',
      difficulty: '中级',
      prerequisites: ['群的定义', '置换', '双射'],
    },
    {
      conceptId: 'permutation',
      conceptName: '置换',
      curriculumTopic: '计数与置换',
      grade: '高中 (9-12)',
      standard: 'HSS.CP.B.9',
      difficulty: '中级',
      prerequisites: ['排列组合', '双射'],
    },
    {
      conceptId: 'homomorphism_isomorphism',
      conceptName: '同态与同构',
      curriculumTopic: '群映射与结构定理',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.6',
      difficulty: '高级',
      prerequisites: ['群的定义', '正规子群', '单射与满射'],
    },
    {
      conceptId: 'direct_product',
      conceptName: '直积',
      curriculumTopic: '群的构造',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.7',
      difficulty: '中级',
      prerequisites: ['群的定义', '子群'],
    },
    {
      conceptId: 'normal_subgroup',
      conceptName: '正规子群',
      curriculumTopic: '共轭与正规性',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.4.1',
      difficulty: '中级',
      prerequisites: ['子群', '陪集'],
    },
    {
      conceptId: 'lagrange_theorem',
      conceptName: '拉格朗日定理',
      curriculumTopic: '计数定理',
      grade: '大学',
      standard: 'CCSS.EXT.ALG.4.2',
      difficulty: '高级',
      prerequisites: ['陪集', '子群的阶'],
    },
  ],
}

const FRAMEWORKS: string[] = Object.keys(CURRICULUM_DATA)

// ---------------------------------------------------------------------------
// 内联样式（暗色主题，复用全局 CSS 变量，cw-cm- 前缀作用域）
//
// 注：--accent2 在当前主题中可能未定义，使用 var(--accent2, …) 提供回退，
// 既满足样式规范要求引用该变量，又保证渲染不中断。
// ---------------------------------------------------------------------------

const STYLES = `
.cw-cm-root {
  font-family: var(--sans);
  color: var(--ink);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 18px 20px 20px;
}

/* --- 标题 --- */
.cw-cm-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.cw-cm-title {
  font-family: var(--serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  margin: 0;
  letter-spacing: -0.01em;
}
.cw-cm-badge {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-subtle, hsla(285, 55%, 72%, 0.10));
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}
.cw-cm-subtitle {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 16px;
  line-height: 1.5;
}

/* --- 工具栏 --- */
.cw-cm-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 16px;
  padding: 12px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  margin-bottom: 14px;
}
.cw-cm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.cw-cm-field-grow { flex: 1 1 220px; }
.cw-cm-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.cw-cm-select,
.cw-cm-input {
  appearance: none;
  -webkit-appearance: none;
  font-family: var(--sans);
  font-size: 13px;
  color: var(--ink);
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 7px 10px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  width: 100%;
}
.cw-cm-select {
  padding-right: 26px;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%),
                    linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 14px) 52%, calc(100% - 9px) 52%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  cursor: pointer;
}
.cw-cm-select:focus,
.cw-cm-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-subtle, hsla(285, 55%, 72%, 0.18));
}
.cw-cm-input::placeholder { color: var(--muted); opacity: 0.8; }

.cw-cm-diff-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg3);
}
.cw-cm-diff-btn {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  background: transparent;
  border: none;
  border-right: 1px solid var(--border);
  padding: 7px 11px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}
.cw-cm-diff-btn:last-child { border-right: none; }
.cw-cm-diff-btn:hover { color: var(--ink); }
.cw-cm-diff-btn.active {
  color: var(--ink);
  background: var(--accent-subtle, hsla(285, 55%, 72%, 0.14));
  box-shadow: inset 0 -2px 0 var(--accent);
}

/* --- 统计行 --- */
.cw-cm-stats {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 8px;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.cw-cm-stats .cw-cm-stats-num { color: var(--ink); font-weight: 600; }

/* --- 表格 --- */
.cw-cm-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 5px;
}
.cw-cm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 640px;
}
.cw-cm-table thead th {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  text-align: left;
  padding: 10px 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
}
.cw-cm-th-sort {
  cursor: pointer;
  transition: color 0.15s;
}
.cw-cm-th-sort:hover { color: var(--ink); }
.cw-cm-th-sort.cw-cm-th-active { color: var(--accent); }
.cw-cm-sort-ind {
  display: inline-block;
  margin-left: 4px;
  font-size: 9px;
  color: var(--accent);
  opacity: 0.4;
}
.cw-cm-th-active .cw-cm-sort-ind { opacity: 1; }
.cw-cm-th-nosort { cursor: default; }

.cw-cm-table tbody tr { border-bottom: 1px solid var(--border-subtle, hsl(222, 8%, 18%)); }
.cw-cm-table tbody tr:last-child { border-bottom: none; }

.cw-cm-row {
  cursor: pointer;
  transition: background 0.12s;
}
.cw-cm-row:hover { background: var(--bg3); }
.cw-cm-row.cw-cm-row-open { background: var(--bg3); }

.cw-cm-table td {
  padding: 10px 12px;
  color: var(--ink);
  vertical-align: middle;
}

.cw-cm-concept {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cw-cm-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.18s ease, color 0.15s;
  flex-shrink: 0;
}
.cw-cm-row-open .cw-cm-chevron { transform: rotate(90deg); color: var(--accent2, hsl(210, 60%, 68%)); }
.cw-cm-concept-name { font-weight: 600; color: var(--ink); }
.cw-cm-concept-id {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.cw-cm-topic { color: var(--ink); }
.cw-cm-grade { color: var(--muted); font-size: 12px; white-space: nowrap; }
.cw-cm-standard {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent2, hsl(210, 60%, 68%));
  white-space: nowrap;
}

/* --- 难度徽标 --- */
.cw-cm-difficulty {
  display: inline-block;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.03em;
  border: 1px solid transparent;
  white-space: nowrap;
}
.cw-cm-diff-入门 {
  color: var(--ok);
  background: hsla(142, 45%, 62%, 0.10);
  border-color: hsla(142, 45%, 62%, 0.28);
}
.cw-cm-diff-中级 {
  color: var(--accent);
  background: hsla(285, 55%, 72%, 0.10);
  border-color: hsla(285, 55%, 72%, 0.28);
}
.cw-cm-diff-高级 {
  color: var(--err);
  background: hsla(355, 65%, 68%, 0.10);
  border-color: hsla(355, 65%, 68%, 0.28);
}

/* --- 展开行 --- */
.cw-cm-expand-cell { padding: 0 !important; background: var(--bg); }
.cw-cm-expand-inner {
  padding: 12px 16px 14px 34px;
  border-top: 1px dashed var(--border);
}
.cw-cm-expand-label {
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 8px;
}
.cw-cm-prereq-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cw-cm-prereq-chip {
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink);
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
  transition: border-color 0.15s, color 0.15s;
}
.cw-cm-prereq-chip:hover {
  border-color: var(--accent2, hsl(210, 60%, 68%));
  color: var(--accent2, hsl(210, 60%, 68%));
}
.cw-cm-prereq-chip::before {
  content: '←';
  margin-right: 5px;
  color: var(--muted);
  font-family: var(--mono);
}
.cw-cm-prereq-empty {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  font-style: italic;
}

/* --- 空状态 / 页脚 --- */
.cw-cm-empty {
  text-align: center;
  padding: 32px 16px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}
.cw-cm-footer {
  margin-top: 10px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  text-align: right;
}
`

// ---------------------------------------------------------------------------
// 组件实现
// ---------------------------------------------------------------------------

function CurriculumMapperBase() {
  const [framework, setFramework] = useState<string>(FRAMEWORKS[0])
  const [search, setSearch] = useState('')
  const [difficulty, setDifficulty] = useState('全部')
  const [sortKey, setSortKey] = useState<SortKey>('conceptName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const entries = CURRICULUM_DATA[framework] ?? []

  // 过滤 + 排序
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    const matched = entries.filter((e) => {
      if (difficulty !== '全部' && e.difficulty !== difficulty) return false
      if (q) {
        const haystack = `${e.conceptName} ${e.curriculumTopic} ${e.standard}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    const sorted = [...matched].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'difficulty') {
        cmp =
          (DIFFICULTY_ORDER[a.difficulty] ?? 99) -
          (DIFFICULTY_ORDER[b.difficulty] ?? 99)
      } else {
        cmp = String(a[sortKey]).localeCompare(String(b[sortKey]), 'zh-Hans-CN')
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return sorted
  }, [entries, search, difficulty, sortKey, sortDir])

  // 切换框架时重置展开行
  const handleFrameworkChange = (next: string) => {
    setFramework(next)
    setExpandedId(null)
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const handleRowToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const handleResetFilters = () => {
    setSearch('')
    setDifficulty('全部')
    setExpandedId(null)
  }

  const difficultyClass = (d: string) => {
    switch (d) {
      case '入门':
        return 'cw-cm-diff-入门'
      case '中级':
        return 'cw-cm-diff-中级'
      case '高级':
        return 'cw-cm-diff-高级'
      default:
        return ''
    }
  }

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? '▲' : '▼'
  }

  return (
    <div className="cw-cm-root">
      <style>{STYLES}</style>

      <div className="cw-cm-header">
        <h3 className="cw-cm-title">课程标准映射</h3>
        <span className="cw-cm-badge">概念 DAG → 课程标准</span>
      </div>
      <p className="cw-cm-subtitle">
        将 MathWeaver 概念依赖图映射至标准课程框架（灵感源于 MathVizy 教材集成）
      </p>

      {/* 工具栏 */}
      <div className="cw-cm-toolbar">
        <div className="cw-cm-field" style={{ flex: '0 0 auto' }}>
          <span className="cw-cm-label">课程框架</span>
          <select
            className="cw-cm-select"
            value={framework}
            onChange={(e) => handleFrameworkChange(e.target.value)}
            aria-label="选择课程框架"
          >
            {FRAMEWORKS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="cw-cm-field cw-cm-field-grow">
          <span className="cw-cm-label">搜索</span>
          <input
            className="cw-cm-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按概念名称、课程主题或标准筛选…"
            aria-label="搜索概念或课程主题"
          />
        </div>

        <div className="cw-cm-field" style={{ flex: '0 0 auto' }}>
          <span className="cw-cm-label">难度</span>
          <div className="cw-cm-diff-group" role="group" aria-label="难度筛选">
            {DIFFICULTY_FILTERS.map((d) => (
              <button
                key={d}
                type="button"
                className={`cw-cm-diff-btn${difficulty === d ? ' active' : ''}`}
                onClick={() => setDifficulty(d)}
                aria-pressed={difficulty === d}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 统计 */}
      <div className="cw-cm-stats">
        <span>
          共 <span className="cw-cm-stats-num">{entries.length}</span> 条映射
        </span>
        <span>
          筛选后 <span className="cw-cm-stats-num">{filtered.length}</span> 条
        </span>
        <span>
          当前框架：<span className="cw-cm-stats-num">{framework}</span>
        </span>
        {(search !== '' || difficulty !== '全部') && (
          <button
            type="button"
            onClick={handleResetFilters}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '3px',
              color: 'var(--muted)',
              fontFamily: 'var(--mono)',
              fontSize: '10px',
              padding: '1px 8px',
              cursor: 'pointer',
            }}
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 表格 */}
      <div className="cw-cm-table-wrap">
        <table className="cw-cm-table">
          <thead>
            <tr>
              {COLUMN_LABELS.map((col) => (
                <th
                  key={col.key}
                  className={`cw-cm-th-sort${sortKey === col.key ? ' cw-cm-th-active' : ''}`}
                  onClick={() => handleSort(col.key)}
                  title={`按${col.label}排序`}
                >
                  {col.label}
                  <span className="cw-cm-sort-ind">{sortIndicator(col.key)}</span>
                </th>
              ))}
              <th className="cw-cm-th-nosort">标准</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="cw-cm-empty">
                  没有符合条件的映射条目，请调整搜索或筛选条件
                </td>
              </tr>
            )}
            {filtered.map((e) => {
              const isOpen = expandedId === e.conceptId
              const prereqs = e.prerequisites ?? []
              // 返回数组而非 Fragment：满足「仅从 react 导入 useState/useMemo/memo」
              // 的约束，同时为兄弟 <tr> 提供唯一 key（React 会自动展平嵌套数组）。
              return [
                <tr
                  key={e.conceptId}
                  className={`cw-cm-row${isOpen ? ' cw-cm-row-open' : ''}`}
                  onClick={() => handleRowToggle(e.conceptId)}
                  aria-expanded={isOpen}
                >
                  <td>
                    <div className="cw-cm-concept">
                      <span className="cw-cm-chevron">▶</span>
                      <span>
                        <span className="cw-cm-concept-name">{e.conceptName}</span>
                        <br />
                        <span className="cw-cm-concept-id">{e.conceptId}</span>
                      </span>
                    </div>
                  </td>
                  <td className="cw-cm-topic">{e.curriculumTopic}</td>
                  <td className="cw-cm-grade">{e.grade}</td>
                  <td>
                    <span className={`cw-cm-difficulty ${difficultyClass(e.difficulty)}`}>
                      {e.difficulty}
                    </span>
                  </td>
                  <td className="cw-cm-standard">{e.standard}</td>
                </tr>,
                isOpen ? (
                  <tr key={`${e.conceptId}-exp`} className="cw-cm-expand-row">
                    <td colSpan={5} className="cw-cm-expand-cell">
                      <div className="cw-cm-expand-inner">
                        <div className="cw-cm-expand-label">
                          前置概念（概念 DAG 入边依赖）
                        </div>
                        {prereqs.length > 0 ? (
                          <div className="cw-cm-prereq-list">
                            {prereqs.map((p) => (
                              <span key={p} className="cw-cm-prereq-chip">
                                {p}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="cw-cm-prereq-empty">
                            该概念为基础入门，无前置依赖
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      </div>

      <div className="cw-cm-footer">点击表头排序 · 点击行展开前置概念</div>
    </div>
  )
}

export const CurriculumMapper = memo(CurriculumMapperBase)
CurriculumMapper.displayName = 'CurriculumMapper'
