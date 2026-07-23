"""Historical narrative weaving: embed math history into conjecture responses.

When a student's conjecture is tested, the system weaves in relevant
historical context — not as a dry fact, but as a story that connects
the student's discovery to the mathematicians who made the same journey.

Design philosophy — response to the New Math movement (1958-1975):
The New Math treated mathematics as a static body of axioms, stripping away
the human stories behind the formulas. This module does the opposite:
it reconnects each conjecture to the mathematician who first grappled with
it, making structure emerge from narrative rather than replacing it.
See: docs/new-math-reflection.md
"""

from __future__ import annotations

from typing import Any

# Historical narratives keyed by conjecture topic keywords.
# Each entry has: context (the story), connection (how it relates to the student's conjecture)
_NARRATIVES: dict[str, dict[str, str]] = {
    "abelian": {
        "context": (
            "Abel 在研究五次方程求根公式时发现，某些多项式根的对称性"
            "可以用群来描述。他证明了五次以上方程没有一般根式解——"
            "关键在于 S₅ 的结构。交换群以他的名字命名，正是因为他"
            "第一个系统研究了「运算可交换」这一性质的影响。"
        ),
        "connection": "你关于交换性的猜想，正是 Abel 当年思考的核心问题之一。",
    },
    "inverse": {
        "context": (
            "逆元的概念可以追溯到 Euler 和 Gauss 的工作。"
            "Gauss 在《算术研究》中系统地研究了模运算下的逆元，"
            "虽然他没用「群」这个词。直到 1854 年，Cayley 才正式"
            "定义了群——包括逆元公理。"
        ),
        "connection": "你对逆元唯一性的直觉，与 Cayley 当年抽象出群定义时的思路一致。",
    },
    "identity": {
        "context": (
            "单位元的概念看似简单，但它的「唯一性」曾让早期数学家困惑。"
            "Gauss 在研究模运算时默认了单位元的存在，但没有证明其唯一性。"
            "直到群论公理化后，这成为了一个基本定理。"
        ),
        "connection": "你关注单位元的唯一性，说明你在思考公理的最小性——这是公理化的核心。",
    },
    "associativity": {
        "context": (
            "结合律看似理所当然，但 Hamilton 在构造四元数时发现，"
            "牺牲交换律是可以接受的（四元数乘法不交换），但结合律"
            "必须保留。后来 Cayley 数和八元数逐步放弃了更多性质——"
            "八元数甚至不满足结合律，但依然是有用的结构。"
        ),
        "connection": "你思考结合律的必要性，正是 Hamilton 当年构造新数系时的关键抉择。",
    },
    "cyclic": {
        "context": (
            "循环群是最简单的群结构。Gauss 证明了 Z_p（p 为素数）的"
            "乘法群是循环群——这是他数论研究的基石之一。"
            "循环群的生成元概念，后来成为 Galois 理论的核心工具。"
        ),
        "connection": "你对循环群的理解，直接通向 Galois 理论——用群论解决方程可解性问题。",
    },
    "prime_order": {
        "context": (
            "Lagrange 定理（子群的阶整除群的阶）是群论最基本的定理之一。"
            "它的推论——素数阶群必循环——看似简单，但背后是"
            "深刻的对称性论证。Lagrange 本人在 1770 年代研究"
            "多项式根的对称函数时就隐含使用了这个思想。"
        ),
        "connection": "你的猜想涉及素数阶群的性质，这正是 Lagrange 定理最优雅的应用之一。",
    },
    "even_order": {
        "context": (
            "群的阶可以是任何正整数——1, 2, 3, ... 都对应群结构。"
            "Cauchy 定理告诉我们，如果素数 p 整除 |G|，则 G 中"
            "有 p 阶元素。3 阶群 Z₃ 是最简单的奇数阶群之一，"
            "也是最简单的非平凡循环群。"
        ),
        "connection": "你关于群阶的猜想，触及了 Cauchy 定理和 Sylow 定理的领域。",
    },
    "subgroup": {
        "context": (
            "子群的概念在 Galois 理论中至关重要：Galois 证明了"
            "方程可解当且仅当其 Galois 群有特定的子群链"
            "（可解群）。子群结构决定了方程的根式可解性。"
        ),
        "connection": "你研究子群的直觉，直接通向 Galois 理论的核心——方程的可解性。",
    },
    "lagrange": {
        "context": (
            "Lagrange 在 1770 年研究多项式根的对称函数时，"
            "隐含使用了子群大小整除群大小这一事实。"
            "但直到 150 年后，这个定理才被严格证明并命名。"
            "它的逆命题不成立——A₄ 没有 6 阶子群，这是"
            "最经典的反例之一。"
        ),
        "connection": "你触及了 Lagrange 定理及其逆命题——后者不成立，这是群论的反直觉之美。",
    },
}


