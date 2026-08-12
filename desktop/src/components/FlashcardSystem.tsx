import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Flashcard {
  id: string
  front: string
  back: string
  category: string
  ease: number // SM-2 ease factor, 初始 2.5
  interval: number // 下次复习间隔(天)
  reps: number // 已复习次数
}

export interface FlashcardSystemProps {
  cards?: Flashcard[]
  onProgress?: (stats: { reviewed: number; total: number; mastered: number }) => void
}

type Rating = 'again' | 'hard' | 'good' | 'easy'

type CardStatus = 'new' | 'learning' | 'mastered'

// ---------------------------------------------------------------------------
// FlashcardSystem
//
// 闪卡复习系统，使用 CSS 3D 翻转动画展示群论概念。点击卡片翻转至背面查看
// 定义/答案，翻转后根据记忆程度评分（再来一次 / 困难 / 良好 / 简单），评分通
// 过简化的 SM-2 间隔重复算法调整每张卡片的 ease factor、复习间隔与复习次数。
//
// 功能要点：
// - CSS 3D transform 翻转（transform-style: preserve-3d, backface-visibility: hidden）
// - 简化 SM-2 算法：q<3 重置；q>=3 按 reps 递增间隔，ease 随评分调整
// - 进度跟踪：已复习 / 总数 / 掌握度百分比
// - 卡片导航：上一张 / 下一张，支持键盘左右箭头、空格翻转、1-4 评分
// - 内置默认卡片集（群论基础概念 10 张）
//
// 样式类名统一以 `fs-` 为前缀，通过组件内 <style> 注入，复用全局暗色 CSS 变量。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_EASE = 2.5
const MIN_EASE = 1.3
const MASTERED_INTERVAL_THRESHOLD = 21
const MASTERED_REPS_THRESHOLD = 3
const FLIP_DEBOUNCE_MS = 300

const RATING_META: Record<Rating, { label: string; quality: number; cls: string; key: string }> = {
  again: { label: '再来一次', quality: 0, cls: 'fs-rate-again', key: '1' },
  hard: { label: '困难', quality: 3, cls: 'fs-rate-hard', key: '2' },
  good: { label: '良好', quality: 4, cls: 'fs-rate-good', key: '3' },
  easy: { label: '简单', quality: 5, cls: 'fs-rate-easy', key: '4' },
}

const RATING_ORDER: Rating[] = ['again', 'hard', 'good', 'easy']

// ---------------------------------------------------------------------------
// 默认卡片集 — 群论基础概念
// ---------------------------------------------------------------------------

