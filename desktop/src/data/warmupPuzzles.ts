/**
 * 热身谜题数据 — 承结构主义与新数学运动的家庭作业结构
 *
 * 每堂课以热身谜题开场：逻辑谜题、物理脑筋急转弯、数学小把戏、语言谜题。
 * 这些谜题并非「群论」，但它们训练的是代数思维所需的底层能力：
 *   - 约束推理（在每个陈述中寻找一致的赋值）
 *   - 对称性观察（碰撞 = 穿过、回文 = 反转不动点）
 *   - 自指与不动点（悖论、奇偶分解）
 *   - 群作用直觉（字谜 = Sₙ 作用下的轨道）
 *
 * 年龄适配：
 *   - kids   (8-10岁):  生活化语言、具体场景
 *   - tweens (11-13岁): 半学术语言、引入术语但保留直觉
 *   - teens  (14+岁):   完整学术表述、抽象形式
 */

import type { AgeLevel } from '../utils/ageAdapt'

export type PuzzleCategory = 'logic' | 'math' | 'physics' | 'linguistic' | 'trick'

export interface WarmupPuzzle {
  id: string
  category: PuzzleCategory
  difficulty: AgeLevel
  question: string
  hint: string
  answer: string
  explanation: string
  /** 该谜题如何连接到代数思维 / 群论直觉 */
  connectionToGroupTheory?: string
}

// ---------------------------------------------------------------------------
// 谜题集合 — 跨类别、跨年龄
// ---------------------------------------------------------------------------

