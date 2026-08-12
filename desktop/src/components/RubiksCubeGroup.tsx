import { useState, useMemo, useEffect, useRef } from 'react'
import type { AgeLevel } from '../utils/ageAdapt'
import { soundSystem } from '../utils/sound'

// ============================================================================
// RubiksCubeGroup — 魔方移动群的置换探秘
//
// 承结构主义传统：用魔方教授群论，核心思想是
//   「交换子 [A,B] = A·B·A⁻¹·B⁻¹ 是非交换性的度量」。
//
// 为可在浏览器中直观演示，采用「6 个面心位置」上的简化置换模型
// （非完整 54 贴纸群 |G|≈4.3×10¹⁹）。面编号：
//   0=U(上) 1=D(下) 2=F(前) 3=B(后) 4=L(左) 5=R(右)
// ============================================================================

// 置换类型：perm[i] = i 的像（即 σ(i) = perm[i]）
type Perm = number[]

const FACE_NAMES = ['U', 'D', 'F', 'B', 'L', 'R'] as const

// 恒等置换
const IDENTITY: Perm = [0, 1, 2, 3, 4, 5]

// U（从上方看顺时针）：侧面四面循环 F→R→B→L→F
//   2→5, 5→3, 3→4, 4→2  ⇒  循环 (F R B L)
const U_MOVE: Perm = [0, 1, 5, 4, 2, 3]
// U² = (F B)(R L)
const U2_MOVE: Perm = [0, 1, 3, 2, 5, 4]
// U' = (F L B R)
const UP_MOVE: Perm = [0, 1, 4, 5, 3, 2]

// R（从右侧看顺时针）：U→F→D→B→U
//   0→2, 2→1, 1→3, 3→0  ⇒  循环 (U F D B)
const R_MOVE: Perm = [2, 3, 1, 0, 4, 5]
// R² = (U D)(F B)
const R2_MOVE: Perm = [1, 0, 3, 2, 4, 5]
// R' = (U B D F)
const RP_MOVE: Perm = [3, 2, 0, 1, 4, 5]

interface MoveDef {
  key: string
  label: string
  perm: Perm
}

const MOVE_E: MoveDef = { key: 'e', label: 'e', perm: IDENTITY }
const MOVE_U: MoveDef = { key: 'U', label: 'U', perm: U_MOVE }
const MOVE_UP: MoveDef = { key: "U'", label: "U'", perm: UP_MOVE }
const MOVE_U2: MoveDef = { key: 'U2', label: 'U²', perm: U2_MOVE }
const MOVE_R: MoveDef = { key: 'R', label: 'R', perm: R_MOVE }
const MOVE_RP: MoveDef = { key: "R'", label: "R'", perm: RP_MOVE }
const MOVE_R2: MoveDef = { key: 'R2', label: 'R²', perm: R2_MOVE }

// 交换子计算器可选操作（含单位元）
const ALL_MOVES: MoveDef[] = [MOVE_E, MOVE_U, MOVE_UP, MOVE_U2, MOVE_R, MOVE_RP, MOVE_R2]
// 合成表的 6 个元素（顺序：U, R, U², R², U', R'）
const TABLE_MOVES: MoveDef[] = [MOVE_U, MOVE_R, MOVE_U2, MOVE_R2, MOVE_UP, MOVE_RP]
// 序列构建器可用操作（不含单位元）
const SEQ_MOVES: MoveDef[] = [MOVE_U, MOVE_UP, MOVE_U2, MOVE_R, MOVE_RP, MOVE_R2]

// ----------------------------------------------------------------------------
// 置换运算
// ----------------------------------------------------------------------------

/** 合成 (a ∘ b)[i] = a[b[i]] —— 先作用 b，再作用 a；即 a·b */
function compose(a: Perm, b: Perm): Perm {
  const out: Perm = new Array<number>(b.length)
  for (let i = 0; i < b.length; i++) out[i] = a[b[i]]
  return out
}

/** 逆置换：inv[p[i]] = i */
function inverse(p: Perm): Perm {
  const inv: Perm = new Array<number>(p.length)
  for (let i = 0; i < p.length; i++) inv[p[i]] = i
  return inv
}

