import { useState, useRef } from 'react'
import type { AgeLevel } from '../utils/ageAdapt'
import { soundSystem } from '../utils/sound'

// ===========================================================================
// ProblemInvention — 结构主义风格的「问题发明」组件
//
// 核心理念：「发明新问题，并成为第一个解决它的人」。
// 学生不再只是解答给定的题目，而是自己创造数学问题 / 猜想，再由系统辅助
// 检查其是否良构、是否有数学意义、以及是否新颖（未落入已知结果库）。
//
// 本组件完全自包含：
//   - 已保存问题使用 localStorage（不依赖 Zustand store），便于独立运行
//   - 新颖性检查采用关键词匹配，对照内置 ~20 条已知定理 / 猜想数据库
//   - 内容随 ageLevel 自适应（kids / tweens / teens）
// ===========================================================================

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

type ProblemCategory = 'conjecture' | 'proof' | 'construction' | 'recreational'

type ProblemStatus = 'exploring' | 'solved' | 'published'

interface SavedProblem {
  id: string
  text: string
  category: ProblemCategory
  status: ProblemStatus
  firstToSolve: boolean
  createdAt: number
}

/** 已知结果库条目：用于新颖性检查的对照基准 */
interface KnownResult {
  id: string
  name: string
  /** 区分性关键词；命中越多越可能就是该已知结果 */
  keywords: string[]
  /** 该结果的简短描述，命中时展示给学生 */
  statement: string
  category: ProblemCategory
}

type CheckLevel = 'ok' | 'warn' | 'err'

interface CheckMessage {
  level: CheckLevel
  text: string
}

