/**
 * 年龄自适应术语与内容系统
 *
 * 核心理念：AI 时代让新数学运动重新成为可能。
 * 不是把群论「简化」到孩子能背，而是把抽象概念翻译成孩子能「玩」的语言。
 *
 * 三层年龄适配：
 *   - kids    (8-10岁):  游戏化隐喻，完全用生活化语言
 *   - tweens  (11-13岁): 过渡期，引入部分术语但保留隐喻
 *   - teens+  (14岁以上): 完整学术术语，但保持直觉入口
 */

export type AgeLevel = 'kids' | 'tweens' | 'teens'

interface TermMapping {
  academic: string
  kids: string
  tweens: string
  teens: string
}

/**
 * 术语映射表 — 每个数学概念在不同年龄段的翻译
 */
const TERM_MAP: Record<string, TermMapping> = {
  group: {
    academic: '群',
    kids: '魔法家族',
    tweens: '群（魔法家族）',
    teens: '群',
  },
  closure: {
    academic: '闭合性',
    kids: '不漏出去的规则',
    tweens: '闭合性（不漏出去）',
    teens: '闭合性',
  },
  identity: {
    academic: '单位元',
    kids: '隐形斗篷老大',
    tweens: '单位元（老大）',
    teens: '单位元',
  },
  inverse: {
    academic: '逆元',
    kids: '好搭档',
    tweens: '逆元（好搭档）',
    teens: '逆元',
  },
  associativity: {
    academic: '结合律',
    kids: '谁先谁后都一样',
    tweens: '结合律（谁先谁后都一样）',
    teens: '结合律',
  },
  commutativity: {
    academic: '交换律',
    kids: '换位置也一样',
    tweens: '交换律（换位置也一样）',
    teens: '交换律',
  },
  cayley_table: {
    academic: '运算表 / Cayley 表',
    kids: '魔法密码表',
    tweens: '运算表（密码表）',
    teens: '运算表 (Cayley 表)',
  },
  operation: {
    academic: '二元运算',
    kids: '两个数碰一碰',
    tweens: '运算（碰一碰）',
    teens: '二元运算',
  },
  cyclic_group: {
    academic: '循环群',
    kids: '绕圈圈家族',
    tweens: '循环群（绕圈圈）',
    teens: '循环群',
  },
  subgroup: {
    academic: '子群',
    kids: '家族里的小帮派',
    tweens: '子群（小帮派）',
    teens: '子群',
  },
  permutation: {
    academic: '置换',
    kids: '换座位',
    tweens: '置换（换座位）',
    teens: '置换',
  },
  conjecture: {
    academic: '猜想',
    kids: '我的发现',
    tweens: '猜想（我的发现）',
    teens: '猜想',
  },
  counterexample: {
    academic: '反例',
    kids: '找茬成功',
    tweens: '反例（找茬成功）',
    teens: '反例',
  },
  theorem: {
    academic: '定理',
    kids: '大发现',
    tweens: '定理（大发现）',
    teens: '定理',
  },
  proof: {
    academic: '证明',
    kids: '说服大家',
    tweens: '证明（说服大家）',
    teens: '证明',
  },
  cognitive_load: {
    academic: '认知负荷',
    kids: '脑子有点满',
    tweens: '脑力负担',
    teens: '认知负荷',
  },
  flow: {
    academic: '心流',
    kids: '超专注状态',
    tweens: '心流状态',
    teens: '心流',
  },
  anxiety: {
    academic: '焦虑指数',
    kids: '紧张度',
    tweens: '紧张度',
    teens: '焦虑指数',
  },
  mastery: {
    academic: '掌握度',
    kids: '厉害程度',
    tweens: '掌握程度',
    teens: '掌握度',
  },
  order: {
    academic: '阶 (群的阶/元素的阶)',
    kids: '绕几圈才回家',
    tweens: '阶（绕几圈回家）',
    teens: '阶 (order)',
  },
  homomorphism: {
    academic: '同态',
    kids: '翻译官',
    tweens: '同态（翻译官）',
    teens: '同态 (homomorphism)',
  },
  isomorphism: {
    academic: '同构',
    kids: '双胞胎',
    tweens: '同构（双胞胎）',
    teens: '同构 (isomorphism)',
  },
  coset: {
    academic: '陪集',
    kids: '排队分组',
    tweens: '陪集（排队分组）',
    teens: '陪集 (coset)',
  },
  normal_subgroup: {
    academic: '正规子群',
    kids: '老实的小帮派',
    tweens: '正规子群（老实的小帮派）',
    teens: '正规子群 (normal subgroup)',
  },
  quotient_group: {
    academic: '商群',
    kids: '把帮派当成一个人',
    tweens: '商群（把帮派当成一个人）',
    teens: '商群 (quotient group)',
  },
  lagrange: {
    academic: 'Lagrange 定理',
    kids: '大帮派切成小帮派',
    tweens: 'Lagrange 定理（整除规则）',
    teens: 'Lagrange 定理',
  },
  abelian: {
    academic: 'Abel 群 / 交换群',
    kids: '谁先谁后都一样的家族',
    tweens: '交换群（Abel 群）',
    teens: 'Abel 群 (交换群)',
  },
  kernel: {
    academic: '核',
    kids: '被翻译官藏起来的部分',
    tweens: '核（被藏起来的部分）',
    teens: '核 (kernel)',
  },
  generator: {
    academic: '生成元',
    kids: '能变出整个家族的人',
    tweens: '生成元（能变出全家族的人）',
    teens: '生成元 (generator)',
  },
  symmetric_group: {
    academic: '对称群',
    kids: '换座位大联盟',
    tweens: '对称群（换座位）',
    teens: '对称群 Sₙ',
  },
  dihedral_group: {
    academic: '二面体群',
    kids: '翻翻转转团',
    tweens: '二面体群（翻翻转转）',
    teens: '二面体群 Dₙ',
  },
  // === 引导界面（Onboarding）专用术语 ===
  cognition_os: {
    academic: 'MathWeaver',
    kids: '魔法学院',
    tweens: '数学探索平台',
    teens: 'MathWeaver',
  },
  algebraic_intuition: {
    academic: 'Build algebraic intuition',
    kids: '玩转魔法数字',
    tweens: '建立数学直觉',
    teens: 'Build algebraic intuition',
  },
  groups_to_proofs: {
    academic: 'Groups to proofs',
    kids: '从碰一碰到大发现',
    tweens: '从群到证明',
    teens: 'Groups to proofs',
  },
  onboarding_cayley: {
    academic: 'Cayley table',
    kids: '魔法密码表',
    tweens: '运算表',
    teens: 'Cayley table',
  },
  z3_engine: {
    academic: 'Z3 verifier',
    kids: '魔法验证器',
    tweens: '自动验证器',
    teens: 'Z3 verifier',
  },
  group_axioms: {
    academic: 'Group axioms',
    kids: '群的规则',
    tweens: '群公理',
    teens: 'Group axioms',
  },
  four_field: {
    academic: 'Four-field dashboard',
    kids: '状态仪表盘',
    tweens: '四场域面板',
    teens: 'Four-field dashboard',
  },
  onboarding_cognitive_load: {
    academic: 'Cognitive load',
    kids: '脑子满不满',
    tweens: '认知负荷',
    teens: 'Cognitive load',
  },
  onboarding_permutation: {
    academic: 'Permutations',
    kids: '换座位',
    tweens: '置换',
    teens: 'Permutations',
  },
  manim_anim: {
    academic: 'Manim animations',
    kids: '数学动画',
    tweens: 'Manim动画',
    teens: 'Manim animations',
  },
  conjecture_engine: {
    academic: 'Conjecture engine',
    kids: '发现机器',
    tweens: '猜想验证',
    teens: 'Conjecture engine',
  },
  eye_tracking: {
    academic: 'Eye tracking',
    kids: '注意力检测',
    tweens: '眼动追踪',
    teens: 'Eye tracking',
  },
  latex_render: {
    academic: 'LaTeX rendering',
    kids: '数学公式',
    tweens: 'LaTeX公式',
    teens: 'LaTeX rendering',
  },
  llm: {
    academic: 'LLM',
    kids: 'AI老师',
    tweens: 'LLM',
    teens: 'LLM',
  },
  mock_mode: {
    academic: '演示模式',
    kids: '试用模式',
    tweens: '演示模式',
    teens: '演示模式',
  },
}

