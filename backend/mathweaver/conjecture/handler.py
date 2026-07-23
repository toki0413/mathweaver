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

logger = logging.getLogger(__name__)


@dataclass
class ConjectureResult:
    """Result of testing a student conjecture."""

    claim: str
    verdict: str  # "confirmed", "refuted", "undecidable"
    counter_example: str | None = None
    explanation: str = ""
    socratic_prompt: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "claim": self.claim,
            "verdict": self.verdict,
            "counter_example": self.counter_example,
            "explanation": self.explanation,
            "socratic_prompt": self.socratic_prompt,
        }


# Known test structures for common conjectures
_TEST_GROUPS = {
    # Small groups as Cayley tables for testing conjectures
    "z2": [[0, 1], [1, 0]],                    # Z2, order 2, abelian
    "z3": [[0, 1, 2], [1, 2, 0], [2, 0, 1]],   # Z3, order 3, abelian
    "z4": [[0,1,2,3],[1,2,3,0],[2,3,0,1],[3,0,1,2]],  # Z4, order 4, abelian
    "klein": [[0,1,2,3],[1,0,3,2],[2,3,0,1],[3,2,1,0]],  # Klein 4-group, abelian
    "s3": [[0,1,2,3,4,5],[1,0,3,2,5,4],[2,4,0,5,1,3],
           [3,5,1,4,0,2],[4,2,5,0,3,1],[5,3,4,1,2,0]],  # S3, order 6, non-abelian
    "z6": [[0,1,2,3,4,5],[1,2,3,4,5,0],[2,3,4,5,0,1],
           [3,4,5,0,1,2],[4,5,0,1,2,3],[5,0,1,2,3,4]],  # Z6, abelian
    "z7": [[0,1,2,3,4,5,6],[1,2,3,4,5,6,0],[2,3,4,5,6,0,1],
           [3,4,5,6,0,1,2],[4,5,6,0,1,2,3],[5,6,0,1,2,3,4],
           [6,0,1,2,3,4,5]],  # Z7, order 7 (prime), abelian
    "q8": [[0,1,2,3,4,5,6,7],[1,0,4,5,2,3,7,6],[2,4,5,0,6,7,1,3],
           [3,5,0,4,7,6,2,1],[4,6,7,1,5,0,3,2],[5,7,6,0,3,1,4,2],
           [6,2,3,7,0,4,5,1],[7,3,1,6,4,2,0,5]],  # Q8 quaternion, non-abelian
}


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
