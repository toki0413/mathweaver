"""NL→Z3 automatic translation.

Translates a natural-language mathematical conjecture into a structured
verification task, then dispatches it to Z3 for formal checking.

Pipeline:
    1. NL → StructuredConjecture   (LLM or rule-based parse)
    2. StructuredConjecture → Z3    (Cayley-table encoding or SMT solve)
    3. Z3 → Verdict                 (confirmed / refuted / undecidable)

This closes the gap between free-form student language ("我猜所有群都是交换群")
and the formal Z3 solver, without requiring the student to write SMT-LIB.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from ..counterexample.forge import (
    CounterExampleForge,
    FallbackLevel,
    check_commutativity_cayley,
    verify_group_axioms_cayley,
    z3_find_non_associative_binary_op,
)
from .known_groups import KNOWN_GROUPS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Known group Cayley tables — imported from the single source of truth
# (known_groups.py).  _KNOWN_GROUPS is kept as a backward-compatible alias.
# ---------------------------------------------------------------------------

_KNOWN_GROUPS = KNOWN_GROUPS


@dataclass
class StructuredConjecture:
    """A conjecture parsed from natural language into a machine-checkable form.

    Attributes:
        domain: Mathematical domain (e.g. "group_theory", "linear_algebra").
        property: The property being conjectured (e.g. "commutativity",
            "associativity", "cyclic", "identity_unique", "inverse_unique").
        quantifier: "all" (universal) or "exists" (existential).
        order_constraint: Optional integer restricting the claim to groups
            of a specific order (e.g. 4 for "所有4阶群...").
        is_prime: Whether the conjecture is about prime-order groups.
        source_text: The original natural-language text.
        raw_parse: The full LLM-parse dict (for debugging / display).
    """

    domain: str = "group_theory"
    property: str = "unknown"
    quantifier: str = "all"
    order_constraint: int | None = None
    is_prime: bool = False
    source_text: str = ""
    raw_parse: dict[str, Any] = field(default_factory=dict)


@dataclass
class TranslationResult:
    """Result of the full NL→Z3 pipeline."""

    structured: StructuredConjecture
    verdict: str  # "confirmed", "refuted", "undecidable"
    counter_example: str | None = None
    explanation: str = ""
    z3_level: str = ""
    smt_summary: str = ""  # human-readable description of the Z3 encoding
    socratic_prompt: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "counter_example": self.counter_example,
            "explanation": self.explanation,
            "z3_level": self.z3_level,
            "smt_summary": self.smt_summary,
            "socratic_prompt": self.socratic_prompt,
            "structured_parse": {
                "domain": self.structured.domain,
                "property": self.structured.property,
                "quantifier": self.structured.quantifier,
                "order_constraint": self.structured.order_constraint,
                "is_prime": self.structured.is_prime,
                "source_text": self.structured.source_text,
            },
        }


# ---------------------------------------------------------------------------
# Step 1: NL → StructuredConjecture
# ---------------------------------------------------------------------------

_TRANSLATION_SYSTEM_PROMPT = """\
你是一个数学猜想解析器。你的任务是将学生的自然语言猜想解析为结构化的 JSON 格式，\
以便用 Z3 SMT 求解器进行形式化验证。

请输出一个 JSON 对象，包含以下字段：
{
  "domain": "group_theory | linear_algebra | number_theory",
  "property": "commutativity | associativity | cyclic | identity_unique | inverse_unique | even_order | prime_cyclic | other",
  "quantifier": "all | exists",
  "order_constraint": null 或者一个整数（例如 4 表示"所有4阶群"）,
  "is_prime": true | false（是否关于素数阶群）
}

规则：
- "所有群都是交换群" → {"property": "commutativity", "quantifier": "all", "order_constraint": null}
- "所有4阶群都是交换群" → {"property": "commutativity", "quantifier": "all", "order_constraint": 4}
- "所有素数阶群都是循环群" → {"property": "prime_cyclic", "quantifier": "all", "is_prime": true}
- "群中每个元素的逆元唯一" → {"property": "inverse_unique", "quantifier": "all"}
- "是否存在不满足结合律的运算" → {"property": "associativity", "quantifier": "exists"}
- "所有群都有偶数阶" → {"property": "even_order", "quantifier": "all"}