/**
 * 获取术语的年龄适配版本
 */
export function t(termKey: string, level: AgeLevel): string {
  const mapping = TERM_MAP[termKey]
  if (!mapping) return termKey
  return mapping[level]
}

/**
 * 获取鼓励语
 */
export function getEncouragement(
  level: AgeLevel,
  type: 'correct' | 'wrong' | 'stuck' | 'milestone',
): string {
  const phrases: Record<AgeLevel, Record<string, string[]>> = {
    kids: {
      correct: ['太棒了！', '答对了！你真聪明！', '哇！就是这个！', '没错！继续冒险！'],
      wrong: [
        '没关系，再想想看～',
        '差一点点！试试别的？',
        '不要紧，每个侦探都会犯错',
        '嗯…再仔细看看密码表？',
      ],
      stuck: [
        '需要帮忙吗？点一下提示吧！',
        '卡住了？没关系，休息一下再回来',
        '试试看不同的数字组合',
      ],
      milestone: [
        '你完成了一个大挑战！',
        '恭喜！你已经是密码大师了！',
        '你解锁了新技能！',
      ],
    },
    tweens: {
      correct: [
        '不错！答对了',
        '正确！你的直觉很好',
        '没错！继续探索',
        '答对了，越来越接近真相了',
      ],
      wrong: [
        '不太对，再想想',
        '差一点，换个思路试试',
        '错了也没关系，反例也是发现',
        '再检查一下运算表？',
      ],
      stuck: ['需要提示吗？', '试试从简单的情况开始', '换个角度看问题试试'],
      milestone: ['成就解锁！', '进步很大！继续保持', '你已经掌握了一个重要概念'],
    },
    teens: {
      correct: ['正确。', '准确。', '对的，继续。', '成立。'],
      wrong: ['不正确，重新考虑。', '有误，检查你的推导。', '试试找反例。', '重新审视假设。'],
      stuck: ['可以请求提示。', '从特殊情况入手。', '回顾定义。'],
      milestone: ['概念掌握确认。', '阶段性达成。', '可以进入下一主题。'],
    },
  }
  const list = phrases[level][type]
  return list[Math.floor(Math.random() * list.length)]
}

/**
 * 引导任务的年龄适配内容
 */
export interface GuidedMission {
  id: string
  phase: 'play' | 'discover' | 'challenge' | 'create' | 'reflect'
  title: string
  story: string
  task: string
  hint: string
  successMsg: string
  actionLabel: string
  actionTarget: 'cayley' | 'chat' | 'conjecture' | 'explore' | 'auto'
}

/**
 * 生成特定年龄段的引导任务序列
 *
 * 小学版：以「魔法密码表」故事线展开
 *   1. 玩：改数字，看会发生什么
 *   2. 发现：找到「隐形斗篷老大」
 *   3. 挑战：试试「换位置也一样」吗？
 *   4. 创造：设计自己的密码表
 *   5. 反思：你发现了什么规律？
 *
 * 初中版：过渡到半学术语言
 * 青年版：完整学术流程
 */
