/**
 * BM25-based RAG retrieval system.
 *
 * Ported from Python backend (backend/mathweaver/rag/retriever.py).
 *
 * 为 MathWeaver 智能体系统提供轻量级知识检索层。使用 Okapi BM25 排序算法，
 * 配合支持中英文混合文本的分词器。纯标准库实现——不依赖任何外部库。
 *
 * 分词器：
 *   英文/ASCII 文本按空格和标点分割为单词；
 *   中文文本（CJK 统一表意文字）按字符二元组（bigram）分割以实现子词匹配，
 *   单个孤立中文字符保留为一元组（unigram）。
 *
 * BM25 参数：
 *   k1 = 1.5  （词频饱和参数）
 *   b  = 0.75 （长度归一化强度）
 */

import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('RAG')

// ---------------------------------------------------------------------------
// 分词器
// ---------------------------------------------------------------------------

// 匹配 ASCII 字母数字串（含重音拉丁字母）或 CJK 连续段
// Latin-1 Supplement (U+00C0-U+00FF) + Latin Extended-A/B (U+0100-U+024F)
// 覆盖常见重音字母如 É、ü、ø 等
const WORD_RE = /[a-zA-Z0-9\u00C0-\u024f]+|[\u4e00-\u9fff]+/g
const CJK_RE = /[\u4e00-\u9fff]/

/**
 * 将文本分词为 BM25 索引用的词项列表。
 *
 * - 英文/ASCII：按空格和标点分割为单词，转为小写。
 * - 中文：按字符二元组（bigram）分割。单个孤立中文字符保留为 unigram。
 *
 * @param text 输入文本（可包含中英文混合）。
 * @returns 词项字符串数组。
 */
export function tokenize(text: string): string[] {
  if (!text) return []

  const tokens: string[] = []
  const matches = text.matchAll(WORD_RE)

  for (const match of matches) {
    const segment = match[0]
    if (CJK_RE.test(segment)) {
      // 中文段：提取二元组
      if (segment.length === 1) {
        tokens.push(segment)
      } else {
        for (let i = 0; i < segment.length - 1; i++) {
          tokens.push(segment.substring(i, i + 2))
        }
      }
    } else {
      // 英文段：转小写
      tokens.push(segment.toLowerCase())
    }
  }

  return tokens
}

// ---------------------------------------------------------------------------
// 辅助：词频计数（替代 Python 的 collections.Counter）
// ---------------------------------------------------------------------------

/**
 * 计算词项列表中每个词项的出现次数。
 * 返回一个 Map<term, count>，对应 Python 的 Counter(terms)。
 */
function countTerms(terms: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const term of terms) {
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return counts
}

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

/**
 * 知识库中的单个文档条目。
 */
export interface KnowledgeEntry {
  /** 唯一标识符 */
  id: string
  /** 人类可读的标题 */
  title: string
  /** 完整文本内容 */
  content: string
  /** 补充匹配用的关键词列表 */
  keywords: string[]
  /** 来源标注（如 "history"、"supplementary"） */
  source: string
  /** 附加元数据 */
  metadata: Record<string, unknown>
}

/**
 * 创建 KnowledgeEntry 的工厂函数，提供默认值。
 */
export function createKnowledgeEntry(
  id: string,
  title: string,
  content: string,
  opts: {
    keywords?: string[]
    source?: string
    metadata?: Record<string, unknown>
  } = {},
): KnowledgeEntry {
  return {
    id,
    title,
    content,
    keywords: opts.keywords ?? [],
    source: opts.source ?? '',
    metadata: opts.metadata ?? {},
  }
}

/**
 * 知识库检索单个结果。
 */
export interface RetrievalResult {
  /** 匹配到的知识条目 */
  entry: KnowledgeEntry
  /** BM25 相关度分数 */
  score: number
  /** 从内容中提取的相关文本片段 */
  snippet: string
}

// ---------------------------------------------------------------------------
// BM25 知识库
// ---------------------------------------------------------------------------

/**
 * 基于 BM25 的知识库，用于文档检索。
 *
 * 使用 Okapi BM25 排序函数，参数可配置。文档在插入时被分词并建立词频索引。
 *
 * BM25 公式：
 *   score(q, d) = Σ_t IDF(t) * f(t,d)*(k1+1) / (f(t,d) + k1*(1 - b + b*|d|/avgdl))
 *   IDF(t) = ln( (N - n(t) + 0.5) / (n(t) + 0.5) + 1 )
 *
 * 其中 N 为文档总数，n(t) 为包含词项 t 的文档数，f(t,d) 为词项 t 在文档 d
 * 中的出现频率，|d| 为文档长度，avgdl 为平均文档长度。
 */
export class KnowledgeBase {
  /** 词频饱和参数 */
  readonly k1: number
  /** 长度归一化参数 */
  readonly b: number

  /** 文档条目列表（索引与 _docTerms 对齐） */
  private _entries: KnowledgeEntry[] = []
  /** 每个条目的预分词词项列表（索引与 _entries 对齐） */
  private _docTerms: string[][] = []
  /** 每个文档的词频计数（索引与 _entries 对齐） */
  private _docTfs: Map<string, number>[] = []
  /** 文档频率：包含每个词项的文档数 */
  private _docFreq: Map<string, number> = new Map()
  /** 所有文档长度之和（用于计算平均值） */
  private _totalDocLen: number = 0