/** 一次「验证」的结构化结果 */
interface ValidationResult {
  /** 是否良构：有明确的问题 / 命题 */
  wellFormed: boolean
  /** 是否具有基本数学意义（含数学对象 / 量词等启发式判定） */
  meaningful: boolean
  /** 是否新颖：未命中已知结果库 */
  novel: boolean
  /** 命中的已知结果（若有） */
  knownMatch: KnownResult | null
  /** 最佳命中的匹配度（0~1） */
  matchScore: number
  /** 逐条诊断信息 */
  messages: CheckMessage[]
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  ageLevel: AgeLevel
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'mathweaver:problem-invention:saved'

/** 题目文本被认为是「有实质内容」的最小长度 */
const MIN_TEXT_LENGTH = 10
/** 视为「命中某已知结果」的最低关键词命中数 */
const MATCH_MIN_HITS = 2
/** 视为命中的最低关键词覆盖率（命中数 / 该条关键词总数） */
const MATCH_MIN_RATIO = 0.4

const CATEGORY_META: Record<
  ProblemCategory,
  { label: string; icon: string; colorVar: string; bgVar: string }
> = {
  conjecture: {
    label: '猜想 (Conjecture)',
    icon: '?',
    colorVar: 'var(--accent2)',
    bgVar: 'var(--ok-bg)',
  },
  proof: {
    label: '证明题 (Proof)',
    icon: '\u25A0',
    colorVar: 'var(--accent)',
    bgVar: 'var(--accent-subtle)',
  },
  construction: {
    label: '构造题 (Construction)',
    icon: '\u2692',
    colorVar: 'var(--warn)',
    bgVar: 'var(--warn-bg)',
  },
  recreational: {
    label: '趣味题 (Recreational)',
    icon: '\u2605',
    colorVar: 'var(--muted)',
    bgVar: 'var(--bg3)',
  },
}

const STATUS_META: Record<ProblemStatus, { label: string; colorVar: string; bgVar: string }> = {
  exploring: {
    label: '探索中 (Exploring)',
    colorVar: 'var(--warn)',
    bgVar: 'var(--warn-bg)',
  },
  solved: { label: '已解决 (Solved)', colorVar: 'var(--ok)', bgVar: 'var(--ok-bg)' },
  published: {
    label: '已发表 (Published)',
    colorVar: 'var(--accent)',
    bgVar: 'var(--accent-subtle)',
  },
}

/** STATUS 循环顺序：探索中 -> 已解决 -> 已发表 -> 探索中 */
const STATUS_CYCLE: ProblemStatus[] = ['exploring', 'solved', 'published']

// ---------------------------------------------------------------------------
// 已知结果数据库（~20 条）— 用于新颖性检查的教学性对照
// ---------------------------------------------------------------------------

const KNOWN_RESULTS: KnownResult[] = [
  {
    id: 'fermat-last',
    name: "Fermat's Last Theorem (费马大定理)",
    keywords: ['fermat', '费马', 'last theorem', '大定理', 'x^n', 'z^n', 'n > 2'],
    statement: '当 n > 2 时，x^n + y^n = z^n 没有正整数解。由 Andrew Wiles 于 1994 年证明。',
    category: 'proof',
  },
  {
    id: 'pythagoras',
    name: 'Pythagorean Theorem (勾股定理)',
    keywords: ['pythagorean', '勾股', '毕达哥拉斯', 'a^2 + b^2', 'c^2', '直角三角形', '斜边'],
    statement: '直角三角形两直角边平方和等于斜边平方：a² + b² = c²。',
    category: 'proof',
  },
  {
    id: 'four-color',
    name: 'Four Color Theorem (四色定理)',
    keywords: ['four color', '四色', 'map coloring', '地图着色', 'planar graph', '平面图'],
    statement: '任意平面地图可用四种颜色着色，使相邻区域颜色不同。',
    category: 'proof',
  },
  {
    id: 'goldbach',
    name: "Goldbach's Conjecture (哥德巴赫猜想)",
    keywords: ['goldbach', '哥德巴赫', 'even number', 'sum of two primes', '素数之和', '偶数'],
    statement: '每个大于 2 的偶数都可表示为两个素数之和。至今未被证明。',
    category: 'conjecture',
  },
  {
    id: 'twin-prime',
    name: 'Twin Prime Conjecture (孪生素数猜想)',
    keywords: ['twin prime', '孪生素数', 'p and p+2', '差为2', '相差2的素数'],
    statement: '存在无穷多对相差 2 的素数（如 3,5 / 11,13）。',
    category: 'conjecture',
  },
  {
    id: 'collatz',
    name: 'Collatz Conjecture (考拉兹猜想 / 3n+1)',
    keywords: ['collatz', '考拉兹', '3n+1', '3n + 1', 'hailstone', '冰雹', '奇数乘3加1'],
    statement: '对任意正整数反复「偶数除以 2，奇数乘 3 加 1」，最终必回到 1。',
    category: 'conjecture',
  },
  {
    id: 'riemann',
    name: 'Riemann Hypothesis (黎曼猜想)',
    keywords: ['riemann', '黎曼', 'zeta', 'critical line', '非平凡零点', '1/2'],
    statement: '黎曼 ζ 函数的所有非平凡零点实部均为 1/2。千禧年七大难题之一。',
    category: 'conjecture',
  },
  {
    id: 'p-vs-np',
    name: 'P vs NP Problem (P=NP 问题)',
    keywords: ['p vs np', 'p=np', 'np-complete', 'npc', '多项式时间', 'polynomial time'],
    statement: '是否每个可在多项式时间验证的解，都能在多项式时间内求出？',
    category: 'conjecture',
  },
  {
    id: 'euler-identity',
    name: "Euler's Identity (欧拉恒等式)",
    keywords: ['e^(i', 'euler identity', '欧拉恒等式', 'e^{i', '+ 1 = 0', '最美公式'],
    statement: 'e^(iπ) + 1 = 0，将五个基本常数联系在一起。',
    category: 'proof',
  },
  {
    id: 'lagrange',
    name: "Lagrange's Theorem (拉格朗日定理)",
    keywords: [
      'lagrange',
      '拉格朗日',
      'subgroup order',
      '子群阶',
      '整除群的阶',
      'divides the order',
    ],
    statement: '有限群中，子群的阶整除群的阶。',
    category: 'proof',
  },
  {
    id: 'fta-arithmetic',
    name: 'Fundamental Theorem of Arithmetic (算术基本定理)',
    keywords: [
      'fundamental theorem of arithmetic',
      'unique prime factorization',
      '唯一分解',
      '算术基本定理',
      '素因子唯一',
    ],
    statement: '每个大于 1 的整数可唯一分解为素数之积（不计顺序）。',
    category: 'proof',
  },
  {
    id: 'inf-primes',
    name: "Euclid's Infinitude of Primes (素数无穷)",
    keywords: [
      'infinitely many primes',
      '素数无穷',
      '无穷多素数',
      'euclid prime',
      '欧几里得 素数',
      '素数有无穷多个',
    ],
    statement: '素数有无穷多个（欧几里得的经典证明）。',
    category: 'proof',
  },
  {
    id: 'pnt',
    name: 'Prime Number Theorem (素数定理)',
    keywords: [
      'prime number theorem',
      '素数定理',
      'density of primes',
      'li(x)',
      'x/ln(x)',
      '素数分布',
    ],
    statement: '不超过 x 的素数个数渐近于 x / ln(x)。',
    category: 'proof',
  },
  {
    id: 'cayley',
    name: "Cayley's Theorem (凯莱定理)",
    keywords: [
      'cayley',
      '凯莱',
      'permutation group',
      '置换群',
      'every group is isomorphic',
      '同构于置换群',
    ],
    statement: '每个有限群都同构于某个置换群的子群。',
    category: 'proof',
  },
  {
    id: 'stable-marriage',
    name: 'Stable Marriage Problem (稳定婚姻问题 / Gale-Shapley)',
    keywords: [
      'stable marriage',
      '稳定婚姻',
      'gale-shapley',
      '盖尔-沙普利',
      'matching algorithm',
      '稳定匹配',
    ],
    statement: 'Gale-Shapley 算法保证在两组偏好下存在稳定匹配。',
    category: 'construction',
  },
  {
    id: 'evenquads-ecc',
    name: 'EvenQuads & Error-Correcting Codes (EvenQuads 与纠错码)',
    keywords: [
      'evenquads',
      'error-correcting',
      '纠错码',
      '检错码',
      'hamming',
      '海明码',
      'error correcting code',
    ],
    statement: 'EvenQuads 矩阵与二进制纠错码存在深刻联系（结构主义经典课题）。',
    category: 'construction',
  },
  {
    id: 'pigeonhole',
    name: 'Pigeonhole Principle (抽屉原理)',
    keywords: ['pigeonhole', '抽屉原理', '鸽巢', 'drawer principle', 'n+1 放入 n'],
    statement: '将 n+1 个物体放入 n 个抽屉，必有抽屉含至少两个物体。',
    category: 'proof',
  },
  {
    id: 'crt',
    name: 'Chinese Remainder Theorem (中国剩余定理 / 孙子定理)',
    keywords: ['chinese remainder', '中国剩余定理', '孙子定理', '同余方程', '模互素', '模两两互素'],
    statement: '当模两两互素时，同余方程组有唯一解（模之积）。',
    category: 'proof',
  },
  {
    id: 'bertrand',
    name: "Bertrand's Postulate (伯特兰公设)",
    keywords: [
      'bertrand',
      '伯特兰',
      'prime between n and 2n',
      'n与2n之间',
      'postulate',
      '伯特兰假设',
    ],
    statement: '对任意 n > 1，n 与 2n 之间至少存在一个素数。',
    category: 'proof',
  },
  {
    id: 'catalan',
    name: "Catalan's Conjecture / Mihailescu's Theorem (卡塔兰猜想)",
    keywords: [
      'catalan',
      '卡塔兰',
      '8 and 9',
      'consecutive powers',
      '连续幂',
      '米哈伊列斯库',
      '唯一连续完全幂',
    ],
    statement: '8 与 9 是唯一相差 1 的正整数完全幂（3² − 2³ = 1）。',
    category: 'proof',
  },
]

// ---------------------------------------------------------------------------
// 结构主义启发的示例问题（4 条）— 展示「发明 + 跨领域联系」的传统
// ---------------------------------------------------------------------------

interface ExampleProblem {
  id: string
  title: string
  statement: string
  category: ProblemCategory
  /** 不同年龄段的引导说明 */
  blurb: Record<AgeLevel, string>
}

const EXAMPLE_PROBLEMS: ExampleProblem[] = [
  {
    id: 'ex-evenquads',
    title: 'EvenQuads 与纠错码的联系',
    statement:
      'EvenQuads 是一种 4×4 的 0/1 矩阵，每行每列恰含两个 1。这种矩阵与二进制纠错码之间是否存在深刻的同构关系？如果我们用 EvenQuads 来编码信息，能检测并纠正多少位错误？',
    category: 'construction',
    blurb: {
      kids: '一张 4×4 的格子，每行每列都正好有两个 1。这种格子能帮电脑「找错字」吗？',
      tweens: '4×4 的 0/1 矩阵每行每列恰好两个 1，它和纠错码是什么关系？能纠几位错？',
      teens:
        'Explore the isomorphism between EvenQuads matrices and binary error-correcting codes. How many errors can such a code detect / correct?',
    },
  },
  {
    id: 'ex-stable-sudoku',
    title: '稳定匹配与数独的联系',
    statement:
      'Gale-Shapley 稳定匹配算法与数独求解都涉及「约束满足」。如果把数独的每行/列/宫看作一组偏好，能否用稳定匹配的框架重新表述数独求解？反过来，数独的唯一性约束如何限制了匹配的稳定性？',
    category: 'conjecture',
    blurb: {
      kids: '「换座位」的游戏和数独都是「不能打架」的规则。它们是同一件事吗？',
      tweens: '稳定匹配算法和数独都是约束满足问题。能否用一个框架统一它们？',
      teens:
        'Can Sudoku be reframed as a stable-matching problem? How does the uniqueness constraint interact with stability?',
    },
  },
  {
    id: 'ex-base-3halves',
    title: '如果用 3/2 进制而不是 10 进制？',
    statement:
      '在以 3/2 为底的进制中（非整数基），每个正整数是否都有唯一的表示？这种表示下的「整数」集合有什么结构？是否存在某些数在这种进制下是有限的、在标准进制下却是无限的？',
    category: 'conjecture',
    blurb: {
      kids: '我们平时用 10 进制。如果用「一又二分之一」进制写数字，会怎样？',
      tweens: '用 3/2（非整数）做进制底数，每个数还有唯一表示吗？',
      teens:
        'In base 3/2 (a non-integer radix), does every positive integer have a unique representation? What is the structure of the "integers" in this system?',
    },
  },
  {
    id: 'ex-coin-weighing',
    title: '称硬币的天平有奇怪行为',
    statement:
      '经典称硬币问题中天平只有「左重 / 右重 / 平衡」三种结果。如果天平在两侧重量相等时也随机倾斜（概率 p），或在差异小于阈值时总是平衡，最少需要多少次称量才能从 n 枚硬币中找出假币？这个下界如何依赖 p？',
    category: 'recreational',
    blurb: {
      kids: '称硬币的天平有时候会「撒谎」。要称几次才能找出那枚假的？',
      tweens: '若天平在平衡时有概率 p 随机倾斜，称量次数下界如何随 p 变化？',
      teens:
        'With a balance that lies with probability p at ties, what is the information-theoretic lower bound on weighings to find the counterfeit among n coins?',
    },
  },
]

// ---------------------------------------------------------------------------
// 年龄自适应文案
// ---------------------------------------------------------------------------

interface AgeCopy {
  tagline: string
  intro: string
  formPrompt: string
  placeholder: string
  validateLabel: string
  examplesTitle: string
  examplesHint: string
  tryExampleLabel: string
  galleryTitle: string
  galleryEmpty: string
  saveLabel: string
  categoryLabel: string
  resultsTitle: string
  validateEmpty: string
}

const AGE_COPY: Record<AgeLevel, AgeCopy> = {
  kids: {
    tagline: '发明你自己的数学谜题！成为第一个解开它的人！',
    intro: '像数学家一样思考：先发明一个新问题，再去解开它。也许你就是第一个发现它的人！',
    formPrompt: '把你的谜题写下来',
    placeholder: '比如：如果把 1 到 100 的数字倒着排，相邻两个数的差有什么规律？',
    validateLabel: '检查我的谜题',
    examplesTitle: '看看别人发明的谜题',
    examplesHint: '点一个看看，喜欢就拿来改成你自己的！',
    tryExampleLabel: '试试这个',
    galleryTitle: '我发明的谜题',
    galleryEmpty: '还没有保存的谜题。写一个，然后点「保存」吧！',
    saveLabel: '保存到我的谜题',
    categoryLabel: '这是什么类型的谜题？',
    resultsTitle: '检查结果',
    validateEmpty: '写好谜题后，点「检查我的谜题」看看结果！',
  },
  tweens: {
    tagline: '提出你自己的猜想，验证它，看看它是否是全新的发现',
    intro:
      '结构主义的精神：发明新问题，并成为第一个解决它的人。系统会帮你检查问题是否良构、是否有数学意义、以及是否是已知结果。',
    formPrompt: '写出你的问题或猜想',
    placeholder: '例如：是否存在一个三角形，它的三条高恰好等于它的三条中线？证明或给出反例。',
    validateLabel: '验证',
    examplesTitle: '结构主义风格的示例问题',
    examplesHint: '这些是「发明 + 跨领域联系」的范例，点击可载入编辑区。',
    tryExampleLabel: '载入此例',
    galleryTitle: '我保存的问题',
    galleryEmpty: '尚未保存任何问题。提出一个猜想，验证后保存它。',
    saveLabel: '保存问题',
    categoryLabel: '问题类型',
    resultsTitle: '验证结果',
    validateEmpty: '填写问题后点击「验证」，查看良构性、意义与新颖性。',
  },
  teens: {
    tagline: 'Formulate original conjectures. The system helps you check novelty and structure.',
    intro:
      'Invent new problems and be the first to solve them — the structuralist ethos. The checker assesses well-formedness, mathematical substance, and novelty against a known-results database.',
    formPrompt: 'State your problem or conjecture',
    placeholder:
      'e.g. Is there a non-cyclic group of order 21 whose every proper subgroup is cyclic? Prove or disprove.',
    validateLabel: 'Validate',
    examplesTitle: 'Structuralism-inspired examples',
    examplesHint: 'Problems that invent a question and link two domains. Click to load.',
    tryExampleLabel: 'Load example',
    galleryTitle: 'Saved problems',
    galleryEmpty: 'No saved problems yet. Formulate a conjecture, validate, then save.',
    saveLabel: 'Save problem',
    categoryLabel: 'Category',
    resultsTitle: 'Validation results',
    validateEmpty: 'Write a problem and click Validate to assess structure and novelty.',
  },
}

// ---------------------------------------------------------------------------
// 验证逻辑
// ---------------------------------------------------------------------------

/** 归一化文本：小写化 + 折叠空白，便于子串匹配（保留 ^ + = 等符号） */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 良构判定：长度足够 且 含问号或疑问 / 命令式关键词 */
function checkWellFormed(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < MIN_TEXT_LENGTH) return false
  if (/[?？]/.test(trimmed)) return true
  const questionWords = [
    'prove',
    'show',
    'find',
    'how',
    'why',
    'what',
    'whether',
    'does',
    'is there',
    'are there',
    'can',
    'determine',
    'calculate',
    'solve',
    'construct',
    'investigate',
    '证明',
    '求证',
    '试证',
    '是否',
    '是否存在',
    '求',
    '多少',
    '为什么',
    '怎样',
    '如何',
    '找出',
    '构造',
    '判定',
    '是否存在',
    '能否',
  ]
  const lower = trimmed.toLowerCase()
  return questionWords.some(w => lower.includes(w))
}