export function getMissions(level: AgeLevel): GuidedMission[] {
  if (level === 'kids') {
    return [
      {
        id: 'play-1',
        phase: 'play',
        title: '第 1 关：魔法密码表',
        story:
          '欢迎来到魔法学院！这是一张魔法密码表，两个数字碰一碰就会变出新数字。试着改几个格子里面的数字，看看会发生什么！',
        task: '点击表格里的数字，把它们改成别的数（0 到 2）。改 5 个格子试试！',
        hint: '直接点格子里的数字就能修改啦！',
        successMsg: '太棒了！你已经开始使用魔法密码表了！',
        actionLabel: '去玩密码表',
        actionTarget: 'cayley',
      },
      {
        id: 'play-2',
        phase: 'play',
        title: '第 2 关：数字会漏出去吗？',
        story:
          '如果你把数字改得太大（比如改成 3），它就「漏」到表外面去了！试试找一个会「漏出去」的数字。',
        task: '把某个格子改成 3（比 2 大的数），看看会发生什么？红色的格子就是「漏出去」了！',
        hint: '当所有数字都在 0 到 2 之间，就叫「不漏出去的规则」！',
        successMsg: '你发现了「不漏出去的规则」！这就是大数学家说的「闭合性」！',
        actionLabel: '去试试看',
        actionTarget: 'cayley',
      },
      {
        id: 'discover-1',
        phase: 'discover',
        title: 'â 第 3 关：找隐形斗篷老大',
        story:
          '在魔法密码表里，藏着一个「隐形斗篷老大」。它跟谁碰一碰，谁就不变！比如老大是 0，那 0 碰 1 还是 1，0 碰 2 还是 2。',
        task: '找一找：哪一行跟最上面的数字一模一样？那就是老大！',
        hint: '看看第 0 行 — 它是不是 0, 1, 2？如果是，那 0 就是老大！',
        successMsg: '找到了！老大就是「隐形斗篷」！大数学家叫它「单位元」！',
        actionLabel: '去找老大',
        actionTarget: 'cayley',
      },
      {
        id: 'discover-2',
        phase: 'discover',
        title: '第 4 关：找到好搭档',
        story:
          '每个数字都有自己的「好搭档」！两个好搭档碰一碰，就会变成老大（隐形斗篷老大）！比如 1 的好搭档是 2，因为 1 碰 2 = 0（老大）。',
        task: '用「运算步骤」工具，选一个数字 a，然后点「逆元搜索」模式，看看谁是好搭档！',
        hint: '点「运算步骤可视化」下面的按钮，选「逆元搜索」模式，然后按 ▶ 播放！',
        successMsg: '太厉害了！每个数字都有自己的好搭档！大数学家叫它「逆元」！',
        actionLabel: '去找好搭档',
        actionTarget: 'explore',
      },
      {
        id: 'discover-assoc',
        phase: 'discover',
        title: '↔ 第 5 关：谁先谁后都一样？',
        story:
          '三个数字碰一碰时，先碰前两个再碰第三个，和先碰后两个再碰第一个，结果一样吗？比如 (1 碰 2) 再碰 1，和 1 碰 (2 碰 1)，会得到一样的答案吗？',
        task: '用「运算步骤」工具的「结合律」模式，选三个数字 a, b, c，看看 (a∗b)∗c 和 a∗(b∗c) 是不是一样！',
        hint: '如果不管谁先谁后结果都一样，这就是「谁先谁后都一样」的规则！大数学家叫它「结合律」',
        successMsg: '太神奇了！谁先谁后结果都一样！大数学家叫它「结合律」！',
        actionLabel: '去试试看',
        actionTarget: 'explore',
      },
      {
        id: 'discover-3',
        phase: 'discover',
        title: '○ 第 6 关：绕圈圈家族',
        story:
          '有些家族很特别：从老大开始，一直跟同一个人碰一碰，就能走遍所有人再回到老大！试试从 0 开始一直碰 1，看看会怎样。',
        task: '用「运算步骤」工具，选「绕圈圈」模式，选一个数字，看看绕几圈才回家！',
        hint: '如果 0→1→2→0，就是绕了 3 圈！圈数就是这个数字的「阶」。',
        successMsg: '你发现了绕圈圈家族！一个人就能变出所有人！',
        actionLabel: '去绕圈圈',
        actionTarget: 'explore',
      },
      {
        id: 'challenge-1',
        phase: 'challenge',
        title: '↔ 第 7 关：换位置也一样吗？',
        story:
          '两个数字碰一碰，交换位置后结果一样吗？比如 1 碰 2 和 2 碰 1，结果一样吗？注意：这是有些家族才有的额外本领，不是每个家族都有的哦！',
        task: '用「运算步骤」工具，选 a=1, b=2，看看 1∗2 和 2∗1 是否一样！然后试试 a=0 看看。',
        hint: '如果 1∗2 = 2∗1，就说明这对数字「换位置也一样」！如果所有数字对都这样，就叫「交换律」！注意：这是额外本领，不是群公理哦！',
        successMsg: '你发现了「换位置也一样」的规律！试试 S3 预设表，看看是不是所有表都这样！',
        actionLabel: '去试一试',
        actionTarget: 'explore',
      },
      {
        id: 'challenge-2',
        phase: 'challenge',
        title: '第 8 关：找小帮派',
        story:
          '大家族里可能藏着小帮派！小帮派自己也是一个完整的家族——有老大、有好搭档、不漏出去、谁先谁后都一样。试试在 4×4 表里找找有没有 2 个人的小帮派。',
        task: '加载 Klein 预设表（4×4），想想 {0, 1} 是不是一个小帮派？0+0=0 ✓，0+1=1 ✓，1+1=0 ✓，1 的好搭档是 1 自己！',
        hint: '在 Klein 表里，{0,1} 是小帮派！{0,2} 和 {0,3} 也是！每个小帮派都有 2 个人。',
        successMsg: '你找到了小帮派！大数学家叫它「子群」！',
        actionLabel: '去找小帮派',
        actionTarget: 'cayley',
      },
      {
        id: 'create-1',
        phase: 'create',
        title: '第 9 关：创造你自己的密码表',
        story:
          '现在你是魔法师了！试试自己设计一张密码表。记得四条规则：不能漏出去（数字在 0 到 2 之间）、要有一个老大（单位元行）、每个数字都要有好搭档（逆元）、谁先谁后都一样（结合律）！',
        task: '从空白表开始，试着填一个「不漏出去 + 有老大 + 有好搭档 + 谁先谁后都一样」的密码表。填好后点「验证动画」看看！',
        hint: '最简单的：让 0 当老大，然后让 1 和 2 互为好搭档（1∗2=0, 2∗1=0）',
        successMsg: '你创造了属于自己的魔法密码表！这就是一个「群」！',
        actionLabel: '去创造',
        actionTarget: 'cayley',
      },
      {
        id: 'reflect-1',
        phase: 'reflect',
        title: '第 10 关：你发现了什么？',
        story:
          '回顾你的冒险：你发现了「不漏出去的规则」、「隐形斗篷老大」、「好搭档」和「谁先谁后都一样」！这四件事就是数学家研究「群」时必看的四条公理！至于「换位置也一样」（交换律），那是有些群才有的额外本领，不是所有群都必须有的哦！',
        task: '在对话框里说说：你觉得「群」是什么？什么样的密码表才是一个「群」？「换位置也一样」是群必须有的吗？',
        hint: '一个「群」必须满足四条公理：1) 不漏出去（闭合性）2) 有老大（单位元）3) 每个数字有好搭档（逆元）4) 谁先谁后都一样（结合律）。「换位置也一样」（交换律）是额外性质，不是公理！',
        successMsg: '你已经像数学家一样思考了！你分清了群公理和额外性质！',
        actionLabel: '去说说看',
        actionTarget: 'chat',
      },
      {
        id: 'reflect-2',
        phase: 'reflect',
        title: '第 11 关：毕业挑战',
        story:
          '你已经掌握了所有基础！现在来终极挑战：用你学到的所有知识，解释为什么 S3 表不是一个「换位置也一样」的家族。',
        task: '在对话框里说说：S3 表里哪两个数字换位置后结果不同？为什么这说明它不是交换群？但它仍然是一个群吗？',
        hint: '看看 S3 表里，table[1][2] 和 table[2][1] 是不是不一样？不一样说明不满足交换律，但 S3 仍然满足四条群公理，所以它是一个（非交换）群！',
        successMsg: '恭喜毕业！你已经是真正的群论冒险家了！',
        actionLabel: '去毕业',
        actionTarget: 'chat',
      },
    ]
  }

  if (level === 'tweens') {
    return [
      {
        id: 'play-1',
        phase: 'play',
        title: '第 1 关：操作运算表',
        story:
          '运算表（也叫 Cayley 表）是研究群论的工具。修改表中的数字，观察验证徽章的变化。数字范围必须在 0 到 n-1 之间。',
        task: '修改几个单元格的值，观察「闭合性」「结合律」「交换律」徽章如何变化。',
        hint: '闭合性 = 所有结果都在 0~n-1 范围内。超出范围会标红。',
        successMsg: '✓ 你已经熟悉运算表的基本操作了。',
        actionLabel: '去编辑运算表',
        actionTarget: 'cayley',
      },
      {
        id: 'discover-1',
        phase: 'discover',
        title: '第 2 关：寻找单位元',
        story: '单位元 e 满足：e∗a = a 对所有 a 成立。在运算表中，就是「与列头完全相同的那一行」。',
        task: '观察运算表，找到满足 table[e][j] = j 的行 e。它会被高亮标记为「单位元」。',
        hint: '看哪一行的值依次是 0, 1, 2, ..., n-1？',
        successMsg: '✓ 找到了单位元！它是群结构的核心要素之一。',
        actionLabel: '去查看运算表',
        actionTarget: 'cayley',
      },
      {
        id: 'discover-2',
        phase: 'discover',
        title: '第 3 关：逆元与逆元搜索',
        story:
          '每个元素 a 的逆元 a⁻¹ 满足 a∗a⁻¹ = e（单位元）。用「运算步骤可视化」的逆元搜索模式，看系统如何逐个尝试找到逆元。',
        task: '在运算步骤可视化中选择「逆元搜索」模式，选择一个元素 a，然后播放动画。',
        hint: '系统会逐个尝试每个元素 b，检查 a∗b 是否等于单位元。',
        successMsg: '✓ 你看到了逆元搜索的完整过程！每个元素都有唯一的逆元。',
        actionLabel: '去看逆元搜索',
        actionTarget: 'explore',
      },
      {
        id: 'discover-assoc',
        phase: 'discover',
        title: '↔ 第 4 关：结合律探索',
        story:
          '三个元素运算时，(a∗b)∗c 和 a∗(b∗c) 是否相等？这就是结合律，群的四条公理之一。用运算步骤可视化观察两种运算顺序的结果。',
        task: '在运算步骤可视化中选择「结合律」模式，选三个元素 a, b, c，对比 (a∗b)∗c 和 a∗(b∗c)。',
        hint: '结合律：(a∗b)∗c = a∗(b∗c)。这是群公理中较难直接观察的一条，验证需要 O(n³) 次检查。',
        successMsg: '✓ 你验证了结合律！这是群公理中最难直接观察的一条。',
        actionLabel: '去试试看',
        actionTarget: 'explore',
      },
      {
        id: 'discover-3',
        phase: 'discover',
        title: '第 5 关：子群发现',
        story:
          '群中的某些子集自己也能构成群！在运算表中找一个子集 H，使得 H 中任意两元素的运算结果仍在 H 中，且 H 中每个元素的逆元也在 H 中。',
        task: '加载 Klein 四元群预设。验证 {0, 1} 是否构成子群：检查 0∗1, 1∗1 是否仍在 {0,1} 中，以及逆元。',
        hint: 'Klein 群中每个元素的逆元都是自己。{0,1}: 0∗0=0✓ 0∗1=1✓ 1∗0=1✓ 1∗1=0✓ — 闭合且含单位元和逆元，是子群！',
        successMsg: '✓ 你发现了一个子群！子群的阶整除群的阶（Lagrange 定理）。',
        actionLabel: '去验证子群',
        actionTarget: 'cayley',
      },
      {
        id: 'challenge-1',
        phase: 'challenge',
        title: '· 第 6 关：交换律与反例',
        story:
          '运算总是满足交换律吗？table[a][b] = table[b][a] 对所有 a, b 成立吗？加载 S3 预设表（非交换群的经典例子）观察。注意：交换律是额外性质，不是群公理！',
        task: '先加载 Z3 预设（交换群），再加载 S3 预设（非交换群）。对比交换律徽章的变化。用运算步骤可视化探索 a∗b 与 b∗a 的差异。',
        hint: 'S3（3阶对称群）是最小的非交换群。找出 table[a][b] ≠ table[b][a] 的那一对。注意：交换律不是群公理，满足它的群叫交换群（Abel 群）。',
        successMsg:
          '✓ 你发现了交换律不一定成立！反例是数学发现的重要工具。交换律不是群公理，满足它的群叫交换群（Abel 群）。',
        actionLabel: '去探索交换律',
        actionTarget: 'explore',
      },
      {
        id: 'challenge-2',
        phase: 'challenge',
        title: '第 7 关：循环子群',
        story:
          '从一个元素 a 出发，不断做运算 a, a², a³, ...，直到回到单位元。生成的集合就是循环子群 ⟨a⟩。',
        task: '在运算步骤可视化中选择「循环子群」模式，选一个元素，观察 ⟨a⟩ 的生成过程。',
        hint: 'a 的阶 = 回到单位元需要做几次运算。如果 a³ = e，则 a 的阶为 3。',
        successMsg: '✓ 你生成了循环子群！素数阶群都是循环群。',
        actionLabel: '去生成子群',
        actionTarget: 'explore',
      },
      {
        id: 'challenge-3',
        phase: 'challenge',
        title: '第 8 关：Lagrange 定理验证',
        story:
          'Lagrange 定理说：子群的阶一定整除群的阶。Klein 群有 4 个元素，它的子群阶只能是 1, 2, 4。不可能有 3 阶子群！',
        task: '在 Klein 四元群中找出所有子群：{0}, {0,1}, {0,2}, {0,3}, {0,1,2,3}。验证它们的阶 1,2,2,2,4 都整除 4。',
        hint: '4 的因数：1, 2, 4。没有 3 阶子群因为 3 不整除 4。这就是 Lagrange 定理的威力！',
        successMsg: '✓ 你验证了 Lagrange 定理！子群阶 | 因群阶。',
        actionLabel: '去验证',
        actionTarget: 'cayley',
      },
      {
        id: 'create-1',
        phase: 'create',
        title: '第 9 关：构造一个群',
        story:
          '综合运用所学：构造一个满足所有群公理的运算表（闭合、有单位元、有逆元、满足结合律）。',
        task: '从空白 4×4 表开始，手动填入一个 Klein 四元群或 Z4 循环群，然后用「验证动画」检查。',
        hint: 'Klein 四元群：每个元素都是自己的逆元。Z4：0→1→2→3→0 循环。',
        successMsg: '✓ 你成功构造了一个群！这就是从公理到实例的过程。',
        actionLabel: '去构造',
        actionTarget: 'cayley',
      },
      {
        id: 'create-2',
        phase: 'create',
        title: '第 10 关：构造陪集',
        story:
          '给定子群 H 和元素 a，左陪集 aH = {a∗h : h ∈ H}。所有左陪集划分群 G，大小相等且互不相交。这就是 Lagrange 定理的直观证明！',
        task: '在 Z₄ 中取 H={0,2}。计算陪集 0+H={0,2} 和 1+H={1,3}。两个陪集大小都是 2，正好覆盖 Z₄！',
        hint: 'Z₄: H={0,2}。0+H={0+0,0+2}={0,2}。1+H={1+0,1+2}={1,3}。两个陪集互不相交，合起来正好是整个 Z₄。',
        successMsg: '✓ 你构造了陪集！陪集是群论中最优雅的工具之一。',
        actionLabel: '去构造陪集',
        actionTarget: 'explore',
      },
      {
        id: 'reflect-1',
        phase: 'reflect',
        title: '第 11 关：总结与反思',
        story:
          '回顾整个发现过程：操作 → 单位元 → 逆元 → 结合律 → 交换律反例 → 子群 → 循环子群 → Lagrange → 构造群 → 陪集。这就是数学发现的 Lakatos 循环。',
        task: '在对话中总结：群论的四个公理分别对应了你刚才做的哪些操作？交换律是公理吗？为什么？',
        hint: '群公理四条：闭合性、结合律、单位元、逆元。交换律不是公理，是额外性质——满足它的群叫交换群（Abel 群），S₃ 就不满足。',
        successMsg: '✓ 你已经像数学家一样思考了群论的基本结构，并区分了公理与额外性质。',
        actionLabel: '去总结',
        actionTarget: 'chat',
      },
      {
        id: 'reflect-2',
        phase: 'reflect',
        title: '第 12 关：综合反思',
        story:
          '回顾完整旅程：公理 → 单位元 → 逆元 → 结合律 → 交换律 → 循环子群 → 构造群 → 子群 → Lagrange → 陪集。你已经从公理走到了群论的核心定理！',
        task: '在对话中解释：为什么 Lagrange 定理意味着素数阶群一定是循环群？（提示：素数 p 的因数只有 1 和 p）',
        hint: '如果 |G|=p（素数），则子群只有 {e} 和 G 本身。取任意非单位元 a，⟨a⟩ 的阶整除 p，所以 |⟨a⟩|=p，⟨a⟩=G。',
        successMsg: '✓ 太厉害了！你已经理解了素数阶群必循环的证明！',
        actionLabel: '去反思',
        actionTarget: 'chat',
      },
    ]
  }

  // teens — 完整学术流程
  return [
    {
      id: 'play-1',
      phase: 'play',
      title: 'Phase 1: Cayley Table Exploration',
      story:
        'The Cayley table encodes a binary operation on a finite set. Modify entries and observe how axiom satisfaction changes in real time.',
      task: 'Edit several cells. Watch the closure, associativity, and commutativity badges update.',
      hint: 'Closure: all entries in [0, n-1]. Out-of-range cells are flagged red.',
      successMsg: 'Familiar with the table interface.',
      actionLabel: 'Edit table',
      actionTarget: 'cayley',
    },
    {
      id: 'discover-1',
      phase: 'discover',
      title: 'Phase 2: Identify the Identity',
      story:
        'The identity element e satisfies e∗a = a for all a. In the table, this is the row identical to the column headers.',
      task: 'Locate the identity row. It will be highlighted automatically.',
      hint: 'Look for the row where table[e][j] = j for all j.',
      successMsg: 'Identity identified. Uniqueness follows from associativity.',
      actionLabel: 'View table',
      actionTarget: 'cayley',
    },
    {
      id: 'discover-2',
      phase: 'discover',
      title: 'Phase 3: Inverse Search',
      story:
        'For each a, the inverse a⁻¹ satisfies a∗a⁻¹ = e. Use the Operation Step Visualizer to watch the brute-force search.',
      task: 'Select "inverse" mode in the step visualizer, pick element a, and play the animation.',
      hint: 'In a group, every element has a unique inverse. This follows from the other axioms.',
      successMsg: 'Inverse found. Uniqueness is provable from associativity + identity.',
      actionLabel: 'Search inverse',
      actionTarget: 'explore',
    },
    {
      id: 'discover-assoc',
      phase: 'discover',
      title: 'Phase 4: Associativity Exploration',
      story:
        'Associativity requires (a∗b)∗c = a∗(b∗c) for all a, b, c ∈ G. This is one of the four group axioms. Use the step visualizer to compare both bracketings.',
      task: 'Select "associativity" mode in the step visualizer. Pick three elements a, b, c and verify table[table[a][b]][c] = table[a][table[b][c]].',
      hint: 'Associativity is the hardest axiom to verify by brute force: O(n³) checks. Most algebraic structures satisfy it, but not all.',
      successMsg: 'Associativity verified. This is one of the four group axioms.',
      actionLabel: 'Try it',
      actionTarget: 'explore',
    },
    {
      id: 'discover-3',
      phase: 'discover',
      title: 'Phase 5: Subgroup Lattice',
      story:
        "Subgroups of G form a lattice under inclusion. For finite groups, Lagrange's theorem constrains which orders are possible. Explore the full subgroup structure.",
      task: 'Load the Klein four-group V₄. Find all subgroups: {e}, ⟨a⟩={e,a}, ⟨b⟩={e,b}, ⟨c⟩={e,c}, V₄. Draw the lattice.',
      hint: 'V₄ = {e,a,b,c} where every element has order 2. Subgroups: 1 trivial + 3 order-2 + 1 whole group = 5 total. All subgroups are normal (V₄ is abelian).',
      successMsg: 'Subgroup lattice constructed. The lattice is a poset under ⊆.',
      actionLabel: 'Explore subgroups',
      actionTarget: 'cayley',
    },
    {
      id: 'challenge-1',
      phase: 'challenge',
      title: 'Phase 6: Non-commutative Counterexample',
      story:
        'Not all groups are abelian. Load S3 (symmetric group on 3 elements) and find a pair where a∗b ≠ b∗a. Note: commutativity is an extra property, not a group axiom.',
      task: 'Load the S3 preset. Find a pair (a, b) where table[a][b] ≠ table[b][a]. Compare with Z3 where commutativity holds.',
      hint: 'S3 is the smallest non-abelian group (order 6). Check transpositions: (12)∘(13) ≠ (13)∘(12).',
      successMsg:
        'Counterexample found. Commutativity is not a group axiom — abelian groups are a special subclass.',
      actionLabel: 'Explore S3',
      actionTarget: 'explore',
    },
    {
      id: 'challenge-2',
      phase: 'challenge',
      title: 'Phase 7: Cyclic Subgroup Generation',
      story:
        'The cyclic subgroup ⟨a⟩ = {a⁰, a¹, a², ...} is generated by repeatedly applying the operation. It terminates when aᵏ = e.',
      task: 'Use "cyclic subgroup" mode to generate ⟨a⟩ for various elements. Observe how order relates to group structure.',
      hint: "By Lagrange's theorem, |⟨a⟩| divides |G|. Try elements of different orders in S3.",
      successMsg: 'Subgroup generated. Cyclic groups are the simplest group structure.',
      actionLabel: 'Generate subgroup',
      actionTarget: 'explore',
    },
    {
      id: 'challenge-2',
      phase: 'challenge',
      title: 'Phase 8: Cosets and Lagrange',
      story:
        "Left cosets aH = {ah : h ∈ H} partition G into equal-sized blocks. The number of cosets [G:H] = |G|/|H|. This partition proof yields Lagrange's theorem.",
      task: 'In S₃, take H = ⟨(12)⟩ = {e, (12)}. Compute all left cosets: eH, (13)H, (23)H. Verify they partition S₃.',
      hint: 'Left cosets of H={e,(12)} in S₃: eH={e,(12)}, (13)H={(13),(132)}, (23)H={(23),(123)}. Three cosets, each size 2. [S₃:H] = 6/2 = 3. ✓',
      successMsg: "Coset partition verified. This is the proof skeleton of Lagrange's theorem.",
      actionLabel: 'Compute cosets',
      actionTarget: 'explore',
    },
    {
      id: 'create-1',
      phase: 'create',
      title: 'Phase 9: Construct a Group',
      story:
        'Synthesize your understanding: construct a valid group table from scratch. Verify all four axioms (closure, associativity, identity, inverse).',
      task: 'Start from a blank 4×4 table. Construct either Z4 (cyclic) or V4 (Klein four-group). Run verification.',
      hint: 'Z4: 0→1→2→3→0. V4: every element is its own inverse, all non-identity elements have order 2.',
      successMsg: "Valid group constructed. You've gone from axioms to a concrete instance.",
      actionLabel: 'Construct',
      actionTarget: 'cayley',
    },
    {
      id: 'create-2',
      phase: 'create',
      title: 'Phase 10: Homomorphism & Isomorphism',
      story:
        "A homomorphism φ: G → G' preserves the operation: φ(ab) = φ(a)φ(b). An isomorphism is a bijective homomorphism. The kernel ker(φ) is always a normal subgroup.",
      task: "Verify that φ: Z₄ → Z₂ defined by φ(x) = x mod 2 is a homomorphism. Compute ker(φ) = {0, 2} and verify it's a normal subgroup of Z₄.",
      hint: 'φ(a+b) = (a+b) mod 2 = (a mod 2 + b mod 2) = φ(a) + φ(b) ✓. ker(φ) = {x : φ(x)=0} = {0,2}. Z₄ is abelian so all subgroups are normal. Z₄/ker(φ) ≅ Z₂ (First Isomorphism Theorem).',
      successMsg:
        'Homomorphism verified. The First Isomorphism Theorem connects kernels, quotients, and images.',
      actionLabel: 'Verify homomorphism',
      actionTarget: 'chat',
    },
    {
      id: 'reflect-1',
      phase: 'reflect',
      title: 'Phase 11: Reflect',
      story:
        'Review the four group axioms: closure, associativity, identity, inverse. These are the necessary conditions for a group. Commutativity (abelian property) is an extra property, not an axiom — S₃ satisfies all axioms but is not abelian. This is the Lakatos discovery cycle.',
      task: 'Summarize in the chat: which axiom corresponds to which property you verified? Why is commutativity not required for a group? What distinguishes a group from an abelian group?',
      hint: 'The four group axioms: closure, associativity, identity, inverse. Commutativity is an extra property — groups satisfying it are called abelian (Abel groups). S₃ is a non-abelian group.',
      successMsg:
        "You've completed the discovery cycle and distinguished axioms from extra properties.",
      actionLabel: 'Summarize',
      actionTarget: 'chat',
    },
    {
      id: 'reflect-2',
      phase: 'reflect',
      title: 'Phase 12: Synthesis',
      story:
        "Complete cycle: axioms → structure → subgroups → cosets → Lagrange → homomorphisms → isomorphism theorems. You've traversed the core of finite group theory.",
      task: "Explain in chat: Why does Lagrange's theorem imply that every group of prime order is cyclic? How does this connect to the subgroup structure?",
      hint: 'If |G| = p (prime), the only subgroups are {e} and G (since 1 and p are the only divisors). For any a ≠ e, |⟨a⟩| divides p, so |⟨a⟩| = p, meaning ⟨a⟩ = G. Thus G is cyclic.',
      successMsg: "You've mastered the fundamental theorem connecting axioms to structure.",
      actionLabel: 'Synthesize',
      actionTarget: 'chat',
    },
  ]
}

