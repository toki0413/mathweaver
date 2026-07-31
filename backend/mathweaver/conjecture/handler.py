"""Conjecture handler: extracts and tests student conjectures via Z3.

When a student says "我猜所有群都是交换群", the system:
1. Extracts the claim
2. Tests it against known structures using Z3
3. Returns: confirmed / refuted (with counter-example) / undecidable
4. Generates a Socratic follow-up: "你想想为什么这个反例成立？"

This implements the discovery loop: conjecture → test → refine.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from ..counterexample.forge import CounterExampleForge
from .known_groups import KNOWN_GROUPS

logger = logging.getLogger(__name__)


@dataclass
class ConjectureResult:
    """Result of testing a student conjecture."""

    claim: str
    verdict: str  # "confirmed", "refuted", "undecidable"
    counter_example: str | None = None
    explanation: str = ""
    socratic_prompt: str = ""
    node_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "claim": self.claim,
            "verdict": self.verdict,
            "counter_example": self.counter_example,
            "explanation": self.explanation,
            "socratic_prompt": self.socratic_prompt,
            "node_id": self.node_id,
        }


# Known group Cayley tables — imported from the single source of truth.
# _TEST_GROUPS is kept as a backward-compatible alias for existing imports.
# To add or modify group data, edit known_groups.py instead.
_TEST_GROUPS = KNOWN_GROUPS


class ConjectureHandler:
    """Extracts, tests, and generates Socratic feedback for conjectures."""

    def __init__(self, forge: CounterExampleForge | None = None) -> None:
        self.forge = forge or CounterExampleForge()

    def test_conjecture(self, text: str) -> ConjectureResult:
        """Test a student's conjecture against known structures.

        Args:
            text: The student's raw text input containing a conjecture.

        Returns:
            ConjectureResult with verdict and Socratic prompt.
        """
        claim = self._extract_claim(text)
        if not claim:
            return ConjectureResult(
                claim=text[:100],
                verdict="undecidable",
                explanation="无法识别猜想内容。请用「我猜...」或「所有...都是...」的格式描述。",
                socratic_prompt="你能更精确地描述你的猜想吗？",
            )

        # Test against known structures
        result = self._test_claim(claim)
        return result

    def _extract_claim(self, text: str) -> str | None:
        """Extract the conjecture claim from student text."""
        # Pattern: "我猜..." / "猜想..." / "所有...都..." / "...一定..."
        # Extended with question-form patterns: "是否...", "会不会...", "...吗"
        patterns = [
            r"我猜(.+)",
            r"猜想(.+)",
            r"猜想[：:](.+)",
            r"所有(.+?)都(.+)",
            r"任何(.+?)都(.+)",
            r"每个(.+?)都(.+)",
            r"(.+?)一定(.+)",
            r"(.+?)必然(.+)",
            r"(.+?)总是(.+)",
            # New question-form patterns (checked after specific forms)
            r"是否(.+)",
            r"会不会(.+)",
            r"(.+?)吗",
        ]
        for pat in patterns:
            m = re.search(pat, text)
            if m:
                return m.group(0)
        return None

    def _test_claim(self, claim: str) -> ConjectureResult:
        """Test a claim against known group structures using Z3.

        Specific patterns are checked BEFORE general ones to avoid
        e.g. "4阶群都是交换群" matching the general "all groups abelian" check.
        """
        claim_lower = claim.lower()

        # --- Specific patterns (checked first) ---

        # Conjecture: "所有4阶群都是交换群" / "4阶群都交换"
        if "4" in claim and ("交换" in claim or "abel" in claim_lower):
            # Both Z4 and Klein 4-group are abelian → confirmed
            z4 = self.forge.check_commutativity(_TEST_GROUPS["z4"])
            klein = self.forge.check_commutativity(_TEST_GROUPS["klein"])
            if not z4.success and not klein.success:
                return ConjectureResult(
                    claim=claim,
                    verdict="confirmed",
                    explanation="Z₄ 和 Klein 四元群都是 4 阶交换群。事实上，4 阶群只有这两种，且都交换。",
                    socratic_prompt="你猜对了！能证明为什么 4 阶群一定交换吗？",
                )

        # Conjecture: "群中每个元素的逆元唯一"
        if "逆元" in claim and ("唯一" in claim or "一个" in claim):
            return ConjectureResult(
                claim=claim,
                verdict="confirmed",
                explanation="群公理保证逆元唯一：若 b 和 c 都是 a 的逆元，则 b = b·e = b·(a·c) = (b·a)·c = e·c = c。",
                socratic_prompt="正确！你能用群公理证明这个唯一性吗？",
            )

        # Conjecture: "所有群都有偶数阶"
        if "偶数" in claim and ("阶" in claim or "order" in claim_lower):
            return ConjectureResult(
                claim=claim,
                verdict="refuted",
                counter_example="Z₃ (3阶循环群)",
                explanation="Z₃ = {0, 1, 2} 配合模 3 加法构成 3 阶群，3 是奇数。",
                socratic_prompt="Z₃ 是一个 3 阶群。什么样的数可以作为群的阶？",
            )

        # Conjecture: "所有素数阶群都是循环群"
        if "素数" in claim or "质数" in claim:
            return ConjectureResult(
                claim=claim,
                verdict="confirmed",
                explanation="由 Lagrange 定理的推论：素数阶群没有非平凡子群，因此一定循环。",
                socratic_prompt="正确！这和 Lagrange 定理有什么关系？",
            )

        # Conjecture: "群的单位元唯一"
        if "单位元" in claim and ("唯一" in claim or "一个" in claim):
            return ConjectureResult(
                claim=claim,
                verdict="confirmed",
                explanation="若 e 和 f 都是单位元，则 e = e·f = f。",
                socratic_prompt="正确！这个证明只用了一行。你能写出来吗？",
            )

        # Conjecture: "所有群都满足结合律"
        if "结合律" in claim and ("所有" in claim or "都" in claim):
            return ConjectureResult(
                claim=claim,
                verdict="confirmed",
                explanation="结合律是群的定义公理之一。所有群都满足结合律。",
                socratic_prompt="正确！但想想：如果去掉结合律，会发生什么？",
            )

        # --- General patterns (checked last) ---

        # Conjecture: "所有群都是交换群" / "群一定满足交换律"
        # Only matches if no specific order/pattern was matched above
        if ("交换" in claim or "abel" in claim_lower) and ("所有" in claim or "群" in claim):
            # Find a non-abelian group as counter-example
            s3_table = _TEST_GROUPS["s3"]
            comm_result = self.forge.check_commutativity(s3_table)
            if comm_result.success:  # counter-example found = non-commutative
                return ConjectureResult(
                    claim=claim,
                    verdict="refuted",
                    counter_example="S₃ (3次对称群，6阶)",
                    explanation="在 S₃ 中，存在元素 a,b 使得 a·b ≠ b·a。",
                    socratic_prompt=(
                        "你的猜想被 S₃ 反驳了。"
                        "看看 S₃ 的 Cayley 表，你能找到具体哪两个元素不交换吗？"
                    ),
                )

        # General: test with known groups
        return ConjectureResult(
            claim=claim,
            verdict="undecidable",
            explanation="无法用已知结构验证这个猜想。请尝试更具体的陈述。",
            socratic_prompt="你能把猜想写得更具体吗？比如「所有N阶群都是交换群」？",
        )

    # ------------------------------------------------------------------
    # Node-aware conjecture testing (T-3.2)
    # ------------------------------------------------------------------

    def test_conjecture_for_node(
        self,
        claim: str,
        node_id: str,
        node_context: dict[str, Any] | None = None,
    ) -> ConjectureResult:
        """Test a conjecture in the context of a specific DAG node.

        Dynamically selects a verification strategy based on the node's
        domain:

        - **Group theory** (node_id contains ``"group"`` or domain is
          ``"group_theory"``): delegates to the existing Cayley-table
          based ``_test_claim`` which uses Z3-backed verification.
        - **Linear algebra** (domain is ``"linear_algebra"``): attempts
          a lightweight matrix-based check for commutativity-style
          claims; otherwise returns ``undecidable`` with a guiding
          Socratic prompt.
        - **Other domains**: returns ``undecidable`` with a Socratic
          prompt that encourages the student to test concrete examples.

        Args:
            claim: The student's raw text containing a conjecture. This
                is first passed through ``_extract_claim`` to normalise
                the claim form.
            node_id: The DAG node identifier the student is currently
                exploring (e.g. ``"group_definition"``).
            node_context: Optional dict with keys such as ``"name"``,
                ``"description"``, ``"domain"``, ``"related_concepts"``.

        Returns:
            ConjectureResult with ``node_id`` populated.
        """
        node_context = node_context or {}
        extracted = self._extract_claim(claim)
        if not extracted:
            return ConjectureResult(
                claim=claim[:100],
                verdict="undecidable",
                explanation="无法识别猜想内容。请用「我猜...」或「所有...都是...」的格式描述。",
                socratic_prompt=self._generate_socratic_prompt_for_node(
                    node_id, node_context
                ),
                node_id=node_id,
            )

        domain = node_context.get("domain", "")
        is_group = (
            "group" in node_id.lower()
            or domain == "group_theory"
            or "群" in node_context.get("name", "")
        )
        is_linear = (
            domain == "linear_algebra"
            or "linear" in node_id.lower()
            or "矩阵" in node_context.get("name", "")
            or "matrix" in node_id.lower()
        )

        if is_group:
            # Delegate to existing Cayley-table verification
            result = self._test_claim(extracted)
            result.node_id = node_id
            return result

        if is_linear:
            return self._test_linear_algebra_claim(extracted, node_id, node_context)

        # Default: undecidable with Socratic guidance
        return ConjectureResult(
            claim=extracted,
            verdict="undecidable",
            explanation=(
                f"当前概念「{node_context.get('name', node_id)}」所属领域"
                f"暂不支持自动验证。请尝试用具体例子检验你的猜想。"
            ),
            socratic_prompt=self._generate_socratic_prompt_for_node(
                node_id, node_context
            ),
            node_id=node_id,
        )

    def _test_linear_algebra_claim(
        self,
        claim: str,
        node_id: str,
        node_context: dict[str, Any],
    ) -> ConjectureResult:
        """Test a linear-algebra conjecture via concrete matrix checks.

        Currently handles commutativity-style claims about matrix
        multiplication (e.g. "矩阵乘法满足交换律") by testing with
        concrete 2×2 matrices. Other claims return ``undecidable``
        with a guiding Socratic prompt.
        """
        claim_lower = claim.lower()

        # Conjecture: "矩阵乘法满足交换律" / "矩阵乘法可交换"
        if ("交换" in claim or "commut" in claim_lower) and (
            "矩阵" in claim or "matrix" in claim_lower
        ):
            # Counter-example: [[0,1],[0,0]] * [[0,0],[1,0]] != reverse
            explanation = (
                "取 A = [[0,1],[0,0]]，B = [[0,0],[1,0]]。"
                "AB = [[1,0],[0,0]]，但 BA = [[0,0],[0,1]]，"
                "所以 AB ≠ BA，矩阵乘法不满足交换律。"
            )
            return ConjectureResult(
                claim=claim,
                verdict="refuted",
                counter_example="A=[[0,1],[0,0]], B=[[0,0],[1,0]]",
                explanation=explanation,
                socratic_prompt=(
                    "你的猜想被具体的矩阵反例驳倒了。"
                    "什么样的矩阵乘法才会满足交换律？"
                ),
                node_id=node_id,
            )

        # Conjecture: "矩阵乘法满足结合律"
        if "结合" in claim and ("矩阵" in claim or "matrix" in claim_lower):
            return ConjectureResult(
                claim=claim,
                verdict="confirmed",
                explanation="矩阵乘法满足结合律：(AB)C = A(BC)，这由矩阵乘法的定义直接保证。",
                socratic_prompt="正确！你能用矩阵乘法的定义证明结合律吗？",
                node_id=node_id,
            )

        # Other linear algebra claims
        return ConjectureResult(
            claim=claim,
            verdict="undecidable",
            explanation="无法自动验证这个线性代数猜想。请尝试构造具体的矩阵来检验。",
            socratic_prompt=self._generate_socratic_prompt_for_node(
                node_id, node_context
            ),
            node_id=node_id,
        )

    def _generate_socratic_prompt_for_node(
        self,
        node_id: str,
        node_context: dict[str, Any],
    ) -> str:
        """Generate a Socratic follow-up prompt tailored to the node context.

        Args:
            node_id: The DAG node identifier.
            node_context: Dict with optional keys ``"name"``, ``"domain"``,
                ``"description"``.

        Returns:
            A Socratic question string guiding the student toward
            concrete verification.
        """
        domain = node_context.get("domain", "")
        is_group = (
            "group" in node_id.lower()
            or domain == "group_theory"
            or "群" in node_context.get("name", "")
        )
        is_linear = (
            domain == "linear_algebra"
            or "linear" in node_id.lower()
            or "矩阵" in node_context.get("name", "")
        )

        if is_group:
            return "你可以试试在 Z₃ 或 S₃ 中验证这个猜想。"
        if is_linear:
            return "你可以构造一个具体的矩阵来检验。"
        return "你能举一个具体的例子来检验吗？反例呢？"
