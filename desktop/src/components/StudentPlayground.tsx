import { useState, useMemo, useCallback, useRef } from 'react'
import type { AgeLevel } from '../utils/ageAdapt'
import { getEncouragement } from '../utils/ageAdapt'
import { soundSystem } from '../utils/sound'
import {
  areInverses as areInversesUtil,
  findIdentity,
  getInverseMap,
  getPairKey,
  isTableSymmetric,
  lookupValue,
} from '../utils/playgroundMath'

/**
 * StudentPlayground — 学生互动游戏场
 *
 * 从学生视角设计的三大互动模块：
 *
 * 1. "碰一碰" (Bump) — 拖拽元素碰撞，看运算结果
 *    学生把两个彩色圆球拖到一起，"砰"一声，结果弹出来。
 *    不再是抽象的表格数字，而是可视的物理交互。
 *
 * 2. "找搭档" (Find Partner) — 逆元配对游戏
 *    学生翻牌找搭档，找到逆元对就消除。
 *    像记忆翻牌游戏一样，但学的是逆元概念。
 *
 * 3. 颜色可视化 — 每个数字对应一种颜色
 *    让对称性、交换律等模式"一眼可见"。
 *
 * 核心设计原则（学生视角）：
 *   - 看得见：颜色、动画、粒子效果
 *   - 摸得着：拖拽、点击、翻牌
 *   - 有反馈：每次操作都有声音和视觉回应
 *   - 有惊喜：发现性质时有"发现时刻"庆祝
 */

// ---------------------------------------------------------------------------
// 颜色映射 — 每个数字对应一种鲜明颜色
// ---------------------------------------------------------------------------

const ELEMENT_COLORS = [
  '#FF6B6B', // 0 - 红
  '#4ECDC4', // 1 - 青
  '#FFE66D', // 2 - 黄
  '#A78BFA', // 3 - 紫
  '#95E1D3', // 4 - 绿
  '#FF8A65', // 5 - 橙
  '#7986CB', // 6 - 靛
  '#F48FB1', // 7 - 粉
  '#81C784', // 8 - 草绿
  '#FFD54F', // 9 - 金
  '#4DD0E1', // 10 - 天青
  '#BA68C8', // 11 - 品红
]