  /**
   * @param k1 词频饱和参数（默认 1.5）。
   * @param b  长度归一化参数（默认 0.75）。
   */
  constructor(k1: number = 1.5, b: number = 0.75) {
    this.k1 = k1
    this.b = b
  }

  /** 知识库中的条目数量。 */
  get size(): number {
    return this._entries.length
  }

  /** 平均文档长度（以词项计）。 */
  get avgDocLen(): number {
    if (this._entries.length === 0) return 0.0
    return this._totalDocLen / this._entries.length
  }

  // ------------------------------------------------------------------
  // 添加文档
  // ------------------------------------------------------------------

  /**
   * 向知识库添加单个文档。
   *
   * 条目的标题、内容和关键词会被合并分词并一起索引。
   */
  addEntry(entry: KnowledgeEntry): void {
    const combined = `${entry.title} ${entry.content} ${entry.keywords.join(' ')}`
    const terms = tokenize(combined)
    const tf = countTerms(terms)

    this._entries.push(entry)
    this._docTerms.push(terms)
    this._docTfs.push(tf)
    this._totalDocLen += terms.length

    // 更新文档频率
    for (const term of tf.keys()) {
      this._docFreq.set(term, (this._docFreq.get(term) ?? 0) + 1)
    }
  }

  /**
   * 批量添加多个文档。
   */
  addEntries(entries: KnowledgeEntry[]): void {
    for (const entry of entries) {
      this.addEntry(entry)
    }
  }

  // ------------------------------------------------------------------
  // 搜索
  // ------------------------------------------------------------------

  /**
   * 使用 BM25 排序搜索知识库。
   *
   * @param query  搜索查询文本。
   * @param topK   返回结果的最大数量。
   * @returns 按分数降序排列的 RetrievalResult 列表。仅返回正分数结果。
   */
  search(query: string, topK: number = 3): RetrievalResult[] {
    if (this._entries.length === 0 || !query) return []

    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) return []

    // 对每个文档评分
    const scored: Array<{ idx: number; score: number }> = []
    for (let idx = 0; idx < this._docTerms.length; idx++) {
      const score = this._bm25Score(queryTerms, this._docTerms[idx])
      if (score > 0) {
        scored.push({ idx, score })
      }
    }

    // 按分数降序排列
    scored.sort((a, b) => b.score - a.score)

    // 构建结果
    const results: RetrievalResult[] = []
    const limit = Math.min(topK, scored.length)
    for (let i = 0; i < limit; i++) {
      const { idx, score } = scored[i]
      const entry = this._entries[idx]
      const snippet = this._makeSnippet(entry, queryTerms)
      results.push({ entry, score, snippet })
    }

    return results
  }

  // ------------------------------------------------------------------
  // BM25 评分
  // ------------------------------------------------------------------

  /**
   * 计算查询对文档的 BM25 分数。
   *
   * @param queryTerms  分词后的查询词项。
   * @param docTerms    分词后的文档词项。
   * @returns BM25 相关度分数。
   */
  private _bm25Score(queryTerms: string[], docTerms: string[]): number {
    if (queryTerms.length === 0 || docTerms.length === 0) return 0.0

    const N = this._entries.length
    const avgdl = this.avgDocLen
    const docLen = docTerms.length
    const docTf = countTerms(docTerms)

    let score = 0.0
    // 使用去重后的查询词项（标准 BM25）
    const uniqueQueryTerms = new Set(queryTerms)

    for (const term of uniqueQueryTerms) {
      const f = docTf.get(term) ?? 0
      if (f === 0) continue

      const df = this._docFreq.get(term) ?? 0
      // IDF 带 +1 平滑，保证非负
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)

      // BM25 词频饱和分量
      let denom: number
      if (avgdl > 0) {
        denom = f + this.k1 * (1 - this.b + (this.b * docLen) / avgdl)
      } else {
        denom = f + this.k1
      }

      score += (idf * (f * (this.k1 + 1))) / denom
    }

    return score
  }

  // ------------------------------------------------------------------
  // 片段提取
  // ------------------------------------------------------------------

  /**
   * 从条目内容中提取相关片段。
   *
   * 查找任意查询词项在内容中最早出现的位置，返回该位置周围的文本窗口。
   *
   * @param entry       知识条目。
   * @param queryTerms  分词后的查询词项。
   * @returns 最多约 200 字符的文本片段。
   */
  private _makeSnippet(entry: KnowledgeEntry, queryTerms: string[]): string {
    const content = entry.content
    if (!content) return ''

    let bestPos = -1
    const contentLower = content.toLowerCase()

    for (const qt of queryTerms) {
      const pos = contentLower.indexOf(qt.toLowerCase())
      if (pos >= 0 && (bestPos < 0 || pos < bestPos)) {
        bestPos = pos
      }
    }

    if (bestPos < 0) {
      // 无直接匹配：返回内容开头
      return content.substring(0, 200) + (content.length > 200 ? '...' : '')
    }

    const start = Math.max(0, bestPos - 60)
    const end = Math.min(content.length, bestPos + 140)

    const prefix = start > 0 ? '...' : ''
    const suffix = end < content.length ? '...' : ''

    return prefix + content.substring(start, end) + suffix
  }

  // ------------------------------------------------------------------
  // 工具方法
  // ------------------------------------------------------------------

  /**
   * 按 ID 检索条目。
   *
   * @returns 找到的条目，或 undefined。
   */
  getEntry(entryId: string): KnowledgeEntry | undefined {
    return this._entries.find(e => e.id === entryId)
  }

  /** 返回知识库中的所有条目。 */
  allEntries(): KnowledgeEntry[] {
    return [...this._entries]
  }
}

