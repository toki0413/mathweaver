import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InteractiveExplorerProps {
  onGroupChange?: (info: {
    type: string
    order: number
    isGroup: boolean
    isAbelian: boolean
    identity: number | null
  }) => void
}

type GroupType = 'cyclic' | 'klein' | 's3'

/** 三态性质判定：通过 / 不通过 / 未确定（无法验证）。 */
type PropStatus = 'pass' | 'fail' | 'unknown'

interface GroupData {
  type: GroupType
  order: number
  table: number[][]
  /** 元素的展示标签（索引到记号的映射），例如 Z_n 用 '0'..'n-1'，S_3 用 'e','(12)'... */
  labels: string[]
}

interface SubgroupInfo {
  label: string
  order: number
  elements: string[]
}

interface AssocResult {
  status: PropStatus
  /** 已检验的三元组数量 */
  sampled: number
  /** 是否做了全量检验（小阶群） */
  exhaustive: boolean
  violation: [number, number, number] | null
}

interface InverseResult {
  status: PropStatus
  inverses: Map<number, number>
}

// ---------------------------------------------------------------------------
// InteractiveExplorer
//
// 参数滑块探索器：通过滑块控制群的阶 n（2-12）实时生成 Z_n 运算表，并在循环
// 群 Z_n / Klein 四元群 V_4 / 对称群 S_3 之间切换。组件实时检测并显示封闭性、
// 结合律（随机采样）、交换性、幺元、逆元与「是否为群」六项性质，附带属性面板
// （阶、元素、生成元）与子群列表（循环群列出全部子群）。
//
// 样式类名统一以 `ie-` 为前缀，通过组件内 <style> 注入，复用全局暗色 CSS 变量。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 群的构造
// ---------------------------------------------------------------------------

/** S_3 的 6 个元素，以 [0,1,2] 上的置换数组表示（左作用于下标）。 */
const S3_PERMS: number[][] = [
  [0, 1, 2], // e
  [1, 0, 2], // (12)
  [2, 1, 0], // (13)
  [0, 2, 1], // (23)
  [1, 2, 0], // (123)
  [2, 0, 1], // (132)
]

const S3_LABELS: string[] = ['e', '(12)', '(13)', '(23)', '(123)', '(132)']

/**
 * Klein 四元群 V_4 ≅ Z_2 × Z_2，阶 4。
 * 元素索引 0=e, 1=a, 2=b, 3=c，每个非幺元均为自逆元（阶 2）。
 */
const KLEIN_TABLE: number[][] = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [2, 3, 0, 1],
  [3, 2, 1, 0],
]
const KLEIN_LABELS: string[] = ['e', 'a', 'b', 'c']

/** 置换复合 (σ·τ)(i) = σ(τ(i))：先施 τ 再施 σ。 */
function composePerms(sigma: number[], tau: number[]): number[] {
  return sigma.map((_, i) => sigma[tau[i]])
}

/** 由置换复合生成 S_3 的 Cayley 表（保证正确性）。 */
function buildS3Table(): number[][] {
  const table: number[][] = []
  for (let i = 0; i < 6; i++) {
    const row: number[] = []
    for (let j = 0; j < 6; j++) {
      const prod = composePerms(S3_PERMS[i], S3_PERMS[j])
      const idx = S3_PERMS.findIndex(p => p[0] === prod[0] && p[1] === prod[1] && p[2] === prod[2])
      row.push(idx)
    }
    table.push(row)
  }
  return table
}

/** 循环群 Z_n：加法模 n，table[a][b] = (a + b) mod n。 */
function buildCyclicTable(n: number): number[][] {
  const table: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let j = 0; j < n; j++) {
      row.push((i + j) % n)
    }
    table.push(row)
  }
  return table
}

function buildGroup(type: GroupType, n: number): GroupData {
  switch (type) {
    case 'cyclic':
      return {
        type,
        order: n,
        table: buildCyclicTable(n),
        labels: Array.from({ length: n }, (_, i) => String(i)),
      }
    case 'klein':
      return {
        type,
        order: 4,
        table: KLEIN_TABLE.map(r => [...r]),
        labels: [...KLEIN_LABELS],
      }
    case 's3':
      return {
        type,
        order: 6,
        table: buildS3Table(),
        labels: [...S3_LABELS],
      }
  }
}

// ---------------------------------------------------------------------------
// 性质检测
// ---------------------------------------------------------------------------

