"""BM25-based RAG retrieval system (3.5).

Provides a lightweight knowledge retrieval layer for the MathWeaver agent
system. Uses the Okapi BM25 ranking algorithm with a tokenizer that handles
both Chinese and English text. Standard library only -- no external
dependencies (numpy, sklearn, etc.).

Tokenizer:
    English/ASCII text is split on whitespace and punctuation into words.
    Chinese text (CJK Unified Ideographs) is split into character bigrams
    for sub-word matching; single characters are kept as unigrams.

BM25 parameters:
    k1 = 1.5  (term-frequency saturation)
    b  = 0.75 (length-normalization strength)
"""

from __future__ import annotations

import logging
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

# Match ASCII alphanumeric runs (including accented Latin) or CJK runs.
# Latin-1 Supplement (U+00C0-U+00FF) + Latin Extended-A/B (U+0100-U+024F)
# covers common accented letters like É, ü, ø, etc.
_WORD_RE = re.compile(r"[a-zA-Z0-9\u00C0-\u024f]+|[\u4e00-\u9fff]+")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def tokenize(text: str) -> list[str]:
    """Tokenize text into a list of terms for BM25 indexing.

    - English/ASCII: split on whitespace and punctuation into words,
      lowercased.
    - Chinese: split into character bigrams. A single isolated Chinese
      character is kept as a unigram.

    Args:
        text: Input text (may contain mixed Chinese and English).

    Returns:
        List of token strings.
    """
    if not text:
        return []

    tokens: list[str] = []
    for segment in _WORD_RE.findall(text):
        if _CJK_RE.match(segment):
            # Chinese segment: extract bigrams.
            if len(segment) == 1:
                tokens.append(segment)
            else:
                for i in range(len(segment) - 1):
                    tokens.append(segment[i : i + 2])
        else:
            tokens.append(segment.lower())

    return tokens


# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------

@dataclass
class KnowledgeEntry:
    """A single document in the knowledge base.

    Attributes:
        id: Unique identifier for the entry.
        title: Human-readable title.
        content: Full text content of the entry.
        keywords: List of keyword strings for supplemental matching.
        source: Source attribution (e.g. ``"HISTORY_DB"``, ``"supplementary"``).
        metadata: Additional metadata.
    """

    id: str
    title: str
    content: str
    keywords: list[str] = field(default_factory=list)
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievalResult:
    """A single retrieval result from a knowledge base search.

    Attributes:
        entry: The matched :class:`KnowledgeEntry`.
        score: BM25 relevance score.
        snippet: A text snippet from the content around the best match.
    """

    entry: KnowledgeEntry
    score: float
    snippet: str = ""


# ---------------------------------------------------------------------------
# BM25 Knowledge Base
# ---------------------------------------------------------------------------