/**
 * 阶段元数据
 */
export const PHASE_META: Record<
  GuidedMission['phase'],
  { icon: string; color: string; label: Record<AgeLevel, string> }
> = {
  play: {
    icon: '',
    color: '#2C7A9E',
    label: { kids: '玩一玩', tweens: '操作', teens: 'Explore' },
  },
  discover: {
    icon: '',
    color: '#8A6A1F',
    label: { kids: '找一找', tweens: '发现', teens: 'Discover' },
  },
  challenge: {
    icon: '·',
    color: '#9A3B2E',
    label: { kids: '挑战', tweens: '挑战', teens: 'Challenge' },
  },
  create: {
    icon: '',
    color: '#6B6259',
    label: { kids: '创造', tweens: '构造', teens: 'Construct' },
  },
  reflect: {
    icon: '',
    color: '#3D4F7A',
    label: { kids: '想一想', tweens: '反思', teens: 'Reflect' },
  },
}

/**
 * 年龄等级配置
 */
export const AGE_LEVELS: {
  id: AgeLevel
  label: string
  range: string
  emoji: string
  desc: string
}[] = [
  { id: 'kids', label: '小学', range: '8-10 岁', emoji: '', desc: '游戏化语言，完全用生活隐喻' },
  { id: 'tweens', label: '初中', range: '11-13 岁', emoji: '', desc: '半学术语言，保留直觉入口' },
  {
    id: 'teens',
    label: '高中及以上',
    range: '14+ 岁',
    emoji: '',
    desc: '完整学术术语，严谨表达',
  },
]