/** 封闭性：遍历检查所有 a*b ∈ [0, n-1]。 */
function checkClosure(table: number[][], n: number): boolean {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = table[i]?.[j]
      if (typeof v !== 'number' || v < 0 || v > n - 1) return false
    }
  }
  return true
}

/** 以 n 为种子的确定性 PRNG，保证同一张表的采样结果在多次渲染间稳定。 */
function makeRng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * 结合律：随机采样检查 (a*b)*c === a*(b*c)，而非全量 O(n^3) 检查以避免性能问题。
 * - 封闭性不满足时无法可靠索引，返回 unknown。
 * - 小阶群（n^3 ≤ 预算）退化为全量检验，结果确定。
 * - 一旦发现违反即返回 fail 并记录反例三元组。
 */
function checkAssociativity(table: number[][], n: number, closureOk: boolean): AssocResult {
  if (!closureOk) {
    return { status: 'unknown', sampled: 0, exhaustive: false, violation: null }
  }
  const get = (a: number, b: number): number | null => {
    const v = table[a]?.[b]
    if (typeof v !== 'number' || v < 0 || v > n - 1) return null
    return v
  }
  const total = n * n * n
  const sampleBudget = 200
  const exhaustive = total <= sampleBudget
  const rng = makeRng(n)
  const triples: Array<[number, number, number]> = []
  if (exhaustive) {
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) triples.push([a, b, c])
  } else {
    for (let k = 0; k < sampleBudget; k++) {
      triples.push([Math.floor(rng() * n), Math.floor(rng() * n), Math.floor(rng() * n)])
    }
  }
  for (const [a, b, c] of triples) {
    const ab = get(a, b)
    const bc = get(b, c)
    if (ab === null || bc === null) {
      return { status: 'unknown', sampled: triples.length, exhaustive, violation: null }
    }
    const left = get(ab, c)
    const right = get(a, bc)
    if (left === null || right === null) {
      return { status: 'unknown', sampled: triples.length, exhaustive, violation: null }
    }
    if (left !== right) {
      return { status: 'fail', sampled: triples.length, exhaustive, violation: [a, b, c] }
    }
  }
  return { status: 'pass', sampled: triples.length, exhaustive, violation: null }
}

/** 交换性：遍历检查 a*b === b*a。封闭性不满足时返回 unknown。 */
function checkCommutativity(table: number[][], n: number, closureOk: boolean): PropStatus {
  if (!closureOk) return 'unknown'
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const ab = table[a]?.[b]
      const ba = table[b]?.[a]
      if (typeof ab !== 'number' || typeof ba !== 'number') return 'unknown'
      if (ab !== ba) return 'fail'
    }
  }
  return 'pass'
}

/** 幺元：找到满足 e*a = a*e = a 的元素 e。封闭性不满足时返回 null。 */
function findIdentity(table: number[][], n: number, closureOk: boolean): number | null {
  if (!closureOk) return null
  for (let e = 0; e < n; e++) {
    let ok = true
    for (let x = 0; x < n; x++) {
      const ex = table[e]?.[x]
      const xe = table[x]?.[e]
      if (typeof ex !== 'number' || typeof xe !== 'number') {
        ok = false
        break
      }
      if (ex !== x || xe !== x) {
        ok = false
        break
      }
    }
    if (ok) return e
  }
  return null
}

/** 逆元：在已知幺元的前提下，检查每个元素是否存在逆元。无幺元时返回 unknown。 */
function checkInverses(table: number[][], n: number, identity: number | null): InverseResult {
  if (identity === null) {
    return { status: 'unknown', inverses: new Map() }
  }
  const inverses = new Map<number, number>()
  for (let a = 0; a < n; a++) {
    let found = false
    for (let b = 0; b < n; b++) {
      const ab = table[a]?.[b]
      const ba = table[b]?.[a]
      if (typeof ab !== 'number' || typeof ba !== 'number') {
        return { status: 'unknown', inverses }
      }
      if (ab === identity && ba === identity) {
        inverses.set(a, b)
        found = true
        break
      }
    }
    if (!found) return { status: 'fail', inverses }
  }
  return { status: 'pass', inverses }
}

// ---------------------------------------------------------------------------
// 群论辅助：生成元、子群
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}

function divisors(n: number): number[] {
  const ds: number[] = []
  for (let d = 1; d <= n; d++) {
    if (n % d === 0) ds.push(d)
  }
  return ds
}

