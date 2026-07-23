"""Tests for the counter-example forge."""

import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mathweaver.counterexample.forge import (
    CounterExampleForge,
    CounterExampleResult,
    FallbackLevel,
    check_commutativity_cayley,
    verify_group_axioms_cayley,
)

# Known group: Z3 (cyclic group of order 3)
# Cayley table for Z3: 0 is identity, addition mod 3
Z3_TABLE = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
]

# Non-group: missing identity
NON_GROUP_TABLE = [
    [0, 1, 2],
    [1, 0, 1],
    [2, 1, 0],
]

# Non-associative operation
NON_ASSOC_TABLE = [
    [0, 1, 2],
    [1, 1, 0],
    [2, 0, 2],
]

# Klein four-group (Abelian)
KLEIN_TABLE = [
    [0, 1, 2, 3],
    [1, 0, 3, 2],
    [2, 3, 0, 1],
    [3, 2, 1, 0],
]

# S3 (symmetric group on 3 elements, non-Abelian)
S3_TABLE = [
    [0, 1, 2, 3, 4, 5],
    [1, 0, 4, 5, 2, 3],
    [2, 5, 0, 4, 3, 1],
    [3, 4, 5, 0, 1, 2],
    [4, 3, 1, 2, 5, 0],
    [5, 2, 3, 1, 0, 4],
]


def test_z3_is_group_z3():
    """Z3 (cyclic group) should be verified as a group."""
    is_group, reason = verify_group_axioms_cayley(Z3_TABLE)
    assert is_group, f"Z3 should be a group but got: {reason}"


def test_z3_non_group():
    """Non-group table should be detected."""
    is_group, reason = verify_group_axioms_cayley(NON_GROUP_TABLE)
    assert not is_group, "Should detect non-group"
    assert reason is not None


def test_z3_non_associative():
    """Non-associative table should be detected."""
    forge = CounterExampleForge()
    result = forge.verify_associativity(NON_ASSOC_TABLE)
    assert result.success, "Should find associativity violation"


def test_z3_commutative_klein():
    """Klein four-group should be commutative."""
    is_comm, reason = check_commutativity_cayley(KLEIN_TABLE)
    assert is_comm, f"Klein group should be commutative: {reason}"


def test_z3_non_commutative_s3():
    """S3 should be detected as non-commutative."""
    is_comm, reason = check_commutativity_cayley(S3_TABLE)
    assert not is_comm, "S3 should not be commutative"


def test_forge_check_group_axioms():
    """Counter-example forge should check group axioms."""
    forge = CounterExampleForge()

    # Z3 is a group
    result = forge.check_group_axioms(Z3_TABLE)
    assert not result.success, "Z3 should pass group axiom check"

    # Non-group
    result = forge.check_group_axioms(NON_GROUP_TABLE)
    assert result.success, "Non-group should fail group axiom check"


def test_forge_find_non_associative():
    """Counter-example forge should find non-associative operations."""
    forge = CounterExampleForge()
    result = forge.find_non_associative_table(n=3)
    assert result.success, "Should find a non-associative operation on 3 elements"
    assert result.z3_model is not None
    assert "cayley_table" in result.z3_model


# ---------------------------------------------------------------------------
# Async tests for generate_counter_example (L1/L2/L4 fallback)
# ---------------------------------------------------------------------------

def _run(coro):
    """Run an async coroutine synchronously."""
    return asyncio.run(coro)


class MockLLM:
    """Mock LLM client for testing the forge's L2/L4 fallback paths.

    Returns a fixed response for every chat() call.
    The forge code uses: resp.get("content", "") if isinstance(resp, dict) else str(resp)
    So we return a dict with a "content" key.
    """

    def __init__(self, response_content: str):
        self.response_content = response_content
        self.call_count = 0
        self.calls: list[dict] = []

    async def chat(self, system_prompt, user_message, tools=None, temperature=0.7):
        self.call_count += 1
        self.calls.append({
            "system": system_prompt[:200],
            "user": user_message[:200],
        })
        return {"content": self.response_content}