// ===================================================================
// 知识卡片系统 — 完成任务后解锁的概念详解
// ===================================================================

export interface KnowledgeCard {
  id: string
  conceptKey: string
  icon: string
  title: Record<AgeLevel, string>
  body: Record<AgeLevel, string>
  example: Record<AgeLevel, string>
  unlockAfter: string[]
}

export const KNOWLEDGE_CARDS: KnowledgeCard[] = [
  {
    id: 'card-closure',
    conceptKey: 'closure',
    icon: '',
    title: { kids: '不漏出去的规则', tweens: '闭合性 (Closure)', teens: 'Closure Axiom' },
    body: {
      kids: '如果两个数字碰一碰，结果还在 0 到 n-1 之间，没有「漏」出去，这就叫「不漏出去的规则」！这是成为「群」的第一条规则。',
      tweens:
        '闭合性：对于群 G 中任意两个元素 a, b，运算 a∗b 的结果仍属于 G。在运算表中，所有格子的值都必须在 0 到 n-1 范围内。',
      teens:
        'Closure: ∀ a, b ∈ G, a∗b ∈ G. In the Cayley table, every entry must be a valid element of G. This is the first group axiom — the operation maps G×G → G.',
    },
    example: {
      kids: '在 3×3 表里，1 碰 2 = 0 没漏出去 ✓。但如果某个格子 = 3，就漏出去了 ×！',
      tweens: 'Z₃ 中 1+2 = 0 ∈ {0,1,2} ✓。若某格 = 3，则违反闭合性 ×。',
      teens: 'In Z₃: 1+2 ≡ 0 (mod 3) ∈ Z₃ ✓. A value of 3 violates closure ×.',
    },
    unlockAfter: ['play-2'],
  },
  {
    id: 'card-identity',
    conceptKey: 'identity',
    icon: 'â',
    title: { kids: '隐形斗篷老大', tweens: '单位元 (Identity)', teens: 'Identity Element' },
    body: {
      kids: '老大有一个神奇斗篷：它跟谁碰一碰，谁就不变！比如老大是 0，那 0 碰 1 = 1，0 碰 2 = 2。每个群只有一个老大！',
      tweens:
        '单位元 e 满足：e∗a = a∗e = a，对所有 a 成立。在运算表中，就是与列头（行头）完全相同的那一行（列）。单位元是唯一的。',
      teens:
        'The identity e satisfies e∗a = a∗e = a ∀a∈G. In the Cayley table, the identity row equals the column headers and vice versa. Uniqueness follows from associativity.',
    },
    example: {
      kids: '在 Z₃ 里，0 是老大：0 碰 1 = 1，0 碰 2 = 2，0 碰 0 = 0。',
      tweens: 'Z₃ 中 e=0：0+1=1, 0+2=2, 0+0=0。运算表第 0 行 = [0,1,2]。',
      teens:
        'In Z₃: e=0. Row 0 = [0,1,2] = column headers. Proof of uniqueness: if e, e′ both identities, e = e∗e′ = e′.',
    },
    unlockAfter: ['discover-1'],
  },
  {
    id: 'card-inverse',
    conceptKey: 'inverse',
    icon: '',
    title: { kids: '好搭档', tweens: '逆元 (Inverse)', teens: 'Inverse Element' },
    body: {
      kids: '每个数字都有自己的好搭档！两个好搭档碰一碰就变成老大（0）。比如 1 的好搭档是 2，因为 1 碰 2 = 0。',
      tweens:
        '元素 a 的逆元 a⁻¹ 满足 a∗a⁻¹ = a⁻¹∗a = e。在运算表中，就是找到值为单位元的那一列。逆元是唯一的。',
      teens:
        'The inverse a⁻¹ satisfies a∗a⁻¹ = a⁻¹∗a = e. In the table, find column j where table[a][j] = e. Uniqueness: if b, b′ are both inverses of a, then b = b∗e = b∗(a∗b′) = (b∗a)∗b′ = e∗b′ = b′.',
    },
    example: {
      kids: 'Z₃ 中：1 的好搭档是 2（1+2=0），2 的好搭档是 1（2+1=0），0 的好搭档是自己（0+0=0）！',
      tweens: 'Z₃：1⁻¹=2, 2⁻¹=1, 0⁻¹=0。Klein 四元群：每个元素的逆元都是自己！',
      teens:
        'Z₃: 1⁻¹=2, 2⁻¹=1, 0⁻¹=0. In V₄ (Klein): every element is self-inverse (a²=e ∀a). In Z₄: 1⁻¹=3, 2⁻¹=2, 3⁻¹=1.',
    },
    unlockAfter: ['discover-2'],
  },
  {
    id: 'card-associativity',
    conceptKey: 'associativity',
    icon: '↔',
    title: {
      kids: '谁先谁后都一样',
      tweens: '结合律 (Associativity)',
      teens: 'Associativity Axiom',
    },
    body: {
      kids: '三个数字碰一碰时，先碰哪两个再碰第三个，结果都一样！就像搭积木：先搭左边再搭右边，还是先搭右边再搭左边，最后积木一样高。',
      tweens:
        '结合律：(a∗b)∗c = a∗(b∗c)。在运算表中验证时，先查 a∗b 再查结果∗c，跟先查 b∗c 再查 a∗结果，答案相同。',
      teens:
        'Associativity: (a∗b)∗c = a∗(b∗c) ∀a,b,c∈G. In the table: table[table[a][b]][c] = table[a][table[b][c]]. This is the hardest axiom to verify by brute force — O(n³) checks.',
    },
    example: {
      kids: 'Z₃：(1 碰 2) 碰 1 = 0 碰 1 = 1。1 碰 (2 碰 1) = 1 碰 0 = 1。两边一样！',
      tweens: 'Z₃：(1+2)+1 = 0+1 = 1。1+(2+1) = 1+0 = 1。✓。S₃ 中某些三元组不满足！',
      teens:
        'Z₃: (1+2)+1 = 0+1 = 1 = 1+(2+1) = 1+0 ✓. In S₃, associativity holds (it is a group axiom), but commutativity does not.',
    },
    unlockAfter: ['challenge-1'],
  },
  {
    id: 'card-commutativity',
    conceptKey: 'commutativity',
    icon: '·',
    title: {
      kids: '换位置也一样',
      tweens: '交换律 (Commutativity)',
      teens: 'Commutativity / Abelian',
    },
    body: {
      kids: '有些密码表有特别的本领：两个数字碰一碰，谁先谁后结果都一样！这叫「换位置也一样」。但不是所有表都这样哦！',
      tweens:
        '交换律：a∗b = b∗a。满足交换律的群叫交换群（Abel 群）。运算表关于对角线对称。S₃ 是最小的非交换群。',
      teens:
        'Commutativity: a∗b = b∗a ∀a,b∈G. An Abelian group satisfies this. The Cayley table is symmetric about the main diagonal. S₃ (order 6) is the smallest non-abelian group.',
    },
    example: {
      kids: 'Z₃ 是交换群：1+2 = 2+1 = 0。但 S₃ 不是：有些数字换位置结果不同！',
      tweens: 'Z₃ 交换 ✓（表关于对角线对称）。S₃ 不交换 ×（存在 a,b 使 a∗b≠b∗a）。',
      teens:
        'Z₃ is abelian: table symmetric ✓. S₃ is non-abelian: e.g. (12)∘(13) ≠ (13)∘(12). Abelian groups have simpler structure (all subgroups are normal).',
    },
    unlockAfter: ['challenge-1'],
  },
  {
    id: 'card-cyclic',
    conceptKey: 'cyclic_group',
    icon: '○',
    title: { kids: '绕圈圈家族', tweens: '循环群 (Cyclic Group)', teens: 'Cyclic Group' },
    body: {
      kids: '有些家族里，一个人就能变出所有人！从老大开始，不停地跟同一个人碰一碰，就能走遍所有人再回到老大。这就是绕圈圈家族！',
      tweens:
        '循环群 ⟨a⟩：从一个元素 a 出发，a⁰=e, a¹=a, a²=a∗a, ... 直到 aᵏ=e。如果能生成整个群 G，则 G 是循环群，a 是生成元。',
      teens:
        'A cyclic group G = ⟨g⟩ is generated by a single element g: G = {g⁰=e, g¹, g², ..., g^(n-1)} where gⁿ = e. All cyclic groups of order n are isomorphic to Zₙ. Every subgroup of a cyclic group is cyclic.',
    },
    example: {
      kids: 'Z₃ 是绕圈圈家族：从 0 开始，一直碰 1：0→1→2→0。绕了 3 圈回家！',
      tweens: 'Z₄ = ⟨1⟩：1¹=1, 1²=2, 1³=3, 1⁴=0。生成元是 1（或 3）。Z₃ = ⟨1⟩。',
      teens:
        'Z₄ = ⟨1⟩: {0,1,2,3}. Generators: {1,3}. Subgroups: ⟨0⟩={0}, ⟨2⟩={0,2}, ⟨1⟩=Z₄. All subgroups of cyclic groups are cyclic.',
    },
    unlockAfter: ['challenge-2'],
  },
  {
    id: 'card-subgroup',
    conceptKey: 'subgroup',
    icon: '',
    title: { kids: '家族里的小帮派', tweens: '子群 (Subgroup)', teens: 'Subgroup' },
    body: {
      kids: '有时候大家族里藏着小帮派！小帮派自己也是个完整的家族——有老大、有好搭档、不漏出去。最小的帮派只有老大一个人！',
      tweens:
        '子群 H ≤ G：H 是 G 的子集，且 H 在 G 的运算下也构成群。{e} 和 G 本身是平凡子群。子群的阶整除群的阶（Lagrange 定理）。',
      teens:
        "A subgroup H ≤ G is a subset closed under the operation and inverses. Trivial subgroups: {e} and G. By Lagrange's theorem, |H| divides |G|. The set of all subgroups forms a lattice under inclusion.",
    },
    example: {
      kids: 'Z₄ = {0,1,2,3} 里，{0,2} 是小帮派：0+0=0, 0+2=2, 2+2=0 都没漏出去！',
      tweens: 'Z₄ 的子群：{0}, {0,2}, {0,1,2,3}。S₃ 的子群：{e}, ⟨(12)⟩, ⟨(13)⟩, ⟨(23)⟩, A₃, S₃。',
      teens:
        'Z₄ subgroups: {0}, ⟨2⟩={0,2}, Z₄. S₃ subgroups: 6 total — {e}, 3×⟨(ij)⟩≅Z₂, ⟨(123)⟩≅Z₃, S₃. Subgroup lattice is a poset.',
    },
    unlockAfter: ['challenge-2'],
  },
  {
    id: 'card-lagrange',
    conceptKey: 'lagrange',
    icon: '',
    title: { kids: '大帮派切成小帮派', tweens: 'Lagrange 定理', teens: "Lagrange's Theorem" },
    body: {
      kids: '一个大帮派可以切成一样大的小队！比如 6 个人的帮派可以切成 3 个 2 人小队，或 2 个 3 人小队。小队的人数一定能整除大帮派的总人数！',
      tweens:
        'Lagrange 定理：如果 H 是有限群 G 的子群，则 |H| 整除 |G|。商 |G|/|H| 叫做 H 在 G 中的指数 [G:H]。',
      teens:
        'Lagrange: If H ≤ G and |G| finite, then |H| divides |G|. The quotient [G:H] = |G|/|H| counts the number of left cosets. Proof uses coset partition: left cosets of H partition G into equal-sized blocks.',
    },
    example: {
      kids: '6 人的 S₃ 帮派：可以有 2 人小帮派（3 个）或 3 人小帮派（2 个）。但不能有 4 人小帮派，因为 4 不能整除 6！',
      tweens:
        '|S₃|=6。子群阶只能是 1,2,3,6。没有 4 阶子群（4∤6）。|Z₆|=6，⟨2⟩={0,2,4} 阶 3，6/3=2 个陪集。',
      teens:
        '|S₃|=6. Possible subgroup orders: 1,2,3,6 (divisors of 6). No order-4 subgroup. Left cosets of H={e,(12)}: {e,(12)}, {(13),(132)}, {(23),(123)} — 3 cosets, [S₃:H]=3.',
    },
    unlockAfter: ['challenge-2'],
  },
  {
    id: 'card-coset',
    conceptKey: 'coset',
    icon: '',
    title: { kids: '排队分组', tweens: '陪集 (Coset)', teens: 'Coset' },
    body: {
      kids: '把大家族里的人排成小队，每队都有一个队长。队长不同，队伍就不同。所有小队加起来正好是整个家族，一个人不漏、不重复！',
      tweens:
        '左陪集 aH = {a∗h : h ∈ H}。所有左陪集划分 G，大小相等且互不相交。陪集数 = [G:H] = |G|/|H|。',
      teens:
        'Left coset aH = {ah : h ∈ H}. Right coset Ha = {ha : h ∈ H}. Cosets partition G into equal-sized blocks. aH = bH iff a⁻¹b ∈ H. If aH = Ha ∀a, H is normal (H ◁ G).',
    },
    example: {
      kids: 'S₃ 里，以 {0,1} 为小帮派，2 的队伍是 {2,3}，3 的队伍是 {3,2}——哦不，要看具体运算！',
      tweens: 'Z₆ 中 H={0,2,4}。陪集：0+H={0,2,4}, 1+H={1,3,5}。两个陪集，每个 3 人，正好覆盖 Z₆。',
      teens:
        'Z₆, H={0,2,4}: cosets 0+H={0,2,4}, 1+H={1,3,5}. [G:H]=2. In S₃, H={e,(12)}: left cosets differ from right cosets — H is not normal.',
    },
    unlockAfter: ['challenge-2'],
  },
  {
    id: 'card-isomorphism',
    conceptKey: 'isomorphism',
    icon: '',
    title: { kids: '双胞胎家族', tweens: '同构 (Isomorphism)', teens: 'Isomorphism' },
    body: {
      kids: '有些家族虽然名字不同，但长得一模一样！就像双胞胎，他们的密码表只是数字换了名字，碰一碰的结果完全对应。这就是「双胞胎家族」！',
      tweens:
        "同构 φ: G → G' 是双射，满足 φ(a∗b) = φ(a)∗'φ(b)。同构的群结构完全相同，只是元素「换了标签」。",
      teens:
        'An isomorphism φ: G → G′ is a bijection preserving the operation: φ(a∗b) = φ(a)∗′φ(b). Isomorphic groups (G ≅ G′) have identical structure — only element labels differ. There are 2 groups of order 4 up to isomorphism: Z₄ and V₄.',
    },
    example: {
      kids: 'Z₂ 和「翻转家族」是双胞胎！0=不翻，1=翻。翻两次 = 不翻 = 0+0=0！',
      tweens: 'Z₄ ≄ V₄（Klein）：Z₄ 有阶 4 元素，V₄ 所有非单位元阶 2。Z₂×Z₂ ≅ V₄。',
      teens:
        'Z₄ ≇ V₄: Z₄ has an element of order 4; V₄ has none (max order 2). Z₂×Z₂ ≅ V₄. Classification: 1 group of order 1-3, 2 of order 4, 1 of order 5 (cyclic), 2 of order 6.',
    },
    unlockAfter: ['create-1'],
  },
]