/** 意义判定：含数学对象指示符 且 长度足够 */
function checkMeaningful(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < MIN_TEXT_LENGTH + 5) return false
  const lower = trimmed.toLowerCase()
  const mathIndicators = [
    /\d/,
    /[+=\u00D7\u00F7\u2212\u2212\u2264\u2265\u2260\u2208\u2229\u222a\u2282\u2283\u2211\u222b\u221e\u03c0]/,
    /\^/,
    /\bmod\b/,
    'prime',
    'primes',
    'group',
    'subgroup',
    'matrix',
    'vector',
    'triangle',
    'integer',
    'rational',
    'polynomial',
    'function',
    'graph',
    'tree',
    'permutation',
    'combination',
    'probability',
    'modulo',
    'coset',
    'cyclic',
    'base',
    'radix',
    'weigh',
    'balance',
    'sudoku',
    'matching',
    '素数',
    '群',
    '子群',
    '矩阵',
    '向量',
    '三角',
    '整数',
    '方程',
    '函数',
    '图',
    '树',
    '排列',
    '组合',
    '概率',
    '模',
    '陪集',
    '循环',
    '进制',
    '权重',
    '称重',
    '天平',
    '数独',
    '匹配',
    '染色',
    '奇数',
    '偶数',
    '整除',
  ]
  return mathIndicators.some(ind =>
    typeof ind === 'string' ? lower.includes(ind) : ind.test(lower),
  )
}

