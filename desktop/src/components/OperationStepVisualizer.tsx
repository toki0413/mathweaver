import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { AgeLevel } from '../utils/ageAdapt'
import { getEncouragement } from '../utils/ageAdapt'

/**
 * OperationStepVisualizer — 动态运算步骤可视化
 *
 * AI 时代的新数学运动：把群论运算从静态数字变成可玩的动态过程。
 *
 * 七种模式（年龄适配标签）：
 *   1. 二元运算 — kids: "碰一碰" / teens: "Binary Operation"
 *   2. 结合律   — kids: "谁先谁后" / teens: "Associativity"
 *   3. 逆元搜索 — kids: "找好搭档" / teens: "Inverse Search"
 *   4. 循环子群 — kids: "绕圈圈" / teens: "Cyclic Subgroup"
 *   5. 交换律   — kids: "换位置一样吗" / teens: "Commutativity"
 *   6. 子群检测 — kids: "找小帮派" / teens: "Subgroup"
 *   7. 阶计算   — kids: "绕几圈" / teens: "Order"
 *
 * 互动性增强：
 *   - 完成时有星星奖励 + 鼓励语
 *   - 找到结果时有庆祝动画
 *   - 错误时有友好提示（不是冷冰冰的"错误"）
 *   - 可拖拽元素到运算区
 *   - 动画速度可调
 */

type VizMode =
  'binary' | 'associativity' | 'inverse' | 'cyclic' | 'commutativity' | 'subgroup' | 'order'

interface Step {
  label: string
  cell?: { row: number; col: number }
  result?: number
  expr?: string
  type: 'lookup' | 'compute' | 'compare' | 'found' | 'cycle'
}

interface Props {
  table: number[][]
  size: number
  ageLevel?: AgeLevel
  onHighlightCell?: (
    cell: { row: number; col: number; type: 'computation' | 'identity' | 'symmetry' } | null,
  ) => void
}