// ===================================================================
// 成就系统 — 学习里程碑徽章
// ===================================================================

export interface AchievementDef {
  id: string
  icon: string
  title: Record<AgeLevel, string>
  desc: Record<AgeLevel, string>
  condition: {
    type: 'missions_completed' | 'stars_collected' | 'modes_completed' | 'all_done'
    count?: number
  }
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-step',
    icon: '',
    title: { kids: '初出茅庐', tweens: '初步探索', teens: 'First Step' },
    desc: { kids: '完成第一个任务！', tweens: '完成第一个任务', teens: 'Complete first mission' },
    condition: { type: 'missions_completed', count: 1 },
  },
  {
    id: 'halfway',
    icon: '',
    title: { kids: '过半啦！', tweens: '过半成就', teens: 'Halfway There' },
    desc: { kids: '完成一半任务！', tweens: '完成一半任务', teens: 'Complete half the missions' },
    condition: { type: 'missions_completed', count: 6 },
  },
  {
    id: 'star-collector',
    icon: '',
    title: { kids: '星星收集者', tweens: '星星收集者', teens: 'Star Collector' },
    desc: { kids: '收集 3 颗星星！', tweens: '收集 3 颗星星', teens: 'Collect 3 stars' },
    condition: { type: 'stars_collected', count: 3 },
  },
  {
    id: 'star-master',
    icon: '',
    title: { kids: '星星大师', tweens: '星星大师', teens: 'Star Master' },
    desc: { kids: '收集 5 颗星星！', tweens: '收集 5 颗星星', teens: 'Collect 5 stars' },
    condition: { type: 'stars_collected', count: 5 },
  },
  {
    id: 'mode-explorer',
    icon: '',
    title: { kids: '模式探险家', tweens: '模式探索者', teens: 'Mode Explorer' },
    desc: {
      kids: '完成 3 种运算模式！',
      tweens: '完成 3 种运算模式',
      teens: 'Complete 3 operation modes',
    },
    condition: { type: 'modes_completed', count: 3 },
  },
  {
    id: 'all-modes',
    icon: '',
    title: { kids: '全部通关', tweens: '全模式通关', teens: 'All Modes' },
    desc: {
      kids: '完成所有运算模式！',
      tweens: '完成所有运算模式',
      teens: 'Complete all operation modes',
    },
    condition: { type: 'modes_completed', count: 4 },
  },
  {
    id: 'group-master',
    icon: '',
    title: { kids: '群论大师', tweens: '群论达人', teens: 'Group Theorist' },
    desc: { kids: '完成全部冒险！', tweens: '完成全部任务', teens: 'Complete all missions' },
    condition: { type: 'all_done' },
  },
]