/** 交换子 [a,b] = a·b·a⁻¹·b⁻¹ = a ∘ b ∘ a⁻¹ ∘ b⁻¹ */
function commutator(a: Perm, b: Perm): Perm {
  return compose(a, compose(b, compose(inverse(a), inverse(b))))
}

function permEquals(a: Perm, b: Perm): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function isIdentity(p: Perm): boolean {
  return permEquals(p, IDENTITY)
}

/** 循环记号；compact=true 时不加空格，便于表格紧凑显示 */
function toCycle(p: Perm, compact = false): string {
  if (isIdentity(p)) return 'e'
  const seen = new Array<boolean>(p.length).fill(false)
  const cycles: string[] = []
  const sep = compact ? '' : ' '
  for (let i = 0; i < p.length; i++) {
    if (seen[i] || p[i] === i) {
      seen[i] = true
      continue
    }
    const cyc: string[] = []
    let j = i
    while (!seen[j]) {
      seen[j] = true
      cyc.push(FACE_NAMES[j])
      j = p[j]
    }
    if (cyc.length > 1) cycles.push('(' + cyc.join(sep) + ')')
  }
  return cycles.length > 0 ? cycles.join('') : 'e'
}

function getMoveByKey(key: string): MoveDef {
  return ALL_MOVES.find(m => m.key === key) ?? MOVE_E
}

function findMoveByPerm(p: Perm): MoveDef {
  return ALL_MOVES.find(m => permEquals(m.perm, p)) ?? MOVE_E
}

// ----------------------------------------------------------------------------
// CSS 3D 立方体面定义（标准魔方配色）
// ----------------------------------------------------------------------------
const HALF = 75 // 立方体边长 150px 的一半
const FACES: { name: string; cls: string; tf: string }[] = [
  { name: 'U', cls: 'u', tf: `rotateX(90deg) translateZ(${HALF}px)` },
  { name: 'D', cls: 'd', tf: `rotateX(-90deg) translateZ(${HALF}px)` },
  { name: 'F', cls: 'f', tf: `translateZ(${HALF}px)` },
  { name: 'B', cls: 'b', tf: `rotateY(180deg) translateZ(${HALF}px)` },
  { name: 'L', cls: 'l', tf: `rotateY(-90deg) translateZ(${HALF}px)` },
  { name: 'R', cls: 'r', tf: `rotateY(90deg) translateZ(${HALF}px)` },
]

/** 序列移动对应的立方体旋转增量 [dx, dy]（度） */
function moveDelta(key: string): [number, number] {
  switch (key) {
    case 'U':
      return [0, -90]
    case "U'":
      return [0, 90]
    case 'U2':
      return [0, -180]
    case 'R':
      return [-90, 0]
    case "R'":
      return [90, 0]
    case 'R2':
      return [-180, 0]
    default:
      return [0, 0]
  }
}

// ----------------------------------------------------------------------------
// 年龄适配文案
// ----------------------------------------------------------------------------
const SUBTITLE: Record<AgeLevel, string> = {
  kids: '转一转，看看「顺序」为什么很重要！',
  tweens: '用魔方感受非交换性与交换子 [A,B]',
  teens: "Rubik's Cube Move Group — Commutators & Non-commutativity",
}

const MODEL_NOTE: Record<AgeLevel, string> = {
  kids: '我们把魔方简化成 6 个面来玩：转一面就是给面「换座位」。',
  tweens: '简化模型：6 个面心位置上的置换（U、R 生成），非完整 54 贴纸群 |G|≈4.3×10¹⁹。',
  teens:
    'Simplified model: permutations on 6 face-center positions generated by U, R — a tiny slice of the full cube group |G|≈4.3×10¹⁹.',
}

const EDU: Record<AgeLevel, { primary: string; deep: string }> = {
  kids: {
    primary: '转动魔方就像魔法！先转上面再转右边，和先转右边再转上面，结果不一样哦！',
    deep: '数学家把这种「顺序很重要」叫做「不交换」。交换子就是用来测量它的小工具——结果越不像「什么都没变」，这两个操作就越不交换。',
  },
  tweens: {
    primary: '交换子 [A,B] = A·B·A⁻¹·B⁻¹ 衡量两个操作「不交换」的程度',
    deep: '用魔方演示：当 [A,B] = e（单位元）时，A 与 B 可交换；否则不可交换。上方表格里，颜色不同的格子就是「不可交换」的操作对。',
  },
  teens: {
    primary: 'The commutator subgroup [G,G] measures the degree of non-commutativity',
    deep: 'Commutators quantify non-commutativity. [A,B]=e iff A,B commute. The commutator subgroup [G,G] is normal in G, and the abelianization G/[G,G] is the largest abelian quotient.',
  },
}