export function OperationStepVisualizer({
  table,
  size,
  ageLevel = 'tweens',
  onHighlightCell,
}: Props) {
  const [mode, setMode] = useState<VizMode>('binary')
  const [elemA, setElemA] = useState(0)
  const [elemB, setElemB] = useState(1)
  const [elemC, setElemC] = useState(2)
  const [playing, setPlaying] = useState(false)
  const [currentStepIdx, setCurrentStepIdx] = useState(-1)
  const [animSpeed, setAnimSpeed] = useState(900)
  const [showReward, setShowReward] = useState(false)
  const [rewardText, setRewardText] = useState('')
  const [completedModes, setCompletedModes] = useState<Set<VizMode>>(new Set())
  const [subgroupElements, _setSubgroupElements] = useState<Set<number>>(new Set([0, 1]))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lookup = useCallback(
    (a: number, b: number): number | null => {
      const v = table[a]?.[b]
      if (typeof v !== 'number' || v < 0 || v > size - 1) return null
      return v
    },
    [table, size],
  )

  const identity = useMemo(() => {
    for (let e = 0; e < size; e++) {
      let ok = true
      for (let j = 0; j < size; j++) {
        if (table[e]?.[j] !== j) {
          ok = false
          break
        }
      }
      if (ok) return e
    }
    return -1
  }, [table, size])

  // ── 模式标签 ──
  const modeTabs: { id: VizMode; label: string; icon: string; desc: string }[] = useMemo(() => {
    const base: { id: VizMode; label: string; icon: string; desc: string }[] = []
    if (ageLevel === 'kids') {
      base.push(
        { id: 'binary', label: '碰一碰', icon: '✨', desc: '两个数字碰一碰' },
        { id: 'associativity', label: '谁先谁后', icon: '🔄', desc: '换顺序试试看' },
        { id: 'inverse', label: '找好搭档', icon: '🤝', desc: '谁的搭档是谁？' },
        { id: 'cyclic', label: '绕圈圈', icon: '⭕', desc: '一直碰下去会怎样？' },
        { id: 'commutativity', label: '换位置', icon: '⚖', desc: '换位置结果一样吗？' },
        { id: 'subgroup', label: '找小帮派', icon: '👪', desc: '谁能组成小家族？' },
        { id: 'order', label: '绕几圈', icon: '🔢', desc: '要碰几次才回家？' },
      )
    } else if (ageLevel === 'tweens') {
      base.push(
        { id: 'binary', label: '二元运算', icon: '∗', desc: 'a ∗ b 的查表过程' },
        { id: 'associativity', label: '结合律', icon: '()', desc: '(a∗b)∗c vs a∗(b∗c)' },
        { id: 'inverse', label: '逆元搜索', icon: '⁻¹', desc: '寻找 a⁻¹' },
        { id: 'cyclic', label: '循环子群', icon: '⟨a⟩', desc: '生成 ⟨a⟩' },
        { id: 'commutativity', label: '交换律', icon: '⚖', desc: '检查 a∗b = b∗a' },
        { id: 'subgroup', label: '子群检测', icon: 'H', desc: '检测子集是否构成子群' },
        { id: 'order', label: '阶计算', icon: '|a|', desc: '计算元素的阶' },
      )
    } else {
      base.push(
        { id: 'binary', label: 'Binary', icon: '∗', desc: 'a ∗ b lookup' },
        { id: 'associativity', label: 'Associativity', icon: '()', desc: '(a∗b)∗c vs a∗(b∗c)' },
        { id: 'inverse', label: 'Inverse', icon: '⁻¹', desc: 'Find a⁻¹' },
        { id: 'cyclic', label: 'Cyclic', icon: '⟨a⟩', desc: 'Generate ⟨a⟩' },
        { id: 'commutativity', label: 'Commutativity', icon: '⚖', desc: 'Check a∗b = b∗a ∀a,b' },
        { id: 'subgroup', label: 'Subgroup', icon: 'H', desc: 'Test if subset is a subgroup' },
        { id: 'order', label: 'Order', icon: '|a|', desc: 'Compute |a|' },
      )
    }
    return base
  }, [ageLevel])

  // ── 步骤生成 ──
  const binarySteps = useMemo<Step[]>(() => {
    const steps: Step[] = []
    steps.push({
      label: ageLevel === 'kids' ? `让 ${elemA} 和 ${elemB} 碰一碰！` : `计算 ${elemA} ∗ ${elemB}`,
      type: 'compute',
      expr: `${elemA} ∗ ${elemB} = ?`,
    })
    steps.push({
      label:
        ageLevel === 'kids'
          ? `在密码表里找第 ${elemA} 行、第 ${elemB} 列`
          : `在运算表中查找 table[${elemA}][${elemB}]`,
      cell: { row: elemA, col: elemB },
      type: 'lookup',
      expr: `table[${elemA}][${elemB}]`,
    })
    const result = lookup(elemA, elemB)
    steps.push({
      label:
        ageLevel === 'kids'
          ? `找到了！${elemA} 碰 ${elemB} = ${result ?? '?'}`
          : `结果：${elemA} ∗ ${elemB} = ${result ?? '?'}`,
      cell: { row: elemA, col: elemB },
      result: result ?? undefined,
      type: 'found',
      expr: `${elemA} ∗ ${elemB} = ${result ?? '?'}`,
    })
    return steps
  }, [elemA, elemB, lookup, ageLevel])

  const assocSteps = useMemo<Step[]>(() => {
    const steps: Step[] = []
    const ab = lookup(elemA, elemB)
    const bc = lookup(elemB, elemC)

    if (ageLevel === 'kids') {
      steps.push({ label: `试试先碰 ${elemA} 和 ${elemB}，再碰 ${elemC}`, type: 'compute' })
    } else {
      steps.push({
        label: `验证结合律：(${elemA}∗${elemB})∗${elemC} vs ${elemA}∗(${elemB}∗${elemC})`,
        type: 'compute',
      })
    }

    const leftPrefix = ageLevel === 'kids' ? '左边' : '左路'
    const rightPrefix = ageLevel === 'kids' ? '右边' : '右路'

    // Left path
    steps.push({
      label: `【${leftPrefix}】先查 ${elemA} ∗ ${elemB}`,
      cell: { row: elemA, col: elemB },
      type: 'lookup',
    })
    steps.push({
      label: `【${leftPrefix}】${elemA} ∗ ${elemB} = ${ab ?? '?'}`,
      cell: { row: elemA, col: elemB },
      result: ab ?? undefined,
      type: 'found',
    })
    if (ab !== null) {
      steps.push({
        label: `【${leftPrefix}】再查 (${ab}) ∗ ${elemC}`,
        cell: { row: ab, col: elemC },
        type: 'lookup',
      })
      const abc = lookup(ab, elemC)
      steps.push({
        label: `【${leftPrefix}】(${ab}) ∗ ${elemC} = ${abc ?? '?'}`,
        cell: { row: ab, col: elemC },
        result: abc ?? undefined,
        type: 'found',
      })
    }

    // Right path
    steps.push({
      label: `【${rightPrefix}】先查 ${elemB} ∗ ${elemC}`,
      cell: { row: elemB, col: elemC },
      type: 'lookup',
    })
    steps.push({
      label: `【${rightPrefix}】${elemB} ∗ ${elemC} = ${bc ?? '?'}`,
      cell: { row: elemB, col: elemC },
      result: bc ?? undefined,
      type: 'found',
    })
    if (bc !== null) {
      steps.push({
        label: `【${rightPrefix}】再查 ${elemA} ∗ (${bc})`,
        cell: { row: elemA, col: bc },
        type: 'lookup',
      })
      const abc2 = lookup(elemA, bc)
      steps.push({
        label: `【${rightPrefix}】${elemA} ∗ (${bc}) = ${abc2 ?? '?'}`,
        cell: { row: elemA, col: bc },
        result: abc2 ?? undefined,
        type: 'found',
      })
    }

    if (ab !== null && bc !== null) {
      const left = lookup(ab, elemC)
      const right = lookup(elemA, bc)
      const equal = left === right
      steps.push({
        label:
          ageLevel === 'kids'
            ? equal
              ? '两边一样！谁先谁后都一样！🎉'
              : '两边不一样！这个表谁先谁后有区别！🤔'
            : equal
              ? '✓ 两者相等，结合律在此三元组上成立'
              : '✗ 两者不等，结合律在此三元组上不成立',
        type: 'compare',
        expr: `(${elemA}∗${elemB})∗${elemC} = ${left ?? '?'}  vs  ${elemA}∗(${elemB}∗${elemC}) = ${right ?? '?'}`,
      })
    }
    return steps
  }, [elemA, elemB, elemC, lookup, ageLevel])

  const inverseSteps = useMemo<Step[]>(() => {
    const steps: Step[] = []
    if (identity < 0) {
      steps.push({
        label: ageLevel === 'kids' ? '还没找到老大呢！' : '未检测到单位元，无法搜索逆元',
        type: 'compute',
      })
      return steps
    }
    steps.push({
      label:
        ageLevel === 'kids'
          ? `帮 ${elemA} 找好搭档！好搭档碰一碰会变成老大(${identity})`
          : `寻找 ${elemA} 的逆元 a⁻¹，使得 ${elemA} ∗ a⁻¹ = ${identity}`,
      type: 'compute',
    })

    let found = false
    for (let b = 0; b < size; b++) {
      steps.push({
        label:
          ageLevel === 'kids'
            ? `试试 ${b}：${elemA} 碰 ${b} = ?`
            : `尝试 a⁻¹ = ${b}：table[${elemA}][${b}]`,
        cell: { row: elemA, col: b },
        type: 'lookup',
        expr: `${elemA} ∗ ${b} = ?`,
      })
      const result = lookup(elemA, b)
      if (result === identity) {
        steps.push({
          label:
            ageLevel === 'kids'
              ? `找到了！${elemA} 碰 ${b} = ${identity}（老大）！好搭档就是 ${b}！🎉`
              : `✓ ${elemA} ∗ ${b} = ${identity}，所以 ${elemA}⁻¹ = ${b}`,
          cell: { row: elemA, col: b },
          result,
          type: 'found',
          expr: `${elemA}⁻¹ = ${b}`,
        })
        found = true
        break
      } else {
        steps.push({
          label:
            ageLevel === 'kids'
              ? `结果是 ${result ?? '?'}，不是老大(${identity})，再试试别人...`
              : `结果 ${result ?? '?'} ≠ ${identity}，继续搜索...`,
          cell: { row: elemA, col: b },
          result: result ?? undefined,
          type: 'compute',
        })
      }
    }
    if (!found) {
      steps.push({
        label: ageLevel === 'kids' ? `没有找到好搭档...${elemA} 可能没有搭档哦` : `✗ 未找到逆元`,
        type: 'compare',
      })
    }
    return steps
  }, [elemA, identity, size, lookup, ageLevel])

  const cyclicSteps = useMemo<Step[]>(() => {
    const steps: Step[] = []
    if (identity < 0) {
      steps.push({
        label: ageLevel === 'kids' ? '还没找到老大呢！' : '未检测到单位元',
        type: 'compute',
      })
      return steps
    }
    steps.push({
      label:
        ageLevel === 'kids'
          ? `让 ${elemA} 不停地碰自己，看看会怎样！`
          : `生成循环子群 ⟨${elemA}⟩：从单位元 ${identity} 开始，不断左乘 ${elemA}`,
      type: 'compute',
    })

    const visited: number[] = [identity]
    steps.push({
      label:
        ageLevel === 'kids' ? `第 0 次：${identity}（老大，起点）` : `a⁰ = ${identity}（单位元）`,
      type: 'found',
      expr: `${elemA}⁰ = ${identity}`,
    })

    let current = identity
    for (let power = 1; power <= size * size; power++) {
      steps.push({
        label:
          ageLevel === 'kids'
            ? `第 ${power} 次：${current} 碰 ${elemA} = ?`
            : `a^${power} = ${current} ∗ ${elemA}`,
        cell: { row: current, col: elemA },
        type: 'lookup',
        expr: `${current} ∗ ${elemA} = ?`,
      })
      const next = lookup(current, elemA)
      if (next === null) break
      steps.push({
        label: ageLevel === 'kids' ? `第 ${power} 次：${next}！` : `a^${power} = ${next}`,
        cell: { row: current, col: elemA },
        result: next,
        type: 'found',
        expr: `${elemA}^${power} = ${next}`,
      })
      if (next === identity) {
        steps.push({
          label:
            ageLevel === 'kids'
              ? `回到老大了！${elemA} 绕了 ${power} 圈！🎉`
              : `回到单位元！${elemA} 的阶为 ${power}`,
          type: 'cycle',
          expr: ageLevel === 'kids' ? `绕了 ${power} 圈` : `|${elemA}| = ${power}`,
        })
        break
      }
      if (visited.includes(next)) {
        steps.push({
          label: ageLevel === 'kids' ? `${next} 已经出现过了，停！` : `进入已访问元素，循环结束`,
          type: 'cycle',
        })
        break
      }
      visited.push(next)
      current = next
    }
    steps.push({
      label:
        ageLevel === 'kids'
          ? `绕圈圈家族：{ ${visited.join(', ')} }`
          : `⟨${elemA}⟩ = { ${visited.join(', ')} }`,
      type: 'compare',
      expr:
        ageLevel === 'kids' ? `一共 ${visited.length} 个人` : `|⟨${elemA}⟩| = ${visited.length}`,
    })
    return steps
  }, [elemA, identity, size, lookup, ageLevel])

  // ── 交换律步骤 ──
  const commutativitySteps = useMemo<Step[]>(() => {
    const steps: Step[] = []
    steps.push({
      label:
        ageLevel === 'kids'
          ? `看看 ${elemA} 碰 ${elemB} 和 ${elemB} 碰 ${elemA} 一不一样！`
          : `验证交换律：${elemA} ∗ ${elemB} vs ${elemB} ∗ ${elemA}`,
      type: 'compute',
    })

    const ab = lookup(elemA, elemB)
    steps.push({
      label: ageLevel === 'kids' ? `先查 ${elemA} 碰 ${elemB}` : `查找 table[${elemA}][${elemB}]`,
      cell: { row: elemA, col: elemB },
      type: 'lookup',
      expr: `${elemA} ∗ ${elemB} = ?`,
    })
    steps.push({
      label:
        ageLevel === 'kids'
          ? `${elemA} 碰 ${elemB} = ${ab ?? '?'}`
          : `${elemA} ∗ ${elemB} = ${ab ?? '?'}`,
      cell: { row: elemA, col: elemB },
      result: ab ?? undefined,
      type: 'found',
      expr: `${elemA} ∗ ${elemB} = ${ab ?? '?'}`,
    })

    const ba = lookup(elemB, elemA)
    steps.push({
      label: ageLevel === 'kids' ? `再查 ${elemB} 碰 ${elemA}` : `查找 table[${elemB}][${elemA}]`,
      cell: { row: elemB, col: elemA },
      type: 'lookup',
      expr: `${elemB} ∗ ${elemA} = ?`,
    })
    steps.push({
      label:
        ageLevel === 'kids'
          ? `${elemB} 碰 ${elemA} = ${ba ?? '?'}`
          : `${elemB} ∗ ${elemA} = ${ba ?? '?'}`,
      cell: { row: elemB, col: elemA },
      result: ba ?? undefined,
      type: 'found',
      expr: `${elemB} ∗ ${elemA} = ${ba ?? '?'}`,
    })

    const equal = ab === ba
    steps.push({
      label:
        ageLevel === 'kids'
          ? equal
            ? `一样！换位置碰都是 ${ab ?? '?'}！🎉`
            : `不一样！${elemA} 碰 ${elemB} = ${ab ?? '?'}，但 ${elemB} 碰 ${elemA} = ${ba ?? '?'}！🤔`
          : equal
            ? '✓ 两者相等，交换律在此二元组上成立'
            : '✗ 两者不等，交换律在此二元组上不成立',
      type: 'compare',
      expr: `${elemA} ∗ ${elemB} = ${ab ?? '?'}  vs  ${elemB} ∗ ${elemA} = ${ba ?? '?'}`,
    })
    return steps
  }, [elemA, elemB, lookup, ageLevel])

  // ── 子群检测步骤 ──
  const subgroupSteps = useMemo<Step[]>(() => {
    const steps: Step[] = []
    const elems = Array.from(subgroupElements).sort((x, y) => x - y)

    steps.push({
      label:
        ageLevel === 'kids'
          ? `检查 { ${elems.join(', ')} } 是不是一个小帮派！`
          : `检验子集 H = { ${elems.join(', ')} } 是否构成子群`,
      type: 'compute',
      expr: `H = { ${elems.join(', ')} }`,
    })

    if (elems.length === 0) {
      steps.push({
        label: ageLevel === 'kids' ? '小帮派里还没有人呢！' : '子集为空，无法构成子群',
        type: 'compare',
      })
      return steps
    }

    // 1) 封闭性：对所有 a,b ∈ H，table[a][b] 也必须在 H 中
    let closureOk = true
    steps.push({
      label:
        ageLevel === 'kids' ? '第一步：碰完还在不在小帮派里？' : '① 封闭性：∀ a,b ∈ H，a ∗ b ∈ H ?',
      type: 'compute',
    })
    for (const a of elems) {
      for (const b of elems) {
        const ab = lookup(a, b)
        const inSet = ab !== null && subgroupElements.has(ab)
        steps.push({
          label:
            ageLevel === 'kids'
              ? inSet
                ? `${a} 碰 ${b} = ${ab}，还在小帮派里！✓`
                : `${a} 碰 ${b} = ${ab ?? '?'}，跑出小帮派了！✗`
              : inSet
                ? `✓ ${a} ∗ ${b} = ${ab} ∈ H`
                : `✗ ${a} ∗ ${b} = ${ab ?? '?'} ∉ H`,
          cell: { row: a, col: b },
          result: ab ?? undefined,
          type: 'lookup',
          expr: `${a} ∗ ${b} = ${ab ?? '?'}`,
        })
        if (!inSet) closureOk = false
      }
    }

    // 2) 单位元：单位元必须在 H 中
    const hasIdentity = identity >= 0 && subgroupElements.has(identity)
    steps.push({
      label:
        ageLevel === 'kids'
          ? hasIdentity
            ? `第二步：老大 ${identity} 在小帮派里！✓`
            : `第二步：老大 ${identity >= 0 ? identity : '?'} 不在小帮派里！✗`
          : hasIdentity
            ? `② 单位元：✓ ${identity} ∈ H`
            : `② 单位元：✗ ${identity >= 0 ? identity : '?'} ∉ H`,
      type: 'compare',
      expr: ageLevel === 'kids' ? '老大检查' : `${identity} ∈ H ? ${hasIdentity}`,
    })

    // 3) 逆元：对每个 a ∈ H，a 的逆元也必须在 H 中
    let inverseOk = true
    steps.push({
      label:
        ageLevel === 'kids'
          ? '第三步：每个人的好搭档也在小帮派里吗？'
          : '③ 逆元：∀ a ∈ H，a⁻¹ ∈ H ?',
      type: 'compute',
    })
    if (identity >= 0) {
      for (const a of elems) {
        let invVal: number | null = null
        for (const b of elems) {
          if (lookup(a, b) === identity) {
            invVal = b
            break
          }
        }
        if (invVal !== null) {
          steps.push({
            label:
              ageLevel === 'kids'
                ? `${a} 的好搭档是 ${invVal}，也在小帮派里！✓`
                : `✓ ${a}⁻¹ = ${invVal} ∈ H`,
            cell: { row: a, col: invVal },
            result: identity,
            type: 'found',
            expr: `${a} ∗ ${invVal} = ${identity}`,
          })
        } else {
          steps.push({
            label: ageLevel === 'kids' ? `${a} 在小帮派里找不到好搭档！✗` : `✗ ${a}⁻¹ ∉ H`,
            type: 'compare',
          })
          inverseOk = false
        }
      }
    }

    const isSubgroup = hasIdentity && closureOk && inverseOk
    steps.push({
      label:
        ageLevel === 'kids'
          ? isSubgroup
            ? `太棒了！{ ${elems.join(', ')} } 是一个小帮派！🎉`
            : `还不是小帮派哦，再调整一下试试看！`
          : isSubgroup
            ? `✓ H = { ${elems.join(', ')} } 是子群`
            : `✗ H = { ${elems.join(', ')} } 不是子群`,
      type: 'compare',
      expr:
        ageLevel === 'kids' ? (isSubgroup ? '是小帮派！' : '不是小帮派') : `子群? ${isSubgroup}`,
    })
    return steps
  }, [subgroupElements, identity, lookup, ageLevel])

  // ── 阶计算步骤 ──
  const orderSteps = useMemo<Step[]>(() => {
    const steps: Step[] = []
    if (identity < 0) {
      steps.push({
        label: ageLevel === 'kids' ? '还没找到老大呢！' : '未检测到单位元，无法计算阶',
        type: 'compute',
      })
      return steps
    }
    steps.push({
      label:
        ageLevel === 'kids'
          ? `看看 ${elemA} 要碰几次自己才能回到老大！`
          : `计算 ${elemA} 的阶 |${elemA}|：不断左乘 ${elemA} 直到回到单位元 ${identity}`,
      type: 'compute',
    })

    steps.push({
      label:
        ageLevel === 'kids'
          ? `第 0 次：${identity}（老大，起点）`
          : `${elemA}⁰ = ${identity}（单位元，计数起点）`,
      type: 'found',
      expr: `${elemA}⁰ = ${identity}`,
    })

    let current = identity
    let order = 0
    const visited = new Set<number>([identity])
    for (let power = 1; power <= size * size; power++) {
      steps.push({
        label:
          ageLevel === 'kids'
            ? `第 ${power} 次：${current} 碰 ${elemA} = ?`
            : `${elemA}^${power} = ${current} ∗ ${elemA}`,
        cell: { row: current, col: elemA },
        type: 'lookup',
        expr: `${current} ∗ ${elemA} = ?`,
      })
      const next = lookup(current, elemA)
      if (next === null) break
      order = power
      steps.push({
        label: ageLevel === 'kids' ? `第 ${power} 次：${next}！` : `${elemA}^${power} = ${next}`,
        cell: { row: current, col: elemA },
        result: next,
        type: 'found',
        expr: `${elemA}^${power} = ${next}`,
      })
      if (next === identity) {
        steps.push({
          label:
            ageLevel === 'kids'
              ? `回到老大了！${elemA} 碰了 ${order} 次回到起点！🎉`
              : `回到单位元！|${elemA}| = ${order}`,
          type: 'cycle',
          expr: `|${elemA}| = ${order}`,
        })
        break
      }
      if (visited.has(next)) {
        steps.push({
          label:
            ageLevel === 'kids'
              ? `${next} 出现过了但没回老大，${elemA} 可能没有有限的阶！`
              : `进入循环但未回到单位元，${elemA} 的阶无法确定（可能无限）`,
          type: 'cycle',
        })
        break
      }
      visited.add(next)
      current = next
    }
    steps.push({
      label: ageLevel === 'kids' ? `结论：${elemA} 的阶是 ${order}` : `结论：|${elemA}| = ${order}`,
      type: 'compare',
      expr: `|${elemA}| = ${order}`,
    })
    return steps
  }, [elemA, identity, size, lookup, ageLevel])

  const steps = useMemo(() => {
    switch (mode) {
      case 'binary':
        return binarySteps
      case 'associativity':
        return assocSteps
      case 'inverse':
        return inverseSteps
      case 'cyclic':
        return cyclicSteps
      case 'commutativity':
        return commutativitySteps
      case 'subgroup':
        return subgroupSteps
      case 'order':
        return orderSteps
    }
  }, [
    mode,
    binarySteps,
    assocSteps,
    inverseSteps,
    cyclicSteps,
    commutativitySteps,
    subgroupSteps,
    orderSteps,
  ])

  // ── 播放动画 ──
  const play = useCallback(() => {
    setPlaying(true)
    setCurrentStepIdx(-1)
  }, [])

  useEffect(() => {
    if (!playing) return
    if (timerRef.current) clearTimeout(timerRef.current)

    if (currentStepIdx >= steps.length - 1) {
      setPlaying(false)
      // 庆祝完成
      if (steps.length > 0) {
        setShowReward(true)
        setRewardText(getEncouragement(ageLevel, 'correct'))
        setCompletedModes(prev => new Set(prev).add(mode))
        setTimeout(() => setShowReward(false), 2500)
      }
      return
    }

    const nextIdx = currentStepIdx + 1
    timerRef.current = setTimeout(() => {
      setCurrentStepIdx(nextIdx)
      const step = steps[nextIdx]
      if (step?.cell && onHighlightCell) {
        onHighlightCell({ row: step.cell.row, col: step.cell.col, type: 'computation' })
      }
    }, animSpeed)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [playing, currentStepIdx, steps, onHighlightCell, animSpeed, ageLevel, mode])

  // 模式/元素变化时重置
  useEffect(() => {
    setPlaying(false)
    setCurrentStepIdx(-1)
    if (onHighlightCell) onHighlightCell(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, elemA, elemB, elemC])

  const handleStepForward = useCallback(() => {
    if (currentStepIdx < steps.length - 1) {
      const next = currentStepIdx + 1
      setCurrentStepIdx(next)
      const step = steps[next]
      if (step?.cell && onHighlightCell) {
        onHighlightCell({ row: step.cell.row, col: step.cell.col, type: 'computation' })
      }
    }
  }, [currentStepIdx, steps, onHighlightCell])

  const handleStepBack = useCallback(() => {
    if (currentStepIdx > 0) {
      const prev = currentStepIdx - 1
      setCurrentStepIdx(prev)
      const step = steps[prev]
      if (step?.cell && onHighlightCell) {
        onHighlightCell({ row: step.cell.row, col: step.cell.col, type: 'computation' })
      }
    } else {
      setCurrentStepIdx(-1)
      if (onHighlightCell) onHighlightCell(null)
    }
  }, [currentStepIdx, steps, onHighlightCell])

  const ElementPicker = ({
    label,
    value,
    onChange,
  }: {
    label: string
    value: number
    onChange: (v: number) => void
  }) => (
    <div className="op-step-picker">
      <span className="op-step-picker-label">{label}</span>
      <div className="op-step-picker-btns">
        {Array.from({ length: size }, (_, i) => (
          <button
            key={i}
            className={`op-step-elem-btn${value === i ? ' selected' : ''}${identity === i ? ' is-identity' : ''}`}
            onClick={() => onChange(i)}
            title={identity === i ? (ageLevel === 'kids' ? '老大' : '单位元') : undefined}
          >
            {i}
            {identity === i && (
              <span className="op-step-identity-mark">{ageLevel === 'kids' ? '王' : 'e'}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )

  const visibleSteps = currentStepIdx >= 0 ? steps.slice(0, currentStepIdx + 1) : []
  const currentStep = currentStepIdx >= 0 ? steps[currentStepIdx] : null
  const currentTab = modeTabs.find(tab => tab.id === mode)!

  return (
    <div className="op-step-visualizer">
      {/* 奖励弹窗 */}
      {showReward && (
        <div className="op-step-reward">
          <div className="op-step-reward-inner">
            <div className="op-step-reward-emoji">🎉</div>
            <div className="op-step-reward-text">{rewardText}</div>
            <div className="op-step-reward-star">⭐</div>
          </div>
        </div>
      )}

      {/* 模式切换 */}
      <div className="op-step-modes">
        {modeTabs.map(tab => (
          <button
            key={tab.id}
            className={`op-step-mode-btn${mode === tab.id ? ' active' : ''}${completedModes.has(tab.id) ? ' completed' : ''}`}
            onClick={() => setMode(tab.id)}
            title={tab.desc}
          >
            <span className="op-step-mode-icon">{tab.icon}</span>
            <span className="op-step-mode-label">{tab.label}</span>
            {completedModes.has(tab.id) && <span className="op-step-mode-check">⭐</span>}
          </button>
        ))}
      </div>

      {/* 当前模式说明 */}
      <div className="op-step-mode-desc">{currentTab.desc}</div>

      {/* 元素选择 */}
      <div className="op-step-pickers">
        <ElementPicker label="a" value={elemA} onChange={setElemA} />
        {(mode === 'binary' || mode === 'associativity' || mode === 'inverse') && (
          <ElementPicker label="b" value={elemB} onChange={setElemB} />
        )}
        {mode === 'associativity' && <ElementPicker label="c" value={elemC} onChange={setElemC} />}
      </div>

      {/* 控制按钮 */}
      <div className="op-step-controls">
        <button
          className="op-step-ctrl-btn"
          onClick={handleStepBack}
          disabled={currentStepIdx < 0}
          title={ageLevel === 'kids' ? '上一步' : 'Previous step'}
        >
          ◀
        </button>
        <button
          className={`op-step-ctrl-btn play${playing ? ' playing' : ''}`}
          onClick={playing ? () => setPlaying(false) : play}
          title={
            playing
              ? ageLevel === 'kids'
                ? '暂停'
                : 'Pause'
              : ageLevel === 'kids'
                ? '播放'
                : 'Play'
          }
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          className="op-step-ctrl-btn"
          onClick={handleStepForward}
          disabled={currentStepIdx >= steps.length - 1}
          title={ageLevel === 'kids' ? '下一步' : 'Next step'}
        >
          ▶
        </button>
        <button
          className="op-step-ctrl-btn reset"
          onClick={() => {
            setPlaying(false)
            setCurrentStepIdx(-1)
            if (onHighlightCell) onHighlightCell(null)
          }}
          title={ageLevel === 'kids' ? '重新开始' : 'Reset'}
        >
          ⟲
        </button>
        <span className="op-step-progress">
          {currentStepIdx + 1} / {steps.length}
        </span>
        {/* 速度调节 */}
        <div className="op-step-speed">
          <span className="op-step-speed-label">{ageLevel === 'kids' ? '快慢' : '速度'}</span>
          <input
            type="range"
            min="300"
            max="2000"
            step="100"
            value={2100 - animSpeed}
            onChange={e => setAnimSpeed(2100 - parseInt(e.target.value))}
            className="op-step-speed-slider"
            aria-label={ageLevel === 'kids' ? '动画速度' : 'Animation speed'}
          />
        </div>
      </div>

      {/* 进度条 */}
      <div className="op-step-progress-bar">
        <div
          className="op-step-progress-fill"
          style={{
            width: `${steps.length > 0 ? ((currentStepIdx + 1) / steps.length) * 100 : 0}%`,
          }}
        />
      </div>

      {/* 当前步骤大显示 */}
      {currentStep && (
        <div className={`op-step-current op-step-type-${currentStep.type}`}>
          <div className="op-step-current-label">{currentStep.label}</div>
          {currentStep.expr && <div className="op-step-current-expr">{currentStep.expr}</div>}
          {currentStep.result !== undefined && (
            <div className="op-step-current-result">
              {ageLevel === 'kids' ? '结果' : 'Result'}：<strong>{currentStep.result}</strong>
            </div>
          )}
        </div>
      )}

      {/* 步骤列表 */}
      <div
        className="op-step-list"
        role="log"
        aria-label={ageLevel === 'kids' ? '运算步骤' : 'Operation steps'}
      >
        {visibleSteps.length === 0 && (
          <div className="op-step-empty">
            {ageLevel === 'kids'
              ? '点击 ▶ 开始冒险！看看数字碰一碰会变出什么！'
              : ageLevel === 'tweens'
                ? '点击 ▶ 播放或 ▶ 逐步查看运算过程'
                : 'Click ▶ to play or ▶ to step through'}
          </div>
        )}
        {visibleSteps.map((step, i) => (
          <div
            key={i}
            className={`op-step-item op-step-type-${step.type}${i === currentStepIdx ? ' active' : ''}`}
          >
            <span className="op-step-num">{i + 1}</span>
            <span className="op-step-text">{step.label}</span>
            {step.expr && <span className="op-step-expr-tag">{step.expr}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default OperationStepVisualizer