// ---------------------------------------------------------------------------
// 内置历史知识内容（从 agents/historical.py 迁移以避免循环导入）
// ---------------------------------------------------------------------------

const _HISTORY_DB: Record<string, string> = {
  group_definition:
    '群论的历史始于 Évariste Galois (1811-1832)，他首次用群的概念' +
    '研究多项式方程的可解性。Felix Klein 在 1872 年的 Erlangen 纲领' +
    '中用群统一几何学。Arthur Cayley 在 1854 年首次用 Cayley 表' +
    '表示有限群，Heinrich Weber (1882) 给出群的公理化定义。',
  cayley_table:
    'Cayley 表以 Arthur Cayley 命名，他在 1854 年首次用表格' +
    '表示有限群的运算结构。Cayley 是群论历史上重要的先驱。',
  associativity:
    '结合律是群最本质的公理之一。Cauchy 在 1844 年已经注意到' +
    '非结合运算在置换复合中的重要性。Galois 的原始工作中' +
    '隐含使用了结合律。',
  abelian:
    '交换群以 Niels Henrik Abel (1802-1829) 命名。Abel 证明' +
    '了一般五次方程不存在根式解，其核心论证依赖于交换群的性质。' +
    '这是群论历史上的里程碑。',
  lagrange:
    'Lagrange 定理由 Joseph-Louis Lagrange 在 1771 年证明，' +
    '指出有限群子群的阶整除群的阶——群论最早的结果之一。',
  什么是群:
    '群的概念由 Galois 引入。群是一个集合配合运算，满足封闭性、' +
    '结合律、单位元和逆元四条公理。Klein 和 Cayley 进一步发展了群论。',
  什么是结合律: '结合律: (a·b)·c = a·(b·c)。Galois 的工作隐含使用了这一性质。',
  什么是交换群:
    '交换群（Abel 群）满足 a·b = b·a。以 Abel 命名，' + '他利用交换群的性质证明五次方程无根式解。',
  lagrange定理:
    'Lagrange 定理: 有限群子群的阶整除群的阶。' + 'Lagrange 在 1771 年证明，是群论最早的定理。',
  什么是线性变换: '线性变换保持向量加法和标量乘法。矩阵是线性变换的表示。',
  什么是向量空间: '向量空间是线性代数的基础结构，满足八条公理。',
  矩阵乘法: '矩阵乘法一般不满足交换律：AB ≠ BA。这与一般群的非交换性一致。',
  矩阵的逆: '矩阵的逆和群的逆元概念一致。可逆矩阵构成一般线性群 GL(n)。',
  新数学运动:
    '新数学运动 (New Math) 是 1950 年代末至 1970 年代初的数学教育改革运动，' +
    '由苏联 Sputnik 卫星上天 (1957) 触发。美国组建学校数学研究小组 (SMSG)，' +
    '将集合论、抽象代数、不同进制等大学内容引入中小学课堂。' +
    '运动深受 Bourbaki 学派的结构主义影响，强调理解数学结构而非计算技能。' +
    '但因过于抽象、脱离实际、教师准备不足而失败。' +
    'Morris Kline 在《为什么约翰不会加法》(1973) 中批评其颠倒了' +
    '数学的历史发展顺序——从应用到抽象，而非反过来。',
  Bourbaki学派:
    'Nicolas Bourbaki 是一群法国数学家的集体笔名，从 1930 年代起' +
    '试图用公理化方法统一全部纯数学。他们的《数学原本》从集合论出发，' +
    '依次构建代数、拓扑、分析，坚信数学的本质是结构。' +
    'Bourbaki 的影响深远：他们的结构主义方法不仅塑造了 20 世纪的' +
    '数学研究，也通过新数学运动影响了数学教育。然而，' +
    '将成年数学家的工作方法直接搬入课堂被证明是灾难性的。',
  什么是新数学:
    '新数学运动的核心主张：理解比计算更重要，结构是数学的本质，' +
    '学生应像数学家一样思考。它引入集合论到小学，教不同进制的运算，' +
    '强调函数与关系。这些理念本身并非错误，但执行方式——' +
    '一刀切地施加抽象、忽视认知准备度、切断与日常经验的联系——' +
    '导致了失败。Tom Lehrer 的讽刺歌曲《New Math》(1965) 精准捕捉了' +
    '家长面对孩子八进制减法作业时的困惑。',
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

// 匹配英文专有名词（大写单词或连续两个大写单词）
const PROPER_NAME_RE = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g

// 常见中文数学术语列表
const CHINESE_TERMS: string[] = [
  '群',
  '群论',
  '结合律',
  '交换群',
  '阿贝尔群',
  '线性变换',
  '向量空间',
  '矩阵',
  '逆元',
  '单位元',
  '子群',
  '正规子群',
  '商群',
  '同态',
  '同构',
  '置换',
  '对称群',
  '循环群',
  '理想',
  '域',
  '特征多项式',
  '特征值',
  '特征向量',
  '线性无关',
  '基',
  '维数',
  '秩',
  '伽罗瓦',
  '克莱因',
  '拉格朗日',
]

/**
 * 从文本中提取关键词，用于补充匹配。
 *
 * 提取英文专有名词/术语（大写单词）和文本中出现的常见中文数学术语。
 *
 * @param text 源文本。
 * @returns 关键词字符串列表。
 */
function _extractKeywords(text: string): string[] {
  const keywords = new Set<string>()

  // 英文专有名词/术语（大写单词或连续两个大写单词）
  const matches = text.matchAll(PROPER_NAME_RE)
  for (const match of matches) {
    keywords.add(match[0].toLowerCase())
  }

  // 常见中文数学术语
  for (const term of CHINESE_TERMS) {
    if (text.includes(term)) {
      keywords.add(term)
    }
  }

  return Array.from(keywords)
}

/**
 * 历史知识库之外的补充知识条目。
 *
 * 涵盖群论、线性代数、环/域理论及相关主题，丰富检索知识库。
 */
function _additionalEntries(): KnowledgeEntry[] {
  return [
    createKnowledgeEntry(
      'galois_theory',
      'Galois Theory',
      [
        'Galois theory, developed by Évariste Galois (1811-1832), ',
        'establishes a deep connection between field theory and group ',
        'theory. The central result is the Galois correspondence: for ',
        'a Galois extension L/K, there is a one-to-one correspondence ',
        'between intermediate fields and subgroups of the Galois group ',
        'Gal(L/K). This theory explains why polynomial equations of ',
        'degree 5 and higher cannot be solved by radicals in general. ',
        'Galois introduced the concept of a normal subgroup and used ',
        'the structure of permutation groups to analyze solvability.',
      ].join(''),
      {
        keywords: [
          'Galois',
          'field theory',
          'Galois group',
          'solvable',
          'radicals',
          'normal subgroup',
          'permutation',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'erlangen_program',
      'Erlangen Program',
      [
        "Felix Klein's Erlangen Program (1872) proposed that different ",
        'geometries can be classified by their transformation groups. ',
        'Euclidean geometry is characterized by the group of rigid ',
        'motions (translations and rotations), projective geometry by ',
        'projective transformations, and topology by homeomorphisms. ',
        'A geometric property is one invariant under the action of the ',
        'corresponding group. This unified viewpoint showed that group ',
        'theory is the organizing principle of geometry.',
      ].join(''),
      {
        keywords: [
          'Klein',
          'Erlangen',
          'geometry',
          'transformation group',
          'invariant',
          'Euclidean',
          'projective',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'cayley_theorem',
      "Cayley's Theorem",
      [
        "Cayley's theorem states that every group G is isomorphic to a ",
        'subgroup of a symmetric group. Specifically, G embeds into ',
        'Sym(G), the group of all permutations of the underlying set ',
        'of G, via the left regular representation: g maps to the ',
        'permutation x -> gx. This means every abstract group can be ',
        'realized concretely as a permutation group. Arthur Cayley ',
        'proved this in 1854, showing that permutation groups are ',
        'universal among all groups.',
      ].join(''),
      {
        keywords: [
          'Cayley',
          'symmetric group',
          'permutation',
          'isomorphism',
          'regular representation',
          'embedding',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'abel_ruffini',
      'Abel-Ruffini Theorem',
      [
        'The Abel-Ruffini theorem states that there is no general ',
        'solution in radicals for polynomial equations of degree 5 or ',
        'higher. Paolo Ruffini gave an incomplete proof in 1799, and ',
        'Niels Henrik Abel provided a complete proof in 1824. The key ',
        'insight is that the Galois group of a generic quintic ',
        'polynomial is the symmetric group S5, which is not solvable. ',
        'A polynomial equation is solvable by radicals if and only if ',
        "its Galois group is solvable. Abel's work on this problem led ",
        'to the naming of abelian (commutative) groups in his honor.',
      ].join(''),
      {
        keywords: ['Abel', 'Ruffini', 'quintic', 'radicals', 'solvable', 'S5', 'Galois group'],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'normal_subgroup',
      'Normal Subgroups',
      [
        'A subgroup N of a group G is normal (written N <| G) if ',
        'gNg^{-1} = N for all g in G. Equivalently, left and right ',
        'cosets coincide: gN = Ng. Normal subgroups are precisely the ',
        'kernels of group homomorphisms. If N is normal, the set of ',
        'cosets G/N forms a group (the quotient group) under the ',
        'operation (gN)(hN) = ghN. The concept of normal subgroup was ',
        "implicit in Galois's work and made explicit by later ",
        'algebraists. Simple groups are groups with no nontrivial ',
        'normal subgroups; they are the building blocks of all finite ',
        'groups, analogous to primes in number theory.',
      ].join(''),
      {
        keywords: [
          'normal subgroup',
          'coset',
          'quotient group',
          'kernel',
          'homomorphism',
          'simple group',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'group_homomorphism',
      'Group Homomorphisms',
      [
        'A group homomorphism is a function f: G -> H between groups ',
        'that preserves the group operation: f(ab) = f(a)f(b) for all ',
        'a, b in G. The kernel ker(f) = {g in G : f(g) = e_H} is ',
        'always a normal subgroup of G. The image im(f) is a subgroup ',
        'of H. The First Isomorphism Theorem states that G/ker(f) is ',
        'isomorphic to im(f). An injective homomorphism is called a ',
        'monomorphism, a surjective one an epimorphism, and a bijective ',
        'one an isomorphism. Isomorphic groups (G ~= H) have identical ',
        'group-theoretic structure.',
      ].join(''),
      {
        keywords: [
          'homomorphism',
          'kernel',
          'image',
          'isomorphism',
          'injective',
          'surjective',
          'First Isomorphism Theorem',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'isomorphism_theorems',
      'Isomorphism Theorems',
      [
        'The three isomorphism theorems are fundamental results in ',
        'group theory. First: G/ker(f) ~= im(f) for any homomorphism ',
        'f: G -> H. Second: If N <| G and H <= G, then N <| NH, ',
        'N intersect H <| H, and NH/N ~= H/(N intersect H). Third: If ',
        'N <= M <| G and N <| G, then (G/N)/(M/N) ~= G/M. These ',
        'theorems relate quotient groups and homomorphisms, providing ',
        'powerful tools for analyzing group structure. They generalize ',
        'to rings, modules, and other algebraic structures.',
      ].join(''),
      {
        keywords: [
          'isomorphism theorem',
          'quotient',
          'kernel',
          'image',
          'homomorphism',
          'First',
          'Second',
          'Third',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'symmetric_group',
      'Symmetric Groups and Permutations',
      [
        'The symmetric group S_n consists of all permutations of n ',
        'elements and has order n!. Permutations can be written in ',
        'cycle notation. S_n is non-abelian for n >= 3. The ',
        'alternating group A_n is the subgroup of even permutations, ',
        'having index 2 in S_n and thus being normal. A_n is simple ',
        'for n >= 5, which is the key fact underlying the ',
        'Abel-Ruffini theorem. The smallest non-abelian simple group ',
        'is A_5 (order 60). Permutation groups were the original ',
        'context in which Galois developed group theory.',
      ].join(''),
      {
        keywords: [
          'symmetric group',
          'permutation',
          'cycle',
          'alternating group',
          'simple group',
          'A5',
          'S5',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'quotient_group',
      'Quotient Groups',
      [
        'Given a group G and a normal subgroup N, the quotient group ',
        'G/N is the set of cosets {gN : g in G} with the operation ',
        '(gN)(hN) = ghN. The natural projection pi: G -> G/N defined ',
        'by pi(g) = gN is a surjective homomorphism with kernel N. ',
        "The order of G/N is |G|/|N| (Lagrange's theorem). Quotient ",
        "groups allow us to 'mod out' by a subgroup, simplifying the ",
        'group structure. For example, Z/nZ is the cyclic group of ',
        'order n, obtained by quotienting the integers by multiples ',
        'of n.',
      ].join(''),
      {
        keywords: [
          'quotient group',
          'coset',
          'normal subgroup',
          'projection',
          'Lagrange',
          'cyclic',
          'Z/nZ',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'cyclic_group_detail',
      'Cyclic Groups',
      [
        'A cyclic group is a group generated by a single element g: ',
        'every element is a power of g. The cyclic group of order n ',
        'is written Z_n or C_n. Every cyclic group of order n is ',
        'isomorphic to Z/nZ (integers mod n). Infinite cyclic groups ',
        'are isomorphic to Z (integers under addition). Cyclic groups ',
        'are always abelian. Every subgroup of a cyclic group is ',
        'cyclic. Z_n has a unique subgroup of order d for each divisor ',
        'd of n. Cyclic groups are the simplest groups and serve as ',
        'building blocks: every finitely generated abelian group is a ',
        'direct sum of cyclic groups.',
      ].join(''),
      {
        keywords: [
          'cyclic',
          'generator',
          'abelian',
          'Z/nZ',
          'subgroup',
          'finitely generated',
          'direct sum',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'ring_theory_intro',
      'Introduction to Ring Theory',
      [
        'A ring is a set R equipped with two operations (addition and ',
        'multiplication) such that (R, +) is an abelian group, ',
        'multiplication is associative, and multiplication distributes ',
        'over addition. A commutative ring has commutative ',
        'multiplication. A ring with identity has a multiplicative ',
        'unit. Examples include the integers Z, polynomial rings, and ',
        'matrix rings. An ideal I of a ring R is an additive subgroup ',
        'such that rI is a subset of I and Ir is a subset of I for all ',
        'r in R. Ideals are the ring-theoretic analogue of normal ',
        'subgroups; the quotient R/I is a ring. Fields are commutative ',
        'rings where every nonzero element has a multiplicative ',
        'inverse.',
      ].join(''),
      {
        keywords: [
          'ring',
          'ideal',
          'commutative',
          'field',
          'polynomial',
          'matrix ring',
          'quotient',
          'distributive',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'field_theory_intro',
      'Introduction to Field Theory',
      [
        'A field is a commutative ring in which every nonzero element ',
        'has a multiplicative inverse. Familiar examples include Q ',
        '(rationals), R (reals), C (complexes), and finite fields F_p ',
        '(integers mod p, for prime p). A field extension L/K is a ',
        'field L containing K as a subfield. The degree [L:K] is the ',
        'dimension of L as a vector space over K. An element is ',
        'algebraic over K if it is a root of a polynomial with ',
        'coefficients in K. The splitting field of a polynomial is the ',
        'smallest extension over which the polynomial factors ',
        'completely. Galois theory studies the symmetry group (Galois ',
        'group) of a field extension.',
      ].join(''),
      {
        keywords: [
          'field',
          'extension',
          'algebraic',
          'splitting field',
          'Galois',
          'finite field',
          'vector space',
          'degree',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'vector_space_axioms',
      'Vector Space Axioms',
      [
        'A vector space V over a field F is a set with an addition ',
        'operation and scalar multiplication satisfying eight axioms: ',
        '(1) associativity of addition, (2) commutativity of addition, ',
        '(3) existence of zero vector, (4) existence of additive ',
        'inverses, (5) compatibility of scalar multiplication with ',
        'field multiplication, (6) identity element of scalar ',
        'multiplication, (7) distributivity of scalar multiplication ',
        'over vector addition, (8) distributivity of scalar ',
        'multiplication over field addition. Key examples: R^n over R, ',
        'function spaces, polynomial spaces. The concept unifies many ',
        'areas of mathematics and is central to linear algebra.',
      ].join(''),
      {
        keywords: [
          'vector space',
          'axiom',
          'field',
          'scalar',
          'addition',
          'distributivity',
          'zero vector',
          'linear algebra',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'linear_independence',
      'Linear Independence',
      [
        'A set of vectors {v1, v2, ..., vn} in a vector space is ',
        'linearly independent if the only solution to c1*v1 + c2*v2 + ',
        '... + cn*vn = 0 is c1 = c2 = ... = cn = 0. If some nontrivial ',
        'combination gives zero, the set is linearly dependent. Linear ',
        'independence is fundamental to the concepts of basis and ',
        'dimension. A basis is a maximal linearly independent set, and ',
        'the dimension of the space is the size of any basis. The ',
        'number of vectors in any basis is invariant (well-defined). A ',
        "matrix's rank equals the dimension of its column space (and ",
        'row space).',
      ].join(''),
      {
        keywords: [
          'linear independence',
          'dependent',
          'basis',
          'dimension',
          'rank',
          'matrix',
          'vector space',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'basis_and_dimension',
      'Basis and Dimension',
      [
        'A basis of a vector space V is a set of vectors that is ',
        'linearly independent and spans V (every vector in V is a ',
        'linear combination of basis vectors). All bases of a ',
        'finite-dimensional vector space have the same number of ',
        'elements, called the dimension dim(V). The standard basis of ',
        'R^n is {e1, e2, ..., en} where ei has a 1 in position i and ',
        '0 elsewhere. A subspace W of V has dim(W) <= dim(V). The ',
        'rank-nullity theorem states that for a linear map T: V -> W, ',
        'dim(V) = rank(T) + nullity(T), where rank is dim(im(T)) and ',
        'nullity is dim(ker(T)).',
      ].join(''),
      {
        keywords: [
          'basis',
          'dimension',
          'span',
          'linear independence',
          'subspace',
          'rank-nullity',
          'kernel',
          'image',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'eigenvalues',
      'Eigenvalues and Eigenvectors',
      [
        'An eigenvector of a linear operator T (or square matrix A) is ',
        'a nonzero vector v such that T(v) = lambda*v for some scalar ',
        'lambda, called the eigenvalue. The eigenvalues are roots of ',
        'the characteristic polynomial det(A - lambda*I) = 0. The set ',
        'of eigenvalues is the spectrum. Eigenvectors corresponding to ',
        'distinct eigenvalues are linearly independent. A matrix is ',
        'diagonalizable if it has a basis of eigenvectors. Eigenvalues ',
        'are crucial in differential equations, quantum mechanics, and ',
        'data analysis (PCA). The trace equals the sum of eigenvalues ',
        'and the determinant equals their product.',
      ].join(''),
      {
        keywords: [
          'eigenvalue',
          'eigenvector',
          'characteristic polynomial',
          'spectrum',
          'diagonalizable',
          'trace',
          'determinant',
          'PCA',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'matrix_groups',
      'Matrix Groups (Classical Groups)',
      [
        'Matrix groups are groups of invertible matrices under matrix ',
        'multiplication. The general linear group GL(n, F) consists of ',
        'all n-by-n invertible matrices over a field F. The special ',
        'linear group SL(n, F) is the subgroup with determinant 1. The ',
        'orthogonal group O(n) consists of matrices satisfying ',
        'A^T A = I (preserving the dot product). The special orthogonal ',
        'group SO(n) adds det = 1 (rotations). The unitary group U(n) ',
        'and special unitary SU(n) are the complex analogues. These ',
        'classical groups are central to geometry, physics, and ',
        'representation theory. They are all examples of Lie groups ',
        '(continuous groups).',
      ].join(''),
      {
        keywords: [
          'matrix group',
          'GL',
          'SL',
          'orthogonal',
          'unitary',
          'Lie group',
          'determinant',
          'invertible',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'group_action',
      'Group Actions',
      [
        'A group action of a group G on a set X is a map ',
        'G x X -> X, written (g, x) -> g*x, satisfying e*x = x and ',
        '(gh)*x = g*(h*x). The orbit of x is {g*x : g in G}, and the ',
        'stabilizer of x is {g in G : g*x = x}. The orbit-stabilizer ',
        'theorem states |G| = |orbit| * |stabilizer|. Group actions ',
        "unify many concepts: Cayley's theorem (G acting on itself), ",
        'conjugation (G acting on itself by conjugation), and symmetry ',
        "groups (acting on geometric objects). Burnside's lemma counts ",
        'orbits using the average number of fixed points.',
      ].join(''),
      {
        keywords: [
          'group action',
          'orbit',
          'stabilizer',
          'orbit-stabilizer',
          'conjugation',
          'Burnside',
          'symmetry',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'sylow_theorems',
      'Sylow Theorems',
      [
        'The Sylow theorems are fundamental results about finite ',
        'groups. First Sylow: If p^k divides |G|, then G has a subgroup ',
        'of order p^k (a Sylow p-subgroup has order p^a where p^a ',
        'divides |G|). Second Sylow: All Sylow p-subgroups are ',
        'conjugate. Third Sylow: The number n_p of Sylow p-subgroups ',
        'satisfies n_p = 1 (mod p) and n_p divides |G|/p^a. These ',
        'theorems are powerful tools for classifying finite groups. ',
        'For example, if |G| = pq with p < q primes and p does not ',
        'divide q-1, then G is cyclic. Sylow proved these in 1872.',
      ].join(''),
      {
        keywords: [
          'Sylow',
          'p-subgroup',
          'conjugate',
          'finite group',
          'cyclic',
          'prime',
          'classification',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'dihedral_group',
      'Dihedral Groups',
      [
        'The dihedral group D_n (or D_{2n}) is the symmetry group of a ',
        'regular n-gon, containing n rotations and n reflections, for ',
        'a total of 2n elements. It is generated by a rotation r ',
        '(order n) and a reflection s (order 2) with the relation ',
        'srs = r^{-1}. D_n is non-abelian for n >= 3. The smallest ',
        'non-abelian group is D_3 (isomorphic to S_3) of order 6. ',
        'Dihedral groups are important examples in group theory: they ',
        'illustrate semidirect products, have interesting subgroup ',
        'structures, and serve as the simplest family of non-abelian ',
        'groups.',
      ].join(''),
      {
        keywords: [
          'dihedral',
          'symmetry',
          'rotation',
          'reflection',
          'non-abelian',
          'semidirect product',
          'S3',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'group_representation',
      'Group Representation Theory',
      [
        'A representation of a group G is a homomorphism ',
        'rho: G -> GL(V), where V is a vector space. This realizes ',
        'abstract group elements as matrices. Representation theory ',
        'connects group theory to linear algebra and is essential in ',
        'physics (quantum mechanics, particle physics) and chemistry ',
        '(molecular symmetry). A representation is irreducible if V ',
        "has no nontrivial G-invariant subspaces. Maschke's theorem ",
        'states that over a field of characteristic not dividing |G|, ',
        'every representation decomposes into irreducibles. Character ',
        'theory (traces of representation matrices) provides a powerful ',
        'tool for classifying representations of finite groups.',
      ].join(''),
      {
        keywords: [
          'representation',
          'irreducible',
          'character',
          'Maschke',
          'matrix',
          'GL',
          'quantum',
        ],
        source: 'supplementary',
      },
    ),
    createKnowledgeEntry(
      'lagrange_theorem_detail',
      "Lagrange's Theorem (Detailed)",
      [
        "Lagrange's theorem: if H is a subgroup of a finite group G, ",
        'then |H| divides |G|. The quotient |G|/|H| is the index ',
        '[G:H], equal to the number of left (or right) cosets of H. A ',
        'consequence: the order of any element g in G divides |G| ',
        '(since the cyclic subgroup generated by g has order equal to ',
        'the order of g). Another consequence: every group of prime ',
        "order is cyclic. The converse of Lagrange's theorem is false ",
        'in general -- not every divisor of |G| corresponds to a ',
        "subgroup -- but Sylow's theorems provide partial converses ",
        'for prime power divisors. Lagrange proved the original ',
        'version for permutation groups in 1771.',
      ].join(''),
      {
        keywords: ['Lagrange', 'subgroup', 'order', 'coset', 'index', 'prime', 'cyclic', 'divisor'],
        source: 'supplementary',
      },
    ),
    // --- 新数学运动与教育哲学 ---
    createKnowledgeEntry(
      'new_math_movement',
      'The New Math Movement (1958-1975)',
      [
        'The New Math movement was a sweeping reform of mathematics ',
        'education that originated in the United States in the late ',
        '1950s, triggered by the Soviet launch of Sputnik in 1957. ',
        'The American Mathematical Society established the School ',
        'Mathematics Study Group (SMSG) in 1958, led by Edward Begle ',
        'of Yale University, to redesign the K-12 mathematics ',
        'curriculum. The movement introduced set theory, abstract ',
        'algebra, different number bases, and formal logic into ',
        'elementary and secondary education. It was deeply influenced ',
        "by the Bourbaki school's structuralist approach to ",
        'mathematics. The movement failed by the mid-1970s due to ',
        'excessive abstraction, inadequate teacher preparation, ',
        'parental alienation, and disconnection from practical ',
        "computation. Morris Kline's 1973 critique 'Why Johnny ",
        "Can't Add' argued that the movement reversed the historical ",
        'order of mathematical development: mathematics grows from ',
        "applications to abstractions, not the reverse. Tom Lehrer's ",
        "satirical song 'New Math' (1965) captured the public's ",
        'frustration with the reform. Despite its failure, the New ',
        'Math left a lasting legacy: the emphasis on understanding ',
        'over rote calculation, the introduction of set notation, ',
        'and the idea that mathematics is about structures.',
      ].join(''),
      {
        keywords: [
          'New Math',
          'SMSG',
          'Sputnik',
          'Begle',
          'Bourbaki',
          'Kline',
          'set theory',
          'education reform',
          'Tom Lehrer',
          'structuralism',
          'curriculum',
          'failure',
        ],
        source: 'education_history',
      },
    ),
    createKnowledgeEntry(
      'bourbaki_influence',
      "Bourbaki's Influence on Mathematics Education",
      [
        'The Bourbaki group, writing under the collective pseudonym ',
        'Nicolas Bourbaki, attempted from the 1930s onward to unify ',
        'all of pure mathematics through an axiomatic, structural ',
        "approach. Their 'Éléments de mathématique' began with set ",
        'theory and proceeded through algebra, topology, and analysis. ',
        "Bourbaki's philosophy—that mathematics is fundamentally about ",
        'structures (algebraic, topological, ordered)—directly ',
        'inspired the New Math movement. The SMSG curriculum mirrored ',
        "Bourbaki's approach: start with sets, build up to algebraic ",
        'structures, emphasize axiomatics. However, what worked for ',
        'professional mathematicians proved disastrous for children. ',
        'The Bourbaki approach assumes years of mathematical maturity ',
        'and intuition; imposing it on elementary students bypassed ',
        'the cognitive development that makes abstraction meaningful. ',
        'Vladimir Arnold later recalled that Soviet mathematics ',
        "education, under Kolmogorov's influence, avoided the ",
        'extreme upheavals seen elsewhere while still incorporating ',
        'modern mathematical ideas. The lesson: structural elegance ',
        'is a destination, not a starting point.',
      ].join(''),
      {
        keywords: [
          'Bourbaki',
          'structure',
          'axiomatic',
          'Éléments',
          'education',
          'Kolmogorov',
          'Arnold',
          'set theory',
          'New Math',
          'structuralism',
        ],
        source: 'education_history',
      },
    ),
    createKnowledgeEntry(
      'morris_kline_critique',
      "Morris Kline's Critique: Why Johnny Can't Add",
      [
        'Morris Kline (1908-1992), a mathematician at NYU, published ',
        "'Why Johnny Can't Add: The Failure of the New Math' in 1973. ",
        'His central argument was not that mathematical structure is ',
        'unimportant, but that the New Math reversed the natural order ',
        'of learning. Mathematics historically develops from ',
        'applications to abstractions: counting precedes number ',
        'theory, surveying precedes geometry, ballistics precedes ',
        'calculus. Kline argued that education should follow this ',
        'path—start with concrete problems, then abstract. He also ',
        'criticized the New Math for: (1) ignoring the role of ',
        'intuition in mathematical discovery, (2) treating ',
        'mathematics as a static body of knowledge rather than a ',
        'living tradition, (3) disconnecting mathematics from ',
        'science and engineering, (4) using excessive formalism that ',
        'obscured rather than illuminated. Kline advocated for a ',
        'curriculum that integrates mathematics with its applications ',
        'and historical development. His critique contributed to the ',
        "'Back to Basics' movement of the 1980s, though the pendulum ",
        'never fully returned to pure rote learning.',
      ].join(''),
      {
        keywords: [
          'Kline',
          "Why Johnny Can't Add",
          'critique',
          'intuition',
          'applications',
          'Back to Basics',
          'formalism',
          'New Math',
          'failure',
        ],
        source: 'education_history',
      },
    ),
    createKnowledgeEntry(
      'mathweaver_new_math_response',
      "MathWeaver's Response to the New Math Legacy",
      [
        'MathWeaver is designed as a conscious response to the ',
        "lessons of the New Math movement. It shares the New Math's ",
        'core intuition—that mathematics is about structure, not ',
        'just computation—but addresses each of its failures: ',
        '(1) Structure before intuition: MathWeaver uses a concept ',
        'DAG (Directed Acyclic Graph) with 193 nodes, ensuring ',
        'abstraction is introduced only after prerequisite ',
        'intuition is established. The four-field cognitive state ',
        '(perception, abstraction, epistemic, collaboration) tracks ',
        'readiness in real time. (2) One-size-fits-all abstraction: ',
        'the Grill mode adapts difficulty based on mastery, ',
        'response time, and emotional state. Abstract concepts enter ',
        "only when the learner's mastery exceeds threshold. ",
        '(3) Emotional neglect: an Encouragement Engine detects ',
        'frustration and provides growth-mindset support, reframing ',
        'errors as discoveries. (4) Historical amnesia: the ',
        'Historical Agent weaves the stories of Galois, Abel, ',
        'Cayley, and others into the learning process, connecting ',
        'learners to the human tradition behind the formulas. ',
        "MathWeaver's guiding principle: structure is the ",
        'destination, not the starting point. Abstraction should ',
        "grow from within the learner's experience, not be imposed ",
        'from above.',
      ].join(''),
      {
        keywords: [
          'MathWeaver',
          'New Math',
          'DAG',
          'adaptive',
          'encouragement',
          'historical',
          'structure',
          'intuition',
          'cognitive state',
          'Z3',
        ],
        source: 'design_philosophy',
      },
    ),
  ]
}

// ---------------------------------------------------------------------------
// 默认知识库构建器
// ---------------------------------------------------------------------------

/**
 * 从内置数学历史内容构建知识库。
 *
 * 包含群论、线性代数及相关主题的条目。
 *
 * @returns 已填充的 KnowledgeBase 实例。
 */
export function buildDefaultKB(): KnowledgeBase {
  const kb = new KnowledgeBase()
  const entries: KnowledgeEntry[] = []

  // --- 转换已有的历史条目 ---
  for (const [key, text] of Object.entries(_HISTORY_DB)) {
    let title = key.replace(/_/g, ' ')
    if (title.startsWith('什么是')) {
      title = title.substring(3)
    }
    title = title.trim() || key

    const keywords = _extractKeywords(text)
    entries.push(
      createKnowledgeEntry(`history_${key}`, title, text, {
        keywords,
        source: 'history',
        metadata: { original_key: key },
      }),
    )
  }

  // --- 添加补充条目 ---
  entries.push(..._additionalEntries())

  kb.addEntries(entries)
  log.info('Built default knowledge base', { entryCount: kb.size })
  return kb
}