/** 新颖性检查：返回最佳命中的已知结果及其匹配度 */
function checkNovelty(text: string): {
  novel: boolean
  knownMatch: KnownResult | null
  matchScore: number
} {
  const norm = normalize(text)
  if (norm.length < MIN_TEXT_LENGTH) {
    return { novel: true, knownMatch: null, matchScore: 0 }
  }

  let best: { result: KnownResult; hits: number; ratio: number } | null = null

  for (const result of KNOWN_RESULTS) {
    let hits = 0
    for (const kw of result.keywords) {
      if (norm.includes(normalize(kw))) hits += 1
    }
    if (hits === 0) continue
    const ratio = hits / result.keywords.length
    if (!best || hits > best.hits || (hits === best.hits && ratio > best.ratio)) {
      best = { result, hits, ratio }
    }
  }

  if (!best) return { novel: true, knownMatch: null, matchScore: 0 }

  const isMatch = best.hits >= MATCH_MIN_HITS && best.ratio >= MATCH_MIN_RATIO
  return {
    novel: !isMatch,
    knownMatch: isMatch ? best.result : null,
    matchScore: best.ratio,
  }
}

/** 综合验证：良构 + 意义 + 新颖性，并组装年龄自适应的诊断信息 */
function validateProblem(text: string, ageLevel: AgeLevel): ValidationResult {
  const trimmed = text.trim()
  const wellFormed = checkWellFormed(trimmed)
  const meaningful = checkMeaningful(trimmed)
  const { novel, knownMatch, matchScore } = checkNovelty(trimmed)

  const messages: CheckMessage[] = []

  // a) 良构性
  if (wellFormed) {
    messages.push({
      level: 'ok',
      text:
        ageLevel === 'kids'
          ? '你的谜题有一个清楚的问题，真棒！'
          : ageLevel === 'tweens'
            ? '良构：问题表述清晰，有明确的命题 / 疑问。'
            : 'Well-formed: the statement poses a clear question or claim.',
    })
  } else {
    messages.push({
      level: trimmed.length < MIN_TEXT_LENGTH ? 'warn' : 'err',
      text:
        trimmed.length < MIN_TEXT_LENGTH
          ? ageLevel === 'kids'
            ? '再写多一点吧，把你想问的问题说清楚。'
            : ageLevel === 'tweens'
              ? '内容过短：请把问题或猜想写得更完整一些。'
              : 'Too short: expand the statement so it poses a complete question.'
          : ageLevel === 'kids'
            ? '没看到一个问题哦。试着用「是不是」「有多少」来提问。'
            : ageLevel === 'tweens'
              ? '缺少明确的疑问 / 命题。可用「证明」「是否存在」「求」等引导。'
              : 'No clear question detected. Use a question mark or an imperative (prove / find / determine).',
    })
  }

  // b) 数学意义
  if (meaningful) {
    messages.push({
      level: 'ok',
      text:
        ageLevel === 'kids'
          ? '里面有数字和数学的东西，是个数学谜题！'
          : ageLevel === 'tweens'
            ? '具有数学意义：涉及数学对象 / 量词 / 运算。'
            : 'Mathematically meaningful: references mathematical objects or relations.',
    })
  } else if (wellFormed) {
    messages.push({
      level: 'warn',
      text:
        ageLevel === 'kids'
          ? '试试在里面加上数字、形状或者运算，让它更像数学题。'
          : ageLevel === 'tweens'
            ? '数学对象不明显：可加入具体的数、运算、几何或代数对象。'
            : 'Weak mathematical substance: specify the objects, operations, or structures involved.',
    })
  }

  // c) 新颖性
  if (knownMatch) {
    messages.push({
      level: 'warn',
      text:
        ageLevel === 'kids'
          ? `这好像是一个已经知道答案的问题：${knownMatch.name}。改一改，让它变成全新的吧！`
          : ageLevel === 'tweens'
            ? `这是已知结果：${knownMatch.name}。${knownMatch.statement}`
            : `This is a known result: ${knownMatch.name}. ${knownMatch.statement}`,
    })
  } else if (wellFormed && meaningful) {
    messages.push({
      level: 'ok',
      text:
        ageLevel === 'kids'
          ? '这个好像还没人研究过！你可能是第一个探索它的人！'
          : ageLevel === 'tweens'
            ? '未命中已知结果库——这可能是全新的发现！你也许是第一个探索它的人。'
            : 'This might be novel! No match in the known-results database — you could be the first to explore this.',
    })
  } else {
    messages.push({
      level: 'warn',
      text:
        ageLevel === 'kids'
          ? '把问题写清楚后，再看看它是不是全新的！'
          : ageLevel === 'tweens'
            ? '完善问题后即可检查新颖性。'
            : 'Refine the statement to assess novelty.',
    })
  }

  return {
    wellFormed,
    meaningful,
    novel,
    knownMatch,
    matchScore,
    messages,
  }
}