class MockLLMSequence:
    """Mock LLM that returns different responses on successive calls.

    Useful for testing L2→L4 fallthrough where the LLM is called
    first by L2 (returning a Cayley table) and then by L4 (returning text).
    """

    def __init__(self, responses: list[str]):
        self.responses = responses
        self.call_index = 0
        self.calls: list[dict] = []

    async def chat(self, system_prompt, user_message, tools=None, temperature=0.7):
        idx = min(self.call_index, len(self.responses) - 1)
        content = self.responses[idx]
        self.call_index += 1
        self.calls.append({
            "system": system_prompt[:200],
            "user": user_message[:200],
            "returned": content[:200],
        })
        return {"content": content}


# Tables for async tests

# A table with no identity element (not a group), but IS associative
# All entries are 0, so: (a*b)*c = table[table[a][b]][c] = table[0][c] = 0
#                        a*(b*c) = table[a][table[b][c]] = table[a][0] = 0
# All triples agree -> associative.
# Identity: e=0 fails (table[0][1]=0 ≠ 1), e=1 fails (table[1][0]=0 ≠ 0). No identity!
NO_IDENTITY_TABLE = [
    [0, 0],
    [0, 0],
]


# ===========================================================================
# L1 → L4 Fallthrough Tests (no LLM available)
# ===========================================================================

def test_generate_no_llm_no_cayley_table():
    """Without LLM or cayley_table, should fall straight to L4 (failure).

    generate_counter_example:
    - No "cayley_table" in context -> skip L1
    - No LLM -> skip L2
    - Return L4 failure: "需要 LLM 支持"
    """
    forge = CounterExampleForge()  # no LLM
    result = _run(forge.generate_counter_example("所有群都是交换群"))
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert result.success is False
    assert "LLM" in result.explanation or "未配置" in result.explanation


def test_generate_no_llm_valid_group_falls_to_l4():
    """With a valid group Cayley table and no LLM, should fall L1→L4.

    L1: verify_associativity(Z3) -> no violation (success=False)
    L1: check_group_axioms(Z3) -> is_group=True -> success=False
    No LLM -> L4 failure.
    """
    forge = CounterExampleForge()  # no LLM
    result = _run(forge.generate_counter_example(
        "Z3 是一个群",
        context={"cayley_table": Z3_TABLE},
    ))
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert result.success is False


def test_generate_l1_finds_associativity_violation():
    """With a non-associative Cayley table, L1 should find the violation.

    L1: verify_associativity(NON_ASSOC_TABLE) -> finds violation -> returns L1 result.
    No LLM needed.
    """
    forge = CounterExampleForge()  # no LLM
    result = _run(forge.generate_counter_example(
        "这个运算满足结合律",
        context={"cayley_table": NON_ASSOC_TABLE},
    ))
    assert result.level == FallbackLevel.L1_Z3
    assert result.success is True
    assert result.counter_example is not None


def test_generate_l1_finds_group_axiom_violation():
    """With a non-group Cayley table, L1 should find the axiom violation.

    L1: verify_associativity(NON_GROUP_TABLE) -> finds violation -> returns L1 result.
    (verify_group_axioms checks associativity before identity/inverses.)
    """
    forge = CounterExampleForge()
    result = _run(forge.generate_counter_example(
        "这个结构是一个群",
        context={"cayley_table": NON_GROUP_TABLE},
    ))
    assert result.level == FallbackLevel.L1_Z3
    assert result.success is True


# ===========================================================================
# L2 Path Tests (mock LLM returns Cayley table)
# ===========================================================================

def test_generate_l2_non_associative_table():
    """L2 path: mock LLM returns a non-associative Cayley table.

    Conjecture contains "结合" so the L2 code checks associativity.
    The mock returns NON_ASSOC_TABLE as JSON -> Z3 finds the violation.
    """
    table_json = json.dumps(NON_ASSOC_TABLE)
    mock = MockLLM(table_json)
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有运算都满足结合律",
        context={},
    ))
    assert result.level == FallbackLevel.L2_LLM_Z3
    assert result.success is True
    assert mock.call_count == 1  # only L2 was called
    assert result.metadata.get("llm_generated") is True
    assert result.metadata.get("z3_verified") is True