/** 循环群 Z_n 的生成元：满足 gcd(g, n) = 1 的元素 g（g ≠ 0）。 */
function cyclicGenerators(n: number): number[] {
  const gens: number[] = []
  for (let g = 1; g < n; g++) {
    if (gcd(g, n) === 1) gens.push(g)
  }
  return gens
}

/** 循环群 Z_n 的全部子群：对应 n 的每个约数 d，唯一子群 ⟨n/d⟩，阶为 d。 */
function cyclicSubgroups(n: number, labels: string[]): SubgroupInfo[] {
  return divisors(n).map(d => {
    const step = n / d
    const elems: string[] = []
    for (let k = 0; k < d; k++) {
      elems.push(labels[(k * step) % n])
    }
    return { label: `⟨${labels[step]}⟩`, order: d, elements: elems }
  })
}

const KLEIN_SUBGROUPS: SubgroupInfo[] = [
  { label: '{e}', order: 1, elements: ['e'] },
  { label: '⟨a⟩', order: 2, elements: ['e', 'a'] },
  { label: '⟨b⟩', order: 2, elements: ['e', 'b'] },
  { label: '⟨c⟩', order: 2, elements: ['e', 'c'] },
  { label: 'V₄', order: 4, elements: ['e', 'a', 'b', 'c'] },
]

const S3_SUBGROUPS: SubgroupInfo[] = [
  { label: '{e}', order: 1, elements: ['e'] },
  { label: '⟨(12)⟩', order: 2, elements: ['e', '(12)'] },
  { label: '⟨(13)⟩', order: 2, elements: ['e', '(13)'] },
  { label: '⟨(23)⟩', order: 2, elements: ['e', '(23)'] },
  { label: '⟨(123)⟩', order: 3, elements: ['e', '(123)', '(132)'] },
  {
    label: 'S₃',
    order: 6,
    elements: ['e', '(12)', '(13)', '(23)', '(123)', '(132)'],
  },
]

// ---------------------------------------------------------------------------
// 展示元数据
// ---------------------------------------------------------------------------

const STATUS_META: Record<PropStatus, { symbol: string; label: string; cls: string }> = {
  pass: { symbol: '✓', label: '满足', cls: 'ie-prop-pass' },
  fail: { symbol: '✗', label: '不满足', cls: 'ie-prop-fail' },
  unknown: { symbol: '?', label: '未确定', cls: 'ie-prop-unknown' },
}

const GROUP_TYPE_META: Record<
  GroupType,
  { label: string; desc: string; fixedOrder: number | null }
> = {
  cyclic: { label: '循环群 Zₙ', desc: '加法模 n，阶由滑块控制', fixedOrder: null },
  klein: { label: 'Klein 四元群 V₄', desc: 'Z₂ × Z₂，阶固定为 4', fixedOrder: 4 },
  s3: { label: '对称群 S₃', desc: '3 元置换，阶固定为 6', fixedOrder: 6 },
}

const MIN_N = 2
const MAX_N = 12

// ---------------------------------------------------------------------------
// 内联样式（暗色主题，复用全局 CSS 变量）
// ---------------------------------------------------------------------------