const DEFAULT_CARDS: Flashcard[] = [
  {
    id: 'grp-def',
    front: '群的定义',
    back: '设 G 是一个非空集合，· 是 G 上的二元运算。若满足：\n(1) 封闭性：∀a,b∈G, a·b∈G\n(2) 结合律：∀a,b,c∈G, (a·b)·c = a·(b·c)\n(3) 幺元：∃e∈G, ∀a∈G, e·a = a·e = a\n(4) 逆元：∀a∈G, ∃a⁻¹∈G, a·a⁻¹ = a⁻¹·a = e\n则称 (G, ·) 为群。',
    category: '基础',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'subgroup',
    front: '子群',
    back: '设 H 是群 G 的非空子集。若 H 在 G 的运算下自身构成群，则称 H 为 G 的子群，记作 H ≤ G。\n\n判定定理：H ≤ G ⟺ ∀a,b∈H, ab⁻¹∈H。\n\n子群的幺元与群的幺元相同。',
    category: '子结构',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'normal-subgroup',
    front: '正规子群',
    back: '设 N 是群 G 的子群。若 ∀g∈G, gNg⁻¹ = N（即 ∀g∈G, ∀n∈N, gng⁻¹∈N），则称 N 为 G 的正规子群，记作 N ◁ G。\n\n等价条件：∀g∈G, gN = Ng（左陪集等于右陪集）。\n\n商群 G/N 有定义当且仅当 N ◁ G。',
    category: '子结构',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'homomorphism',
    front: '同态',
    back: '设 (G, ·) 和 (H, *) 是群。若映射 φ: G → H 满足 ∀a,b∈G, φ(a·b) = φ(a) * φ(b)，则称 φ 为 G 到 H 的群同态。\n\n核 ker(φ) = {g∈G : φ(g) = e_H} 是 G 的正规子群。\n像 Im(φ) 是 H 的子群。',
    category: '映射',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'isomorphism',
    front: '同构',
    back: '若群同态 φ: G → H 是双射（单射且满射），则称 φ 为同构，记作 G ≅ H。\n\n同构的群具有完全相同的群论结构，仅在元素记号上不同。同态基本定理：G/ker(φ) ≅ Im(φ)。',
    category: '映射',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'cyclic-group',
    front: '循环群',
    back: '若群 G 中存在元素 g，使得 G = ⟨g⟩ = {gⁿ : n∈ℤ}，则称 G 为循环群，g 为生成元。\n\n循环群必是交换群。有限循环群 Z_n 的阶为 n，其子群个数等于 n 的正约数个数，每个子群仍是循环群。',
    category: '群类型',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'abelian-group',
    front: '交换群 (Abel 群)',
    back: '若群 G 满足 ∀a,b∈G, a·b = b·a，则称 G 为交换群（或阿贝尔群 / Abel 群）。\n\n所有循环群都是交换群，但交换群不一定是循环群（例如 Klein 四元群 V₄ ≅ Z₂×Z₂）。',
    category: '群类型',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'coset',
    front: '陪集',
    back: '设 H ≤ G, g∈G。集合 gH = {g·h : h∈H} 称为 g 关于 H 的左陪集，Hg = {h·g : h∈H} 称为右陪集。\n\n性质：|gH| = |H|；任意两个左陪集要么相等，要么不相交；G 可划分为若干不相交左陪集之并。',
    category: '结构',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'quotient-group',
    front: '商群',
    back: '设 N ◁ G。商群 G/N = {gN : g∈G}，其运算为 (gN)(hN) = (g·h)N。\n\n|G/N| = [G:N] = |G| / |N|，幺元为 eN = N，元素 gN 的逆元为 g⁻¹N。\n\n商群将「模掉 N 的差异」后剩余的群结构。',
    category: '结构',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
  {
    id: 'lagrange',
    front: '拉格朗日定理',
    back: '设 G 是有限群，H ≤ G。则 |G| = [G:H] · |H|，即子群的阶整除群的阶。\n\n推论：\n(1) 有限群中任意元素的阶整除群的阶\n(2) 素数阶群必为循环群\n(3) |G| 为素数时 G 无非平凡子群',
    category: '定理',
    ease: DEFAULT_EASE,
    interval: 0,
    reps: 0,
  },
]

// ---------------------------------------------------------------------------
// SM-2 间隔重复算法（简化版）
// ---------------------------------------------------------------------------

/**
 * 根据评分更新卡片的 SM-2 参数。
 *
 * 评分映射到 SM-2 quality：
 *   again → q=0, hard → q=3, good → q=4, easy → q=5
 *
 * 规则：
 * - q < 3（再来一次）：重置 reps=0，interval=0（立即重看）
 * - q >= 3：按 reps 递增间隔（1 → 6 → interval×ease），reps++
 * - ease 更新：EF' = EF + (0.1 - (5-q)(0.08 + (5-q)·0.02))，下限 1.3
 */
function sm2(card: Flashcard, rating: Rating): Flashcard {
  const q = RATING_META[rating].quality
  let { ease, interval, reps } = card

  if (q < 3) {
    reps = 0
    interval = 0
  } else {
    if (reps === 0) {
      interval = 1
    } else if (reps === 1) {
      interval = 6
    } else {
      interval = Math.round(interval * ease)
    }
    reps += 1
  }

  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  if (ease < MIN_EASE) ease = MIN_EASE

  return {
    ...card,
    ease: Math.round(ease * 100) / 100,
    interval,
    reps,
  }
}

/** 判断卡片是否已掌握：复习次数 >= 3 且下次间隔 >= 21 天。 */
function isMastered(card: Flashcard): boolean {
  return card.reps >= MASTERED_REPS_THRESHOLD && card.interval >= MASTERED_INTERVAL_THRESHOLD
}

/** 获取卡片学习状态标签。 */
function cardStatus(card: Flashcard): CardStatus {
  if (isMastered(card)) return 'mastered'
  if (card.reps > 0) return 'learning'
  return 'new'
}

/** 格式化间隔天数为可读字符串。 */
function formatInterval(days: number): string {
  if (days === 0) return '立刻'
  if (days === 1) return '明天'
  if (days < 30) return `${days}天`
  if (days < 365) return `${Math.round(days / 30)}个月`
  return `${(days / 365).toFixed(1)}年`
}

// ---------------------------------------------------------------------------
// 内联样式（暗色主题，复用全局 CSS 变量，CSS 3D 翻转）
// ---------------------------------------------------------------------------

const STYLES = `
.fs-root {
  font-family: var(--serif);
  color: var(--ink);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 18px 20px;
}
.fs-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--ink);
}
.fs-subtitle {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 16px;
}

/* --- 进度条 --- */
.fs-progress {
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.fs-progress-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.fs-progress-stats .fs-progress-pct {
  color: var(--accent);
  font-weight: 600;
  font-size: 13px;
}
.fs-progress-bar {
  width: 100%;
  height: 6px;
  background: var(--bg3);
  border-radius: 3px;
  overflow: hidden;
  display: flex;
}
.fs-progress-fill-reviewed {
  height: 100%;
  background: var(--accent);
  transition: width 0.4s ease;
  border-radius: 3px 0 0 3px;
}
.fs-progress-fill-mastered {
  height: 100%;
  background: var(--ok);
  transition: width 0.4s ease;
  border-radius: 0 3px 3px 0;
}
.fs-progress-legend {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.fs-progress-legend .fs-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}
.fs-dot-reviewed { background: var(--accent); }
.fs-dot-mastered { background: var(--ok); }

/* --- 3D 翻转卡片 --- */
.fs-card-scene {
  perspective: 1200px;
  margin-bottom: 14px;
}
.fs-card {
  position: relative;
  width: 100%;
  min-height: 240px;
  transform-style: preserve-3d;
  -webkit-transform-style: preserve-3d;
  transition: transform 0.55s cubic-bezier(0.4, 0.2, 0.2, 1);
  cursor: pointer;
}
.fs-card.flipped {
  transform: rotateY(180deg);
}
.fs-card-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 28px 24px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: center;
  overflow: hidden;
}
.fs-card-back {
  transform: rotateY(180deg);
}
.fs-card-category {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}
.fs-card-question {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 16px;
  line-height: 1.4;
}
.fs-card-answer {
  font-family: var(--serif);
  font-size: 14px;
  color: var(--ink);
  line-height: 1.7;
  white-space: pre-wrap;
  text-align: left;
  max-width: 520px;
}
.fs-card-hint {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  margin-top: 18px;
}
.fs-card-status {
  position: absolute;
  top: 10px;
  right: 12px;
  font-family: var(--mono);
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.fs-card-status.new {
  background: rgba(138, 136, 132, 0.15);
  color: var(--muted);
}
.fs-card-status.learning {
  background: rgba(229, 192, 123, 0.14);
  color: var(--warn);
}
.fs-card-status.mastered {
  background: rgba(152, 195, 121, 0.14);
  color: var(--ok);
}

/* --- 评分按钮 --- */
.fs-rating {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  pointer-events: none;
}
.fs-rating.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.fs-rate-btn {
  flex: 1;
  min-width: 110px;
  max-width: 180px;
  padding: 10px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.fs-rate-btn:hover { transform: translateY(-2px); }
.fs-rate-btn:active { transform: translateY(0); }
.fs-rate-btn .fs-rate-interval {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 400;
  color: var(--muted);
}
.fs-rate-again { border-color: rgba(224, 108, 117, 0.4); }
.fs-rate-again:hover { background: rgba(224, 108, 117, 0.1); border-color: var(--err); }
.fs-rate-again .fs-rate-interval { color: var(--err); }
.fs-rate-hard { border-color: rgba(229, 192, 123, 0.4); }
.fs-rate-hard:hover { background: rgba(229, 192, 123, 0.1); border-color: var(--warn); }
.fs-rate-hard .fs-rate-interval { color: var(--warn); }
.fs-rate-good { border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.fs-rate-good:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); border-color: var(--accent); }
.fs-rate-good .fs-rate-interval { color: var(--accent); }
.fs-rate-easy { border-color: rgba(152, 195, 121, 0.4); }
.fs-rate-easy:hover { background: rgba(152, 195, 121, 0.1); border-color: var(--ok); }
.fs-rate-easy .fs-rate-interval { color: var(--ok); }

/* --- 导航 --- */
.fs-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.fs-nav-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.fs-nav-btn:hover { color: var(--ink); border-color: var(--muted); }
.fs-nav-btn:active { color: var(--accent); border-color: var(--accent); }
.fs-nav-btn:disabled { opacity: 0.3; cursor: default; }
.fs-counter {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink);
  font-weight: 500;
}

/* --- SM-2 统计 --- */
.fs-stats {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 12px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.fs-stat {
  display: flex;
  align-items: center;
  gap: 4px;
}
.fs-stat .fs-stat-val {
  color: var(--ink);
  font-weight: 600;
}

/* --- 重置按钮 --- */
.fs-reset {
  display: block;
  margin: 12px auto 0;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.fs-reset:hover { color: var(--err); border-color: var(--err); }

/* --- 键盘提示 --- */
.fs-keys {
  text-align: center;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  margin-top: 8px;
}
.fs-keys kbd {
  display: inline-block;
  padding: 1px 5px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink);
  margin: 0 2px;
}

/* --- 空状态 --- */
.fs-empty {
  text-align: center;
  padding: 40px 20px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}
`

// ---------------------------------------------------------------------------
// 组件实现
// ---------------------------------------------------------------------------

function FlashcardSystemBase({ cards, onProgress }: FlashcardSystemProps) {
  // --- 状态 ---
  const [cardStates, setCardStates] = useState<Flashcard[]>(() => cards ?? DEFAULT_CARDS)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set())

  // --- Refs ---
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const lastFlipRef = useRef<number>(0)

  // --- 派生数据 ---
  const total = cardStates.length
  const currentCard = cardStates[currentIndex]

  const stats = useMemo(() => {
    const mastered = cardStates.filter(isMastered).length
    return {
      reviewed: reviewedIds.size,
      total,
      mastered,
    }
  }, [cardStates, reviewedIds, total])

  const masteryPercent = total > 0 ? Math.round((stats.mastered / total) * 100) : 0
  const reviewedPercent = total > 0 ? Math.round((stats.reviewed / total) * 100) : 0

  // 各评分按钮的间隔预览
  const ratingPreviews = useMemo(() => {
    const previews: Record<Rating, number> = {} as Record<Rating, number>
    if (currentCard) {
      for (const r of RATING_ORDER) {
        previews[r] = sm2(currentCard, r).interval
      }
    }
    return previews
  }, [currentCard])

  // --- 通知父组件进度变化 ---
  useEffect(() => {
    onProgress?.(stats)
  }, [stats, onProgress])

  // --- cards prop 变化时重置 ---
  useEffect(() => {
    if (cards !== undefined) {
      setCardStates(cards)
      setCurrentIndex(0)
      setIsFlipped(false)
      setReviewedIds(new Set())
    }
  }, [cards])

  // --- 事件处理 ---

  const handleFlip = useCallback(() => {
    const now = Date.now()
    if (now - lastFlipRef.current < FLIP_DEBOUNCE_MS) return
    lastFlipRef.current = now
    setIsFlipped(f => !f)
  }, [])

  const handlePrev = useCallback(() => {
    setIsFlipped(false)
    setCurrentIndex(i => (i - 1 + total) % total)
  }, [total])

  const handleNext = useCallback(() => {
    setIsFlipped(false)
    setCurrentIndex(i => (i + 1) % total)
  }, [total])

  const handleRate = useCallback(
    (rating: Rating) => {
      if (!currentCard) return

      setCardStates(prev => {
        const next = [...prev]
        next[currentIndex] = sm2(next[currentIndex], rating)
        return next
      })

      setReviewedIds(prev => {
        const nextSet = new Set(prev)
        nextSet.add(currentCard.id)
        return nextSet
      })

      setIsFlipped(false)
      // 评分后自动前进到下一张
      setCurrentIndex(i => (i + 1) % total)
    },
    [currentCard, currentIndex, total],
  )

  const handleReset = useCallback(() => {
    setCardStates(prev =>
      prev.map(c => ({
        ...c,
        ease: DEFAULT_EASE,
        interval: 0,
        reps: 0,
      })),
    )
    setCurrentIndex(0)
    setIsFlipped(false)
    setReviewedIds(new Set())
  }, [])

  // --- 键盘导航 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      // 输入框中不拦截
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          handlePrev()
          break
        case 'ArrowRight':
          e.preventDefault()
          handleNext()
          break
        case ' ':
        case 'Enter':
          if (target.tagName !== 'BUTTON') {
            e.preventDefault()
            handleFlip()
          }
          break
        case '1':
          if (isFlipped) {
            e.preventDefault()
            handleRate('again')
          }
          break
        case '2':
          if (isFlipped) {
            e.preventDefault()
            handleRate('hard')
          }
          break
        case '3':
          if (isFlipped) {
            e.preventDefault()
            handleRate('good')
          }
          break
        case '4':
          if (isFlipped) {
            e.preventDefault()
            handleRate('easy')
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlePrev, handleNext, handleFlip, handleRate, isFlipped])

  // --- 渲染 ---

  if (total === 0 || !currentCard) {
    return (
      <div className="fs-root">
        <style>{STYLES}</style>
        <div className="fs-empty">暂无闪卡</div>
      </div>
    )
  }

  const status = cardStatus(currentCard)
  const statusLabels: Record<CardStatus, string> = {
    new: '新卡',
    learning: '学习中',
    mastered: '已掌握',
  }

  return (
    <div className="fs-root">
      <style>{STYLES}</style>

      <h3 className="fs-title">闪卡复习</h3>
      <p className="fs-subtitle">翻转卡片复习群论概念，根据记忆程度评分以调整复习间隔</p>

      {/* 进度跟踪 */}
      <div className="fs-progress">
        <div className="fs-progress-stats">
          <span>
            已复习 {stats.reviewed} / {total}
          </span>
          <span className="fs-progress-pct">掌握度 {masteryPercent}%</span>
        </div>
        <div className="fs-progress-bar">
          <div className="fs-progress-fill-reviewed" style={{ width: `${reviewedPercent}%` }} />
          <div className="fs-progress-fill-mastered" style={{ width: `${masteryPercent}%` }} />
        </div>
        <div className="fs-progress-legend">
          <span>
            <span className="fs-dot fs-dot-reviewed" />
            已复习 {stats.reviewed}
          </span>
          <span>
            <span className="fs-dot fs-dot-mastered" />
            已掌握 {stats.mastered}
          </span>
          <span>待复习 {total - stats.reviewed}</span>
        </div>
      </div>

      {/* 3D 翻转卡片 */}
      <div className="fs-card-scene" ref={sceneRef}>
        <div
          className={`fs-card${isFlipped ? ' flipped' : ''}`}
          onClick={handleFlip}
          role="button"
          tabIndex={0}
          aria-label={isFlipped ? '点击翻回正面' : '点击翻转查看答案'}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') handleFlip()
          }}
        >
          {/* 正面：概念名称 / 问题 */}
          <div className="fs-card-face fs-card-front">
            <span className={`fs-card-status ${status}`}>{statusLabels[status]}</span>
            <div className="fs-card-category">{currentCard.category}</div>
            <div className="fs-card-question">{currentCard.front}</div>
            <div className="fs-card-hint">点击翻转查看答案</div>
          </div>

          {/* 背面：定义 / 答案 */}
          <div
            className="fs-card-face fs-card-back"
            tabIndex={isFlipped ? 0 : -1}
            role="region"
            aria-label="答案"
          >
            <span className={`fs-card-status ${status}`}>{statusLabels[status]}</span>
            <div className="fs-card-category">{currentCard.category}</div>
            <div className="fs-card-answer">{currentCard.back}</div>
          </div>
        </div>
      </div>

      {/* 评分按钮（翻转后显示） */}
      <div className={`fs-rating${isFlipped ? ' visible' : ''}`}>
        {RATING_ORDER.map(r => {
          const meta = RATING_META[r]
          return (
            <button
              key={r}
              type="button"
              className={`fs-rate-btn ${meta.cls}`}
              onClick={() => handleRate(r)}
              disabled={!isFlipped}
              aria-label={`${meta.label}，下次间隔 ${formatInterval(ratingPreviews[r])}`}
            >
              <span>{meta.label}</span>
              <span className="fs-rate-interval">{formatInterval(ratingPreviews[r])}</span>
            </button>
          )
        })}
      </div>

      {/* 导航 */}
      <div className="fs-nav">
        <button type="button" className="fs-nav-btn" onClick={handlePrev} aria-label="上一张">
          {'\u2190'} 上一张
        </button>
        <span className="fs-counter">
          {currentIndex + 1} / {total}
        </span>
        <button type="button" className="fs-nav-btn" onClick={handleNext} aria-label="下一张">
          下一张 {'\u2192'}
        </button>
      </div>

      {/* SM-2 参数 */}
      <div className="fs-stats">
        <span className="fs-stat">
          Ease <span className="fs-stat-val">{currentCard.ease.toFixed(2)}</span>
        </span>
        <span className="fs-stat">
          间隔 <span className="fs-stat-val">{formatInterval(currentCard.interval)}</span>
        </span>
        <span className="fs-stat">
          复习 <span className="fs-stat-val">{currentCard.reps}</span> 次
        </span>
      </div>

      {/* 键盘提示 */}
      <div className="fs-keys">
        <kbd>{'\u2190'}</kbd>
        <kbd>{'\u2192'}</kbd> 导航
        {'  '}
        <kbd>Space</kbd> 翻转
        {isFlipped && (
          <>
            {'  '}
            <kbd>1</kbd>
            <kbd>2</kbd>
            <kbd>3</kbd>
            <kbd>4</kbd> 评分
          </>
        )}
      </div>

      {/* 重置进度 */}
      <button type="button" className="fs-reset" onClick={handleReset}>
        重置全部进度
      </button>
    </div>
  )
}

export const FlashcardSystem = memo(FlashcardSystemBase)
FlashcardSystem.displayName = 'FlashcardSystem'