export const WARMUP_PUZZLES: WarmupPuzzle[] = [
  // =========================================================================
  // 小学 (kids) — 7 题
  // =========================================================================

  // --- 逻辑：Halfsies 侦探（简化版） ---
  {
    id: 'halfsies-kids',
    category: 'logic',
    difficulty: 'kids',
    question:
      '小明的饼干被偷了！嫌疑人有三个：小红、小蓝、小绿。每个人说了两句话，但每个人都是「一句真、一句假」。\n\n' +
      '小红说：「是小蓝偷的」「不是我偷的」\n' +
      '小蓝说：「不是我偷的」「是小红偷的」\n' +
      '小绿说：「不是小红偷的」「是小蓝偷的」\n\n' +
      '到底是谁偷了饼干？',
    hint: '一个一个假设！假设是小红偷的，看看每个人是不是都「一句真一句假」。如果不行，再换小蓝、小绿。',
    answer: '小绿偷了饼干。',
    explanation:
      '假设是小绿偷的：\n' +
      '• 小红的两句：「是小蓝偷的」= 假，「不是我偷的」= 真 ✓\n' +
      '• 小蓝的两句：「不是我偷的」= 真，「是小红偷的」= 假 ✓\n' +
      '• 小绿的两句：「不是小红偷的」= 真，「是小蓝偷的」= 假 ✓\n' +
      '三个人都是「一句真一句假」，全部对得上！而假设小红或小蓝偷的，都会有人两句都假或两句都真，对不上。',
    connectionToGroupTheory:
      '每个陈述是一个「是 / 否」的约束。找小偷就像解方程：每个约束排除一部分可能，最后只剩一个满足所有约束的答案。这种「在约束下找唯一解」正是代数思维的核心。',
  },

  // --- 物理：蚂蚁碰撞（具体版） ---
  {
    id: 'ant-kids',
    category: 'physics',
    difficulty: 'kids',
    question:
      '一根 30 厘米长的木棍。一只蚂蚁在 5 厘米处向右爬，另一只在 25 厘米处向左爬，速度都是 1 厘米/秒。' +
      '两只蚂蚁碰头时会掉头往回爬。请问：多久后两只蚂蚁都掉下木棍？',
    hint: '关键点：蚂蚁长得一模一样，分不清谁是谁！碰头后掉头，和「互相穿过对方」看起来完全一样。',
    answer: '25 秒。',
    explanation:
      '把「碰头掉头」想成「互相穿过对方」——因为蚂蚁一模一样，穿过去之后你根本看不出区别！\n' +
      '• 向右的那只从 5 厘米走到 30 厘米：走了 25 厘米 = 25 秒\n' +
      '• 向左的那只从 25 厘米走到 0 厘米：走了 25 厘米 = 25 秒\n' +
      '所以两只都在 25 秒后掉下去。你可以自己画一画碰头掉头的过程，答案一模一样！',
    connectionToGroupTheory:
      '「碰头 = 穿过」是一个等价变换：两种描述对应同一个结果。数学里经常这样——把复杂的过程换成等价但更简单的描述，这正是「同构」的直觉。',
  },

  // --- 把戏：别读这句话 ---
  {
    id: 'dontread-kids',
    category: 'trick',
    difficulty: 'kids',
    question: '请大声读出这句话：「不要读这句话。」\n\n你做到了吗？这里有什么好笑的地方？',
    hint: '如果你读了出来，你就没有「不要读」；如果你没读，你又不知道它写了什么。',
    answer: '这是一个「自相矛盾」的小把戏。',
    explanation:
      '这句话在命令你「不要读」，可它本身就是一句话——你要看懂命令就得先读它！读了吧，你就违背了命令；不读吧，你又不知道命令是什么。' +
      '这种「自己说自己」的话会绕成一个圈，让人忍不住笑。',
    connectionToGroupTheory:
      '一个规则作用到自己身上时，常常会产生意外。数学里研究「把一个东西作用到它自己」的操作时，会找到「不动点」——像 0+0=0、1×1=1 这样「作用后不变」的点。',
  },

  // --- 语言：字谜配对 ---
  {
    id: 'anagram-kids',
    category: 'linguistic',
    difficulty: 'kids',
    question:
      '「listen」（听）和「silent」（安静）这两个英文单词，用了同样几个字母吗？\n\n' +
      '再想想：哪些词也是把同样的字母重新排队组成的？',
    hint: '把两个单词的字母分别排一排、数一数，看看 l、i、s、t、e、n 是不是都一样。',
    answer: '是的！它们用的是完全相同的字母，只是顺序不同。这叫「字谜词」（重排字母）。',
    explanation:
      'listen 和 silent 都由 l、i、s、t、e、n 这 6 个字母组成，只是排队顺序不同。\n' +
      '更多例子：live（活）和 evil（邪恶）；ear（耳朵）和 are（是）。\n' +
      '只要字母种类和数量一样，怎么重新排队都算一组字谜词。',
    connectionToGroupTheory:
      '「重新排队」就是一种「排列」操作。把字母换位置的游戏，正是数学里「置换群」研究的内容——每一步换位置都对应一个置换。',
  },

  // --- 数学：找假币（简化版） ---
  {
    id: 'coin-kids',
    category: 'math',
    difficulty: 'kids',
    question:
      '有 3 枚硬币，其中 1 枚是假的，比真的轻。你有一个天平。最少称几次能找出假币？怎么称？',
    hint: '天平两边各放 1 枚。如果一边轻，那就是假的；如果一样重呢？',
    answer: '称 1 次就够了。',
    explanation:
      '把 3 枚硬币中的 2 枚分别放在天平两边：\n' +
      '• 如果一边轻，那枚就是假币；\n' +
      '• 如果两边一样重，没放上去的第 3 枚就是假币！\n' +
      '所以 1 次就能找出假币。',
    connectionToGroupTheory:
      '每次称重把硬币分成 3 组，相当于一次「三分」决策。这种「分组 + 比较」的结构，和数学里把大集合划分成小块（陪集）的思想一脉相承。',
  },

  // --- 数学：找规律 ---
  {
    id: 'fibo-kids',
    category: 'math',
    difficulty: 'kids',
    question: '看这一串数：1, 1, 2, 3, 5, 8, ?\n\n下一个数是多少？规律是什么？',
    hint: '看看每个数和它前面两个数的关系。试试把前两个数加起来。',
    answer: '13。规律是：每个数 = 前面两个数相加。',
    explanation:
      '1 + 1 = 2，1 + 2 = 3，2 + 3 = 5，3 + 5 = 8，所以 5 + 8 = 13。\n' +
      '这串数叫「斐波那契数列」，是大自然里到处出现的神奇数字——向日葵的螺旋、蜗牛的壳都能找到它！',
    connectionToGroupTheory:
      '「后一项由前两项决定」是一种递推规则。数学家用一个 2×2 的「魔法格子」来表示这个规则，把这个格子反复作用，就能变出整个数列——就像一个生成元变出整个家族。',
  },

  // --- 逻辑：两扇门 ---
  {
    id: 'knights-kids',
    category: 'logic',
    difficulty: 'kids',
    question:
      '面前有两扇门：一扇通向宝藏，一扇通向陷阱。门口各有一个守卫。' +
      '其中一个守卫永远说真话，另一个永远说谎话，但你不知道谁是谁。\n\n' +
      '你只能问其中一个守卫一个问题。怎样问才能找到宝藏门？',
    hint: '不要直接问「宝藏在哪里」。试试问：「另一个守卫会说宝藏在哪里？」',
    answer: '问任意一个守卫：「另一个守卫会说哪扇门是宝藏？」然后走相反的那扇门。',
    explanation:
      '不管你问的是诚实守卫还是说谎守卫，得到的答案都是「陷阱门」：\n' +
      '• 问诚实守卫：他会如实转述说谎守卫的谎话（说谎守卫会指陷阱门），所以他说陷阱门。\n' +
      '• 问说谎守卫：诚实守卫本会指宝藏门，但他要撒谎，所以他也指陷阱门。\n' +
      '两种情况答案都是陷阱门，所以走相反的那扇就是宝藏！',
    connectionToGroupTheory:
      '说谎守卫就像一个「翻转」操作：把真变假、假变真。问「另一个守卫怎么说」相当于把两个翻转叠在一起——这正是「逆元」配合运算的直觉。',
  },

  // =========================================================================
  // 初中 (tweens) — 7 题
  // =========================================================================

  // --- 逻辑：Halfsies 侦探（半学术版） ---
  {
    id: 'halfsies-tweens',
    category: 'logic',
    difficulty: 'tweens',
    question:
      '一道经典的「半真半假」侦探题。三个人 A、B、C 是一桩案件的嫌疑人，恰有一人是罪犯。' +
      '每人做了两条陈述，每人恰有一真一假。\n\n' +
      'A：「罪犯是 B」「罪犯不是我」\n' +
      'B：「罪犯不是我」「罪犯是 A」\n' +
      'C：「罪犯不是 A」「罪犯是 B」\n\n' +
      '请推理出罪犯是谁。',
    hint: '逐一假设罪犯为 A / B / C，对每个人检查两条陈述的真假数，必须恰好一真一假。',
    answer: '罪犯是 C。',
    explanation:
      '设罪犯为 X。\n' +
      '• 若 X=A：A 的两条「是 B」(假)、「不是我」(假) → 两假，违反规则。✗\n' +
      '• 若 X=B：A 的两条「是 B」(真)、「不是我」(真) → 两真，违反规则。✗\n' +
      '• 若 X=C：A(假,真)、B(真,假)、C(真,假)，三人都是一真一假。✓\n' +
      '所以罪犯是 C。关键在于「一真一假」的约束会同时排除两种极端情况。',
    connectionToGroupTheory:
      '每个陈述是一个二元谓词（真/假）。约束求解本质上是寻找变量赋值使所有约束同时满足——这与「在代数结构中寻找满足方程的元素」是同一种思维。',
  },

  // --- 数学：奇函数 ---
  {
    id: 'oddfunc-tweens',
    category: 'math',
    difficulty: 'tweens',
    question:
      '若 f(-x) = -f(x) 对所有 x 成立，则称 f 为「奇函数」；若 f(-x) = f(x)，则称「偶函数」。\n\n' +
      '判断 f(x) = x³ - 3x 是奇函数、偶函数，还是都不是？',
    hint: '把 -x 代入，算出 f(-x)，再看看它等于 -f(x) 还是 f(x)。',
    answer: '是奇函数。',
    explanation:
      'f(-x) = (-x)³ - 3(-x) = -x³ + 3x = -(x³ - 3x) = -f(x)。\n' +
      '所以 f(-x) = -f(x)，满足奇函数定义。\n' +
      '注意 x³ 是奇函数、x² 是偶函数；奇函数相加减仍为奇函数。',
    connectionToGroupTheory:
      '变换 x → -x 是一个「阶为 2」的操作（做两次回到原点）。奇函数和偶函数分别是这个操作下「特征值 -1」和「+1」的部分。任意函数都能拆成一个奇部分加一个偶部分——这就是「投影到特征子空间」的雏形。',
  },

  // --- 物理：蚂蚁碰撞（n 只，最坏情况） ---
  {
    id: 'ant-tweens',
    category: 'physics',
    difficulty: 'tweens',
    question:
      'n 只蚂蚁在一根长 L 的木棍上，位置分别为 p₁, p₂, …, pₙ，速度都是 v，方向各异。' +
      '相碰时各自掉头。蚂蚁走到木棍端点就掉下去。\n\n' +
      '求：所有蚂蚁全部掉下去所需的最长时间（最坏情况）。',
    hint: '蚂蚁相碰掉头 ≡ 互相穿过（蚂蚁不可区分）。每只蚂蚁的「幽灵」按原方向走到底。',
    answer: '最长时间 = maxᵢ max(pᵢ, L - pᵢ) / v。',
    explanation:
      '由于蚂蚁不可区分，「相碰掉头」与「互相穿过」产生完全相同的可观测结果。\n' +
      '因此每只蚂蚁的「幽灵」沿原方向直走到端点：第 i 只若向右走需 (L - pᵢ)/v，向左走需 pᵢ/v。\n' +
      '所有蚂蚁掉完的时刻 = 各幽灵掉落时刻的最大值。\n' +
      '最坏情况（每只都朝远端走）即为 maxᵢ max(pᵢ, L - pᵢ) / v。',
    connectionToGroupTheory:
      '「掉头」与「穿过」是两种描述同一物理过程的等价模型——这正是「同构」的物理化身：不同表象，相同结构。',
  },

  // --- 数学：派对地点之谜 ---
  {
    id: 'party-tweens',
    category: 'math',
    difficulty: 'tweens',
    question:
      '派对的门牌号是个数字 N。三个人各自记错了：\n' +
      '• 爱丽丝把数字夸大了 2 倍，她说成 2N；\n' +
      '• 鲍勃把数字缩小到 1/4，他说成 N/4；\n' +
      '• 儿子给数字加了 8，他说成 N + 8。\n\n' +
      '已知：爱丽丝说的数 = 儿子说的数，且鲍勃说的数比真实数小 6。求真实门牌号 N。',
    hint: '把两个已知条件写成方程：2N = N + 8，以及 N/4 = N − 6。先解一个。',
    answer: 'N = 8。',
    explanation:
      '由「鲍勃说的比真实小 6」：N/4 = N − 6 → N − N/4 = 6 → 3N/4 = 6 → N = 8。\n' +
      '验证另一条件：爱丽丝说 2×8 = 16，儿子说 8 + 8 = 16，相等 ✓。\n' +
      '所以真实门牌号是 8。',
    connectionToGroupTheory:
      '×2、÷4、+8 都是「仿射变换」x ↦ ax + b。所有可逆仿射变换构成一个群（仿射群）。这个谜题就是在一个变换群里反推「原像」——求一个数，使它在不同群元作用下满足给定关系。',
  },

  // --- 数学：天平称币（9 枚） ---
  {
    id: 'coin-tweens',
    category: 'math',
    difficulty: 'tweens',
    question: '9 枚硬币中有 1 枚假币（偏轻）。用天平最少称几次能找出假币？给出方案。',
    hint: '每次称重把硬币分成 3 组：左盘、右盘、不称。三组应尽量平均。',
    answer: '称 2 次。',
    explanation:
      '第 1 次：把 9 枚分成 3、3、3，称其中两组。\n' +
      '  • 若平衡，假币在没称的那 3 枚里；\n' +
      '  • 若不平衡，假币在较轻的那 3 枚里。\n' +
      '第 2 次：从可疑的 3 枚中取 2 枚称。\n' +
      '  • 若平衡，没称的那枚是假币；\n' +
      '  • 若不平衡，较轻的那枚是假币。\n' +
      '2 次足矣。本质：每次称重有 3 种结果（左轻/平衡/右轻），2 次可区分 3² = 9 种情况。',
    connectionToGroupTheory:
      '每次称重是一个三分决策，编码了 log₃3 比特信息。2 次称重的决策树有 3² = 9 个叶子，恰好覆盖 9 枚硬币——这种「群作用的轨道数 = 信息容量」的思想在编码与群论中反复出现。',
  },

  // --- 语言：回文 ---
  {
    id: 'palindrome-tweens',
    category: 'linguistic',
    difficulty: 'tweens',
    question:
      '「level」「racecar」「上海自来水来自海上」有什么共同点？\n\n' +
      '一个字符串满足什么条件才是回文？「abcba」是回文吗？「abca」呢？',
    hint: '把字符串反过来读，看看和原来一不一样。',
    answer: '正读和反读完全一样的串就是回文。「abcba」是回文，「abca」不是。',
    explanation:
      '回文 = 反转后等于自身。\n' +
      '• 「abcba」反过来是「abcba」，相同 ✓\n' +
      '• 「abca」反过来是「acba」，不同 ✗\n' +
      '一个长度为 n 的串 s 是回文，当且仅当对所有 i，s[i] = s[n−1−i]。',
    connectionToGroupTheory:
      '「反转」是一个阶为 2 的操作（反转两次回到原串）。回文正是这个操作下的「不动点」——作用后保持不变。这与偶函数（在 x↦−x 下不变）是同一回事：不动点 = 特征值 +1 的部分。',
  },

  // --- 把戏：自指悖论 ---
  {
    id: 'selfref-tweens',
    category: 'trick',
    difficulty: 'tweens',
    question: '请判断这句话的真假：「这句话是假的。」',
    hint: '假设它为真，会推出什么？假设它为假，又推出什么？',
    answer: '它既不能为真也不能为假——这是一个悖论。',
    explanation:
      '• 若它为真，那么「这句话是假的」属实，即它为假——矛盾。\n' +
      '• 若它为假，那么「这句话是假的」不成立，即它为真——又矛盾。\n' +
      '无论怎么假设都会自我推翻。这就是「说谎者悖论」，源于语句指向了自身。',
    connectionToGroupTheory:
      '当一个对象作用到自身时，可能出现「没有一致赋值」的情形。数学家用「不动点」来研究这类自我作用：若存在 x 使 f(x) = x，则系统自洽；悖论恰恰是「不存在这样的不动点」的极端体现。',
  },

  // =========================================================================
  // 高中及以上 (teens) — 7 题
  // =========================================================================

  // --- 逻辑：Halfsies（抽象形式） ---
  {
    id: 'halfsies-teens',
    category: 'logic',
    difficulty: 'teens',
    question:
      'Three suspects A, B, C; exactly one is guilty. Each makes two statements; each person has exactly one true and one false statement.\n\n' +
      'A: "B is guilty." / "I am not guilty."\n' +
      'B: "I am not guilty." / "A is guilty."\n' +
      'C: "A is not guilty." / "B is guilty."\n\n' +
      'Determine the guilty party and prove uniqueness.',
    hint: 'For each candidate X, evaluate the truth values of all six statements. The "one true, one false per person" constraint must hold for all three simultaneously.',
    answer: 'C is guilty (uniquely).',
    explanation:
      'Let X be guilty. A person is consistent iff exactly one of their two statements is true.\n' +
      '• X=A: A says (false, false) → 0 true. Inconsistent.\n' +
      '• X=B: A says (true, true) → 2 true. Inconsistent.\n' +
      '• X=C: A(false,true), B(true,false), C(true,false) → each has exactly one true. Consistent.\n' +
      'Only X=C satisfies the constraint, so C is uniquely guilty. The structure forces the answer because "one true, one false" excludes both the all-false and all-true cases.',
    connectionToGroupTheory:
      'Each statement is a Boolean predicate; the puzzle is a constraint-satisfaction problem over {A,B,C}. Finding the unique satisfying assignment is the discrete analogue of solving a system of equations over a structure — the same reasoning that locates elements satisfying group-theoretic conditions.',
  },

  // --- 数学：奇函数与 Z₂ 作用 ---
  {
    id: 'oddfunc-teens',
    category: 'math',
    difficulty: 'teens',
    question:
      'Let σ act on functions by (σ·f)(x) = f(−x). \n\n' +
      '(a) Show σ² = id, so ⟨σ⟩ ≅ Z₂.\n' +
      '(b) Express any function f uniquely as f = f₊ + f₋, where σ·f₊ = f₊ and σ·f₋ = −f₋.\n' +
      '(c) Give the explicit decomposition.',
    hint: 'σ is an order-2 operator. Think of f₊ and f₋ as projections onto the ±1 eigenspaces: average f with σ·f, and take half their difference.',
    answer:
      '(a) σ²·f(x) = f(−(−x)) = f(x), so σ² = id, hence ⟨σ⟩ ≅ Z₂.\n' +
      '(b),(c) f₊(x) = ½(f(x) + f(−x)) (even part), f₋(x) = ½(f(x) − f(−x)) (odd part); f = f₊ + f₋ uniquely.',
    explanation:
      'σ² = id because negation is an involution. The group ring of Z₂ = {e, σ} has idempotents e₊ = ½(e + σ) and e₋ = ½(e − σ), projecting onto the +1 and −1 eigenspaces.\n' +
      '  f₊ = e₊·f = ½(f(x)+f(−x))  →  σ·f₊ = f₊  (even)\n' +
      '  f₋ = e₋·f = ½(f(x)−f(−x))  →  σ·f₋ = −f₋ (odd)\n' +
      'Uniqueness: if f = g + h with σ·g = g, σ·h = −h, then applying σ gives σ·f = g − h; solving yields g = ½(f + σ·f) = f₊, h = ½(f − σ·f) = f₋.',
    connectionToGroupTheory:
      'This is the canonical example of decomposing a representation of a finite group into isotypic components. The even/odd split is the Z₂-equivariant decomposition; for a general finite group G acting on a vector space, the group algebra ℂ[G] yields analogous idempotent projectors onto each irreducible-character subspace (the isotypic decomposition).',
  },

  // --- 物理：蚂蚁碰撞（期望时间） ---
  {
    id: 'ant-teens',
    category: 'physics',
    difficulty: 'teens',
    question:
      'Three ants sit on a stick of length L at positions L/4, L/2, 3L/4, each moving at speed v. ' +
      'Each independently chooses left or right with probability 1/2. On collision, ants reverse.\n\n' +
      'Find the expected time until all ants have fallen off the stick.',
    hint: 'Use the pass-through equivalence: label-following is irrelevant. Each ant falls at p_i/v (left) or (L−p_i)/v (right), each w.p. 1/2. The clearing time is the max of the three fall times.',
    answer: 'E[T] = 11L / (16v).',
    explanation:
      'By the pass-through lemma, ant i falls at time Tᵢ = pᵢ/v (left) or (L−pᵢ)/v (right), equiprobably, independently. Clearing time T = max(T₁, T₂, T₃).\n' +
      'Scale L=v=1. Positions 1/4, 1/2, 3/4.\n' +
      '  T₂ = 1/2 always.\n' +
      '  T₁ ∈ {1/4 (L), 3/4 (R)}, T₃ ∈ {3/4 (L), 1/4 (R)}.\n' +
      'Only (dir₁, dir₃) matters (4 equiprobable cases):\n' +
      '  (L,L): max(1/4, 1/2, 3/4) = 3/4\n' +
      '  (L,R): max(1/4, 1/2, 1/4) = 1/2\n' +
      '  (R,L): max(3/4, 1/2, 3/4) = 3/4\n' +
      '  (R,R): max(3/4, 1/2, 1/4) = 3/4\n' +
      'E[T] = ¼(3/4 + 1/2 + 3/4 + 3/4) = ¼·(11/4) = 11/16.\n' +
      'Restoring units: E[T] = 11L/(16v).',
    connectionToGroupTheory:
      'The pass-through lemma identifies a non-trivial symmetry of the system: the dynamics are invariant under relabeling ants at collisions. Recognizing such symmetries reduces the problem to order statistics of independent variables — the same simplification-by-symmetry that makes group-theoretic counting (Burnside, orbit-stabilizer) powerful.',
  },

  // --- 数学：派对地点（代数形式） ---
  {
    id: 'party-teens',
    category: 'math',
    difficulty: 'teens',
    question:
      'A party is at house number N. Three witnesses apply invertible affine transforms to N: ' +
      'Alice reports φ_A(N) = 2N, Bob reports φ_B(N) = N/4, the son reports φ_S(N) = N + 8.\n' +
      'Given φ_A(N) = φ_S(N) and φ_B(N) = N − 6, recover N. ' +
      'Verify that φ_A, φ_B, φ_S are elements of the affine group Aff(ℝ).',
    hint: 'Each φ(x) = ax + b is invertible iff a ≠ 0, hence lies in Aff(ℝ) = {x ↦ ax+b : a ≠ 0}. Solve the two linear equations.',
    answer: 'N = 8. All three maps are in Aff(ℝ): a = 2, 1/4, 1 (with b = 0, 0, 8); all a ≠ 0.',
    explanation:
      'Invertibility: φ_A(x)=2x (a=2), φ_B(x)=x/4 (a=1/4), φ_S(x)=x+8 (a=1); all a ≠ 0, so each is in Aff(ℝ), with inverses x/2, 4x, x−8.\n' +
      'Solve φ_B(N) = N − 6: N/4 = N − 6 → 3N/4 = 6 → N = 8.\n' +
      'Check φ_A(N) = φ_S(N): 2·8 = 16 = 8 + 8 ✓.\n' +
      'So N = 8. The puzzle is the recovery of a common preimage under three known group elements.',
    connectionToGroupTheory:
      'Aff(ℝ) = ℝ ⋊ GL(1,ℝ) is the affine group (translations semidirect-linear maps). The witnesses apply group elements; the solver inverts them to recover N. This is precisely "solving equations in a group": given g₁(N)=g₂(N), find N — the algebraic heart of the puzzle.',
  },

  // --- 语言：字谜作为 Sₙ 轨道 ---
  {
    id: 'anagram-teens',
    category: 'linguistic',
    difficulty: 'teens',
    question:
      'Two words are anagrams if one is obtained from the other by permuting letters. ' +
      'Formalize this with the symmetric group Sₙ acting on the set of length-n strings.\n\n' +
      '(a) Define the action and show "are anagrams" is an equivalence relation.\n' +
      '(b) For the word "MISSISSIPPI", compute |Orbit(word)| using orbit-stabilizer.',
    hint: 'Sₙ acts by permuting positions. Stabilizer = permutations fixing the word = ∏ (multiplicities)! for each repeated letter. Orbit size = n! / |Stab|.',
    answer:
      '(a) Sₙ acts by σ·(a₁…aₙ) = a_{σ⁻¹(1)}…a_{σ⁻¹(n)}; orbits = anagram classes, hence an equivalence relation.\n' +
      '(b) |Orbit| = 11! / (1!·4!·4!·2!) = 34650.',
    explanation:
      '(a) The action is a genuine group action (identity fixes; σ(τ·w) = (στ)·w). "Are anagrams" = "lie in the same orbit"; orbits always partition the set, giving an equivalence relation.\n' +
      '(b) "MISSISSIPPI" has length 11 with letters M:1, I:4, S:4, P:2. The stabilizer permutes identical letters freely: |Stab| = 1!·4!·4!·2! = 1·24·24·2 = 1152. By orbit-stabilizer, |Orbit| = |S₁₁|/|Stab| = 11!/1152 = 39916800/1152 = 34650 distinct anagrams.',
    connectionToGroupTheory:
      'This is orbit-stabilizer in action. Anagram classes are the orbits of Sₙ on strings; the stabilizer is the product of symmetric groups on each batch of identical letters (a Young subgroup). Counting anagrams = counting orbits = the combinatorial core of group actions, directly generalizing to Burnside/Pólya counting.',
  },

  // --- 把戏：理发师悖论 / 罗素 ---
  {
    id: 'russell-teens',
    category: 'trick',
    difficulty: 'teens',
    question:
      'The barber shaves all and only those who do not shave themselves. Does the barber shave himself?\n\n' +
      "Relate this to Russell's paradox and to the general obstruction captured by Lawvere's fixed-point theorem.",
    hint: 'Both answers ("yes" and "no") yield contradictions. The issue is a self-referential universal quantifier. Lawvere: a weakly point-surjective map f: X → Y^X guarantees a fixed point for any g: Y → Y.',
    answer:
      "Neither — the situation is impossible; no such barber exists. It is Russell's paradox in colloquial form, and an instance of the diagonal argument / Lawvere fixed-point obstruction.",
    explanation:
      'If the barber shaves himself, he is among "those who shave themselves," whom he does NOT shave — contradiction. If he does not, he is among "those who do not shave themselves," whom he MUST shave — contradiction. Hence the defining condition is unsatisfiable: no such barber exists.\n' +
      "Russell's paradox: the set R = {x : x ∉ x} yields R ∈ R ⟺ R ∉ R. Both are diagonal/self-reference contradictions.\n" +
      'Lawvere\'s theorem (1969): if f: X → Y^X is weakly point-surjective, then every g: Y → Y has a fixed point. Russell/barber constructions work by building a g with no fixed point (negation), which is possible only because the relevant "membership/evaluation" map fails to be point-surjective. The paradox signals the breakdown of an assumed surjectivity — a structural, not merely linguistic, obstruction.',
    connectionToGroupTheory:
      'Fixed points and their absence are central in group theory: Burnside/Cauchy-Frobenius counts fixed points of group actions; a group acting on itself by conjugation has the class equation driven by fixed points (centralizers). The barber/Russell obstruction is the limit case — an attempted self-action admitting no fixed point — mirroring why certain self-maps (e.g., negation) cannot be realized internally, a theme recurring in representation theory and cohomology.',
  },

  // --- 逻辑：骑士与无赖（形式化） ---
  {
    id: 'knights-teens',
    category: 'logic',
    difficulty: 'teens',
    question:
      'Two doors: one safe, one trap. Two guards: a Knight (always truthful) and a Knave (always lies). ' +
      'You may ask one guard one question to find the safe door.\n\n' +
      'Formalize truth/lies as an order-2 involution and prove your one-question strategy works regardless of whom you ask.',
    hint: 'Let τ flip truth values (τ(T)=F, τ(F)=T), τ²=id. A Knight applies id; a Knave applies τ. Asking about the other guard composes the two maps. Design a question whose answer always undergoes an odd number of flips.',
    answer:
      'Ask either guard: "Which door would the OTHER guard say is safe?" Then take the OPPOSITE door. This works because the response always passes through exactly one τ (net negation), regardless of whom you ask.',
    explanation:
      'Model truth-handling as a group action: Knight = identity e, Knave = negation τ with τ² = e (so {e,τ} ≅ Z₂). Let S = the true safe door.\n' +
      'A guard reporting "what the other guard would say" composes their maps:\n' +
      "  • Ask Knight (e): he reports the Knave's answer = τ(S) (the trap). Net effect on S: τ.\n" +
      '  • Ask Knave (τ): the Knight would say S; the Knave negates it = τ(S) (the trap). Net effect: τ∘e = τ.\n' +
      'In both cases the reported door = τ(S) = the trap. Taking the opposite recovers S.\n' +
      "The key algebraic fact: composing the two guards' maps gives e∘τ = τ∘e = τ — a single negation — so the answer is always the negation of the truth, no matter whom you ask.",
    connectionToGroupTheory:
      'The guards realize the group Z₂ = {e, τ} acting on the truth value. "Asking about the other guard" composes group elements; since e and τ commute and τ is the only non-identity, any such composition reduces to τ (one negation). The strategy exploits that the product is forced — a miniature of how representation theory predicts outcomes from group structure alone.',
  },
]