const STYLES = `
.ie-root {
  font-family: var(--serif);
  color: var(--ink);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 18px 20px;
}
.ie-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--ink);
}
.ie-subtitle {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 16px;
}
.ie-controls {
  display: flex;
  align-items: flex-start;
  gap: 28px;
  flex-wrap: wrap;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.ie-control-group { display: flex; flex-direction: column; gap: 6px; }
.ie-control-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ie-type-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.ie-type-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: transparent;
  color: var(--muted);
  font-family: var(--serif);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.ie-type-btn:hover { color: var(--ink); border-color: var(--muted); }
.ie-type-btn.active {
  background: rgba(198, 120, 221, 0.12);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.ie-type-desc {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.ie-slider-wrap { min-width: 240px; }
.ie-slider-row { display: flex; align-items: center; gap: 12px; }
.ie-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  background: var(--bg3);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.ie-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: none;
}
.ie-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: none;
}
.ie-slider:disabled { opacity: 0.4; cursor: not-allowed; }
.ie-slider:disabled::-webkit-slider-thumb { background: var(--muted); cursor: not-allowed; }
.ie-slider:disabled::-moz-range-thumb { background: var(--muted); cursor: not-allowed; }
.ie-slider-value {
  font-family: var(--mono);
  font-size: 14px;
  color: var(--ink);
  min-width: 54px;
  text-align: right;
  font-weight: 600;
}
.ie-fixed-note {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--warn);
}
.ie-body {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(260px, 1fr);
  gap: 24px;
  align-items: start;
}
@media (max-width: 760px) {
  .ie-body { grid-template-columns: 1fr; }
}
.ie-table-wrap {
  overflow: auto;
  max-width: 100%;
  padding-bottom: 4px;
}
.ie-table {
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: 12px;
}
.ie-table th, .ie-table td {
  min-width: 32px;
  height: 30px;
  text-align: center;
  border: 1px solid var(--border);
  padding: 0 6px;
  transition: background 0.12s, color 0.12s;
}
.ie-table th {
  background: var(--bg3);
  color: var(--muted);
  font-weight: 500;
  font-size: 11px;
}
.ie-table .ie-corner { background: var(--bg); }
.ie-table .ie-rowhead { background: var(--bg3); color: var(--muted); }
.ie-table td.ie-cell {
  color: var(--ink);
  cursor: default;
}
.ie-table td.ie-cell:hover {
  background: rgba(198, 120, 221, 0.2);
  color: var(--accent);
}
.ie-cell-idrow, .ie-cell-idcol {
  background: rgba(152, 195, 121, 0.07);
}
.ie-cell-idrow:hover, .ie-cell-idcol:hover {
  background: rgba(198, 120, 221, 0.2);
}
.ie-side { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.ie-section-title {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 8px;
}
.ie-props { display: flex; flex-direction: column; gap: 6px; }
.ie-prop {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
}
.ie-prop-name {
  font-family: var(--serif);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  min-width: 68px;
}
.ie-prop-tag {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 2px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.ie-prop-pass { background: rgba(152, 195, 121, 0.14); color: var(--ok); border: 1px solid rgba(152, 195, 121, 0.3); }
.ie-prop-fail { background: rgba(224, 108, 117, 0.14); color: var(--err); border: 1px solid rgba(224, 108, 117, 0.3); }
.ie-prop-unknown { background: rgba(229, 192, 123, 0.14); color: var(--warn); border: 1px solid rgba(229, 192, 123, 0.3); }
.ie-prop-note {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  margin-left: auto;
  text-align: right;
  line-height: 1.4;
}
.ie-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.ie-panel-item {
  background: var(--bg);
  padding: 8px 10px;
}
.ie-panel-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  margin-bottom: 3px;
}
.ie-panel-value {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink);
  word-break: break-word;
  line-height: 1.5;
}
.ie-panel-value .ie-gen { color: var(--accent); }
.ie-subgroups { display: flex; flex-direction: column; gap: 6px; }
.ie-subgroup {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 11px;
}
.ie-subgroup-label { color: var(--accent); font-weight: 600; min-width: 78px; }
.ie-subgroup-order { color: var(--muted); }
.ie-subgroup-elems { color: var(--ink); margin-left: auto; text-align: right; }
.ie-empty { font-family: var(--mono); font-size: 11px; color: var(--muted); }
`

// ---------------------------------------------------------------------------
// 组件实现
// ---------------------------------------------------------------------------