def test_generate_l2_non_group_table():
    """L2 path: mock LLM returns a non-group Cayley table.

    Conjecture does NOT contain "结合", so the L2 code skips associativity
    and checks group axioms. The mock returns NON_GROUP_TABLE -> not a group.
    """
    table_json = json.dumps(NON_GROUP_TABLE)
    mock = MockLLM(table_json)
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "这个结构满足群公理",
        context={},
    ))
    assert result.level == FallbackLevel.L2_LLM_Z3
    assert result.success is True


def test_generate_l2_non_commutative_table():
    """L2 path: mock LLM returns a non-commutative group (S3).

    Conjecture contains "交换" so the L2 code checks commutativity.
    S3 is a valid group but non-commutative -> L2 finds the violation.
    """
    table_json = json.dumps(S3_TABLE)
    mock = MockLLM(table_json)
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有群都是交换群",
        context={},
    ))
    assert result.level == FallbackLevel.L2_LLM_Z3
    assert result.success is True


def test_generate_l2_valid_group_falls_to_l4():
    """L2 path: mock LLM returns a valid group, falls through to L4.

    The mock returns Z3_TABLE (a valid group). L2:
    1. "结合" in conjecture -> verify_associativity -> Z3 IS associative -> skip
    2. Group axioms -> Z3 IS a group -> skip
    3. "交换" in conjecture -> check_commutativity -> Z3 IS commutative -> skip
    4. Falls through to L4.

    L4 uses the same mock LLM, which returns the JSON table again.
    Since the text doesn't contain "反例"/"不成立"/"counter", L4 returns failure.
    """
    table_json = json.dumps(Z3_TABLE)
    mock = MockLLM(table_json)
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有运算都满足结合律且交换",
        context={},
    ))
    # Falls through to L4
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert mock.call_count == 2  # L2 called once, L4 called once


def test_generate_l2_invalid_json_falls_to_l4():
    """L2 path: mock LLM returns non-JSON text, falls through to L4.

    The mock returns "This is not a Cayley table" which can't be parsed as JSON.
    L2 fails to extract a Cayley table -> falls to L4.
    """
    mock = MockLLM("This is not a Cayley table. S3 is a counter-example.")
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有群都是交换群",
        context={},
    ))
    # Falls through to L4 because L2 couldn't parse a Cayley table
    assert result.level == FallbackLevel.L4_LLM_ONLY
    # L4 checks for "反例" in text — "counter" is in the text
    assert result.success is True
    assert mock.call_count == 2  # L2 + L4


# ===========================================================================
# L4 Path Tests (mock LLM returns text analysis)
# ===========================================================================

def test_generate_l4_text_with_counter_example():
    """L4 path: mock LLM returns text containing "反例" -> success."""
    mock = MockLLM("这是一个反例：S3 群不满足交换律。")
    forge = CounterExampleForge(llm_client=mock)

    # Provide a valid group table so L1 passes, then L2 gets a valid table
    # (from the mock), and falls to L4.
    # Actually, simpler: no cayley_table in context, L2 gets text (not JSON),
    # falls to L4 directly.
    mock = MockLLM("这是一个反例：考虑 S3 群，它不满足交换律。")
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有群都是交换群",
        context={},
    ))
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert result.success is True
    assert result.metadata.get("llm_generated") is True
    assert result.metadata.get("z3_verified") is False


def test_generate_l4_text_without_counter_example():
    """L4 path: mock LLM returns text without "反例" -> failure."""
    mock = MockLLM("这个猜想是正确的，所有群都满足这个性质。")
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有群都是交换群",
        context={},
    ))
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert result.success is False
    assert result.metadata.get("llm_generated") is True


def test_generate_l4_text_with_buchengli():
    """L4 path: text containing "不成立" should also trigger success."""
    mock = MockLLM("这个命题不成立，考虑非交换群的例子即可反驳。")
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有群都是交换群",
        context={},
    ))
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert result.success is True