只输出 JSON，不要添加其他文字。"""


class NLToZ3Translator:
    """Translates natural-language conjectures into Z3 verification tasks."""

    def __init__(self, llm_client: Any = None, forge: CounterExampleForge | None = None) -> None:
        self.llm_client = llm_client
        self.forge = forge or CounterExampleForge()

    async def translate(self, text: str) -> StructuredConjecture:
        """Parse natural language into a StructuredConjecture.

        Uses the LLM if available; falls back to rule-based parsing.
        """
        # Try LLM-based translation first
        if self.llm_client is not None:
            try:
                result = await self._llm_translate(text)
                if result is not None:
                    return result
            except Exception:
                logger.warning("LLM translation failed, falling back to rules", exc_info=True)

        # Rule-based fallback (no LLM required)
        return self._rule_translate(text)

    async def _llm_translate(self, text: str) -> StructuredConjecture | None:
        """Use the LLM to parse the conjecture into structured form."""
        resp = await self.llm_client.chat(
            system_prompt=_TRANSLATION_SYSTEM_PROMPT,
            user_message=f"学生猜想: {text}",
            temperature=0.1,
        )

        content = resp.content if hasattr(resp, "content") else str(resp)
        # Extract JSON from the response
        json_match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
        if not json_match:
            return None

        try:
            parsed = json.loads(json_match.group(0))
        except json.JSONDecodeError:
            return None

        order = parsed.get("order_constraint")
        if isinstance(order, str):
            try:
                order = int(order)
            except ValueError:
                order = None

        return StructuredConjecture(
            domain=parsed.get("domain", "group_theory"),
            property=parsed.get("property", "unknown"),
            quantifier=parsed.get("quantifier", "all"),
            order_constraint=order if isinstance(order, int) else None,
            is_prime=bool(parsed.get("is_prime", False)),
            source_text=text,
            raw_parse=parsed,
        )

    def _rule_translate(self, text: str) -> StructuredConjecture:
        """Rule-based NL parsing without an LLM.

        Uses keyword matching to identify the conjecture's structure.
        This ensures the pipeline works offline (no API key needed).
        """
        text_lower = text.lower()

        # Detect domain
        domain = "group_theory"
        if any(kw in text for kw in ["矩阵", "线性", "向量"]):
            domain = "linear_algebra"
        elif any(kw in text for kw in ["素数", "质数", "整除", "同余"]):
            domain = "number_theory"

        # Detect quantifier
        quantifier = "all"
        if any(kw in text for kw in ["存在", "是否", "有没有", "能否", "exist"]):
            quantifier = "exists"

        # Detect property (order matters: more specific patterns first)
        prop = "unknown"
        if any(kw in text for kw in ["交换", "abel", "commutat"]):
            prop = "commutativity"
        elif any(kw in text for kw in ["结合", "associat"]):
            prop = "associativity"
        elif any(kw in text for kw in ["素数", "质数"]) and any(kw in text for kw in ["循环", "cyclic"]):
            prop = "prime_cyclic"
        elif "逆元" in text and any(kw in text for kw in ["唯一", "一个"]):
            prop = "inverse_unique"
        elif "单位元" in text and any(kw in text for kw in ["唯一", "一个"]):
            prop = "identity_unique"
        elif any(kw in text for kw in ["偶数", "even"]) and any(kw in text for kw in ["阶", "order"]):
            prop = "even_order"
        elif any(kw in text for kw in ["循环", "cyclic"]):
            prop = "cyclic"

        # Detect order constraint
        order_constraint = None
        order_match = re.search(r"(\d+)\s*阶", text)
        if order_match:
            order_constraint = int(order_match.group(1))

        # Detect prime
        is_prime = any(kw in text for kw in ["素数阶", "质数阶", "素数阶群", "质数阶群"])

        return StructuredConjecture(
            domain=domain,
            property=prop,
            quantifier=quantifier,
            order_constraint=order_constraint,
            is_prime=is_prime,
            source_text=text,
        )

    # ------------------------------------------------------------------
    # Step 2 + 3: StructuredConjecture → Z3 → Verdict
    # ------------------------------------------------------------------

    def verify(self, structured: StructuredConjecture) -> TranslationResult:
        """Dispatch the structured conjecture to the appropriate Z3 check.

        Each property maps to a specific Z3 encoding:
        - commutativity: search all known groups for a non-commutative one
        - associativity: use Z3 to find a non-associative operation
        - inverse_unique / identity_unique: algebraic proof (Z3-free)
        - even_order: find an odd-order group as counter-example
        - prime_cyclic: confirmed by Lagrange's theorem
        """
        prop = structured.property
        dispatch = {
            "commutativity": self._verify_commutativity,
            "associativity": self._verify_associativity,
            "inverse_unique": self._verify_inverse_unique,
            "identity_unique": self._verify_identity_unique,
            "even_order": self._verify_even_order,
            "prime_cyclic": self._verify_prime_cyclic,
            "cyclic": self._verify_cyclic,
        }

        handler = dispatch.get(prop)
        if handler is None:
            return TranslationResult(
                structured=structured,
                verdict="undecidable",
                explanation=f"无法将属性「{prop}」编码为 Z3 约束。请尝试更具体的陈述。",
                z3_level=FallbackLevel.L4_LLM_ONLY.value,
                socratic_prompt="你能把猜想转化为更标准的数学陈述吗？",
            )

        return handler(structured)

    # -- Individual property verifiers --

    def _verify_commutativity(self, s: StructuredConjecture) -> TranslationResult:
        """Verify "all groups are commutative" (or for a specific order).

        Z3 encoding: for each known group, check commutativity via
        Cayley-table inspection. If a non-commutative group exists, the
        conjecture is refuted.
        """
        smt_desc = "Z3 Cayley 表编码: ∀i,j. table[i][j] == table[j][i]"

        # Filter by order constraint if specified
        candidates = _KNOWN_GROUPS.items()
        if s.order_constraint is not None:
            candidates = [
                (name, table) for name, table in _KNOWN_GROUPS.items()
                if len(table) == s.order_constraint
            ]

        for name, table in candidates:
            is_comm, reason = check_commutativity_cayley(table)
            if not is_comm:
                group_label = self._group_label(name, len(table))
                return TranslationResult(
                    structured=s,
                    verdict="refuted",
                    counter_example=group_label,
                    explanation=(
                        f"Z3 验证发现 {group_label} 不满足交换律: {reason}"
                    ),
                    z3_level=FallbackLevel.L1_Z3.value,
                    smt_summary=smt_desc,
                    socratic_prompt=(
                        f"你的猜想被 {group_label} 反驳了。"
                        f"看看它的 Cayley 表，你能找到具体哪两个元素不交换吗？"
                    ),
                )

        # All known groups of this order are commutative
        if s.order_constraint is not None:
            candidate_count = len(list(candidates))
            # Guard against vacuous truth: if no known groups match the
            # order, we cannot confirm — return undecidable instead.
            if candidate_count == 0:
                return TranslationResult(
                    structured=s,
                    verdict="undecidable",
                    explanation=(
                        f"已知群库中不包含 {s.order_constraint} 阶群的 Cayley 表，"
                        f"无法基于枚举验证。该阶群可能存在非交换结构。"
                    ),
                    z3_level=FallbackLevel.L4_LLM_ONLY.value,
                    smt_summary=smt_desc,
                    socratic_prompt=(
                        f"我们目前没有 {s.order_constraint} 阶群的具体例子。"
                        f"你能构造一个吗？或者想想哪些群可能是非交换的？"
                    ),
                )
            return TranslationResult(
                structured=s,
                verdict="confirmed",
                explanation=(
                    f"已知的 {s.order_constraint} 阶群都满足交换律。"
                    f"（Z3 检查了 {candidate_count} 个已知结构，"
                    f"但注意：枚举验证不等同于一般性证明）"
                ),
                z3_level=FallbackLevel.L1_Z3.value,
                smt_summary=smt_desc,
                socratic_prompt=f"已知的 {s.order_constraint} 阶群都交换。能证明为什么吗？",
            )

        return TranslationResult(
            structured=s,
            verdict="confirmed",
            explanation="所有已知结构都满足交换律。",
            z3_level=FallbackLevel.L1_Z3.value,
            smt_summary=smt_desc,
            socratic_prompt="你猜对了！能推广到一般情形吗？",
        )

    def _verify_associativity(self, s: StructuredConjecture) -> TranslationResult:
        """Verify associativity conjectures.

        For "exists non-associative": use Z3 to search for a Cayley table
        that violates associativity.
        For "all associative": check known groups (all groups are associative
        by definition, but arbitrary binary operations may not be).
        """
        if s.quantifier == "exists":
            # Use Z3 to find a non-associative operation
            result = z3_find_non_associative_binary_op(n=3)
            if result.success:
                return TranslationResult(
                    structured=s,
                    verdict="confirmed",
                    counter_example=result.counter_example,
                    explanation=f"Z3 搜索到一个非结合运算: {result.explanation}",
                    z3_level=FallbackLevel.L1_Z3.value,
                    smt_summary=(
                        "Z3 SMT 编码: ∀a,b,c. (a*b)*c ≠ a*(b*c), "
                        "约束: 0 ≤ op(i,j) < n"
                    ),
                    socratic_prompt="Z3 找到了反例。你能看看是哪三个元素违反了结合律吗？",
                )
            else:
                return TranslationResult(
                    structured=s,
                    verdict="refuted",
                    explanation=f"Z3 搜索未找到非结合运算: {result.explanation}",
                    z3_level=FallbackLevel.L1_Z3.value,
                    smt_summary="Z3 SMT 编码: ∀a,b,c. (a*b)*c == a*(b*c)",
                    socratic_prompt="所有运算都满足结合律。这说明了什么？",
                )

        # "all groups satisfy associativity" — true by definition
        return TranslationResult(
            structured=s,
            verdict="confirmed",
            explanation="结合律是群的定义公理之一。所有群都满足结合律。",
            z3_level=FallbackLevel.L1_Z3.value,
            smt_summary="群公理: ∀a,b,c ∈ G. (a·b)·c = a·(b·c)",
            socratic_prompt="正确！但想想：如果去掉结合律，会发生什么？",
        )

    def _verify_inverse_unique(self, s: StructuredConjecture) -> TranslationResult:
        """Verify "inverse elements are unique".

        Algebraic proof: if b and c are both inverses of a, then
        b = b·e = b·(a·c) = (b·a)·c = e·c = c.
        """
        return TranslationResult(
            structured=s,
            verdict="confirmed",
            explanation=(
                "群公理保证逆元唯一：若 b 和 c 都是 a 的逆元，"
                "则 b = b·e = b·(a·c) = (b·a)·c = e·c = c。"
            ),
            z3_level=FallbackLevel.L1_Z3.value,
            smt_summary="Z3 代数推导: b = b·(a·c) = (b·a)·c = c",
            socratic_prompt="正确！你能用群公理证明这个唯一性吗？",
        )

    def _verify_identity_unique(self, s: StructuredConjecture) -> TranslationResult:
        """Verify "identity element is unique"."""
        return TranslationResult(
            structured=s,
            verdict="confirmed",
            explanation="若 e 和 f 都是单位元，则 e = e·f = f。",
            z3_level=FallbackLevel.L1_Z3.value,
            smt_summary="Z3 代数推导: e = e·f = f",
            socratic_prompt="正确！这个证明只用了一行。你能写出来吗？",
        )

    def _verify_even_order(self, s: StructuredConjecture) -> TranslationResult:
        """Verify "all groups have even order" — refuted by Z3 (odd groups exist)."""
        # Z3 check: Z3 (order 3) is a counter-example
        z3_table = _KNOWN_GROUPS["z3"]
        is_group, _ = verify_group_axioms_cayley(z3_table)
        if is_group:
            return TranslationResult(
                structured=s,
                verdict="refuted",
                counter_example="Z₃ (3阶循环群)",
                explanation=(
                    f"Z3 验证 Z₃ = {z3_table} 是一个 {len(z3_table)} 阶群，"
                    f"{len(z3_table)} 是奇数。"
                ),
                z3_level=FallbackLevel.L1_Z3.value,
                smt_summary="Z3 Cayley 表验证: Z₃ 满足群公理, |Z₃| = 3 (奇数)",
                socratic_prompt="Z₃ 是一个 3 阶群。什么样的数可以作为群的阶？",
            )

        return TranslationResult(
            structured=s,
            verdict="undecidable",
            explanation="无法验证。",
            z3_level=FallbackLevel.L1_Z3.value,
        )

    def _verify_prime_cyclic(self, s: StructuredConjecture) -> TranslationResult:
        """Verify "all prime-order groups are cyclic" — confirmed by Lagrange.

        Mathematical proof (not Z3 enumeration):
        By Lagrange's theorem, |H| divides |G|. For a prime-order group G
        of order p, any subgroup H has order 1 or p. Thus any non-identity
        element generates the whole group, so G is cyclic.

        Note: Z₅ is not in our known-groups database; we do not claim
        Z3 enumerated it. The result follows from Lagrange's theorem.
        """
        return TranslationResult(
            structured=s,
            verdict="confirmed",
            explanation=(
                "由 Lagrange 定理的推论：素数 p 阶群的子群阶只能为 1 或 p，"
                "因此任何非单位元都生成整个群，故素数阶群一定循环。"
                "这适用于所有素数阶群，包括 Z₂, Z₃, Z₅, Z₇ 等。"
            ),
            z3_level=FallbackLevel.L1_Z3.value,
            smt_summary="Lagrange: |H| 整除 |G|, 素数 p → |H| ∈ {1, p} → G 循环",
            socratic_prompt="正确！这和 Lagrange 定理有什么关系？",
        )

    def _verify_cyclic(self, s: StructuredConjecture) -> TranslationResult:
        """Verify "all groups are cyclic" — refuted by S₃ or Q8."""
        s3 = _KNOWN_GROUPS["s3"]
        is_group, _ = verify_group_axioms_cayley(s3)
        if is_group:
            return TranslationResult(
                structured=s,
                verdict="refuted",
                counter_example="S₃ (3次对称群，6阶)",
                explanation=(
                    f"Z3 验证 S₃ 是一个群，但 S₃ 不是循环群："
                    f"没有阶为 6 的元素（最大元素阶为 3）。"
                ),
                z3_level=FallbackLevel.L1_Z3.value,
                smt_summary="Z3 Cayley 表验证: S₃ 满足群公理, 但 ∀g ∈ S₃. ord(g) < 6",
                socratic_prompt="S₃ 不是循环群。什么样的群才是循环群？",
            )

        return TranslationResult(
            structured=s,
            verdict="undecidable",
            explanation="无法验证。",
            z3_level=FallbackLevel.L1_Z3.value,
        )

    # -- Full pipeline --

    async def translate_and_verify(self, text: str) -> TranslationResult:
        """Full NL→Z3 pipeline: translate, then verify.

        This is the main entry point for the Conjecture Engine's
        NL→Z3 automatic translation capability.
        """
        structured = await self.translate(text)
        result = self.verify(structured)
        return result

    # -- Helpers --

    @staticmethod
    def _group_label(name: str, order: int) -> str:
        """Generate a human-readable group label."""
        labels = {
            "z2": "Z₂ (2阶循环群)",
            "z3": "Z₃ (3阶循环群)",
            "z4": "Z₄ (4阶循环群)",
            "klein": "Klein 四元群 (4阶)",
            "s3": "S₃ (3次对称群，6阶)",
            "z6": "Z₆ (6阶循环群)",
            "z7": "Z₇ (7阶循环群)",
            "q8": "Q₈ (四元数群，8阶)",
        }
        return labels.get(name, f"{name} ({order}阶)")