// ---------------------------------------------------------------------------
// localStorage 持久化（自包含，不依赖 Zustand）
// ---------------------------------------------------------------------------

function isSavedProblem(v: unknown): v is SavedProblem {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.text === 'string' &&
    (o.category === 'conjecture' ||
      o.category === 'proof' ||
      o.category === 'construction' ||
      o.category === 'recreational') &&
    (o.status === 'exploring' || o.status === 'solved' || o.status === 'published') &&
    typeof o.firstToSolve === 'boolean' &&
    typeof o.createdAt === 'number'
  )
}

function loadSaved(): SavedProblem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedProblem)
  } catch {
    return []
  }
}

function persistSaved(problems: SavedProblem[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(problems))
  } catch {
    /* 配额 / 序列化失败时静默处理，不阻断交互 */
  }
}

// ---------------------------------------------------------------------------
// 内联样式（Theorema 设计语言：宣纸底 + 朱砂红 / 竹绿 + 衬线标题）
// 类名统一以 `pi-` 前缀，避免污染 index.css
// ---------------------------------------------------------------------------

const STYLES = `
.pi-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-family: var(--sans);
  color: var(--ink);
}
.pi-header {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: var(--r-lg);
  padding: 16px 18px;
  box-shadow: var(--shadow-sm);
}
.pi-header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.pi-title {
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  color: var(--ink);
  letter-spacing: 0.01em;
}
.pi-tagline {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13px;
  color: var(--muted);
  margin: 6px 0 0;
  line-height: 1.5;
}
.pi-step-badge {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-subtle);
  border: 1px solid var(--accent);
  border-radius: var(--r-full);
  padding: 4px 10px;
  white-space: nowrap;
  flex-shrink: 0;
}
.pi-section {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px 18px;
  box-shadow: var(--shadow-sm);
}
.pi-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}
.pi-section-title {
  font-family: var(--serif);
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}
.pi-section-hint {
  font-family: var(--sans);
  font-size: 12px;
  color: var(--faint);
  margin: 0 0 12px;
}
.pi-toggle {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 3px 8px;
  cursor: pointer;
  transition: background var(--t-fast), border-color var(--t-fast);
}
.pi-toggle:hover { background: var(--bg3); border-color: var(--border-strong); }

/* 示例问题 */
.pi-examples {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pi-example-card {
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent2);
  border-radius: var(--r-md);
  padding: 12px 14px;
  background: var(--bg);
  transition: box-shadow var(--t-fast), border-color var(--t-fast);
}
.pi-example-card:hover { box-shadow: var(--shadow-md); }
.pi-example-title {
  font-family: var(--serif);
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--ink);
}
.pi-example-statement {
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
  margin: 0 0 6px;
}
.pi-example-blurb {
  font-family: var(--sans);
  font-size: 12px;
  font-style: italic;
  color: var(--faint);
  margin: 0 0 8px;
}
.pi-example-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pi-mini-cat {
  font-family: var(--mono);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: var(--r-full);
  border: 1px solid currentColor;
}

/* 创建表单 */
.pi-form { display: flex; flex-direction: column; gap: 12px; }
.pi-label {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin: 0 0 4px;
  letter-spacing: 0.02em;
}
.pi-textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  box-sizing: border-box;
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 10px 12px;
  outline: none;
  transition: border-color var(--t-fast), box-shadow var(--t-fast), background var(--t-fast);
}
.pi-textarea:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
  background: var(--bg2);
}
.pi-textarea::placeholder { color: var(--faint); font-style: italic; }

.pi-cat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pi-cat-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 500;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--bg);
  color: var(--muted);
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), color var(--t-fast), transform var(--t-fast);
  -webkit-tap-highlight-color: transparent;
}
.pi-cat-btn:hover { border-color: var(--border-strong); background: var(--bg3); }
.pi-cat-btn:active { transform: scale(0.97); }
.pi-cat-btn-active {
  border-color: currentColor;
  font-weight: 600;
}
.pi-cat-icon {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 13px;
}

.pi-form-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pi-validate-btn {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 18px;
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--accent-text);
  cursor: pointer;
  box-shadow: var(--shadow-accent);
  transition: background var(--t-fast), transform var(--t-fast), box-shadow var(--t-fast);
  -webkit-tap-highlight-color: transparent;
}
.pi-validate-btn:hover { background: var(--accent-hover); }
.pi-validate-btn:active { transform: scale(0.97); }
.pi-validate-btn:disabled {
  background: var(--bg3);
  border-color: var(--border);
  color: var(--faint);
  cursor: default;
  box-shadow: none;
  transform: none;
}
.pi-save-btn {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  padding: 9px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg2);
  color: var(--ink);
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), transform var(--t-fast);
}
.pi-save-btn:hover { border-color: var(--border-strong); background: var(--bg3); }
.pi-save-btn:active { transform: scale(0.97); }
.pi-save-btn:disabled { color: var(--faint); cursor: default; }

/* 验证结果面板 */
.pi-results { display: flex; flex-direction: column; gap: 8px; }
.pi-results-empty {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--faint);
  font-style: italic;
  margin: 0;
  padding: 6px 0;
}
.pi-result-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  line-height: 1.5;
  padding: 8px 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--bg);
}
.pi-result-row.pi-ok { border-left: 3px solid var(--ok); background: var(--ok-bg); }
.pi-result-row.pi-warn { border-left: 3px solid var(--warn); background: var(--warn-bg); }
.pi-result-row.pi-err { border-left: 3px solid var(--err); background: var(--err-bg); }
.pi-result-icon { font-weight: 700; flex-shrink: 0; line-height: 1.5; }
.pi-result-row.pi-ok .pi-result-icon { color: var(--ok); }
.pi-result-row.pi-warn .pi-result-icon { color: var(--warn); }
.pi-result-row.pi-err .pi-result-icon { color: var(--err); }
.pi-result-text { color: var(--ink); }
.pi-result-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.pi-chip {
  font-family: var(--mono);
  font-size: 11px;
  padding: 3px 9px;
  border-radius: var(--r-full);
  border: 1px solid var(--border);
  background: var(--bg2);
  color: var(--muted);
}
.pi-chip-on { color: var(--ok); border-color: var(--ok); background: var(--ok-bg); }
.pi-chip-off { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
.pi-chip-novel { color: var(--accent2); border-color: var(--accent2); background: var(--ok-bg); }
.pi-chip-known { color: var(--accent); border-color: var(--accent); background: var(--accent-subtle); }

/* 已保存问题画廊 */
.pi-gallery-empty {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--faint);
  font-style: italic;
  margin: 0;
  text-align: center;
  padding: 18px 0;
}
.pi-gallery {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pi-problem-card {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg);
  padding: 12px 14px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--t-fast);
}
.pi-problem-card:hover { box-shadow: var(--shadow-md); }
.pi-problem-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.pi-problem-text {
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink);
  margin: 0 0 10px;
  white-space: pre-wrap;
}
.pi-problem-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pi-problem-meta {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--faint);
}
.pi-problem-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: auto;
}
.pi-icon-btn {
  font-family: var(--mono);
  font-size: 11px;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg2);
  color: var(--muted);
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), color var(--t-fast), transform var(--t-fast);
}
.pi-icon-btn:hover { border-color: var(--border-strong); background: var(--bg3); }
.pi-icon-btn:active { transform: scale(0.96); }
.pi-icon-btn-danger { color: var(--err); border-color: var(--err); }
.pi-icon-btn-danger:hover { background: var(--err-bg); }
.pi-first-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent-text);
  background: var(--accent);
  border-radius: var(--r-full);
  padding: 3px 9px;
  box-shadow: var(--shadow-accent);
}
.pi-first-badge-off {
  background: transparent;
  color: var(--faint);
  border: 1px dashed var(--border-strong);
  box-shadow: none;
}
`

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function ProblemInvention({ ageLevel }: Props) {
  const copy = AGE_COPY[ageLevel]

  const [problemText, setProblemText] = useState('')
  const [category, setCategory] = useState<ProblemCategory>('conjecture')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [saved, setSaved] = useState<SavedProblem[]>(() => loadSaved())

  // 用于生成稳定的唯一 id（避免 useState 依赖循环）
  const idRef = useRef(0)

  /** 生成一个基本唯一的 id */
  const makeId = (): string => {
    idRef.current += 1
    return `pi-${Date.now().toString(36)}-${idRef.current.toString(36)}`
  }

  const handleValidate = (): void => {
    const result = validateProblem(problemText, ageLevel)
    setValidation(result)
    // 用音效反馈验证结果的整体走向
    if (result.wellFormed && result.meaningful && result.novel) {
      soundSystem.play('discover')
    } else if (result.wellFormed && result.meaningful) {
      soundSystem.play('star')
    } else {
      soundSystem.play('click')
    }
  }

  const handleSave = (): void => {
    const text = problemText.trim()
    if (text.length < MIN_TEXT_LENGTH) {
      soundSystem.play('wrong')
      return
    }
    const problem: SavedProblem = {
      id: makeId(),
      text,
      category,
      status: 'exploring',
      firstToSolve: false,
      createdAt: Date.now(),
    }
    const next = [problem, ...saved]
    setSaved(next)
    persistSaved(next)
    soundSystem.play('complete')
    // 保存后清空编辑区，鼓励发明下一个问题
    setProblemText('')
    setValidation(null)
  }

  const handleLoadExample = (ex: ExampleProblem): void => {
    setProblemText(ex.statement)
    setCategory(ex.category)
    setValidation(null)
    soundSystem.play('pop')
  }

  const cycleStatus = (id: string): void => {
    const next = saved.map(p => {
      if (p.id !== id) return p
      const idx = STATUS_CYCLE.indexOf(p.status)
      const nextStatus = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
      return { ...p, status: nextStatus }
    })
    setSaved(next)
    persistSaved(next)
    soundSystem.play('click')
  }

  const toggleFirstToSolve = (id: string): void => {
    const next = saved.map(p => (p.id === id ? { ...p, firstToSolve: !p.firstToSolve } : p))
    setSaved(next)
    persistSaved(next)
    const nowFirst = next.find(q => q.id === id)?.firstToSolve ?? false
    soundSystem.play(nowFirst ? 'unlock' : 'click')
  }

  const deleteProblem = (id: string): void => {
    const next = saved.filter(p => p.id !== id)
    setSaved(next)
    persistSaved(next)
    soundSystem.play('whoosh')
  }

  const canSave = problemText.trim().length >= MIN_TEXT_LENGTH
  const canValidate = problemText.trim().length > 0

  return (
    <div className="pi-root">
      <style>{STYLES}</style>

      {/* 1. 头部：标题 + 结构主义标语 */}
      <header className="pi-header">
        <div className="pi-header-top">
          <div>
            <h2 className="pi-title">Problem Invention — 问题发明台</h2>
            <p className="pi-tagline">{copy.tagline}</p>
          </div>
          <span className="pi-step-badge">结构主义 · 问题发明</span>
        </div>
        <p className="pi-tagline" style={{ marginTop: 10 }}>
          {copy.intro}
        </p>
      </header>

      {/* 2. 示例问题（可折叠） */}
      <section className="pi-section">
        <div className="pi-section-head">
          <h3 className="pi-section-title">{copy.examplesTitle}</h3>
          <button
            type="button"
            className="pi-toggle"
            onClick={() => {
              setExamplesOpen(o => !o)
              soundSystem.play('click')
            }}
            aria-expanded={examplesOpen}
          >
            {examplesOpen ? '\u25BC 收起' : '\u25B8 展开'}
          </button>
        </div>
        <p className="pi-section-hint">{copy.examplesHint}</p>

        {examplesOpen && (
          <div className="pi-examples">
            {EXAMPLE_PROBLEMS.map(ex => {
              const cat = CATEGORY_META[ex.category]
              return (
                <article key={ex.id} className="pi-example-card">
                  <h4 className="pi-example-title">{ex.title}</h4>
                  <p className="pi-example-statement">{ex.statement}</p>
                  <p className="pi-example-blurb">{ex.blurb[ageLevel]}</p>
                  <div className="pi-example-foot">
                    <span
                      className="pi-mini-cat"
                      style={{ color: cat.colorVar, background: cat.bgVar }}
                    >
                      {cat.icon} {cat.label}
                    </span>
                    <button
                      type="button"
                      className="pi-icon-btn"
                      onClick={() => handleLoadExample(ex)}
                    >
                      {copy.tryExampleLabel}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* 3. 问题创建表单 */}
      <section className="pi-section">
        <h3 className="pi-section-title">{copy.formPrompt}</h3>
        <p className="pi-section-hint">
          {ageLevel === 'kids'
            ? '把你想问的数学问题写出来，再选一个类型。'
            : ageLevel === 'tweens'
              ? '清晰陈述你的问题或猜想，并选择最贴切的类型。'
              : 'State the problem precisely. Precision is the first step toward a solvable conjecture.'}
        </p>

        <div className="pi-form">
          <div>
            <label className="pi-label" htmlFor="pi-problem-input">
              {copy.formPrompt}
            </label>
            <textarea
              id="pi-problem-input"
              className="pi-textarea"
              value={problemText}
              onChange={e => setProblemText(e.target.value)}
              placeholder={copy.placeholder}
              spellCheck={false}
            />
          </div>

          <div>
            <span className="pi-label">{copy.categoryLabel}</span>
            <div className="pi-cat-row" role="radiogroup" aria-label={copy.categoryLabel}>
              {(Object.keys(CATEGORY_META) as ProblemCategory[]).map(key => {
                const cat = CATEGORY_META[key]
                const active = category === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={'pi-cat-btn' + (active ? ' pi-cat-btn-active' : '')}
                    style={active ? { color: cat.colorVar, background: cat.bgVar } : undefined}
                    onClick={() => {
                      setCategory(key)
                      soundSystem.play('click')
                    }}
                  >
                    <span className="pi-cat-icon">{cat.icon}</span>
                    {cat.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="pi-form-actions">
            <button
              type="button"
              className="pi-validate-btn"
              onClick={handleValidate}
              disabled={!canValidate}
            >
              {copy.validateLabel}
            </button>
            <button type="button" className="pi-save-btn" onClick={handleSave} disabled={!canSave}>
              {copy.saveLabel}
            </button>
          </div>
        </div>
      </section>

      {/* 4. 验证结果面板 */}
      <section className="pi-section">
        <h3 className="pi-section-title">{copy.resultsTitle}</h3>
        <div className="pi-results">
          {validation === null ? (
            <p className="pi-results-empty">{copy.validateEmpty}</p>
          ) : (
            <>
              {/* 三项检查总览徽章 */}
              <div className="pi-result-summary">
                <span
                  className={'pi-chip ' + (validation.wellFormed ? 'pi-chip-on' : 'pi-chip-off')}
                >
                  良构 {validation.wellFormed ? '\u2713' : '\u2717'}
                </span>
                <span
                  className={'pi-chip ' + (validation.meaningful ? 'pi-chip-on' : 'pi-chip-off')}
                >
                  意义 {validation.meaningful ? '\u2713' : '\u2717'}
                </span>
                {validation.knownMatch ? (
                  <span className="pi-chip pi-chip-known">已知：{validation.knownMatch.name}</span>
                ) : (
                  <span className="pi-chip pi-chip-novel">
                    {ageLevel === 'teens' ? 'Possibly novel' : '可能新颖'}
                  </span>
                )}
              </div>

              {/* 逐条诊断 */}
              {validation.messages.map((msg, i) => (
                <div key={i} className={'pi-result-row pi-' + msg.level}>
                  <span className="pi-result-icon">
                    {msg.level === 'ok' ? '\u2713' : msg.level === 'warn' ? '!' : '\u2717'}
                  </span>
                  <span className="pi-result-text">{msg.text}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* 5. 已保存问题画廊 */}
      <section className="pi-section">
        <div className="pi-section-head">
          <h3 className="pi-section-title">{copy.galleryTitle}</h3>
          <span className="pi-problem-meta">{saved.length} 项</span>
        </div>

        {saved.length === 0 ? (
          <p className="pi-gallery-empty">{copy.galleryEmpty}</p>
        ) : (
          <div className="pi-gallery">
            {saved.map(p => {
              const cat = CATEGORY_META[p.category]
              const st = STATUS_META[p.status]
              return (
                <article key={p.id} className="pi-problem-card">
                  <div className="pi-problem-card-head">
                    <span
                      className="pi-mini-cat"
                      style={{ color: cat.colorVar, background: cat.bgVar }}
                    >
                      {cat.icon} {cat.label}
                    </span>
                    <span
                      className="pi-mini-cat"
                      style={{ color: st.colorVar, background: st.bgVar }}
                    >
                      {st.label}
                    </span>
                    {p.firstToSolve ? (
                      <span className="pi-first-badge">{'\u2605'} 首次解决 (First to solve)</span>
                    ) : null}
                  </div>

                  <p className="pi-problem-text">{p.text}</p>

                  <div className="pi-problem-foot">
                    <span className="pi-problem-meta">
                      {new Date(p.createdAt).toLocaleString()}
                    </span>
                    <div className="pi-problem-actions">
                      <button
                        type="button"
                        className="pi-icon-btn"
                        onClick={() => cycleStatus(p.id)}
                        title="切换状态"
                      >
                        {'\u21BB'} {ageLevel === 'teens' ? 'Status' : '状态'}
                      </button>
                      <button
                        type="button"
                        className={'pi-icon-btn' + (p.firstToSolve ? '' : ' pi-icon-btn-danger')}
                        onClick={() => toggleFirstToSolve(p.id)}
                        title="标记 / 取消「首次解决」"
                      >
                        {'\u2605'} {p.firstToSolve ? '取消首次' : '首次解决'}
                      </button>
                      <button
                        type="button"
                        className="pi-icon-btn pi-icon-btn-danger"
                        onClick={() => deleteProblem(p.id)}
                        title="删除"
                      >
                        {'\u2715'}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