class KnowledgeBase:
    """A BM25-based knowledge base for document retrieval.

    Uses the Okapi BM25 ranking function with configurable parameters.
    Documents are tokenized at insertion time and indexed for term-frequency
    lookups.

    BM25 formula::

        score(q, d) = sum_t  IDF(t) * f(t,d)*(k1+1) / (f(t,d) + k1*(1 - b + b*|d|/avgdl))

        IDF(t) = ln( (N - n(t) + 0.5) / (n(t) + 0.5) + 1 )

    where ``N`` is the total number of documents, ``n(t)`` is the document
    frequency of term *t*, ``f(t,d)`` is the term frequency in document *d*,
    ``|d|`` is the document length, and ``avgdl`` is the average document
    length.

    Args:
        k1: Term-frequency saturation parameter (default ``1.5``).
        b: Length-normalization parameter (default ``0.75``).

    Example::

        kb = KnowledgeBase()
        kb.add_entry(KnowledgeEntry(id="1", title="Groups", content="..."))
        results = kb.search("group theory", top_k=3)
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self._entries: list[KnowledgeEntry] = []
        # Pre-tokenized terms for each entry (index-aligned with _entries).
        self._doc_terms: list[list[str]] = []
        # Term frequency Counter per document.
        self._doc_tfs: list[Counter] = []
        # Document frequency: number of docs containing each term.
        self._doc_freq: Counter = Counter()
        # Sum of all document lengths (for average computation).
        self._total_doc_len: int = 0

    @property
    def size(self) -> int:
        """Number of entries in the knowledge base."""
        return len(self._entries)

    @property
    def avg_doc_len(self) -> float:
        """Average document length (in tokens)."""
        if not self._entries:
            return 0.0
        return self._total_doc_len / len(self._entries)

    # ------------------------------------------------------------------
    # Adding documents
    # ------------------------------------------------------------------

    def add_entry(self, entry: KnowledgeEntry) -> None:
        """Add a single document to the knowledge base.

        The entry's title, content, and keywords are all tokenized and
        indexed together.

        Args:
            entry: The :class:`KnowledgeEntry` to add.
        """
        combined = entry.title + " " + entry.content + " " + " ".join(entry.keywords)
        terms = tokenize(combined)
        tf = Counter(terms)

        self._entries.append(entry)
        self._doc_terms.append(terms)
        self._doc_tfs.append(tf)
        self._total_doc_len += len(terms)

        for term in tf:
            self._doc_freq[term] += 1

        logger.debug(
            "Added entry '%s' (%d tokens) to KB (total: %d)",
            entry.id, len(terms), len(self._entries),
        )

    def add_entries(self, entries: list[KnowledgeEntry]) -> None:
        """Batch add multiple documents to the knowledge base.

        Args:
            entries: List of :class:`KnowledgeEntry` objects to add.
        """
        for entry in entries:
            self.add_entry(entry)

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search(self, query: str, top_k: int = 3) -> list[RetrievalResult]:
        """Search the knowledge base using BM25 ranking.

        Args:
            query: The search query text.
            top_k: Maximum number of results to return.

        Returns:
            List of :class:`RetrievalResult` objects sorted by score
            (descending). Only results with a positive score are returned.
        """
        if not self._entries or not query:
            return []

        query_terms = tokenize(query)
        if not query_terms:
            return []

        # Score every document.
        scored: list[tuple[int, float]] = []
        for idx, doc_terms in enumerate(self._doc_terms):
            score = self._bm25_score(query_terms, doc_terms)
            if score > 0:
                scored.append((idx, score))

        # Sort by score descending.
        scored.sort(key=lambda x: x[1], reverse=True)

        # Build results.
        results: list[RetrievalResult] = []
        for idx, score in scored[:top_k]:
            entry = self._entries[idx]
            snippet = self._make_snippet(entry, query_terms)
            results.append(RetrievalResult(
                entry=entry,
                score=score,
                snippet=snippet,
            ))

        return results

    # ------------------------------------------------------------------
    # BM25 scoring
    # ------------------------------------------------------------------

    def _bm25_score(
        self,
        query_terms: list[str],
        doc_terms: list[str],
    ) -> float:
        """Compute the BM25 score for a query against a document.

        Args:
            query_terms: Tokenized query terms.
            doc_terms: Tokenized document terms.

        Returns:
            The BM25 relevance score.
        """
        if not query_terms or not doc_terms:
            return 0.0

        N = len(self._entries)
        avgdl = self.avg_doc_len
        doc_len = len(doc_terms)
        doc_tf = Counter(doc_terms)

        score = 0.0
        # Use unique query terms (standard BM25).
        unique_query_terms = set(query_terms)

        for term in unique_query_terms:
            f = doc_tf.get(term, 0)
            if f == 0:
                continue

            df = self._doc_freq.get(term, 0)
            # IDF with +1 smoothing to guarantee non-negativity.
            idf = math.log((N - df + 0.5) / (df + 0.5) + 1)

            # BM25 term-frequency saturation component.
            if avgdl > 0:
                denom = f + self.k1 * (1 - self.b + self.b * doc_len / avgdl)
            else:
                denom = f + self.k1

            score += idf * (f * (self.k1 + 1)) / denom

        return score

    # ------------------------------------------------------------------
    # Snippet extraction
    # ------------------------------------------------------------------

    def _make_snippet(
        self,
        entry: KnowledgeEntry,
        query_terms: list[str],
    ) -> str:
        """Extract a relevant snippet from the entry content.

        Finds the earliest occurrence of any query term in the content and
        returns a window of text around it.

        Args:
            entry: The knowledge entry.
            query_terms: Tokenized query terms.

        Returns:
            A text snippet (at most ~200 chars) from the content.
        """
        content = entry.content
        if not content:
            return ""

        best_pos = -1
        content_lower = content.lower()

        for qt in query_terms:
            pos = content_lower.find(qt.lower())
            if pos >= 0 and (best_pos < 0 or pos < best_pos):
                best_pos = pos

        if best_pos < 0:
            # No direct match: return the beginning of the content.
            return content[:200] + ("..." if len(content) > 200 else "")

        start = max(0, best_pos - 60)
        end = min(len(content), best_pos + 140)

        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(content) else ""

        return prefix + content[start:end] + suffix

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    def get_entry(self, entry_id: str) -> KnowledgeEntry | None:
        """Retrieve an entry by ID.

        Args:
            entry_id: The unique identifier of the entry.

        Returns:
            The :class:`KnowledgeEntry`, or ``None`` if not found.
        """
        for entry in self._entries:
            if entry.id == entry_id:
                return entry
        return None

    def all_entries(self) -> list[KnowledgeEntry]:
        """Return all entries in the knowledge base."""
        return list(self._entries)


# ---------------------------------------------------------------------------
# Built-in history content (moved from agents/historical.py to avoid circular import)
# ---------------------------------------------------------------------------

_HISTORY_DB: dict[str, str] = {
    "group_definition": (
        "群论的历史始于 Évariste Galois (1811-1832)，他首次用群的概念"
        "研究多项式方程的可解性。Felix Klein 在 1872 年的 Erlangen 纲领"
        "中用群统一几何学。Arthur Cayley 在 1854 年首次用 Cayley 表"
        "表示有限群，Heinrich Weber (1882) 给出群的公理化定义。"
    ),
    "cayley_table": (
        "Cayley 表以 Arthur Cayley 命名，他在 1854 年首次用表格"
        "表示有限群的运算结构。Cayley 是群论历史上重要的先驱。"
    ),
    "associativity": (
        "结合律是群最本质的公理之一。Cauchy 在 1844 年已经注意到"
        "非结合运算在置换复合中的重要性。Galois 的原始工作中"
        "隐含使用了结合律。"
    ),
    "abelian": (
        "交换群以 Niels Henrik Abel (1802-1829) 命名。Abel 证明"
        "了一般五次方程不存在根式解，其核心论证依赖于交换群的性质。"
        "这是群论历史上的里程碑。"
    ),
    "lagrange": (
        "Lagrange 定理由 Joseph-Louis Lagrange 在 1771 年证明，"
        "指出有限群子群的阶整除群的阶——群论最早的结果之一。"
    ),
    "什么是群": (
        "群的概念由 Galois 引入。群是一个集合配合运算，满足封闭性、"
        "结合律、单位元和逆元四条公理。Klein 和 Cayley 进一步发展了群论。"
    ),
    "什么是结合律": (
        "结合律: (a·b)·c = a·(b·c)。Galois 的工作隐含使用了这一性质。"
    ),
    "什么是交换群": (
        "交换群（Abel 群）满足 a·b = b·a。以 Abel 命名，"
        "他利用交换群的性质证明五次方程无根式解。"
    ),
    "lagrange定理": (
        "Lagrange 定理: 有限群子群的阶整除群的阶。"
        "Lagrange 在 1771 年证明，是群论最早的定理。"
    ),
    "什么是线性变换": (
        "线性变换保持向量加法和标量乘法。矩阵是线性变换的表示。"
    ),
    "什么是向量空间": (
        "向量空间是线性代数的基础结构，满足八条公理。"
    ),
    "矩阵乘法": (
        "矩阵乘法一般不满足交换律：AB ≠ BA。"
        "这与一般群的非交换性一致。"
    ),
    "矩阵的逆": (
        "矩阵的逆和群的逆元概念一致。可逆矩阵构成一般线性群 GL(n)。"
    ),
    "新数学运动": (
        "新数学运动 (New Math) 是 1950 年代末至 1970 年代初的数学教育改革运动，"
        "由苏联 Sputnik 卫星上天 (1957) 触发。美国组建学校数学研究小组 (SMSG)，"
        "将集合论、抽象代数、不同进制等大学内容引入中小学课堂。"
        "运动深受 Bourbaki 学派的结构主义影响，强调理解数学结构而非计算技能。"
        "但因过于抽象、脱离实际、教师准备不足而失败。"
        "Morris Kline 在《为什么约翰不会加法》(1973) 中批评其颠倒了"
        "数学的历史发展顺序——从应用到抽象，而非反过来。"
    ),
    "Bourbaki学派": (
        "Nicolas Bourbaki 是一群法国数学家的集体笔名，从 1930 年代起"
        "试图用公理化方法统一全部纯数学。他们的《数学原本》从集合论出发，"
        "依次构建代数、拓扑、分析，坚信数学的本质是结构。"
        "Bourbaki 的影响深远：他们的结构主义方法不仅塑造了 20 世纪的"
        "数学研究，也通过新数学运动影响了数学教育。然而，"
        "将成年数学家的工作方法直接搬入课堂被证明是灾难性的。"
    ),
    "什么是新数学": (
        "新数学运动的核心主张：理解比计算更重要，结构是数学的本质，"
        "学生应像数学家一样思考。它引入集合论到小学，教不同进制的运算，"
        "强调函数与关系。这些理念本身并非错误，但执行方式——"
        "一刀切地施加抽象、忽视认知准备度、切断与日常经验的联系——"
        "导致了失败。Tom Lehrer 的讽刺歌曲《New Math》(1965) 精准捕捉了"
        "家长面对孩子八进制减法作业时的困惑。"
    ),
}


# ---------------------------------------------------------------------------
# Default Knowledge Base Builder
# ---------------------------------------------------------------------------

def build_default_kb() -> KnowledgeBase:
    """Build a knowledge base from the built-in math history content.

    Includes entries about group theory, linear algebra, and related topics.

    Returns:
        A populated :class:`KnowledgeBase` instance.
    """
    kb = KnowledgeBase()

    entries: list[KnowledgeEntry] = []

    # --- Convert existing history entries ---
    for key, text in _HISTORY_DB.items():
        title = key.replace("_", " ")
        if title.startswith("什么是"):
            title = title[3:]
        title = title.strip() or key
        keywords = _extract_keywords(text)
        entries.append(KnowledgeEntry(
            id=f"history_{key}",
            title=title,
            content=text,
            keywords=keywords,
            source="history",
            metadata={"original_key": key},
        ))

    # --- Add supplementary entries ---
    entries.extend(_additional_entries())

    kb.add_entries(entries)
    logger.info("Built default knowledge base with %d entries", kb.size)
    return kb


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_keywords(text: str) -> list[str]:
    """Extract keywords from text for supplemental matching.

    Extracts English proper names / terms (capitalised words) and common
    Chinese mathematical terms found in the text.

    Args:
        text: Source text.

    Returns:
        List of keyword strings.
    """
    keywords: set[str] = set()

    # English proper names / terms (capitalised words or word pairs).
    for match in re.finditer(r"[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?", text):
        keywords.add(match.group().lower())

    # Common Chinese mathematical terms.
    chinese_terms = [
        "群", "群论", "结合律", "交换群", "阿贝尔群",
        "线性变换", "向量空间", "矩阵", "逆元", "单位元",
        "子群", "正规子群", "商群", "同态", "同构",
        "置换", "对称群", "循环群", "理想", "域",
        "特征多项式", "特征值", "特征向量", "线性无关",
        "基", "维数", "秩", "伽罗瓦", "克莱因", "拉格朗日",
    ]
    for term in chinese_terms:
        if term in text:
            keywords.add(term)

    return list(keywords)


def _additional_entries() -> list[KnowledgeEntry]:
    """Supplementary knowledge entries beyond HISTORY_DB.

    Covers group theory, linear algebra, ring/field theory, and related
    topics to enrich the retrieval knowledge base.
    """
    return [
        KnowledgeEntry(
            id="galois_theory",
            title="Galois Theory",
            content=(
                "Galois theory, developed by Évariste Galois (1811-1832), "
                "establishes a deep connection between field theory and group "
                "theory. The central result is the Galois correspondence: for "
                "a Galois extension L/K, there is a one-to-one correspondence "
                "between intermediate fields and subgroups of the Galois group "
                "Gal(L/K). This theory explains why polynomial equations of "
                "degree 5 and higher cannot be solved by radicals in general. "
                "Galois introduced the concept of a normal subgroup and used "
                "the structure of permutation groups to analyze solvability."
            ),
            keywords=["Galois", "field theory", "Galois group", "solvable",
                       "radicals", "normal subgroup", "permutation"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="erlangen_program",
            title="Erlangen Program",
            content=(
                "Felix Klein's Erlangen Program (1872) proposed that different "
                "geometries can be classified by their transformation groups. "
                "Euclidean geometry is characterized by the group of rigid "
                "motions (translations and rotations), projective geometry by "
                "projective transformations, and topology by homeomorphisms. "
                "A geometric property is one invariant under the action of the "
                "corresponding group. This unified viewpoint showed that group "
                "theory is the organizing principle of geometry."
            ),
            keywords=["Klein", "Erlangen", "geometry", "transformation group",
                       "invariant", "Euclidean", "projective"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="cayley_theorem",
            title="Cayley's Theorem",
            content=(
                "Cayley's theorem states that every group G is isomorphic to a "
                "subgroup of a symmetric group. Specifically, G embeds into "
                "Sym(G), the group of all permutations of the underlying set "
                "of G, via the left regular representation: g maps to the "
                "permutation x -> gx. This means every abstract group can be "
                "realized concretely as a permutation group. Arthur Cayley "
                "proved this in 1854, showing that permutation groups are "
                "universal among all groups."
            ),
            keywords=["Cayley", "symmetric group", "permutation", "isomorphism",
                       "regular representation", "embedding"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="abel_ruffini",
            title="Abel-Ruffini Theorem",
            content=(
                "The Abel-Ruffini theorem states that there is no general "
                "solution in radicals for polynomial equations of degree 5 or "
                "higher. Paolo Ruffini gave an incomplete proof in 1799, and "
                "Niels Henrik Abel provided a complete proof in 1824. The key "
                "insight is that the Galois group of a generic quintic "
                "polynomial is the symmetric group S5, which is not solvable. "
                "A polynomial equation is solvable by radicals if and only if "
                "its Galois group is solvable. Abel's work on this problem led "
                "to the naming of abelian (commutative) groups in his honor."
            ),
            keywords=["Abel", "Ruffini", "quintic", "radicals", "solvable",
                       "S5", "Galois group"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="normal_subgroup",
            title="Normal Subgroups",
            content=(
                "A subgroup N of a group G is normal (written N <| G) if "
                "gNg^{-1} = N for all g in G. Equivalently, left and right "
                "cosets coincide: gN = Ng. Normal subgroups are precisely the "
                "kernels of group homomorphisms. If N is normal, the set of "
                "cosets G/N forms a group (the quotient group) under the "
                "operation (gN)(hN) = ghN. The concept of normal subgroup was "
                "implicit in Galois's work and made explicit by later "
                "algebraists. Simple groups are groups with no nontrivial "
                "normal subgroups; they are the building blocks of all finite "
                "groups, analogous to primes in number theory."
            ),
            keywords=["normal subgroup", "coset", "quotient group", "kernel",
                       "homomorphism", "simple group"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="group_homomorphism",
            title="Group Homomorphisms",
            content=(
                "A group homomorphism is a function f: G -> H between groups "
                "that preserves the group operation: f(ab) = f(a)f(b) for all "
                "a, b in G. The kernel ker(f) = {g in G : f(g) = e_H} is "
                "always a normal subgroup of G. The image im(f) is a subgroup "
                "of H. The First Isomorphism Theorem states that G/ker(f) is "
                "isomorphic to im(f). An injective homomorphism is called a "
                "monomorphism, a surjective one an epimorphism, and a bijective "
                "one an isomorphism. Isomorphic groups (G ~= H) have identical "
                "group-theoretic structure."
            ),
            keywords=["homomorphism", "kernel", "image", "isomorphism",
                       "injective", "surjective", "First Isomorphism Theorem"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="isomorphism_theorems",
            title="Isomorphism Theorems",
            content=(
                "The three isomorphism theorems are fundamental results in "
                "group theory. First: G/ker(f) ~= im(f) for any homomorphism "
                "f: G -> H. Second: If N <| G and H <= G, then N <| NH, "
                "N intersect H <| H, and NH/N ~= H/(N intersect H). Third: If "
                "N <= M <| G and N <| G, then (G/N)/(M/N) ~= G/M. These "
                "theorems relate quotient groups and homomorphisms, providing "
                "powerful tools for analyzing group structure. They generalize "
                "to rings, modules, and other algebraic structures."
            ),
            keywords=["isomorphism theorem", "quotient", "kernel", "image",
                       "homomorphism", "First", "Second", "Third"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="symmetric_group",
            title="Symmetric Groups and Permutations",
            content=(
                "The symmetric group S_n consists of all permutations of n "
                "elements and has order n!. Permutations can be written in "
                "cycle notation. S_n is non-abelian for n >= 3. The "
                "alternating group A_n is the subgroup of even permutations, "
                "having index 2 in S_n and thus being normal. A_n is simple "
                "for n >= 5, which is the key fact underlying the "
                "Abel-Ruffini theorem. The smallest non-abelian simple group "
                "is A_5 (order 60). Permutation groups were the original "
                "context in which Galois developed group theory."
            ),
            keywords=["symmetric group", "permutation", "cycle",
                       "alternating group", "simple group", "A5", "S5"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="quotient_group",
            title="Quotient Groups",
            content=(
                "Given a group G and a normal subgroup N, the quotient group "
                "G/N is the set of cosets {gN : g in G} with the operation "
                "(gN)(hN) = ghN. The natural projection pi: G -> G/N defined "
                "by pi(g) = gN is a surjective homomorphism with kernel N. "
                "The order of G/N is |G|/|N| (Lagrange's theorem). Quotient "
                "groups allow us to 'mod out' by a subgroup, simplifying the "
                "group structure. For example, Z/nZ is the cyclic group of "
                "order n, obtained by quotienting the integers by multiples "
                "of n."
            ),
            keywords=["quotient group", "coset", "normal subgroup",
                       "projection", "Lagrange", "cyclic", "Z/nZ"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="cyclic_group_detail",
            title="Cyclic Groups",
            content=(
                "A cyclic group is a group generated by a single element g: "
                "every element is a power of g. The cyclic group of order n "
                "is written Z_n or C_n. Every cyclic group of order n is "
                "isomorphic to Z/nZ (integers mod n). Infinite cyclic groups "
                "are isomorphic to Z (integers under addition). Cyclic groups "
                "are always abelian. Every subgroup of a cyclic group is "
                "cyclic. Z_n has a unique subgroup of order d for each divisor "
                "d of n. Cyclic groups are the simplest groups and serve as "
                "building blocks: every finitely generated abelian group is a "
                "direct sum of cyclic groups."
            ),
            keywords=["cyclic", "generator", "abelian", "Z/nZ", "subgroup",
                       "finitely generated", "direct sum"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="ring_theory_intro",
            title="Introduction to Ring Theory",
            content=(
                "A ring is a set R equipped with two operations (addition and "
                "multiplication) such that (R, +) is an abelian group, "
                "multiplication is associative, and multiplication distributes "
                "over addition. A commutative ring has commutative "
                "multiplication. A ring with identity has a multiplicative "
                "unit. Examples include the integers Z, polynomial rings, and "
                "matrix rings. An ideal I of a ring R is an additive subgroup "
                "such that rI is a subset of I and Ir is a subset of I for all "
                "r in R. Ideals are the ring-theoretic analogue of normal "
                "subgroups; the quotient R/I is a ring. Fields are commutative "
                "rings where every nonzero element has a multiplicative "
                "inverse."
            ),
            keywords=["ring", "ideal", "commutative", "field", "polynomial",
                       "matrix ring", "quotient", "distributive"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="field_theory_intro",
            title="Introduction to Field Theory",
            content=(
                "A field is a commutative ring in which every nonzero element "
                "has a multiplicative inverse. Familiar examples include Q "
                "(rationals), R (reals), C (complexes), and finite fields F_p "
                "(integers mod p, for prime p). A field extension L/K is a "
                "field L containing K as a subfield. The degree [L:K] is the "
                "dimension of L as a vector space over K. An element is "
                "algebraic over K if it is a root of a polynomial with "
                "coefficients in K. The splitting field of a polynomial is the "
                "smallest extension over which the polynomial factors "
                "completely. Galois theory studies the symmetry group (Galois "
                "group) of a field extension."
            ),
            keywords=["field", "extension", "algebraic", "splitting field",
                       "Galois", "finite field", "vector space", "degree"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="vector_space_axioms",
            title="Vector Space Axioms",
            content=(
                "A vector space V over a field F is a set with an addition "
                "operation and scalar multiplication satisfying eight axioms: "
                "(1) associativity of addition, (2) commutativity of addition, "
                "(3) existence of zero vector, (4) existence of additive "
                "inverses, (5) compatibility of scalar multiplication with "
                "field multiplication, (6) identity element of scalar "
                "multiplication, (7) distributivity of scalar multiplication "
                "over vector addition, (8) distributivity of scalar "
                "multiplication over field addition. Key examples: R^n over R, "
                "function spaces, polynomial spaces. The concept unifies many "
                "areas of mathematics and is central to linear algebra."
            ),
            keywords=["vector space", "axiom", "field", "scalar", "addition",
                       "distributivity", "zero vector", "linear algebra"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="linear_independence",
            title="Linear Independence",
            content=(
                "A set of vectors {v1, v2, ..., vn} in a vector space is "
                "linearly independent if the only solution to c1*v1 + c2*v2 + "
                "... + cn*vn = 0 is c1 = c2 = ... = cn = 0. If some nontrivial "
                "combination gives zero, the set is linearly dependent. Linear "
                "independence is fundamental to the concepts of basis and "
                "dimension. A basis is a maximal linearly independent set, and "
                "the dimension of the space is the size of any basis. The "
                "number of vectors in any basis is invariant (well-defined). A "
                "matrix's rank equals the dimension of its column space (and "
                "row space)."
            ),
            keywords=["linear independence", "dependent", "basis", "dimension",
                       "rank", "matrix", "vector space"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="basis_and_dimension",
            title="Basis and Dimension",
            content=(
                "A basis of a vector space V is a set of vectors that is "
                "linearly independent and spans V (every vector in V is a "
                "linear combination of basis vectors). All bases of a "
                "finite-dimensional vector space have the same number of "
                "elements, called the dimension dim(V). The standard basis of "
                "R^n is {e1, e2, ..., en} where ei has a 1 in position i and "
                "0 elsewhere. A subspace W of V has dim(W) <= dim(V). The "
                "rank-nullity theorem states that for a linear map T: V -> W, "
                "dim(V) = rank(T) + nullity(T), where rank is dim(im(T)) and "
                "nullity is dim(ker(T))."
            ),
            keywords=["basis", "dimension", "span", "linear independence",
                       "subspace", "rank-nullity", "kernel", "image"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="eigenvalues",
            title="Eigenvalues and Eigenvectors",
            content=(
                "An eigenvector of a linear operator T (or square matrix A) is "
                "a nonzero vector v such that T(v) = lambda*v for some scalar "
                "lambda, called the eigenvalue. The eigenvalues are roots of "
                "the characteristic polynomial det(A - lambda*I) = 0. The set "
                "of eigenvalues is the spectrum. Eigenvectors corresponding to "
                "distinct eigenvalues are linearly independent. A matrix is "
                "diagonalizable if it has a basis of eigenvectors. Eigenvalues "
                "are crucial in differential equations, quantum mechanics, and "
                "data analysis (PCA). The trace equals the sum of eigenvalues "
                "and the determinant equals their product."
            ),
            keywords=["eigenvalue", "eigenvector", "characteristic polynomial",
                       "spectrum", "diagonalizable", "trace", "determinant",
                       "PCA"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="matrix_groups",
            title="Matrix Groups (Classical Groups)",
            content=(
                "Matrix groups are groups of invertible matrices under matrix "
                "multiplication. The general linear group GL(n, F) consists of "
                "all n-by-n invertible matrices over a field F. The special "
                "linear group SL(n, F) is the subgroup with determinant 1. The "
                "orthogonal group O(n) consists of matrices satisfying "
                "A^T A = I (preserving the dot product). The special orthogonal "
                "group SO(n) adds det = 1 (rotations). The unitary group U(n) "
                "and special unitary SU(n) are the complex analogues. These "
                "classical groups are central to geometry, physics, and "
                "representation theory. They are all examples of Lie groups "
                "(continuous groups)."
            ),
            keywords=["matrix group", "GL", "SL", "orthogonal", "unitary",
                       "Lie group", "determinant", "invertible"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="group_action",
            title="Group Actions",
            content=(
                "A group action of a group G on a set X is a map "
                "G x X -> X, written (g, x) -> g*x, satisfying e*x = x and "
                "(gh)*x = g*(h*x). The orbit of x is {g*x : g in G}, and the "
                "stabilizer of x is {g in G : g*x = x}. The orbit-stabilizer "
                "theorem states |G| = |orbit| * |stabilizer|. Group actions "
                "unify many concepts: Cayley's theorem (G acting on itself), "
                "conjugation (G acting on itself by conjugation), and symmetry "
                "groups (acting on geometric objects). Burnside's lemma counts "
                "orbits using the average number of fixed points."
            ),
            keywords=["group action", "orbit", "stabilizer",
                       "orbit-stabilizer", "conjugation", "Burnside",
                       "symmetry"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="sylow_theorems",
            title="Sylow Theorems",
            content=(
                "The Sylow theorems are fundamental results about finite "
                "groups. First Sylow: If p^k divides |G|, then G has a subgroup "
                "of order p^k (a Sylow p-subgroup has order p^a where p^a "
                "divides |G|). Second Sylow: All Sylow p-subgroups are "
                "conjugate. Third Sylow: The number n_p of Sylow p-subgroups "
                "satisfies n_p = 1 (mod p) and n_p divides |G|/p^a. These "
                "theorems are powerful tools for classifying finite groups. "
                "For example, if |G| = pq with p < q primes and p does not "
                "divide q-1, then G is cyclic. Sylow proved these in 1872."
            ),
            keywords=["Sylow", "p-subgroup", "conjugate", "finite group",
                       "cyclic", "prime", "classification"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="dihedral_group",
            title="Dihedral Groups",
            content=(
                "The dihedral group D_n (or D_{2n}) is the symmetry group of a "
                "regular n-gon, containing n rotations and n reflections, for "
                "a total of 2n elements. It is generated by a rotation r "
                "(order n) and a reflection s (order 2) with the relation "
                "srs = r^{-1}. D_n is non-abelian for n >= 3. The smallest "
                "non-abelian group is D_3 (isomorphic to S_3) of order 6. "
                "Dihedral groups are important examples in group theory: they "
                "illustrate semidirect products, have interesting subgroup "
                "structures, and serve as the simplest family of non-abelian "
                "groups."
            ),
            keywords=["dihedral", "symmetry", "rotation", "reflection",
                       "non-abelian", "semidirect product", "S3"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="group_representation",
            title="Group Representation Theory",
            content=(
                "A representation of a group G is a homomorphism "
                "rho: G -> GL(V), where V is a vector space. This realizes "
                "abstract group elements as matrices. Representation theory "
                "connects group theory to linear algebra and is essential in "
                "physics (quantum mechanics, particle physics) and chemistry "
                "(molecular symmetry). A representation is irreducible if V "
                "has no nontrivial G-invariant subspaces. Maschke's theorem "
                "states that over a field of characteristic not dividing |G|, "
                "every representation decomposes into irreducibles. Character "
                "theory (traces of representation matrices) provides a powerful "
                "tool for classifying representations of finite groups."
            ),
            keywords=["representation", "irreducible", "character", "Maschke",
                       "matrix", "GL", "quantum"],
            source="supplementary",
        ),
        KnowledgeEntry(
            id="lagrange_theorem_detail",
            title="Lagrange's Theorem (Detailed)",
            content=(
                "Lagrange's theorem: if H is a subgroup of a finite group G, "
                "then |H| divides |G|. The quotient |G|/|H| is the index "
                "[G:H], equal to the number of left (or right) cosets of H. A "
                "consequence: the order of any element g in G divides |G| "
                "(since the cyclic subgroup generated by g has order equal to "
                "the order of g). Another consequence: every group of prime "
                "order is cyclic. The converse of Lagrange's theorem is false "
                "in general -- not every divisor of |G| corresponds to a "
                "subgroup -- but Sylow's theorems provide partial converses "
                "for prime power divisors. Lagrange proved the original "
                "version for permutation groups in 1771."
            ),
            keywords=["Lagrange", "subgroup", "order", "coset", "index",
                       "prime", "cyclic", "divisor"],
            source="supplementary",
        ),
        # --- New Math movement and education philosophy ---
        KnowledgeEntry(
            id="new_math_movement",
            title="The New Math Movement (1958-1975)",
            content=(
                "The New Math movement was a sweeping reform of mathematics "
                "education that originated in the United States in the late "
                "1950s, triggered by the Soviet launch of Sputnik in 1957. "
                "The American Mathematical Society established the School "
                "Mathematics Study Group (SMSG) in 1958, led by Edward Begle "
                "of Yale University, to redesign the K-12 mathematics "
                "curriculum. The movement introduced set theory, abstract "
                "algebra, different number bases, and formal logic into "
                "elementary and secondary education. It was deeply influenced "
                "by the Bourbaki school's structuralist approach to "
                "mathematics. The movement failed by the mid-1970s due to "
                "excessive abstraction, inadequate teacher preparation, "
                "parental alienation, and disconnection from practical "
                "computation. Morris Kline's 1973 critique 'Why Johnny "
                "Can't Add' argued that the movement reversed the historical "
                "order of mathematical development: mathematics grows from "
                "applications to abstractions, not the reverse. Tom Lehrer's "
                "satirical song 'New Math' (1965) captured the public's "
                "frustration with the reform. Despite its failure, the New "
                "Math left a lasting legacy: the emphasis on understanding "
                "over rote calculation, the introduction of set notation, "
                "and the idea that mathematics is about structures."
            ),
            keywords=["New Math", "SMSG", "Sputnik", "Begle", "Bourbaki",
                       "Kline", "set theory", "education reform", "Tom Lehrer",
                       "structuralism", "curriculum", "failure"],
            source="education_history",
        ),
        KnowledgeEntry(
            id="bourbaki_influence",
            title="Bourbaki's Influence on Mathematics Education",
            content=(
                "The Bourbaki group, writing under the collective pseudonym "
                "Nicolas Bourbaki, attempted from the 1930s onward to unify "
                "all of pure mathematics through an axiomatic, structural "
                "approach. Their 'Éléments de mathématique' began with set "
                "theory and proceeded through algebra, topology, and analysis. "
                "Bourbaki's philosophy—that mathematics is fundamentally about "
                "structures (algebraic, topological, ordered)—directly "
                "inspired the New Math movement. The SMSG curriculum mirrored "
                "Bourbaki's approach: start with sets, build up to algebraic "
                "structures, emphasize axiomatics. However, what worked for "
                "professional mathematicians proved disastrous for children. "
                "The Bourbaki approach assumes years of mathematical maturity "
                "and intuition; imposing it on elementary students bypassed "
                "the cognitive development that makes abstraction meaningful. "
                "Vladimir Arnold later recalled that Soviet mathematics "
                "education, under Kolmogorov's influence, avoided the "
                "extreme upheavals seen elsewhere while still incorporating "
                "modern mathematical ideas. The lesson: structural elegance "
                "is a destination, not a starting point."
            ),
            keywords=["Bourbaki", "structure", "axiomatic", "Éléments",
                       "education", "Kolmogorov", "Arnold", "set theory",
                       "New Math", "structuralism"],
            source="education_history",
        ),
        KnowledgeEntry(
            id="morris_kline_critique",
            title="Morris Kline's Critique: Why Johnny Can't Add",
            content=(
                "Morris Kline (1908-1992), a mathematician at NYU, published "
                "'Why Johnny Can't Add: The Failure of the New Math' in 1973. "
                "His central argument was not that mathematical structure is "
                "unimportant, but that the New Math reversed the natural order "
                "of learning. Mathematics historically develops from "
                "applications to abstractions: counting precedes number "
                "theory, surveying precedes geometry, ballistics precedes "
                "calculus. Kline argued that education should follow this "
                "path—start with concrete problems, then abstract. He also "
                "criticized the New Math for: (1) ignoring the role of "
                "intuition in mathematical discovery, (2) treating "
                "mathematics as a static body of knowledge rather than a "
                "living tradition, (3) disconnecting mathematics from "
                "science and engineering, (4) using excessive formalism that "
                "obscured rather than illuminated. Kline advocated for a "
                "curriculum that integrates mathematics with its applications "
                "and historical development. His critique contributed to the "
                "'Back to Basics' movement of the 1980s, though the pendulum "
                "never fully returned to pure rote learning."
            ),
            keywords=["Kline", "Why Johnny Can't Add", "critique",
                       "intuition", "applications", "Back to Basics",
                       "formalism", "New Math", "failure"],
            source="education_history",
        ),
        KnowledgeEntry(
            id="mathweaver_new_math_response",
            title="MathWeaver's Response to the New Math Legacy",
            content=(
                "MathWeaver is designed as a conscious response to the "
                "lessons of the New Math movement. It shares the New Math's "
                "core intuition—that mathematics is about structure, not "
                "just computation—but addresses each of its failures: "
                "(1) Structure before intuition: MathWeaver uses a concept "
                "DAG (Directed Acyclic Graph) with 193 nodes, ensuring "
                "abstraction is introduced only after prerequisite "
                "intuition is established. The four-field cognitive state "
                "(perception, abstraction, epistemic, collaboration) tracks "
                "readiness in real time. (2) One-size-fits-all abstraction: "
                "the Grill mode adapts difficulty based on mastery, "
                "response time, and emotional state. Abstract concepts enter "
                "only when the learner's mastery exceeds threshold. "
                "(3) Emotional neglect: an Encouragement Engine detects "
                "frustration and provides growth-mindset support, reframing "
                "errors as discoveries. (4) Historical amnesia: the "
                "Historical Agent weaves the stories of Galois, Abel, "
                "Cayley, and others into the learning process, connecting "
                "learners to the human tradition behind the formulas. "
                "MathWeaver's guiding principle: structure is the "
                "destination, not the starting point. Abstraction should "
                "grow from within the learner's experience, not be imposed "
                "from above."
            ),
            keywords=["MathWeaver", "New Math", "DAG", "adaptive",
                       "encouragement", "historical", "structure",
                       "intuition", "cognitive state", "Z3"],
            source="design_philosophy",
        ),
    ]