interface Props {
  ageLevel: AgeLevel
}

export function RubiksCubeGroup({ ageLevel }: Props) {
  // 交换子计算器
  const [commAKey, setCommAKey] = useState<string>('U')
  const [commBKey, setCommBKey] = useState<string>('R')

  // 操作序列 + 立方体旋转
  const [sequence, setSequence] = useState<MoveDef[]>([])
  const [cubeRotX, setCubeRotX] = useState(0)
  const [cubeRotY, setCubeRotY] = useState(0)

  const moveA = getMoveByKey(commAKey)
  const moveB = getMoveByKey(commBKey)
  const invA = findMoveByPerm(inverse(moveA.perm))
  const invB = findMoveByPerm(inverse(moveB.perm))

  const commResult = useMemo(
    () => commutator(getMoveByKey(commAKey).perm, getMoveByKey(commBKey).perm),
    [commAKey, commBKey],
  )
  const commIsIdentity = isIdentity(commResult)
  const abPerm = compose(moveA.perm, moveB.perm)
  const baPerm = compose(moveB.perm, moveA.perm)
  const abCommutes = permEquals(abPerm, baPerm)

  // 合成表（常量数据，预计算一次）
  const tableGrid = useMemo(
    () =>
      TABLE_MOVES.map(rowM =>
        TABLE_MOVES.map(colM => {
          const ab = compose(rowM.perm, colM.perm)
          const ba = compose(colM.perm, rowM.perm)
          return {
            key: `${rowM.key}-${colM.key}`,
            label: toCycle(ab, true),
            commute: permEquals(ab, ba),
            isInv: isIdentity(ab),
          }
        }),
      ),
    [],
  )

  // 序列累积置换：依次应用序列中的操作（先加入的先作用）
  const sequenceResult = useMemo(
    () => sequence.reduce<Perm>((acc, m) => compose(m.perm, acc), IDENTITY),
    [sequence],
  )
  const seqIsIdentity = sequence.length > 0 && isIdentity(sequenceResult)

  // 「还原」发现时刻音效
  const prevSolvedRef = useRef(false)
  useEffect(() => {
    if (seqIsIdentity && !prevSolvedRef.current) soundSystem.play('complete')
    prevSolvedRef.current = seqIsIdentity
  }, [seqIsIdentity])

  // ---- 事件处理 ----
  const handleSelectA = (key: string) => {
    setCommAKey(key)
    const res = commutator(getMoveByKey(key).perm, getMoveByKey(commBKey).perm)
    soundSystem.play(isIdentity(res) ? 'correct' : 'discover')
  }
  const handleSelectB = (key: string) => {
    setCommBKey(key)
    const res = commutator(getMoveByKey(commAKey).perm, getMoveByKey(key).perm)
    soundSystem.play(isIdentity(res) ? 'correct' : 'discover')
  }
  const handleTableCellClick = (aKey: string, bKey: string) => {
    setCommAKey(aKey)
    setCommBKey(bKey)
    soundSystem.play('click')
  }
  const handleAddMove = (m: MoveDef) => {
    setSequence(prev => [...prev, m])
    const [dx, dy] = moveDelta(m.key)
    setCubeRotX(x => x + dx)
    setCubeRotY(y => y + dy)
    soundSystem.play('pop')
  }
  const handleUndo = () => {
    if (sequence.length === 0) return
    const last = sequence[sequence.length - 1]
    const [dx, dy] = moveDelta(last.key)
    setCubeRotX(x => x - dx)
    setCubeRotY(y => y - dy)
    setSequence(prev => prev.slice(0, -1))
    soundSystem.play('click')
  }
  const handleResetSeq = () => {
    setSequence([])
    setCubeRotX(0)
    setCubeRotY(0)
    soundSystem.play('whoosh')
  }

  const cubeTransform = `rotateX(${-22 + cubeRotX}deg) rotateY(${-30 + cubeRotY}deg)`

  return (
    <>
      <style>{CSS}</style>
      <div className="rcg-root">
        {/* 1. 头部 */}
        <div className="rcg-header">
          <div className="rcg-title">魔方置换群 · 交换子探秘</div>
          <div className="rcg-subtitle">{SUBTITLE[ageLevel]}</div>
          <div className="rcg-model-note">{MODEL_NOTE[ageLevel]}</div>
        </div>

        {/* 2. 操作合成表 */}
        <div className="rcg-card">
          <div className="rcg-card-title">2 · 操作合成表 A·B</div>
          <div className="rcg-note">
            行 A、列 B，单元格为 A·B 的置换（循环记号）。点击任意单元格，可把该 (A, B)
            载入下方的交换子计算器。
          </div>
          <div className="rcg-table-wrap">
            <table className="rcg-table">
              <thead>
                <tr>
                  <th>A·B</th>
                  {TABLE_MOVES.map(m => (
                    <th key={m.key}>{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABLE_MOVES.map((rowM, i) => (
                  <tr key={rowM.key}>
                    <th>{rowM.label}</th>
                    {tableGrid[i].map((cell, j) => {
                      const colM = TABLE_MOVES[j]
                      return (
                        <td
                          key={cell.key}
                          className={
                            cell.isInv ? 'inverse' : cell.commute ? 'commute' : 'noncommute'
                          }
                          onClick={() => handleTableCellClick(rowM.key, colM.key)}
                          title={`${rowM.label}·${colM.label} = ${cell.label} ${
                            cell.commute ? '（可交换）' : '（不可交换）'
                          }`}
                        >
                          {cell.label}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rcg-legend">
            <span>
              <span className="sw commute" />
              可交换 (A·B = B·A)
            </span>
            <span>
              <span className="sw noncommute" />
              不可交换 (A·B ≠ B·A)
            </span>
            <span>
              <span className="sw inverse" />
              互为逆元 (A·B = e)
            </span>
          </div>
        </div>

        {/* 3. 交换子计算器 */}
        <div className="rcg-card">
          <div className="rcg-card-title">3 · 交换子计算器 [A, B]</div>
          <div className="rcg-note">
            [A,B] = A·B·A⁻¹·B⁻¹。若结果为单位元 e，说明 A、B 可交换；否则不可交换。
          </div>
          <div className="rcg-comm-row">
            <label>
              A
              <select
                className="rcg-select"
                value={commAKey}
                onChange={e => handleSelectA(e.target.value)}
                aria-label="选择操作 A"
              >
                {ALL_MOVES.map(m => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="rcg-comm-op">,</span>
            <label>
              B
              <select
                className="rcg-select"
                value={commBKey}
                onChange={e => handleSelectB(e.target.value)}
                aria-label="选择操作 B"
              >
                {ALL_MOVES.map(m => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="rcg-comm-formula">
            [{moveA.label}, {moveB.label}] = {moveA.label}·{moveB.label}·{invA.label}·{invB.label}
          </div>
          <div className="rcg-compare">
            <div>
              A·B = <code>{toCycle(abPerm)}</code>
            </div>
            <div>
              B·A = <code>{toCycle(baPerm)}</code>
            </div>
            <div className={abCommutes ? 'rcg-cmp-eq' : 'rcg-cmp-neq'}>
              {abCommutes ? '相同 → 可交换' : '不同 → 不可交换'}
            </div>
          </div>
          <div className={`rcg-comm-result ${commIsIdentity ? 'comm' : 'noncomm'}`}>
            <div className="rcg-comm-status">{commIsIdentity ? '✓ 可交换' : '× 不可交换'}</div>
            <div className="rcg-comm-cycle">
              [A,B] = <code>{toCycle(commResult)}</code>
            </div>
          </div>
        </div>

        {/* 4. 操作序列构建器 + 3D 可视化 */}
        <div className="rcg-card">
          <div className="rcg-card-title">4 · 动手构建操作序列 · 3D 可视化</div>
          <div className="rcg-note">
            点击按钮把操作加入序列（从左到右依次执行），魔方会随之旋转。结果 =
            序列所有操作的合成置换。
          </div>
          <div className="rcg-seq-layout">
            <div className="rcg-cube-scene" aria-hidden="true">
              <div className="rcg-cube" style={{ transform: cubeTransform }}>
                {FACES.map(f => (
                  <div
                    key={f.name}
                    className={`rcg-face rcg-face-${f.cls}`}
                    style={{ transform: f.tf }}
                  >
                    {f.name}
                  </div>
                ))}
              </div>
            </div>
            <div className="rcg-seq-panel">
              <div className="rcg-move-row">
                {SEQ_MOVES.map(m => (
                  <button key={m.key} className="rcg-move-btn" onClick={() => handleAddMove(m)}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="rcg-seq-display">
                {sequence.length > 0
                  ? sequence.map(m => m.label).join(' · ')
                  : '（空序列，点击上方按钮开始）'}
              </div>
              <div className="rcg-seq-buttons">
                <button onClick={handleUndo} disabled={sequence.length === 0}>
                   撤销
                </button>
                <button onClick={handleResetSeq} disabled={sequence.length === 0}>
                   清空
                </button>
              </div>
              <div className="rcg-seq-result">
                结果置换：<code>{toCycle(sequenceResult)}</code>
                {seqIsIdentity && <span className="rcg-solved">· 已还原！</span>}
              </div>
            </div>
          </div>
        </div>

        {/* 5. 教育解释 */}
        <div className="rcg-card rcg-edu">
          <div className="rcg-card-title">5 · 为什么这很重要？</div>
          <div className="rcg-step-badge">结构主义 · 用魔方教群论</div>
          <p className="rcg-edu-line">{EDU[ageLevel].primary}</p>
          <p className="rcg-edu-deep">{EDU[ageLevel].deep}</p>
        </div>
      </div>
    </>
  )
}

const CSS = `
.rcg-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: var(--sans);
  color: var(--ink);
}

/* ── 头部 ── */
.rcg-header {
  padding: 4px 2px 8px;
  border-bottom: 1px solid var(--border);
}
.rcg-title {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.rcg-subtitle {
  font-size: 12.5px;
  color: var(--muted);
  margin-top: 3px;
}
.rcg-model-note {
  font-size: 11px;
  color: var(--faint);
  margin-top: 6px;
  font-style: italic;
}

/* ── 卡片通用 ── */
.rcg-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
}
.rcg-card-title {
  font-family: var(--serif);
  font-size: 14.5px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 6px;
  padding-left: 10px;
  border-left: 3px solid var(--warn);
}
.rcg-note {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
  margin-bottom: 10px;
}

/* ── 合成表 ── */
.rcg-table-wrap {
  overflow-x: auto;
}
.rcg-table {
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: 11px;
}
.rcg-table th,
.rcg-table td {
  border: 1px solid var(--border);
  padding: 4px 7px;
  text-align: center;
  white-space: nowrap;
}
.rcg-table th {
  background: var(--bg3);
  color: var(--ink);
  font-weight: 700;
  font-family: var(--sans);
  font-size: 12px;
}
.rcg-table td {
  cursor: pointer;
  transition: outline 0.12s;
  color: var(--muted);
}
.rcg-table td:hover {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.rcg-table td.commute {
  background: rgba(74, 124, 89, 0.1);
  color: var(--ok);
}
.rcg-table td.noncommute {
  background: rgba(184, 134, 46, 0.13);
  color: #8a6516;
}
.rcg-table td.inverse {
  background: rgba(196, 57, 47, 0.12);
  color: var(--accent);
  font-weight: 700;
}
.rcg-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 9px;
  font-size: 11px;
  color: var(--muted);
}
.rcg-legend .sw {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-right: 5px;
  vertical-align: middle;
  border: 1px solid var(--border);
}
.rcg-legend .sw.commute {
  background: rgba(74, 124, 89, 0.4);
}
.rcg-legend .sw.noncommute {
  background: rgba(184, 134, 46, 0.45);
}
.rcg-legend .sw.inverse {
  background: rgba(196, 57, 47, 0.4);
}

/* ── 交换子计算器 ── */
.rcg-comm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.rcg-comm-row label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 6px;
}
.rcg-select {
  padding: 5px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--bg2);
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
.rcg-comm-op {
  font-family: var(--mono);
  color: var(--muted);
}
.rcg-comm-formula {
  font-family: var(--mono);
  font-size: 14px;
  color: var(--ink);
  background: var(--bg3);
  padding: 8px 12px;
  border-radius: var(--r-sm);
  margin-bottom: 10px;
}
.rcg-compare {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 12.5px;
  color: var(--muted);
  margin-bottom: 10px;
  font-family: var(--mono);
}
.rcg-compare code {
  font-family: var(--mono);
  color: var(--ink);
  background: var(--bg3);
  padding: 1px 6px;
  border-radius: 4px;
}
.rcg-cmp-eq {
  color: var(--ok);
  font-weight: 700;
}
.rcg-cmp-neq {
  color: var(--warn);
  font-weight: 700;
}
.rcg-comm-result {
  border-radius: var(--r-md);
  padding: 12px 14px;
  border: 1px solid;
}
.rcg-comm-result.comm {
  background: var(--ok-bg);
  border-color: var(--ok);
}
.rcg-comm-result.noncomm {
  background: var(--warn-bg);
  border-color: var(--warn);
}
.rcg-comm-status {
  font-family: var(--serif);
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
}
.rcg-comm-result.comm .rcg-comm-status {
  color: var(--ok);
}
.rcg-comm-result.noncomm .rcg-comm-status {
  color: #8a6516;
}
.rcg-comm-cycle {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink);
}
.rcg-comm-cycle code {
  font-family: var(--mono);
  font-weight: 700;
}

/* ── 序列 + 3D 立方体 ── */
.rcg-seq-layout {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.rcg-cube-scene {
  perspective: 700px;
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  animation: rcg-float 4.5s ease-in-out infinite;
}
@keyframes rcg-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
.rcg-cube {
  width: 150px;
  height: 150px;
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.rcg-face {
  position: absolute;
  width: 150px;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--serif);
  font-weight: 700;
  font-size: 40px;
  border: 2px solid rgba(0, 0, 0, 0.28);
  box-shadow: inset 0 0 26px rgba(0, 0, 0, 0.18);
}
.rcg-face-u {
  background: #ffffff;
  color: rgba(0, 0, 0, 0.6);
}
.rcg-face-d {
  background: #ffd500;
  color: rgba(0, 0, 0, 0.6);
}
.rcg-face-f {
  background: #009e60;
  color: rgba(255, 255, 255, 0.92);
}
.rcg-face-b {
  background: #0051ba;
  color: rgba(255, 255, 255, 0.92);
}
.rcg-face-l {
  background: #ff7f00;
  color: rgba(255, 255, 255, 0.92);
}
.rcg-face-r {
  background: #c41e3a;
  color: rgba(255, 255, 255, 0.92);
}
.rcg-seq-panel {
  flex: 1;
  min-width: 220px;
}
.rcg-move-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.rcg-move-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--bg2);
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.rcg-move-btn:hover {
  background: var(--bg3);
}
.rcg-move-btn:active {
  transform: scale(0.95);
}
.rcg-seq-display {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink);
  background: var(--bg3);
  padding: 8px 10px;
  border-radius: var(--r-sm);
  min-height: 34px;
  word-break: break-all;
  margin-bottom: 8px;
}
.rcg-seq-buttons {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.rcg-seq-buttons button {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg2);
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
.rcg-seq-buttons button:hover:not(:disabled) {
  background: var(--bg3);
  color: var(--ink);
}
.rcg-seq-buttons button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.rcg-seq-result {
  font-size: 13px;
  color: var(--muted);
  font-family: var(--mono);
}
.rcg-seq-result code {
  font-family: var(--mono);
  color: var(--ink);
  font-weight: 700;
  background: var(--bg3);
  padding: 1px 6px;
  border-radius: 4px;
}
.rcg-solved {
  color: var(--ok);
  font-weight: 700;
  margin-left: 6px;
}

/* ── 教育面板 ── */
.rcg-edu {
  background: linear-gradient(135deg, var(--bg2), rgba(184, 134, 46, 0.06));
  border-color: var(--warn);
}
.rcg-step-badge {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--warn);
  background: var(--warn-bg);
  padding: 3px 9px;
  border-radius: var(--r-full);
  margin-bottom: 8px;
}
.rcg-edu-line {
  font-family: var(--serif);
  font-size: 15px;
  line-height: 1.7;
  color: var(--ink);
  margin-bottom: 8px;
}
.rcg-edu-deep {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--muted);
}
`
