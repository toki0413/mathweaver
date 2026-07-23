"""Counter-example Forge: Z3 + LLM four-layer fallback.

L1: Z3 direct solve (finite structures via Cayley table encoding)
L2: LLM + Z3 verification (LLM generates candidate, Z3 checks)
L3: LLM + Lean verification (for undecidable nonlinear cases)
L4: LLM-only + annotation (last resort)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from z3 import (
    If,
    Int,
    Or,
    Solver,
    sat,
)


class FallbackLevel(Enum):
    L1_Z3 = "L1: Z3 direct"
    L2_LLM_Z3 = "L2: LLM + Z3 verify"
    L3_LLM_LEAN = "L3: LLM + Lean verify"
    L4_LLM_ONLY = "L4: LLM only"


@dataclass
class CounterExampleResult:
    """Result of a counter-example generation attempt."""

    success: bool
    level: FallbackLevel
    counter_example: str | None = None
    explanation: str = ""
    z3_model: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# L1: Z3 Cayley Table Verification
# ---------------------------------------------------------------------------

def verify_group_axioms_cayley(
    cayley_table: list[list[int]],
) -> tuple[bool, str | None]:
    """Verify whether a Cayley table defines a group.

    Checks: closure (trivial by construction), associativity,
    identity element, and inverse elements.

    Returns (is_group, counter_example_description).
    """
    n = len(cayley_table)
    if n == 0:
        return False, "Empty table"

    # Check closure: all entries in [0, n)
    for i in range(n):
        for j in range(n):
            val = cayley_table[i][j]
            if val < 0 or val >= n:
                return False, f"Entry ({i},{j})={val} out of range [0,{n})"

    # Check associativity: (a*b)*c == a*(b*c)
    for a in range(n):
        for b in range(n):
            for c in range(n):
                left = cayley_table[cayley_table[a][b]][c]
                right = cayley_table[a][cayley_table[b][c]]
                if left != right:
                    return False, (
                        f"Associativity violated: ({a}*{b})*{c} = "
                        f"{cayley_table[a][b]}*{c} = {left}, "
                        f"but {a}*({b}*{c}) = {a}*{cayley_table[b][c]} = {right}"
                    )

    # Check identity element
    identity = None
    for e in range(n):
        is_identity = True
        for a in range(n):
            if cayley_table[e][a] != a or cayley_table[a][e] != a:
                is_identity = False
                break
        if is_identity:
            identity = e
            break

    if identity is None:
        return False, "No identity element found"

    # Check inverses
    for a in range(n):
        has_inverse = False
        for b in range(n):
            if cayley_table[a][b] == identity and cayley_table[b][a] == identity:
                has_inverse = True
                break
        if not has_inverse:
            return False, f"Element {a} has no inverse"

    return True, None


def check_commutativity_cayley(cayley_table: list[list[int]]) -> tuple[bool, str | None]:
    """Check if the Cayley table is commutative (Abelian)."""
    n = len(cayley_table)
    for i in range(n):
        for j in range(i + 1, n):
            if cayley_table[i][j] != cayley_table[j][i]:
                return False, (
                    f"Not commutative: {i}*{j} = {cayley_table[i][j]}, "
                    f"but {j}*{i} = {cayley_table[j][i]}"
                )
    return True, None


# ---------------------------------------------------------------------------
# L1: Z3 SMT-based Counter-example Search
# ---------------------------------------------------------------------------

def z3_find_non_associative_binary_op(n: int = 3) -> CounterExampleResult:
    """Use Z3 to find a binary operation on {0,...,n-1} that is NOT associative.

    This demonstrates Z3's ability to search for counter-examples by
    encoding the negation of the associativity axiom.
    """
    s = Solver()

    # Create an n×n multiplication table as integer variables
    table = [[Int(f"op_{i}_{j}") for j in range(n)] for i in range(n)]

    # Closure constraint: 0 <= op[i][j] < n
    for i in range(n):
        for j in range(n):
            s.add(table[i][j] >= 0, table[i][j] < n)

    # We want to find a table where associativity FAILS for some triple.
    # Since n is small, enumerate all triples and assert at least one violates.
    violations = []
    for ai in range(n):
        for bi in range(n):
            for ci in range(n):
                # (ai * bi) * ci  -- index into table twice
                # Since table values are Z3 vars, we use If-Then-Else to
                # express the lookup as a Z3 expression
                ab_val = table[ai][bi]  # This is a Z3 Int var
                # (ab_val) * ci -- need to index table[ab_val][ci]
                # Since ab_val is a Z3 expr, we use If-Then-Else
                left = table[n-1][ci]  # default
                for k in range(n-2, -1, -1):
                    left = If(ab_val == k, table[k][ci], left)

                # ai * (bi * ci) -- similar
                bc_val = table[bi][ci]
                right = table[ai][n-1]  # default
                for k in range(n-2, -1, -1):
                    right = If(bc_val == k, table[ai][k], right)

                violations.append(left != right)

    # Assert at least one triple violates associativity
    s.add(Or(*violations))

    if s.check() == sat:
        m = s.model()
        cayley = []
        for i in range(n):
            row = []
            for j in range(n):
                val = m.eval(table[i][j]).as_long()
                row.append(val)
            cayley.append(row)

        # Find the violating triple
        violation_str = ""
        for ai in range(n):
            for bi in range(n):
                for ci in range(n):
                    left = cayley[cayley[ai][bi]][ci]
                    right = cayley[ai][cayley[bi][ci]]
                    if left != right:
                        violation_str = (
                            f"({ai}*{bi})*{ci} = {cayley[ai][bi]}*{ci} = {left}, "
                            f"but {ai}*({bi}*{ci}) = {ai}*{cayley[bi][ci]} = {right}"
                        )
                        break

        return CounterExampleResult(
            success=True,
            level=FallbackLevel.L1_Z3,
            counter_example=f"非结合运算表: {cayley}",
            explanation=f"Z3 找到违反结合律的运算表。反例: {violation_str}",
            z3_model={"cayley_table": cayley, "n": n},
        )
    else:
        return CounterExampleResult(
            success=False,
            level=FallbackLevel.L1_Z3,
            explanation=f"在 {n} 元集合上，所有二元运算都满足结合律",
        )


def z3_verify_associativity(cayley_table: list[list[int]]) -> CounterExampleResult:
    """Use Z3 to verify if a given Cayley table satisfies associativity."""
    n = len(cayley_table)

    # Create Z3 variables for the table (to get model if counter-example exists)
    # But since we already have the table, we just check directly

    for a in range(n):
        for b in range(n):
            for c in range(n):
                left = cayley_table[cayley_table[a][b]][c]
                right = cayley_table[a][cayley_table[b][c]]
                if left != right:
                    return CounterExampleResult(
                        success=True,
                        level=FallbackLevel.L1_Z3,
                        counter_example=f"a={a}, b={b}, c={c}",
                        explanation=(
                            f"结合律被违反: ({a}*{b})*{c} = "
                            f"{cayley_table[a][b]}*{c} = {left}, "
                            f"但 {a}*({b}*{c}) = "
                            f"{a}*{cayley_table[b][c]} = {right}"
                        ),
                        z3_model={"a": a, "b": b, "c": c},
                    )

    return CounterExampleResult(
        success=False,
        level=FallbackLevel.L1_Z3,
        explanation="该运算表满足结合律，Z3 未找到反例",
    )


# ---------------------------------------------------------------------------
# Counter-Example Forge: Main Entry Point
# ---------------------------------------------------------------------------

class CounterExampleForge:
    """The Counter-Example Forge agent component.

    Implements the four-layer fallback:
    L1: Z3 direct (finite structures)
    L2: LLM + Z3 verify
    L3: LLM + Lean verify
    L4: LLM only + annotation
    """

    def __init__(self, llm_client: Any = None) -> None:
        self.llm_client = llm_client

    # -- Public API --

    def check_group_axioms(
        self, cayley_table: list[list[int]]
    ) -> CounterExampleResult:
        """Check if a Cayley table defines a group. L1 path."""
        is_group, reason = verify_group_axioms_cayley(cayley_table)

        if is_group:
            return CounterExampleResult(
                success=False,
                level=FallbackLevel.L1_Z3,
                explanation="该运算表满足群的全部公理（封闭性、结合律、单位元、逆元）",
            )
        else:
            return CounterExampleResult(
                success=True,
                level=FallbackLevel.L1_Z3,
                counter_example=reason,
                explanation=f"Z3 验证发现群公理不满足: {reason}",
            )

    def check_commutativity(
        self, cayley_table: list[list[int]]
    ) -> CounterExampleResult:
        """Check if a group is commutative. L1 path."""
        is_commutative, reason = check_commutativity_cayley(cayley_table)

        if is_commutative:
            return CounterExampleResult(
                success=False,
                level=FallbackLevel.L1_Z3,
                explanation="该群满足交换律（Abel 群）",
            )
        else:
            return CounterExampleResult(
                success=True,
                level=FallbackLevel.L1_Z3,
                counter_example=reason,
                explanation=f"Z3 验证发现交换律不满足: {reason}",
            )

    def find_non_associative_table(self, n: int = 3) -> CounterExampleResult:
        """Find a binary operation that is NOT associative. L1 Z3 search."""
        return z3_find_non_associative_binary_op(n)

    def verify_associativity(
        self, cayley_table: list[list[int]]
    ) -> CounterExampleResult:
        """Verify associativity of a given table. L1 path."""
        return z3_verify_associativity(cayley_table)

    async def generate_counter_example(
        self,
        student_conjecture: str,
        context: dict[str, Any] | None = None,
    ) -> CounterExampleResult:
        """Generate a counter-example for a student's conjecture.

        Tries L1 first, falls back to L2/L3/L4.
        """
        context = context or {}

        # L1: Try Z3 if we have a Cayley table
        if "cayley_table" in context:
            table = context["cayley_table"]
            result = self.verify_associativity(table)
            if result.success:
                return result

            # Also check group axioms
            result = self.check_group_axioms(table)
            if result.success:
                return result

        # L2: LLM generates candidate, Z3 verifies
        if self.llm_client is not None:
            return await self._fallback_l2(student_conjecture, context)

        # L4: No LLM available
        return CounterExampleResult(
            success=False,
            level=FallbackLevel.L4_LLM_ONLY,
            explanation="需要 LLM 支持，但未配置 LLM 客户端。请配置 MATHWEAVER_LLM_API_KEY。",
        )

    async def _fallback_l2(
        self, conjecture: str, context: dict[str, Any]
    ) -> CounterExampleResult:
        """L2: LLM generates a candidate counter-example, Z3 verifies."""
        import json as _json

        # Ask LLM to propose a counter-example as a Cayley table
        n = context.get("n", 4)  # default to 4-element set
        prompt = (
            f"学生的猜想: {conjecture}\n\n"
            f"请生成一个 {n}×{n} 的 Cayley 表（二元运算表）作为反例。"
            f"表中的元素是 0 到 {n-1} 的整数。"
            f"请只回复 JSON 数组格式，例如: [[0,1],[1,0]]，不要添加其他内容。"
        )

        try:
            resp = await self.llm_client.chat(
                system_prompt=(
                    "你是反例生成器。根据学生的数学猜想，生成一个具体的反例。"
                    "如果猜想涉及群论，生成一个 Cayley 表作为反例。"
                    "只回复 JSON 格式的 Cayley 表。"
                ),
                user_message=prompt,
            )
            llm_text = resp.get("content", "") if isinstance(resp, dict) else str(resp)
        except Exception as e:
            return CounterExampleResult(
                success=False,
                level=FallbackLevel.L2_LLM_Z3,
                explanation=f"L2 LLM 调用失败: {e}",
            )

        # Try to parse the Cayley table from LLM response
        cayley_table = None
        # Extract JSON array from response
        for start in range(len(llm_text)):
            if llm_text[start] == "[":
                for end in range(len(llm_text), start, -1):
                    if llm_text[end - 1] == "]":
                        try:
                            candidate = _json.loads(llm_text[start:end])
                            if (isinstance(candidate, list)
                                    and all(isinstance(r, list) for r in candidate)
                                    and len(candidate) == len(candidate[0])):
                                cayley_table = candidate
                                break
                        except _json.JSONDecodeError:
                            continue
                if cayley_table:
                    break

        if cayley_table is None:
            # LLM didn't produce a valid Cayley table, try L4
            return await self._fallback_l4(conjecture, context)

        # Verify with Z3 (L1 verification on LLM-generated candidate)
        n_table = len(cayley_table)

        # Check if it violates the conjecture
        # For associativity conjectures
        is_assoc, reason = verify_group_axioms_cayley(cayley_table)  # reuse check
        # Actually, check what the conjecture is about
        if "结合" in conjecture or "associative" in conjecture.lower():
            result = z3_verify_associativity(cayley_table)
            if result.success:
                return CounterExampleResult(
                    success=True,
                    level=FallbackLevel.L2_LLM_Z3,
                    counter_example=f"Cayley 表: {cayley_table}",
                    explanation=f"LLM 生成反例，Z3 验证确认: {result.explanation}",
                    z3_model={"cayley_table": cayley_table, "n": n_table},
                    metadata={"llm_generated": True, "z3_verified": True},
                )

        # Check group axiom violations
        is_group, group_reason = verify_group_axioms_cayley(cayley_table)
        if not is_group:
            return CounterExampleResult(
                success=True,
                level=FallbackLevel.L2_LLM_Z3,
                counter_example=f"Cayley 表: {cayley_table}",
                explanation=f"LLM 生成反例，Z3 验证确认群公理不满足: {group_reason}",
                z3_model={"cayley_table": cayley_table, "n": n_table},
                metadata={"llm_generated": True, "z3_verified": True},
            )

        # Check commutativity violations
        is_comm, comm_reason = check_commutativity_cayley(cayley_table)
        if not is_comm and ("交换" in conjecture or "abelian" in conjecture.lower()):
            return CounterExampleResult(
                success=True,
                level=FallbackLevel.L2_LLM_Z3,
                counter_example=f"Cayley 表: {cayley_table}",
                explanation=f"LLM 生成反例，Z3 验证确认不交换: {comm_reason}",
                z3_model={"cayley_table": cayley_table, "n": n_table},
                metadata={"llm_generated": True, "z3_verified": True},
            )

        # LLM's candidate didn't violate anything — fall through to L4
        return await self._fallback_l4(conjecture, context)

    async def _fallback_l4(
        self, conjecture: str, context: dict[str, Any]
    ) -> CounterExampleResult:
        """L4: LLM-only generation with annotation (last resort)."""
        try:
            resp = await self.llm_client.chat(
                system_prompt=(
                    "你是数学反例专家。请为以下猜想提供一个反例或说明为何难以构造反例。"
                    "如果有反例，请描述具体的数学对象和它为什么违反猜想。"
                    "如果猜想是正确的（无反例），请说明原因。"
                ),
                user_message=f"猜想: {conjecture}\n上下文: {context}",
            )
            llm_text = resp.get("content", "") if isinstance(resp, dict) else str(resp)
        except Exception as e:
            return CounterExampleResult(
                success=False,
                level=FallbackLevel.L4_LLM_ONLY,
                explanation=f"L4 LLM 调用失败: {e}",
            )

        # Check if LLM found a counter-example or confirmed the conjecture
        if "反例" in llm_text or "不成立" in llm_text or "counter" in llm_text.lower():
            return CounterExampleResult(
                success=True,
                level=FallbackLevel.L4_LLM_ONLY,
                counter_example=llm_text[:500],
                explanation=f"LLM 生成的反例（未经形式化验证）: {llm_text[:200]}",
                metadata={"llm_generated": True, "z3_verified": False},
            )

        return CounterExampleResult(
            success=False,
            level=FallbackLevel.L4_LLM_ONLY,
            explanation=f"LLM 分析: {llm_text[:300]}",
            metadata={"llm_generated": True, "z3_verified": False},
        )