/**
 * 根据完成状态检查解锁的成就
 */
export function checkAchievements(
  missionsCompleted: number,
  starsCollected: number,
  modesCompleted: number,
  totalMissions: number,
): string[] {
  const unlocked: string[] = []
  for (const a of ACHIEVEMENTS) {
    if (
      a.condition.type === 'missions_completed' &&
      a.condition.count &&
      missionsCompleted >= a.condition.count
    ) {
      unlocked.push(a.id)
    }
    if (
      a.condition.type === 'stars_collected' &&
      a.condition.count &&
      starsCollected >= a.condition.count
    ) {
      unlocked.push(a.id)
    }
    if (
      a.condition.type === 'modes_completed' &&
      a.condition.count &&
      modesCompleted >= a.condition.count
    ) {
      unlocked.push(a.id)
    }
    if (a.condition.type === 'all_done' && missionsCompleted >= totalMissions) {
      unlocked.push(a.id)
    }
  }
  return unlocked
}

/**
 * 检查哪些知识卡片已解锁
 */
export function getUnlockedCards(completedMissionIds: Set<string>): KnowledgeCard[] {
  return KNOWLEDGE_CARDS.filter(card => card.unlockAfter.some(id => completedMissionIds.has(id)))
}

// ===================================================================
// 故事场景 — 可视化故事教学
// ===================================================================