function InteractiveExplorerBase({ onGroupChange }: InteractiveExplorerProps) {
  const [groupType, setGroupType] = useState<GroupType>('cyclic')
  const [n, setN] = useState<number>(6)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)

  // 固定阶群（Klein/S_3）忽略滑块；循环群使用滑块值 n。
  const effectiveOrder = GROUP_TYPE_META[groupType].fixedOrder ?? n
  const sliderDisabled = groupType !== 'cyclic'

  // 当前群数据（运算表 + 标签）。
  const group = useMemo(() => buildGroup(groupType, effectiveOrder), [groupType, effectiveOrder])

  // --- 实时性质检测（依赖运算表） ---
  const closureOk = useMemo(() => checkClosure(group.table, group.order), [group])
  const assoc = useMemo(
    () => checkAssociativity(group.table, group.order, closureOk),
    [group, closureOk],
  )
  const comm = useMemo(
    () => checkCommutativity(group.table, group.order, closureOk),
    [group, closureOk],
  )
  const identity = useMemo(
    () => findIdentity(group.table, group.order, closureOk),
    [group, closureOk],
  )
  const inv = useMemo(() => checkInverses(group.table, group.order, identity), [group, identity])

  // 幺元状态：封闭性不满足时无法判定 → unknown。
  const identityStatus: PropStatus = !closureOk ? 'unknown' : identity !== null ? 'pass' : 'fail'

  // 是否为群：任一 fail 即 fail；任一 unknown 且无 fail 即 unknown；否则 pass。
  const isGroup: PropStatus = useMemo(() => {
    const statuses: PropStatus[] = [
      closureOk ? 'pass' : 'fail',
      assoc.status,
      comm,
      identityStatus,
      inv.status,
    ]
    if (statuses.some(s => s === 'fail')) return 'fail'
    if (statuses.some(s => s === 'unknown')) return 'unknown'
    return 'pass'
  }, [closureOk, assoc.status, comm, identityStatus, inv.status])

  const isAbelian = comm === 'pass'

  // --- 生成元 ---
  const generators = useMemo<string[]>(() => {
    if (groupType === 'cyclic') {
      return cyclicGenerators(group.order).map(g => group.labels[g])
    }
    return []
  }, [groupType, group])

  // --- 子群列表 ---
  const subgroups = useMemo<SubgroupInfo[]>(() => {
    if (groupType === 'cyclic') return cyclicSubgroups(group.order, group.labels)
    if (groupType === 'klein') return KLEIN_SUBGROUPS
    return S3_SUBGROUPS
  }, [groupType, group])

  // --- 通知父组件当前群信息 ---
  useEffect(() => {
    onGroupChange?.({
      type: GROUP_TYPE_META[groupType].label,
      order: group.order,
      isGroup: isGroup === 'pass',
      isAbelian,
      identity: identity !== null ? identity : null,
    })
  }, [groupType, group.order, isGroup, isAbelian, identity, onGroupChange])

  // --- 事件处理 ---
  const handleTypeChange = useCallback((t: GroupType) => {
    setGroupType(t)
  }, [])

  const handleNChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10)
    if (!Number.isNaN(v)) setN(Math.max(MIN_N, Math.min(MAX_N, v)))
  }, [])

  // 切换群类型时把视图滚回表格起点。
  useEffect(() => {
    if (tableWrapRef.current) tableWrapRef.current.scrollLeft = 0
  }, [groupType, effectiveOrder])

  // --- 性质条目 ---
  const propItems: { name: string; status: PropStatus; note: string }[] = [
    {
      name: '封闭性',
      status: closureOk ? 'pass' : 'fail',
      note: '遍历检查 a·b ∈ G',
    },
    {
      name: '结合律',
      status: assoc.status,
      note:
        assoc.status === 'pass'
          ? assoc.exhaustive
            ? `全量 ${assoc.sampled} 组通过`
            : `采样 ${assoc.sampled} 组通过`
          : assoc.status === 'fail'
            ? `违反: (${assoc.violation?.map(x => group.labels[x]).join(', ') ?? ''})`
            : '封闭性未满足',
    },
    {
      name: '交换性',
      status: comm,
      note:
        comm === 'pass' ? '∀a,b: a·b = b·a' : comm === 'fail' ? '存在 a·b ≠ b·a' : '封闭性未满足',
    },
    {
      name: '幺元',
      status: identityStatus,
      note:
        identityStatus === 'pass'
          ? `e = ${group.labels[identity as number]}`
          : identityStatus === 'fail'
            ? '未找到幺元'
            : '封闭性未满足',
    },
    {
      name: '逆元',
      status: inv.status,
      note:
        inv.status === 'pass'
          ? '每个元素均有逆元'
          : inv.status === 'fail'
            ? '存在元素无逆元'
            : '缺少幺元',
    },
    {
      name: '是否为群',
      status: isGroup,
      note:
        isGroup === 'pass'
          ? '四条公理全部满足'
          : isGroup === 'fail'
            ? '存在不满足的公理'
            : '部分公理未确定',
    },
  ]

  const typeMeta = GROUP_TYPE_META[groupType]

  return (
    <div className="ie-root">
      <style>{STYLES}</style>

      <h3 className="ie-title">群性质探索器</h3>
      <p className="ie-subtitle">拖动滑块改变群的阶，实时观察运算表与群公理的满足情况</p>

      {/* 控制区：群类型选择 + 阶滑块 */}
      <div className="ie-controls">
        <div className="ie-control-group">
          <span className="ie-control-label">群类型</span>
          <div className="ie-type-tabs" role="tablist" aria-label="群类型">
            {(Object.keys(GROUP_TYPE_META) as GroupType[]).map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={groupType === t}
                className={`ie-type-btn${groupType === t ? ' active' : ''}`}
                onClick={() => handleTypeChange(t)}
              >
                {GROUP_TYPE_META[t].label}
              </button>
            ))}
          </div>
          <span className="ie-type-desc">{typeMeta.desc}</span>
        </div>

        <div className="ie-control-group ie-slider-wrap">
          <span className="ie-control-label">群的阶 n（Zₙ）</span>
          <div className="ie-slider-row">
            <input
              type="range"
              className="ie-slider"
              min={MIN_N}
              max={MAX_N}
              step={1}
              value={sliderDisabled ? (typeMeta.fixedOrder ?? n) : n}
              disabled={sliderDisabled}
              onChange={handleNChange}
              aria-label="群的阶 n"
            />
            <span className="ie-slider-value">
              n = {sliderDisabled ? (typeMeta.fixedOrder ?? n) : n}
            </span>
          </div>
          {sliderDisabled ? (
            <span className="ie-fixed-note">此群阶固定为 {typeMeta.fixedOrder}，滑块已禁用</span>
          ) : (
            <span className="ie-type-desc">
              范围 {MIN_N}–{MAX_N}，生成 Zₙ 运算表
            </span>
          )}
        </div>
      </div>

      {/* 主体：运算表 + 侧栏 */}
      <div className="ie-body">
        <div className="ie-table-wrap" ref={tableWrapRef}>
          <table className="ie-table" aria-label={`${typeMeta.label} 运算表`}>
            <thead>
              <tr>
                <th className="ie-corner">·</th>
                {group.labels.map((lbl, j) => (
                  <th key={j}>{lbl}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.table.map((row, i) => (
                <tr key={i}>
                  <th className="ie-rowhead">{group.labels[i]}</th>
                  {row.map((val, j) => {
                    const isIdRow = identity === i
                    const isIdCol = identity === j
                    return (
                      <td
                        key={j}
                        className={[
                          'ie-cell',
                          isIdRow ? 'ie-cell-idrow' : '',
                          isIdCol ? 'ie-cell-idcol' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={`${group.labels[i]} · ${group.labels[j]} = ${group.labels[val]}`}
                      >
                        {group.labels[val]}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ie-side">
          {/* 性质标签 */}
          <div>
            <div className="ie-section-title">群公理检测</div>
            <div className="ie-props">
              {propItems.map(p => {
                const meta = STATUS_META[p.status]
                return (
                  <div className="ie-prop" key={p.name}>
                    <span className="ie-prop-name">{p.name}</span>
                    <span className={`ie-prop-tag ${meta.cls}`}>
                      {meta.symbol} {meta.label}
                    </span>
                    <span className="ie-prop-note">{p.note}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 属性面板：阶、元素、生成元 */}
          <div>
            <div className="ie-section-title">群属性</div>
            <div className="ie-panel">
              <div className="ie-panel-item">
                <div className="ie-panel-label">阶 |G|</div>
                <div className="ie-panel-value">{group.order}</div>
              </div>
              <div className="ie-panel-item">
                <div className="ie-panel-label">幺元</div>
                <div className="ie-panel-value">
                  {identity !== null ? group.labels[identity] : '—'}
                </div>
              </div>
              <div className="ie-panel-item">
                <div className="ie-panel-label">元素</div>
                <div className="ie-panel-value">{group.labels.join(', ')}</div>
              </div>
              <div className="ie-panel-item">
                <div className="ie-panel-label">生成元</div>
                <div className="ie-panel-value">
                  {generators.length > 0 ? (
                    <span className="ie-gen">{generators.join(', ')}</span>
                  ) : (
                    <span className="ie-empty">无（非循环群）</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 子群列表 */}
          <div>
            <div className="ie-section-title">子群（{subgroups.length} 个）</div>
            <div className="ie-subgroups">
              {subgroups.map((sg, i) => (
                <div className="ie-subgroup" key={i}>
                  <span className="ie-subgroup-label">{sg.label}</span>
                  <span className="ie-subgroup-order">阶 {sg.order}</span>
                  <span className="ie-subgroup-elems">
                    {'{'}
                    {sg.elements.join(', ')}
                    {'}'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const InteractiveExplorer = memo(InteractiveExplorerBase)
InteractiveExplorer.displayName = 'InteractiveExplorer'