def weave_narrative(
    conjecture_text: str,
    verdict: str,
    counter_example: str | None = None,
    conjecture_history: list[dict[str, Any]] | None = None,
) -> str:
    """Weave historical narrative into a conjecture response.

    Args:
        conjecture_text: The student's conjecture.
        verdict: "confirmed", "refuted", or "undecidable".
        counter_example: The counter-example if refuted.
        conjecture_history: Previous conjectures for multi-turn context.

    Returns:
        A historical narrative string, or empty string if no match.
    """
    text_lower = conjecture_text.lower()

    # Match conjecture to narrative
    narrative = None

    if "交换" in conjecture_text or "abel" in text_lower:
        narrative = _NARRATIVES.get("abelian")
    elif "逆元" in conjecture_text and ("唯一" in conjecture_text or "一个" in conjecture_text):
        narrative = _NARRATIVES.get("inverse")
    elif "单位元" in conjecture_text and ("唯一" in conjecture_text or "一个" in conjecture_text):
        narrative = _NARRATIVES.get("identity")
    elif "结合律" in conjecture_text:
        narrative = _NARRATIVES.get("associativity")
    elif "循环" in conjecture_text:
        narrative = _NARRATIVES.get("cyclic")
    elif "素数" in conjecture_text or "质数" in conjecture_text:
        narrative = _NARRATIVES.get("prime_order")
    elif "偶数" in conjecture_text and ("阶" in conjecture_text or "order" in text_lower):
        narrative = _NARRATIVES.get("even_order")
    elif "子群" in conjecture_text:
        narrative = _NARRATIVES.get("subgroup")
    elif "lagrange" in text_lower or "拉格朗日" in conjecture_text:
        narrative = _NARRATIVES.get("lagrange")

    if not narrative:
        return ""

    # Check if this is a refinement of a previous conjecture
    is_refinement = False
    if conjecture_history and len(conjecture_history) >= 2:
        for prev in conjecture_history[:-1]:
            if prev.get("verdict") == "refuted":
                is_refinement = True
                break

    parts: list[str] = []

    # Add the narrative
    parts.append(f"\n\n📖 {narrative['context'].strip()}")

    # Add the connection
    if is_refinement:
        parts.append(
            f"你修正了之前的猜想——{narrative['connection']}"
            "这种「猜想→反驳→修正」的循环，正是数学发现的本质。"
        )
    else:
        parts.append(narrative["connection"])

    return "\n".join(parts)


def weave_for_conjecture_metadata(ce_meta: dict[str, Any]) -> str:
    """Convenience: weave narrative from conjecture metadata.

    Args:
        ce_meta: The counter_example agent's metadata dict containing
                 conjecture_result, conjecture_verdict, etc.

    Returns:
        Historical narrative string.
    """
    result_dict = ce_meta.get("conjecture_result", {})
    claim = result_dict.get("claim", "")
    verdict = ce_meta.get("conjecture_verdict", "undecidable")
    counter_example = ce_meta.get("conjecture_counter_example")

    return weave_narrative(claim, verdict, counter_example)