// eslint-disable-next-line react-refresh/only-export-components
export function getElementColor(n: number): string {
  return ELEMENT_COLORS[n % ELEMENT_COLORS.length]
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type PlaygroundMode = 'bump' | 'match' | 'colors'

type GuidedTask = 'free' | 'find_identity' | 'find_inverses' | 'find_commutative'

interface BumpRecord {
  a: number
  b: number
  result: number
}

interface ConceptQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

interface Props {
  table: number[][]
  size: number
  ageLevel: AgeLevel
  onHighlightCell?: (
    cell: { row: number; col: number; type: 'computation' | 'identity' | 'symmetry' } | null,
  ) => void
  /** 发现新性质时回调 */
  onDiscovery?: (property: string, ageLevel: AgeLevel) => void
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function StudentPlayground({ table, size, ageLevel, onHighlightCell, onDiscovery }: Props) {
  const [mode, setMode] = useState<PlaygroundMode>('bump')

  const modeLabels = useMemo(() => {
    if (ageLevel === 'kids') {
      return {
        bump: { label: '碰一碰', icon: '', desc: '拖两个球碰一碰，看会变成什么！' },
        match: { label: '找搭档', icon: '', desc: '谁跟谁是好搭档？翻牌找找看！' },
        colors: { label: '彩色表', icon: '', desc: '给密码表涂上颜色，看图案！' },
      }
    } else if (ageLevel === 'tweens') {
      return {
        bump: { label: '碰撞运算', icon: '', desc: '拖拽元素进行运算，观察结果' },
        match: { label: '逆元配对', icon: '', desc: '翻牌找出互为逆元的元素对' },
        colors: { label: '颜色视图', icon: '', desc: '用颜色可视化运算表的模式' },
      }
    }
    return {
      bump: { label: 'Bump', icon: '', desc: 'Drag elements to compute a*b' },
      match: { label: 'Inverse Match', icon: '', desc: 'Flip cards to find inverse pairs' },
      colors: { label: 'Color View', icon: '', desc: 'Visualize table patterns with color' },
    }
  }, [ageLevel])

  return (
    <>
      <style>{PLAYGROUND_CSS}</style>
      <div className="sp-root">
        {/* 模式切换 */}
        <div className="sp-mode-tabs">
          {(Object.keys(modeLabels) as PlaygroundMode[]).map(m => (
            <button
              key={m}
              className={`sp-mode-tab ${mode === m ? 'active' : ''}`}
              onClick={() => {
                setMode(m)
                soundSystem.play('click')
              }}
            >
              <span className="sp-mode-icon">{modeLabels[m].icon}</span>
              <span className="sp-mode-label">{modeLabels[m].label}</span>
            </button>
          ))}
        </div>

        {/* 模式描述 */}
        <div className="sp-mode-desc">{modeLabels[mode].desc}</div>

        {/* 模式内容 */}
        {mode === 'bump' && (
          <BumpGame
            table={table}
            size={size}
            ageLevel={ageLevel}
            onHighlightCell={onHighlightCell}
            onDiscovery={onDiscovery}
          />
        )}
        {mode === 'match' && (
          <MatchGame table={table} size={size} ageLevel={ageLevel} onDiscovery={onDiscovery} />
        )}
        {mode === 'colors' && (
          <ColorView
            table={table}
            size={size}
            ageLevel={ageLevel}
            onHighlightCell={onHighlightCell}
          />
        )}
      </div>
    </>
  )
}

// ===========================================================================
// 1. 碰一碰 (Bump) — 拖拽碰撞游戏
// ===========================================================================

interface BumpGameProps {
  table: number[][]
  size: number
  ageLevel: AgeLevel
  onHighlightCell?: (
    cell: { row: number; col: number; type: 'computation' | 'identity' | 'symmetry' } | null,
  ) => void
  onDiscovery?: (property: string, ageLevel: AgeLevel) => void
}

export function BumpGame({ table, size, ageLevel, onHighlightCell, onDiscovery }: BumpGameProps) {
  const [elemA, setElemA] = useState<number | null>(null)
  const [elemB, setElemB] = useState<number | null>(null)
  const [bumpResult, setBumpResult] = useState<{ a: number; b: number; result: number } | null>(
    null,
  )
  const [bumpAnim, setBumpAnim] = useState(false)
  const [history, setHistory] = useState<BumpRecord[]>([])
  const [discoveredCommutative, setDiscoveredCommutative] = useState<Set<string>>(new Set())
  // --- 引导任务模式 ---
  const [guidedTask, setGuidedTask] = useState<GuidedTask>('free')
  const [taskCompleted, setTaskCompleted] = useState<Set<GuidedTask>>(new Set())
  // --- 概念检查点 ---
  const [showConceptCheck, setShowConceptCheck] = useState(false)
  const [conceptAnswered, setConceptAnswered] = useState(false)
  const [conceptResult, setConceptResult] = useState<'correct' | 'wrong' | null>(null)

  const lookup = useCallback(
    (a: number, b: number): number | null => lookupValue(table, size, a, b),
    [table, size],
  )

  // 找单位元
  const identity = useMemo(() => findIdentity(table, size), [table, size])

  // 引导任务定义
  const guidedTasks = useMemo(() => {
    if (ageLevel === 'kids') {
      return [
        { id: 'free' as GuidedTask, label: '自由玩', icon: '', desc: '随便碰碰看！' },
        {
          id: 'find_identity' as GuidedTask,
          label: '找老大',
          icon: '★',
          desc: '找一个球，碰谁都不变的！',
        },
        {
          id: 'find_inverses' as GuidedTask,
          label: '找搭档',
          icon: '',
          desc: '找两个球，碰了变成老大的！',
        },
        {
          id: 'find_commutative' as GuidedTask,
          label: '换位置',
          icon: '↔',
          desc: '碰碰看，换位置结果一样吗？',
        },
      ]
    } else if (ageLevel === 'tweens') {
      return [
        { id: 'free' as GuidedTask, label: '自由探索', icon: '', desc: '自由运算，观察规律' },
        {
          id: 'find_identity' as GuidedTask,
          label: '找单位元',
          icon: '★',
          desc: '找 e 使 e∗a = a 对所有 a 成立',
        },
        {
          id: 'find_inverses' as GuidedTask,
          label: '找逆元',
          icon: '',
          desc: '找 a,b 使 a∗b = e（单位元）',
        },
        {
          id: 'find_commutative' as GuidedTask,
          label: '验证交换律',
          icon: '↔',
          desc: '检查 a∗b = b∗a 是否成立',
        },
      ]
    }
    return [
      { id: 'free' as GuidedTask, label: 'Free', icon: '', desc: 'Free exploration' },
      {
        id: 'find_identity' as GuidedTask,
        label: 'Find Identity',
        icon: '★',
        desc: 'Find e such that e∗a = a',
      },
      {
        id: 'find_inverses' as GuidedTask,
        label: 'Find Inverses',
        icon: '',
        desc: 'Find a,b such that a∗b = e',
      },
      {
        id: 'find_commutative' as GuidedTask,
        label: 'Commutativity',
        icon: '↔',
        desc: 'Check if a∗b = b∗a',
      },
    ]
  }, [ageLevel])

  // 检查当前运算是否完成了引导任务
  const checkTaskCompletion = useCallback(
    (a: number, b: number, result: number) => {
      if (guidedTask === 'find_identity') {
        // 学生找到了 a∗b = b 且 a∗a = a 的情况
        if (result === b && a !== b && table[a]?.[a] === a) {
          if (!taskCompleted.has('find_identity')) {
            setTaskCompleted(prev => new Set(prev).add('find_identity'))
            onDiscovery?.('identity', ageLevel)
            setShowConceptCheck(true)
            setConceptAnswered(false)
            setConceptResult(null)
          }
        }
      } else if (guidedTask === 'find_inverses') {
        if (identity >= 0 && result === identity && a !== b) {
          if (!taskCompleted.has('find_inverses')) {
            setTaskCompleted(prev => new Set(prev).add('find_inverses'))
            onDiscovery?.('inverses', ageLevel)
            setShowConceptCheck(true)
            setConceptAnswered(false)
            setConceptResult(null)
          }
        }
      } else if (guidedTask === 'find_commutative') {
        const ba = lookup(b, a)
        if (ba !== null && ba === result && a !== b) {
          const key = getPairKey(a, b)
          if (!discoveredCommutative.has(key)) {
            setDiscoveredCommutative(prev => new Set(prev).add(key))
            if (
              !taskCompleted.has('find_commutative') &&
              discoveredCommutative.size + 1 >= Math.min(3, (size * (size - 1)) / 2)
            ) {
              setTaskCompleted(prev => new Set(prev).add('find_commutative'))
              onDiscovery?.('commutativity', ageLevel)
              setShowConceptCheck(true)
              setConceptAnswered(false)
              setConceptResult(null)
            }
          }
        }
      }
    },
    [
      guidedTask,
      taskCompleted,
      discoveredCommutative,
      identity,
      ageLevel,
      onDiscovery,
      table,
      lookup,
      size,
    ],
  )

  // 概念检查问题（根据完成的任务生成）
  const conceptQuestion = useMemo<ConceptQuestion | null>(() => {
    if (!showConceptCheck) return null
    if (guidedTask === 'find_identity' && identity >= 0) {
      if (ageLevel === 'kids') {
        return {
          question: `你发现 ${identity} 碰谁都是原来的数！为什么说它是"老大"？`,
          options: ['因为它最大', '因为它碰了别人，别人都不变', '因为它颜色最亮', '因为它出现最多'],
          correctIndex: 1,
          explanation: '对！老大（单位元）碰了谁，谁就不变。这就是"单位元"的定义：e∗a = a。',
        }
      }
      return {
        question: `你发现 ${identity}∗a = a 对所有 a 成立。这在数学上叫什么？`,
        options: [
          `${identity} 是最大元素`,
          `${identity} 是单位元（identity），满足 e∗a = a∗e = a`,
          `${identity} 是生成元`,
          `${identity} 是逆元`,
        ],
        correctIndex: 1,
        explanation: '正确。单位元 e 满足 e∗a = a∗e = a，这是群公理之一。',
      }
    }
    if (guidedTask === 'find_inverses' && identity >= 0) {
      if (ageLevel === 'kids') {
        return {
          question: '你找到了两个球碰了变老大！这说明了什么？',
          options: [
            '它们颜色一样',
            '它们互为"好搭档"，碰了就变回老大',
            '它们都是最大的数',
            '它们是一样的球',
          ],
          correctIndex: 1,
          explanation: '对！好搭档（逆元）就是碰了变成老大（单位元）的两个元素：a∗b = e。',
        }
      }
      return {
        question: '你找到了 a∗b = e（单位元）。a 和 b 的关系是什么？',
        options: [
          'a 和 b 是同一个元素',
          'a 是 b 的逆元，即 a = b⁻¹，满足 a∗b = b∗a = e',
          'a 和 b 都是单位元',
          'a 是 b 的倍数',
        ],
        correctIndex: 1,
        explanation: '正确。a 和 b 互为逆元，满足 a∗b = b∗a = e，这是群公理之一。',
      }
    }
    if (guidedTask === 'find_commutative') {
      if (ageLevel === 'kids') {
        return {
          question: '你发现换位置碰结果也一样！这说明什么？',
          options: ['这个家族里谁先谁后都一样', '颜色都一样', '数字都一样大', '碰了会消失'],
          correctIndex: 0,
          explanation: '对！在这个家族里，a 碰 b 和 b 碰 a 结果一样。这叫"交换律"。',
        }
      }
      return {
        question: '你验证了 a∗b = b∗a 对多对元素成立。这意味着什么？',
        options: ['这个运算是可交换的（阿贝尔的）', '这个运算不封闭', '没有单位元', '没有逆元'],
        correctIndex: 0,
        explanation: '正确。a∗b = b∗a 对所有 a,b 成立意味着该群是阿贝尔群（交换群）。',
      }
    }
    return null
  }, [showConceptCheck, guidedTask, identity, ageLevel])

  // 检测交换律发现
  const checkCommutativityDiscovery = useCallback(
    (a: number, b: number) => {
      if (a === b) return
      const ab = lookup(a, b)
      const ba = lookup(b, a)
      if (ab === null || ba === null) return
      const key = getPairKey(a, b)
      if (ab === ba && !discoveredCommutative.has(key)) {
        setDiscoveredCommutative(prev => new Set(prev).add(key))
        if (ageLevel === 'kids') {
          onDiscovery?.('commutativity', ageLevel)
        }
      }
    },
    [lookup, discoveredCommutative, ageLevel, onDiscovery],
  )

  const handleSelectElement = useCallback(
    (n: number) => {
      soundSystem.play('pop')
      if (elemA === null) {
        setElemA(n)
      } else if (elemB === null) {
        setElemB(n)
        // 执行碰撞
        const result = lookup(elemA, n)
        if (result !== null) {
          setBumpResult({ a: elemA, b: n, result })
          setBumpAnim(true)
          soundSystem.play('whoosh')
          setTimeout(() => {
            setBumpAnim(false)
            soundSystem.play('correct')
          }, 600)
          setHistory(prev => [{ a: elemA, b: n, result }, ...prev].slice(0, 8))
          onHighlightCell?.({ row: elemA, col: n, type: 'computation' })
          checkCommutativityDiscovery(elemA, n)
          // 检查引导任务是否完成
          checkTaskCompletion(elemA, n, result)
        }
        // 1.5s 后重置，让学生看清楚结果和形式化符号
        setTimeout(() => {
          setElemA(null)
          setElemB(null)
        }, 2000)
      }
    },
    [elemA, elemB, lookup, onHighlightCell, checkCommutativityDiscovery, checkTaskCompletion],
  )

  const elements = useMemo(() => Array.from({ length: size }, (_, i) => i), [size])

  const resultLabel = ageLevel === 'kids' ? '变成' : ageLevel === 'tweens' ? '=' : '='

  return (
    <div className="sp-bump-root">
      {/* 引导任务选择栏 */}
      <div className="sp-task-bar">
        {guidedTasks.map(t => (
          <button
            key={t.id}
            className={`sp-task-btn ${guidedTask === t.id ? 'active' : ''} ${taskCompleted.has(t.id) ? 'completed' : ''}`}
            onClick={() => {
              setGuidedTask(t.id)
              soundSystem.play('click')
              setShowConceptCheck(false)
              setConceptAnswered(false)
              setConceptResult(null)
            }}
          >
            <span className="sp-task-icon">{t.icon}</span>
            <span className="sp-task-label">{t.label}</span>
            {taskCompleted.has(t.id) && <span className="sp-task-check">✓</span>}
          </button>
        ))}
      </div>
      {/* 当前任务描述 */}
      {guidedTask !== 'free' && (
        <div className="sp-task-desc"> {guidedTasks.find(t => t.id === guidedTask)?.desc}</div>
      )}

      {/* 碰撞区域 */}
      <div className={`sp-bump-arena ${bumpAnim ? 'bumping' : ''}`}>
        {/* 槽位 A */}
        <div className={`sp-bump-slot ${elemA !== null ? 'filled' : ''}`}>
          {elemA !== null ? (
            <div className="sp-element-orb" style={{ background: getElementColor(elemA) }}>
              {elemA}
            </div>
          ) : (
            <div className="sp-bump-slot-placeholder">
              {ageLevel === 'kids' ? '?' : ageLevel === 'teens' ? 'a' : 'a'}
            </div>
          )}
        </div>

        {/* 运算符 */}
        <div className="sp-bump-operator">{ageLevel === 'kids' ? '' : '∗'}</div>

        {/* 槽位 B */}
        <div className={`sp-bump-slot ${elemB !== null ? 'filled' : ''}`}>
          {elemB !== null ? (
            <div className="sp-element-orb" style={{ background: getElementColor(elemB) }}>
              {elemB}
            </div>
          ) : (
            <div className="sp-bump-slot-placeholder">
              {ageLevel === 'kids' ? '?' : ageLevel === 'teens' ? 'b' : 'b'}
            </div>
          )}
        </div>

        {/* 等号 */}
        <div className="sp-bump-operator">{resultLabel}</div>

        {/* 结果 */}
        <div className={`sp-bump-result ${bumpResult ? 'show' : ''}`}>
          {bumpResult && (
            <div
              className="sp-element-orb sp-result-orb"
              style={{ background: getElementColor(bumpResult.result) }}
            >
              {bumpResult.result}
            </div>
          )}
        </div>

        {/* 碰撞粒子效果 */}
        {bumpAnim && (
          <div className="sp-bump-particles">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="sp-particle"
                style={
                  {
                    '--angle': `${i * 45}deg`,
                    '--color': getElementColor(bumpResult?.result ?? 0),
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* 形式化符号桥接 — 从"碰球"到"a ∗ b = c" */}
      {bumpResult && (
        <div className="sp-formal-bridge">
          <div className="sp-formal-expr">
            <span style={{ color: getElementColor(bumpResult.a) }}>{bumpResult.a}</span>
            <span className="sp-formal-op">{ageLevel === 'kids' ? '碰' : ' ∗ '}</span>
            <span style={{ color: getElementColor(bumpResult.b) }}>{bumpResult.b}</span>
            <span className="sp-formal-op"> = </span>
            <span style={{ color: getElementColor(bumpResult.result), fontWeight: 700 }}>
              {bumpResult.result}
            </span>
          </div>
          {ageLevel !== 'kids' && (
            <div className="sp-formal-table-ref">
              <span className="sp-formal-ref-label"> 运算表位置：</span>
              <code>
                table[{bumpResult.a}][{bumpResult.b}] = {bumpResult.result}
              </code>
            </div>
          )}
          {ageLevel === 'kids' && (
            <div className="sp-formal-table-ref">
              <span className="sp-formal-ref-label"> 密码表位置：</span>
              <span>
                第 <strong style={{ color: getElementColor(bumpResult.a) }}>{bumpResult.a}</strong>{' '}
                行，第{' '}
                <strong style={{ color: getElementColor(bumpResult.b) }}>{bumpResult.b}</strong> 列
              </span>
            </div>
          )}
        </div>
      )}

      {/* 元素选择池 */}
      <div className="sp-bump-pool">
        <div className="sp-pool-label">
          {guidedTask === 'free'
            ? ageLevel === 'kids'
              ? '点两个球碰一碰！'
              : ageLevel === 'tweens'
                ? '选择两个元素进行运算'
                : 'Select two elements to compute'
            : guidedTask === 'find_identity'
              ? ageLevel === 'kids'
                ? '★ 哪个球碰了别人不变？试试看！'
                : '找 e 使 e∗a = a，逐个测试！'
              : guidedTask === 'find_inverses'
                ? ageLevel === 'kids'
                  ? '找两个球碰了变老大的！'
                  : identity >= 0
                    ? `找 a,b 使 a∗b = ${identity}（单位元）`
                    : '先找到单位元才能找逆元！'
                : ageLevel === 'kids'
                  ? '↔ 换位置碰，结果一样吗？'
                  : '测试 a∗b 和 b∗a 是否相等'}
        </div>
        <div className="sp-pool-orbs">
          {elements.map(n => (
            <button
              key={n}
              className={`sp-pool-orb-btn ${elemA === n || elemB === n ? 'selected' : ''}`}
              onClick={() => handleSelectElement(n)}
              disabled={elemA !== null && elemB !== null}
            >
              <div
                className="sp-element-orb sp-pool-orb"
                style={{ background: getElementColor(n) }}
              >
                {n}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 碰撞历史 */}
      {history.length > 0 && (
        <div className="sp-bump-history">
          <div className="sp-history-label">
            {ageLevel === 'kids' ? '↔ 刚才碰过的' : ageLevel === 'tweens' ? '运算记录' : 'History'}
          </div>
          <div className="sp-history-list">
            {history.map((h, i) => (
              <div key={i} className="sp-history-item">
                <span className="sp-hist-orb" style={{ background: getElementColor(h.a) }}>
                  {h.a}
                </span>
                <span className="sp-hist-op">∗</span>
                <span className="sp-hist-orb" style={{ background: getElementColor(h.b) }}>
                  {h.b}
                </span>
                <span className="sp-hist-op">=</span>
                <span className="sp-hist-orb" style={{ background: getElementColor(h.result) }}>
                  {h.result}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 发现交换律提示 */}
      {discoveredCommutative.size > 0 && ageLevel === 'kids' && (
        <div className="sp-discovery-hint">
          {' '}
          {ageLevel === 'kids' ? '你发现有些数字换位置碰，结果一样！' : 'Commutativity detected!'}
        </div>
      )}

      {/* 概念检查点 — 从感官体验上升到概念理解 */}
      {showConceptCheck && conceptQuestion && (
        <div className="sp-concept-check">
          <div className="sp-concept-header">
            <span className="sp-concept-icon"></span>
            <span className="sp-concept-title">
              {ageLevel === 'kids'
                ? '想一想！'
                : ageLevel === 'tweens'
                  ? '概念检查'
                  : 'Concept Check'}
            </span>
          </div>
          <div className="sp-concept-question">{conceptQuestion.question}</div>
          {!conceptAnswered ? (
            <div className="sp-concept-options">
              {conceptQuestion.options.map((opt, i) => (
                <button
                  key={i}
                  className="sp-concept-option"
                  onClick={() => {
                    setConceptAnswered(true)
                    if (i === conceptQuestion.correctIndex) {
                      setConceptResult('correct')
                      soundSystem.play('star')
                    } else {
                      setConceptResult('wrong')
                      soundSystem.play('wrong')
                    }
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className={`sp-concept-result ${conceptResult}`}>
                {conceptResult === 'correct' ? '✓ ' : '× '}
                {conceptQuestion.explanation}
              </div>
              <button
                className="sp-concept-close"
                onClick={() => {
                  setShowConceptCheck(false)
                  setConceptAnswered(false)
                  setConceptResult(null)
                  soundSystem.play('click')
                }}
              >
                {ageLevel === 'kids' ? '继续玩！' : '继续探索'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// 2. 找搭档 (Match) — 逆元翻牌配对游戏
// ===========================================================================

interface MatchGameProps {
  table: number[][]
  size: number
  ageLevel: AgeLevel
  onDiscovery?: (property: string, ageLevel: AgeLevel) => void
}

export function MatchGame({ table, size, ageLevel, onDiscovery }: MatchGameProps) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set())
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [wrongPair, setWrongPair] = useState<[number, number] | null>(null)
  const [completed, setCompleted] = useState(false)
  const discoveredRef = useRef(false)
  // --- 概念检查点 ---
  const [showConceptCheck, setShowConceptCheck] = useState(false)
  const [conceptAnswered, setConceptAnswered] = useState(false)
  const [conceptResult, setConceptResult] = useState<'correct' | 'wrong' | null>(null)
  // --- 最近匹配对（用于形式化等式显示） ---
  const [lastMatch, setLastMatch] = useState<{ a: number; b: number; e: number } | null>(null)

  // 找单位元
  const identity = useMemo(() => findIdentity(table, size), [table, size])

  // 计算逆元映射
  const inverseMap = useMemo(() => getInverseMap(table, size, identity), [table, size, identity])

  // 检查两个元素是否互为逆元
  const areInverses = useCallback(
    (a: number, b: number): boolean => areInversesUtil(inverseMap, a, b),
    [inverseMap],
  )

  const elements = useMemo(() => Array.from({ length: size }, (_, i) => i), [size])

  const handleCardClick = useCallback(
    (n: number) => {
      if (
        matched.has(
          `pair-${Math.min(n, inverseMap.get(n) ?? n)}-${Math.max(n, inverseMap.get(n) ?? n)}`,
        )
      )
        return
      if (selected === null) {
        setSelected(n)
        setFlipped(prev => new Set(prev).add(n))
        soundSystem.play('click')
      } else if (selected === n) {
        // 取消选择
        setSelected(null)
        setFlipped(prev => {
          const next = new Set(prev)
          next.delete(n)
          return next
        })
      } else {
        // 检查是否匹配
        if (areInverses(selected, n)) {
          const pairKey = `pair-${Math.min(selected, n)}-${Math.max(selected, n)}`
          setMatched(prev => new Set(prev).add(pairKey))
          setLastMatch({ a: selected, b: n, e: identity })
          soundSystem.play('star')
          setSelected(null)

          // 检查是否全部完成
          const allMatched = elements.every(e => {
            const inv = inverseMap.get(e)
            if (inv === undefined) return true
            const pk = `pair-${Math.min(e, inv)}-${Math.max(e, inv)}`
            return matched.has(pk) || pk === pairKey
          })

          if (allMatched && !discoveredRef.current) {
            discoveredRef.current = true
            setCompleted(true)
            onDiscovery?.('inverses', ageLevel)
            soundSystem.play('celebrate')
            // 触发概念检查
            setTimeout(() => setShowConceptCheck(true), 1000)
          }
        } else {
          // 不匹配
          setWrongPair([selected, n])
          soundSystem.play('wrong')
          setTimeout(() => {
            setWrongPair(null)
            setFlipped(prev => {
              const next = new Set(prev)
              next.delete(selected)
              next.delete(n)
              return next
            })
            setSelected(null)
          }, 800)
        }
      }
    },
    [selected, matched, areInverses, elements, inverseMap, identity, onDiscovery, ageLevel],
  )

  const isCardFlipped = (n: number) =>
    flipped.has(n) ||
    matched.has(
      `pair-${Math.min(n, inverseMap.get(n) ?? n)}-${Math.max(n, inverseMap.get(n) ?? n)}`,
    )
  const isCardMatched = (n: number) =>
    matched.has(
      `pair-${Math.min(n, inverseMap.get(n) ?? n)}-${Math.max(n, inverseMap.get(n) ?? n)}`,
    )
  const isCardWrong = (n: number) =>
    wrongPair !== null && (wrongPair[0] === n || wrongPair[1] === n)

  const matchCount = matched.size
  const totalPairs = useMemo(() => {
    const pairs = new Set<string>()
    inverseMap.forEach((inv, key) => {
      pairs.add(`pair-${Math.min(key, inv)}-${Math.max(key, inv)}`)
    })
    return pairs.size
  }, [inverseMap])

  return (
    <div className="sp-match-root">
      {/* 进度 */}
      <div className="sp-match-progress">
        <span className="sp-match-count">
          {ageLevel === 'kids' ? '找到' : ageLevel === 'tweens' ? '已配对' : 'Matched'}:{' '}
          {matchCount} / {totalPairs}
        </span>
        <div className="sp-match-bar">
          <div
            className="sp-match-bar-fill"
            style={{ width: `${totalPairs > 0 ? (matchCount / totalPairs) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* 卡片网格 */}
      <div
        className="sp-match-grid"
        style={{ gridTemplateColumns: `repeat(${Math.min(size, 4)}, 1fr)` }}
      >
        {elements.map(n => {
          const flipped_ = isCardFlipped(n)
          const matched_ = isCardMatched(n)
          const wrong_ = isCardWrong(n)
          return (
            <button
              key={n}
              className={`sp-match-card ${flipped_ ? 'flipped' : ''} ${matched_ ? 'matched' : ''} ${wrong_ ? 'wrong' : ''} ${selected === n ? 'selected' : ''}`}
              onClick={() => handleCardClick(n)}
              disabled={matched_}
            >
              <div className="sp-card-inner">
                {/* 卡片背面 */}
                <div className="sp-card-back">
                  <span className="sp-card-back-num">{n}</span>
                </div>
                {/* 卡片正面 — 显示逆元搭档 */}
                <div className="sp-card-front" style={{ background: getElementColor(n) }}>
                  <span className="sp-card-front-num">{n}</span>
                  {matched_ && <span className="sp-card-check">✓</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* 提示 */}
      <div className="sp-match-hint">
        {ageLevel === 'kids'
          ? '翻开两张牌，如果碰一碰变成老大（0），就是好搭档！'
          : ageLevel === 'tweens'
            ? '翻开两张牌，如果 a∗b = e（单位元），则互为逆元。'
            : 'Flip two cards. If a∗b = e (identity), they are inverses.'}
      </div>

      {/* 完成庆祝 */}
      {completed && (
        <div className="sp-match-complete">
          <div className="sp-complete-icon"></div>
          <div className="sp-complete-text">
            {ageLevel === 'kids'
              ? '太棒了！所有好搭档都找到了！'
              : ageLevel === 'tweens'
                ? '全部逆元配对完成！'
                : 'All inverse pairs found!'}
          </div>
          <div className="sp-complete-encourage">{getEncouragement(ageLevel, 'milestone')}</div>
        </div>
      )}

      {/* 形式化等式桥接 — 匹配成功时显示 */}
      {lastMatch && !showConceptCheck && (
        <div className="sp-formal-bridge sp-match-bridge">
          <div className="sp-formal-expr">
            {ageLevel === 'kids' ? (
              <>
                <span style={{ color: getElementColor(lastMatch.a) }}>{lastMatch.a}</span>
                <span className="sp-formal-op"> 碰 </span>
                <span style={{ color: getElementColor(lastMatch.b) }}>{lastMatch.b}</span>
                <span className="sp-formal-op"> = </span>
                <span style={{ color: getElementColor(lastMatch.e), fontWeight: 700 }}>
                  {lastMatch.e}（老大）
                </span>
              </>
            ) : (
              <>
                <span style={{ color: getElementColor(lastMatch.a) }}>{lastMatch.a}</span>
                <span className="sp-formal-op"> ∗ </span>
                <span style={{ color: getElementColor(lastMatch.b) }}>{lastMatch.b}</span>
                <span className="sp-formal-op"> = </span>
                <span style={{ color: getElementColor(lastMatch.e), fontWeight: 700 }}>
                  {lastMatch.e}
                </span>
                <span className="sp-formal-note"> （单位元 e）</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* 概念检查点 — 全部完成后触发 */}
      {showConceptCheck && (
        <div className="sp-concept-check">
          <div className="sp-concept-header">
            <span className="sp-concept-icon"></span>
            <span className="sp-concept-title">
              {ageLevel === 'kids'
                ? '想一想！'
                : ageLevel === 'tweens'
                  ? '概念检查'
                  : 'Concept Check'}
            </span>
          </div>
          <div className="sp-concept-question">
            {ageLevel === 'kids'
              ? '你配对了所有好搭档！每个球都有搭档吗？自己能当自己的搭档吗？'
              : ageLevel === 'tweens'
                ? '你找到了所有逆元对。如果一个元素的逆元是它自己（a∗a = e），这说明什么？'
                : 'You found all inverse pairs. What does it mean when an element is its own inverse (a∗a = e)?'}
          </div>
          {!conceptAnswered ? (
            <div className="sp-concept-options">
              {(ageLevel === 'kids'
                ? [
                    '是的，每个人都能当自己的搭档！',
                    '不是，有的球没有搭档',
                    '只有老大能当自己的搭档',
                    '只有颜色一样的才能当搭档',
                  ]
                : ageLevel === 'tweens'
                  ? [
                      '该元素是自逆元（a = a⁻¹），即 a² = e',
                      '该元素是单位元',
                      '该元素不存在逆元',
                      '该元素是生成元',
                    ]
                  : [
                      'It is self-inverse (a = a⁻¹), meaning a² = e',
                      'It is the identity element',
                      'It has no inverse',
                      'It is a generator',
                    ]
              ).map((opt, i) => (
                <button
                  key={i}
                  className="sp-concept-option"
                  onClick={() => {
                    setConceptAnswered(true)
                    const correctIdx = ageLevel === 'kids' ? 0 : ageLevel === 'tweens' ? 0 : 0
                    if (i === correctIdx) {
                      setConceptResult('correct')
                      soundSystem.play('star')
                    } else {
                      setConceptResult('wrong')
                      soundSystem.play('wrong')
                    }
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className={`sp-concept-result ${conceptResult}`}>
                {conceptResult === 'correct' ? '✓ ' : '× '}
                {ageLevel === 'kids'
                  ? '对！有些球碰自己就变成老大，说明自己就是自己的搭档。这叫"自逆元"！'
                  : ageLevel === 'tweens'
                    ? '正确。a∗a = e 意味着 a = a⁻¹，即 a 是二阶元素。单位元也是自逆元。'
                    : 'Correct. a² = e means a is its own inverse (involution). The identity is also self-inverse.'}
              </div>
              <button
                className="sp-concept-close"
                onClick={() => {
                  setShowConceptCheck(false)
                  setConceptAnswered(false)
                  setConceptResult(null)
                  soundSystem.play('click')
                }}
              >
                {ageLevel === 'kids' ? '继续玩！' : '继续探索'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// 3. 颜色视图 (ColorView) — 彩色运算表
// ===========================================================================

interface ColorViewProps {
  table: number[][]
  size: number
  ageLevel: AgeLevel
  onHighlightCell?: (
    cell: { row: number; col: number; type: 'computation' | 'identity' | 'symmetry' } | null,
  ) => void
}

export function ColorView({ table, size, ageLevel, onHighlightCell }: ColorViewProps) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null)
  const [showNumbers, setShowNumbers] = useState(true)

  // 检测对称性（交换律）
  const isSymmetric = useMemo(() => isTableSymmetric(table, size), [table, size])

  // 找单位元
  const identity = useMemo(() => findIdentity(table, size), [table, size])

  return (
    <div className="sp-color-root">
      {/* 控制栏 */}
      <div className="sp-color-controls">
        <button
          className={`sp-toggle-btn ${showNumbers ? 'active' : ''}`}
          onClick={() => setShowNumbers(!showNumbers)}
        >
          {showNumbers ? '数字' : '纯色'} {ageLevel === 'kids' ? '(切换)' : ''}
        </button>
        <div className="sp-color-legend">
          {Array.from({ length: size }, (_, i) => (
            <div key={i} className="sp-legend-item">
              <div className="sp-legend-swatch" style={{ background: getElementColor(i) }} />
              <span className="sp-legend-num">{i}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 彩色运算表 */}
      <div className="sp-color-table-wrap">
        <table className="sp-color-table">
          <thead>
            <tr>
              <th className="sp-corner-cell">∗</th>
              {Array.from({ length: size }).map((_, j) => (
                <th key={j} className="sp-header-cell" style={{ background: getElementColor(j) }}>
                  {j}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.map((row, i) => (
              <tr key={i}>
                <th className="sp-header-cell" style={{ background: getElementColor(i) }}>
                  {i}
                </th>
                {row.map((val, j) => {
                  const isIdentityCell = i === identity || j === identity
                  const isDiagonal = i === j
                  const isSymmetricCell = isSymmetric && i !== j
                  const isHovered = hovered?.row === i && hovered?.col === j
                  const isCrossHovered = hovered && (hovered.row === i || hovered.col === j)
                  return (
                    <td
                      key={j}
                      className={`sp-color-cell ${isIdentityCell ? 'identity' : ''} ${isDiagonal ? 'diagonal' : ''} ${isSymmetricCell ? 'symmetric' : ''} ${isHovered ? 'hovered' : ''} ${isCrossHovered ? 'cross' : ''}`}
                      style={{ background: getElementColor(val) }}
                      onMouseEnter={() => {
                        setHovered({ row: i, col: j })
                        onHighlightCell?.({ row: i, col: j, type: 'computation' })
                      }}
                      onMouseLeave={() => {
                        setHovered(null)
                        onHighlightCell?.(null)
                      }}
                    >
                      {showNumbers && <span className="sp-cell-num">{val}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 模式说明 */}
      <div className="sp-color-patterns">
        {isSymmetric && (
          <div className="sp-pattern-badge symmetric">
            {ageLevel === 'kids'
              ? '· 换位置也一样！'
              : ageLevel === 'tweens'
                ? '· 满足交换律'
                : '· Commutative (symmetric)'}
          </div>
        )}
        {!isSymmetric && (
          <div className="sp-pattern-badge non-symmetric">
            {ageLevel === 'kids'
              ? '× 有些位置换了不一样！'
              : ageLevel === 'tweens'
                ? '× 不满足交换律'
                : '× Non-commutative'}
          </div>
        )}
        {identity !== -1 && (
          <div className="sp-pattern-badge identity">
            {ageLevel === 'kids'
              ? `★ 老大是 ${identity}（看那一行一列的彩虹色）`
              : ageLevel === 'tweens'
                ? `★ 单位元 = ${identity}`
                : `Identity: ${identity}`}
          </div>
        )}
        <div className="sp-pattern-hint">
          {ageLevel === 'kids'
            ? '提示：对角线两边的颜色一样吗？一样就是"换位置也一样"！'
            : ageLevel === 'tweens'
              ? '对角线对称 = 交换律；单位元行/列 = 彩虹色排列'
              : ' Diagonal symmetry = commutativity; identity row/col = rainbow order'}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// CSS
// ===========================================================================

const PLAYGROUND_CSS = `
.sp-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* === 模式切换 === */
.sp-mode-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg2, #f5f5f5);
  padding: 4px;
  border-radius: 10px;
}
.sp-mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.sp-mode-tab:hover {
  background: var(--bg, #fff);
  color: var(--ink);
}
.sp-mode-tab.active {
  background: var(--bg, #fff);
  color: var(--accent, #3D4F7A);
  box-shadow: 0 2px 6px rgba(0,0,0,0.06);
}
.sp-mode-icon { font-size: 16px; line-height: 1; }
.sp-mode-desc {
  font-size: 12px;
  color: var(--muted);
  padding: 0 4px;
  line-height: 1.5;
}

/* === 元素球 === */
.sp-element-orb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
  box-shadow: 0 3px 8px rgba(0,0,0,0.15);
  transition: transform 0.2s;
  user-select: none;
}
.sp-element-orb:hover {
  transform: scale(1.1);
}

/* === 碰一碰游戏 === */
.sp-bump-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sp-bump-arena {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 12px;
  background: var(--bg2, #f8f8f8);
  border-radius: 12px;
  border: 1px solid var(--border, #e0e0e0);
  position: relative;
  min-height: 80px;
}
.sp-bump-arena.bumping {
  animation: sp-arena-shake 0.5s ease;
}
@keyframes sp-arena-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-3px); }
  40% { transform: translateX(3px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}
.sp-bump-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 2px dashed var(--border, #ddd);
  background: var(--bg, #fff);
  transition: border-color 0.2s;
}
.sp-bump-slot.filled {
  border-style: solid;
  border-color: var(--accent, #3D4F7A);
  animation: sp-slot-fill 0.3s ease;
}
@keyframes sp-slot-fill {
  from { transform: scale(0.5); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.sp-bump-slot-placeholder {
  font-size: 20px;
  color: var(--muted);
  font-weight: 700;
}
.sp-bump-operator {
  font-size: 20px;
  color: var(--accent, #3D4F7A);
  font-weight: 700;
}
.sp-bump-result {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
}
.sp-bump-result.show .sp-result-orb {
  animation: sp-result-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes sp-result-pop {
  0% { transform: scale(0) rotate(-180deg); }
  60% { transform: scale(1.2) rotate(10deg); }
  100% { transform: scale(1) rotate(0); }
}

/* 碰撞粒子 */
.sp-bump-particles {
  position: absolute;
  top: 50%;
  left: 50%;
  pointer-events: none;
}
.sp-particle {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color, #FFD700);
  animation: sp-particle-fly 0.6s ease-out forwards;
  --angle: 0deg;
}
@keyframes sp-particle-fly {
  0% { transform: translate(0, 0) scale(1); opacity: 1; }
  100% {
    transform: translate(calc(cos(var(--angle)) * 50px), calc(sin(var(--angle)) * 50px)) scale(0);
    opacity: 0;
  }
}

/* 元素池 */
.sp-bump-pool {
  padding: 10px;
  background: var(--bg2, #f5f5f5);
  border-radius: 10px;
}
.sp-pool-label {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
  text-align: center;
}
.sp-pool-orbs {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.sp-pool-orb-btn {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  border-radius: 50%;
  transition: transform 0.15s;
}
.sp-pool-orb-btn:hover {
  transform: scale(1.15);
}
.sp-pool-orb-btn:active {
  transform: scale(0.95);
}
.sp-pool-orb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sp-pool-orb-btn.selected .sp-pool-orb {
  box-shadow: 0 0 0 3px var(--accent, #3D4F7A), 0 3px 8px rgba(0,0,0,0.15);
  animation: sp-orb-selected 0.3s ease;
}
@keyframes sp-orb-selected {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

/* 历史 */
.sp-bump-history {
  padding: 8px 10px;
  background: var(--bg2, #f8f8f8);
  border-radius: 8px;
}
.sp-history-label {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
}
.sp-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sp-history-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  animation: sp-history-in 0.3s ease;
}
@keyframes sp-history-in {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}
.sp-hist-orb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.sp-hist-op {
  color: var(--muted);
  font-size: 12px;
}
.sp-discovery-hint {
  padding: 8px 12px;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 8px;
  font-size: 12px;
  color: #92400E;
  animation: sp-hint-in 0.3s ease;
}
@keyframes sp-hint-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* === 找搭档游戏 === */
.sp-match-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sp-match-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sp-match-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}
.sp-match-bar {
  flex: 1;
  height: 6px;
  background: var(--bg2, #f0f0f0);
  border-radius: 3px;
  overflow: hidden;
}
.sp-match-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #4ECDC4, #95E1D3);
  border-radius: 3px;
  transition: width 0.4s ease;
}
.sp-match-grid {
  display: grid;
  gap: 8px;
  padding: 10px;
  background: var(--bg2, #f5f5f5);
  border-radius: 10px;
}
.sp-match-card {
  aspect-ratio: 1;
  perspective: 300px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
}
.sp-match-card:disabled {
  cursor: default;
}
.sp-card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.4s;
}
.sp-match-card.flipped .sp-card-inner,
.sp-match-card.matched .sp-card-inner {
  transform: rotateY(180deg);
}
.sp-card-back {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent, #3D4F7A);
  border-radius: 10px;
  color: #fff;
  font-size: 24px;
  font-weight: 700;
}
.sp-card-front {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  transform: rotateY(180deg);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #fff;
  font-size: 24px;
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.sp-match-card.matched .sp-card-front {
  box-shadow: 0 0 0 2px #10B981, 0 0 12px rgba(16, 185, 129, 0.3);
  animation: sp-match-success 0.5s ease;
}
@keyframes sp-match-success {
  0% { transform: rotateY(180deg) scale(1); }
  50% { transform: rotateY(180deg) scale(1.1); }
  100% { transform: rotateY(180deg) scale(1); }
}
.sp-match-card.wrong .sp-card-inner {
  animation: sp-card-wrong 0.4s ease;
}
@keyframes sp-card-wrong {
  0%, 100% { transform: rotateY(180deg) translateX(0); }
  25% { transform: rotateY(180deg) translateX(-4px); }
  75% { transform: rotateY(180deg) translateX(4px); }
}
.sp-match-card.wrong .sp-card-front {
  box-shadow: 0 0 0 2px #EF4444;
}
.sp-card-check {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 14px;
  color: #10B981;
}
.sp-match-hint {
  font-size: 12px;
  color: var(--muted);
  padding: 6px 10px;
  background: var(--bg2, #f8f8f8);
  border-radius: 6px;
  line-height: 1.5;
}
.sp-match-complete {
  text-align: center;
  padding: 16px;
  background: linear-gradient(135deg, rgba(16,185,129,0.08), rgba(78,205,196,0.08));
  border-radius: 10px;
  border: 1px solid #10B981;
  animation: sp-complete-in 0.5s ease;
}
@keyframes sp-complete-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
.sp-complete-icon {
  font-size: 36px;
  animation: sp-trophy-bounce 0.6s ease;
}
@keyframes sp-trophy-bounce {
  0% { transform: scale(0) rotate(-180deg); }
  60% { transform: scale(1.2) rotate(10deg); }
  100% { transform: scale(1) rotate(0); }
}
.sp-complete-text {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  margin: 8px 0 4px;
}
.sp-complete-encourage {
  font-size: 12px;
  color: var(--muted);
}

/* === 颜色视图 === */
.sp-color-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sp-color-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.sp-toggle-btn {
  padding: 5px 12px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--bg2, #f5f5f5);
  font-size: 12px;
  cursor: pointer;
  color: var(--muted);
  transition: all 0.15s;
}
.sp-toggle-btn.active {
  border-color: var(--accent, #3D4F7A);
  color: var(--accent, #3D4F7A);
  font-weight: 600;
}
.sp-color-legend {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.sp-legend-item {
  display: flex;
  align-items: center;
  gap: 2px;
}
.sp-legend-swatch {
  width: 16px;
  height: 16px;
  border-radius: 3px;
}
.sp-legend-num {
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
}
.sp-color-table-wrap {
  overflow-x: auto;
}
.sp-color-table {
  border-collapse: separate;
  border-spacing: 2px;
  margin: 0 auto;
}
.sp-corner-cell {
  width: 28px;
  height: 28px;
  background: transparent;
}
.sp-header-cell {
  width: 32px;
  height: 28px;
  text-align: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border-radius: 4px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}
.sp-color-cell {
  width: 32px;
  height: 32px;
  text-align: center;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  position: relative;
}
.sp-color-cell:hover {
  transform: scale(1.15);
  z-index: 2;
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}
.sp-color-cell.cross {
  transform: scale(1.08);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.5);
}
.sp-color-cell.identity {
  outline: 2px solid #FFD700;
  outline-offset: -2px;
}
.sp-color-cell.diagonal {
  outline: 2px dashed rgba(255,255,255,0.6);
  outline-offset: -2px;
}
.sp-cell-num {
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.sp-color-patterns {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sp-pattern-badge {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sp-pattern-badge.symmetric {
  background: rgba(16, 185, 129, 0.1);
  color: #065F46;
  border: 1px solid rgba(16, 185, 129, 0.3);
}
.sp-pattern-badge.non-symmetric {
  background: rgba(239, 68, 68, 0.08);
  color: #991B1B;
  border: 1px solid rgba(239, 68, 68, 0.2);
}
.sp-pattern-badge.identity {
  background: rgba(255, 193, 7, 0.1);
  color: #92400E;
  border: 1px solid rgba(255, 193, 7, 0.3);
}
.sp-pattern-hint {
  font-size: 11px;
  color: var(--muted);
  padding: 4px 8px;
}

/* === 引导任务栏 === */
.sp-task-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px;
  background: var(--bg2, #f5f5f5);
  border-radius: 8px;
}
.sp-task-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--bg, #fff);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.sp-task-btn:hover {
  border-color: var(--accent, #3D4F7A);
  color: var(--accent, #3D4F7A);
}
.sp-task-btn.active {
  border-color: var(--accent, #3D4F7A);
  background: rgba(61, 79, 122, 0.08);
  color: var(--accent, #3D4F7A);
  box-shadow: 0 1px 4px rgba(61, 79, 122, 0.12);
}
.sp-task-btn.completed {
  border-color: #10B981;
  background: rgba(16, 185, 129, 0.06);
  color: #065F46;
}
.sp-task-icon { font-size: 14px; line-height: 1; }
.sp-task-label { font-size: 11px; }
.sp-task-check {
  color: #10B981;
  font-size: 12px;
  font-weight: 700;
}
.sp-task-desc {
  font-size: 12px;
  color: var(--ink);
  padding: 6px 10px;
  background: rgba(61, 79, 122, 0.05);
  border-left: 3px solid var(--accent, #3D4F7A);
  border-radius: 0 6px 6px 0;
  animation: sp-task-desc-in 0.3s ease;
}
@keyframes sp-task-desc-in {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}

/* === 形式化符号桥接 === */
.sp-formal-bridge {
  padding: 10px 14px;
  background: linear-gradient(135deg, rgba(61, 79, 122, 0.06), rgba(78, 205, 196, 0.04));
  border: 1px solid rgba(61, 79, 122, 0.15);
  border-radius: 8px;
  animation: sp-bridge-in 0.4s ease;
}
.sp-match-bridge {
  margin-top: 4px;
}
@keyframes sp-bridge-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.sp-formal-expr {
  font-size: 18px;
  font-weight: 700;
  font-family: 'Courier New', monospace;
  text-align: center;
  letter-spacing: 1px;
}
.sp-formal-op {
  color: var(--accent, #3D4F7A);
  margin: 0 2px;
}
.sp-formal-table-ref {
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
  text-align: center;
}
.sp-formal-table-ref code {
  padding: 2px 6px;
  background: var(--bg2, #f0f0f0);
  border-radius: 4px;
  font-size: 11px;
  font-family: 'Courier New', monospace;
}
.sp-formal-ref-label {
  font-weight: 600;
  margin-right: 4px;
}
.sp-formal-note {
  font-size: 12px;
  color: var(--muted);
  font-weight: 400;
}

/* === 概念检查点 === */
.sp-concept-check {
  padding: 14px;
  background: var(--bg, #fff);
  border: 2px solid var(--accent, #3D4F7A);
  border-radius: 10px;
  animation: sp-concept-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes sp-concept-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
.sp-concept-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.sp-concept-icon { font-size: 20px; }
.sp-concept-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent, #3D4F7A);
}
.sp-concept-question {
  font-size: 13px;
  color: var(--ink);
  line-height: 1.6;
  margin-bottom: 10px;
}
.sp-concept-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sp-concept-option {
  padding: 8px 12px;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: var(--bg2, #f8f8f8);
  color: var(--ink);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}
.sp-concept-option:hover {
  border-color: var(--accent, #3D4F7A);
  background: rgba(61, 79, 122, 0.05);
}
.sp-concept-option:active {
  transform: scale(0.98);
}
.sp-concept-result {
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  margin-bottom: 8px;
}
.sp-concept-result.correct {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #065F46;
}
.sp-concept-result.wrong {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #991B1B;
}
.sp-concept-close {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: var(--accent, #3D4F7A);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s;
}
.sp-concept-close:hover {
  transform: scale(1.03);
}

/* === 响应式 === */
@media (max-width: 600px) {
  .sp-task-btn {
    padding: 5px 8px;
    font-size: 10px;
  }
  .sp-formal-expr {
    font-size: 15px;
  }
  .sp-concept-option {
    font-size: 11px;
    padding: 7px 10px;
  }
  .sp-element-orb {
    width: 36px;
    height: 36px;
    font-size: 15px;
  }
  .sp-bump-slot, .sp-bump-result {
    width: 44px;
    height: 44px;
  }
}
`