export interface StoryScene {
  id: string
  conceptKey: string
  icon: string
  title: Record<AgeLevel, string>
  scenes: {
    text: Record<AgeLevel, string>
    visual: string
  }[]
}

export const STORY_SCENES: StoryScene[] = [
  {
    id: 'story-birthday-party',
    conceptKey: 'group',
    icon: '',
    title: {
      kids: '生日派对的秘密',
      tweens: '从生日派对到群',
      teens: 'Group Structure via Birthday Party',
    },
    scenes: [
      {
        text: {
          kids: '小明过生日，请了 3 个好朋友：小红、小蓝、小绿。他们围坐一圈，准备切蛋糕。',
          tweens: '想象 3 个朋友围坐一圈。每个人都有一个位置。交换座位就是一种「变换」。',
          teens:
            'Consider 3 people at a round table. Each seating arrangement is a permutation. The set of all arrangements forms S₃.',
        },
        visual: '\n● ● ●\n  ',
      },
      {
        text: {
          kids: '小绿跟小红换了座位！现在顺序变了。这就像密码表里 1 碰 2 变成了 0。',
          tweens: '交换两个人的座位 = 对换 (transposition)。两次对换 = 回到原位。这对应 a² = e。',
          teens:
            'A transposition (ij) swaps positions i,j. It has order 2: (ij)² = e. The 3 transpositions generate S₃.',
        },
        visual: '↔\n● ● ● → ● ● ●',
      },
      {
        text: {
          kids: '如果所有人一起往右挪一位，就像循环！这跟绕圈圈家族一模一样。',
          tweens: '循环移动 = (123)。三次循环回到原位。⟨(123)⟩ = {e, (123), (132)} ≅ Z₃。',
          teens:
            'The 3-cycle (123) generates a cyclic subgroup of order 3: {e, (123), (132)} ≅ Z₃. This is A₃, the alternating group.',
        },
        visual: '○\n●→●→●→●',
      },
      {
        text: {
          kids: '所有可能的换座位方式加起来，就是 6 种！这就是一个有 6 个人的大家族——S₃！',
          tweens: '|S₃| = 3! = 6。包含 3 个对换和 2 个 3-循环 + 单位元。S₃ 是最小的非交换群。',
          teens:
            '|S₃| = 6 = 3!. Elements: e, (12), (13), (23), (123), (132). S₃ is the smallest non-abelian group. Its subgroup lattice has 6 subgroups.',
        },
        visual: '\n  e\n (12)(13)(23)\n(123)(132)\n  S₃',
      },
    ],
  },
  {
    id: 'story-snowflake',
    conceptKey: 'dihedral_group',
    icon: '✿',
    title: {
      kids: '雪花的魔法',
      tweens: '雪花与二面体群',
      teens: 'Dihedral Group Dₙ via Snowflake',
    },
    scenes: [
      {
        text: {
          kids: '看看这片雪花！它有 6 个尖尖。如果你转它一下，看起来还是一样的！这就是魔法的秘密。',
          tweens: '正六边形旋转 60° 后看起来不变。这种「不变」的变换构成了二面体群 D₆。',
          teens:
            'A regular hexagon has 12 symmetries: 6 rotations + 6 reflections. These form the dihedral group D₆ of order 12.',
        },
        visual: '✿\n  /\\\n /  \\\n|    |\n \\  /\n  \\/',
      },
      {
        text: {
          kids: '转 60 度，转 120 度，转 180 度……转 6 次就回到原样！就像绕了 6 圈。',
          tweens: '旋转：r(60°), r²(120°), r³(180°), r⁴(240°), r⁵(300°), r⁶=e。⟨r⟩ ≅ Z₆。',
          teens:
            'Rotations: r^k for k=0..5, r⁶=e. ⟨r⟩ ≅ Z₆ is the rotation subgroup (index 2, hence normal).',
        },
        visual: '↔ 60° → 120° → 180° → 240° → 300° → 360°=e',
      },
      {
        text: {
          kids: '现在把雪花翻个面！翻转后也还是一样的雪花。翻转两次 = 没翻！',
          tweens: '反射 s：s² = e。旋转和反射的组合：sr ≠ rs（非交换！）。sr = r⁻¹s。',
          teens:
            'Reflection s: s²=e. Key relation: srs = r⁻¹, or sr = r⁻¹s. Dₙ = ⟨r, s | rⁿ=e, s²=e, srs=r⁻¹⟩. Non-abelian for n≥3.',
        },
        visual: ' s² = e\nsr = r⁻¹s ≠ rs',
      },
      {
        text: {
          kids: '6 种转法 + 6 种翻法 = 12 种魔法！这就是「翻翻转转团」D₆！',
          tweens: '|D₆| = 12 = 2×6。子群包括 ⟨r⟩ ≅ Z₆ 和 6 个反射子群 ≅ Z₂。',
          teens:
            '|D₆| = 12. Subgroups: ⟨r⟩≅Z₆ (normal), 3×⟨rᵏ, s⟩≅D₂, 6×⟨s⟩≅Z₂. D₆ has 16 subgroups total.',
        },
        visual: '✿ D₆\n|D₆| = 12\n6 rotations + 6 reflections',
      },
    ],
  },
  {
    id: 'story-rubik-cube',
    conceptKey: 'symmetric_group',
    icon: '',
    title: {
      kids: '魔方的秘密',
      tweens: '魔方与群论',
      teens: "Rubik's Cube Group",
    },
    scenes: [
      {
        text: {
          kids: '你知道吗？魔方其实是一个超级大家族！每次转一面就是一种「魔法」。',
          tweens: '魔方群：所有合法操作的集合。|G| ≈ 4.3×10¹⁹，但每个状态都能在 20 步内还原！',
          teens:
            "The Rubik's Cube group has order |G| = 43,252,003,274,489,856,000 ≈ 4.3×10¹⁹. God's number = 20 (max moves to solve any state).",
        },
        visual: '\n●●●\n●●○',
      },
      {
        text: {
          kids: '不管你怎么转，都不可能只换两块！这就像群论里的规则——有些事就是做不到。',
          tweens:
            '魔方群不是 S₄₈（所有置换），因为受限于物理约束：角块和棱块分别置换，且奇偶性约束。',
          teens:
            'G is a subgroup of (S₈ × S₁₂) ⋊ (Z₃)⁸ × (Z₂)¹². Parity constraint: corner permutation parity = edge permutation parity. Index [S₄₈:G] = 12.',
        },
        visual: '↔\nCorner: S₈ ∩ A₈\nEdge: S₁₂ ∩ A₁₂',
      },
      {
        text: {
          kids: '如果你只转一个面 4 次，就回到原样了！这就是绕圈圈——转 4 次回家。',
          tweens: '单面旋转 r 的阶 = 4：r⁴ = e。⟨r⟩ ≅ Z₄。整个魔方群由 6 个面旋转生成。',
          teens:
            'Each face turn has order 4. G = ⟨U, D, L, R, F, B⟩. The commutator subgroup [G,G] has index 2 (only even permutations are reachable).',
        },
        visual: '○ r⁴ = e\n6 generators → |G| ≈ 4.3×10¹⁹',
      },
    ],
  },
]