def test_generate_l4_text_with_counter_english():
    """L4 path: text containing 'counter' (English) should trigger success."""
    mock = MockLLM("Here is a counter-example: S3 is non-abelian.")
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "all groups are abelian",
        context={},
    ))
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert result.success is True


# ===========================================================================
# L1 + L2 Integration Tests
# ===========================================================================

def test_generate_l1_then_l2_no_table_in_context():
    """Without cayley_table in context, L1 is skipped and L2 is tried.

    No LLM -> goes straight to L4 failure.
    With LLM -> L2 generates a candidate table.
    """
    mock = MockLLM(json.dumps(NON_ASSOC_TABLE))
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有运算都满足结合律",
        context={},  # no cayley_table
    ))
    # L2 path: mock returns non-associative table, Z3 verifies
    assert result.level == FallbackLevel.L2_LLM_Z3
    assert result.success is True


def test_generate_l1_finds_violation_before_l2():
    """When L1 finds a violation, L2 should NOT be called.

    With a non-associative cayley_table and an LLM client,
    L1 should find the violation and return before L2 is invoked.
    """
    mock = MockLLM("should not be called")
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "这个运算满足结合律",
        context={"cayley_table": NON_ASSOC_TABLE},
    ))
    assert result.level == FallbackLevel.L1_Z3
    assert result.success is True
    assert mock.call_count == 0  # LLM was never called


def test_generate_l1_group_check_finds_violation():
    """When associativity passes but group axioms fail, L1 group check triggers.

    With a table that's associative but not a group (no identity),
    verify_associativity returns success=False, then check_group_axioms
    finds the violation.
    """
    forge = CounterExampleForge()

    # First verify NO_IDENTITY_TABLE is associative (no violation found)
    assoc_result = forge.verify_associativity(NO_IDENTITY_TABLE)
    assert not assoc_result.success, "NO_IDENTITY_TABLE should be associative"

    # Now test the full generate flow
    result = _run(forge.generate_counter_example(
        "这个结构是一个群",
        context={"cayley_table": NO_IDENTITY_TABLE},
    ))
    # L1: verify_associativity -> passes (no violation found)
    # L1: check_group_axioms -> finds no identity -> returns L1 result
    assert result.level == FallbackLevel.L1_Z3
    assert result.success is True
    assert "identity" in result.counter_example.lower() or "单位元" in result.counter_example or "No identity" in result.counter_example


# ===========================================================================
# Edge Cases
# ===========================================================================

def test_generate_empty_conjecture():
    """An empty conjecture should still work through the fallback chain."""
    forge = CounterExampleForge()
    result = _run(forge.generate_counter_example(""))
    assert result.level == FallbackLevel.L4_LLM_ONLY
    assert result.success is False


def test_generate_with_context_n():
    """The context 'n' parameter should be passed to the L2 prompt."""
    mock = MockLLM(json.dumps(NON_ASSOC_TABLE))
    forge = CounterExampleForge(llm_client=mock)

    result = _run(forge.generate_counter_example(
        "所有运算都满足结合律",
        context={"n": 3},
    ))
    assert result.success is True
    # The L2 prompt should mention the n value
    assert len(mock.calls) >= 1


def test_counter_example_result_metadata():
    """CounterExampleResult should have the expected fields."""
    result = CounterExampleResult(
        success=True,
        level=FallbackLevel.L1_Z3,
        counter_example="test",
        explanation="test explanation",
    )
    assert result.success is True
    assert result.level == FallbackLevel.L1_Z3
    assert result.counter_example == "test"
    assert result.explanation == "test explanation"
    assert isinstance(result.metadata, dict)


def test_fallback_level_values():
    """FallbackLevel enum should have all four levels."""
    assert FallbackLevel.L1_Z3.value == "L1: Z3 direct"
    assert FallbackLevel.L2_LLM_Z3.value == "L2: LLM + Z3 verify"
    assert FallbackLevel.L3_LLM_LEAN.value == "L3: LLM + Lean verify"
    assert FallbackLevel.L4_LLM_ONLY.value == "L4: LLM only"
