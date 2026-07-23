"""Tests for individual agents: Perception, Epistemic, Collaboration.

Tests the agent layer in isolation (without the orchestrator) to verify
correct input classification, cognitive diagnosis, and Socratic synthesis.
"""

import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio

import pytest

from mathweaver.agents.base import AgentContext
from mathweaver.agents.collaboration import CollaborationAgent
from mathweaver.agents.epistemic import EpistemicAgent
from mathweaver.agents.perception import PerceptionAgent
from mathweaver.models.state import (
    AgentRole,
    CognitiveState,
    EmotionalState,
    FourFieldState,
)


def _run(coro):
    """Run an async coroutine synchronously."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_state(**kwargs):
    """Create a FourFieldState with optional overrides.

    Supported kwargs:
        mastery, zpd_lower, zpd_upper, baseline_rt, consecutive_correct,
        backtrack_count, anxiety, flow, scaffold_fade_threshold
    """
    state = FourFieldState()
    for key, value in kwargs.items():
        if key == "mastery":
            state.knowledge.mastery_estimate = value
        elif key == "zpd_lower":
            state.knowledge.zpd_lower = value
        elif key == "zpd_upper":
            state.knowledge.zpd_upper = value
        elif key == "baseline_rt":
            state.cognitive.baseline_rt_ms = value
        elif key == "consecutive_correct":
            state.interaction.consecutive_correct = value
        elif key == "backtrack_count":
            state.cognitive.backtrack_count = value
        elif key == "anxiety":
            state.emotional.anxiety_index = value
        elif key == "flow":
            state.emotional.flow_score = value
        elif key == "scaffold_fade_threshold":
            state.interaction.scaffold_fade_threshold = value
    return state


def make_ctx(student_input="", state=None, prior_results=None, metadata=None):
    """Create an AgentContext for testing."""
    return AgentContext(
        student_input=student_input,
        four_field_state=state or FourFieldState(),
        prior_results=prior_results or {},
        metadata=metadata or {},
    )


def run_agent(agent, ctx):
    """Run an agent's async run() method synchronously."""
    return _run(agent.run(ctx))


# ===========================================================================
# PerceptionAgent Tests
# ===========================================================================

class TestPerceptionCayleyTable:
    """Test Cayley table JSON detection in PerceptionAgent."""

    def test_cayley_table_2x2(self):
        """A valid 2x2 Cayley table should be detected."""
        agent = PerceptionAgent()
        ctx = make_ctx("[[0,1],[1,0]]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "cayley_table"
        assert msg.metadata["cayley_table"] == [[0, 1], [1, 0]]
        assert msg.metadata["n"] == 2
        assert msg.confidence == 0.95
        assert "2x2" in msg.content or "2" in msg.content

    def test_cayley_table_3x3(self):
        """A valid 3x3 Cayley table (Z3) should be detected."""
        agent = PerceptionAgent()
        ctx = make_ctx("[[0,1,2],[1,2,0],[2,0,1]]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "cayley_table"
        assert msg.metadata["n"] == 3
        assert msg.metadata["cayley_table"] == [[0, 1, 2], [1, 2, 0], [2, 0, 1]]

    def test_cayley_table_4x4(self):
        """A valid 4x4 Cayley table (Klein four-group) should be detected."""
        agent = PerceptionAgent()
        ctx = make_ctx("[[0,1,2,3],[1,0,3,2],[2,3,0,1],[3,2,1,0]]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "cayley_table"
        assert msg.metadata["n"] == 4

    def test_cayley_table_rejects_out_of_range(self):
        """A table with values >= n should NOT be detected as a Cayley table.

        [[0,1],[1,2]] has value 2 which is >= n=2, so it fails the check
        and falls through to question/conjecture classification.
        """
        agent = PerceptionAgent()
        ctx = make_ctx("[[0,1],[1,2]]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] != "cayley_table"

    def test_cayley_table_rejects_non_square(self):
        """A non-square list-of-lists should not be treated as Cayley table."""
        agent = PerceptionAgent()
        # This is valid JSON but rows have different lengths.
        # json.loads succeeds, all() check on isinstance(r, list) passes,
        # but the value check will fail because n=2 but some values >= 2.
        ctx = make_ctx("[[0,1,2],[1,0]]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] != "cayley_table"

    def test_cayley_table_rejects_invalid_json(self):
        """Text that starts with [ and ends with ] but is not valid JSON
        should fall through to keyword-based classification.
        """
        agent = PerceptionAgent()
        ctx = make_ctx("[not valid json]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] in ("question", "conjecture")

    def test_cayley_table_with_whitespace(self):
        """A Cayley table with surrounding whitespace should still be parsed."""
        agent = PerceptionAgent()
        ctx = make_ctx("  [[0,1],[1,0]]  ")
        msg = run_agent(agent, ctx)

        # strip() is applied before checking startswith/endswith
        assert msg.metadata["input_type"] == "cayley_table"

    def test_cayley_table_metadata_structure(self):
        """Verify exact metadata keys for cayley_table input type."""
        agent = PerceptionAgent()
        ctx = make_ctx("[[0,1],[1,0]]")
        msg = run_agent(agent, ctx)

        meta = msg.metadata
        assert "input_type" in meta
        assert "cayley_table" in meta
        assert "n" in meta
        # cayley_table metadata should NOT have is_proof or is_conjecture
        assert "is_proof" not in meta
        assert "is_conjecture" not in meta


class TestPerceptionConjecture:
    """Test conjecture keyword detection in PerceptionAgent."""

    def test_conjecture_chinese_guess(self):
        """'我猜' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("我猜所有群都是交换群")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"
        assert msg.metadata["is_conjecture"] is True
        assert msg.metadata["raw_text"] == "我猜所有群都是交换群"

    def test_conjecture_chinese_conjecture(self):
        """'猜想' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("猜想：每个群都有子群")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"
        assert msg.metadata["is_conjecture"] is True

    def test_conjecture_chinese_all(self):
        """'所有' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("所有群的阶都是有限的")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"

    def test_conjecture_chinese_must(self):
        """'一定' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("群中一定存在逆元")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"

    def test_conjecture_chinese_necessarily(self):
        """'必然' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("必然存在一个单位元")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"

    def test_conjecture_english_all(self):
        """English 'all' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("all groups are abelian")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"
        assert msg.metadata["is_conjecture"] is True

    def test_conjecture_english_every(self):
        """English 'every' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("every group has an identity element")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"

    def test_conjecture_english_conjecture(self):
        """English 'conjecture' keyword should trigger conjecture detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("my conjecture is that this is a group")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "conjecture"

    def test_conjecture_metadata_structure(self):
        """Verify exact metadata keys for conjecture input type."""
        agent = PerceptionAgent()
        ctx = make_ctx("我猜这个结构是群")
        msg = run_agent(agent, ctx)

        meta = msg.metadata
        assert meta["input_type"] == "conjecture"
        assert meta["is_conjecture"] is True
        assert "raw_text" in meta
        # conjecture should NOT have is_proof key
        assert "is_proof" not in meta
        assert "cayley_table" not in meta


class TestPerceptionProof:
    """Test proof keyword detection in PerceptionAgent."""

    def test_proof_chinese_prove(self):
        """'证明' keyword should trigger proof detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("证明单位元唯一")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"
        assert msg.metadata["is_proof"] is True
        assert msg.metadata["is_conjecture"] is False

    def test_proof_chinese_qiuzheng(self):
        """'求证' keyword should trigger proof detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("求证群的结合律")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"
        assert msg.metadata["is_proof"] is True

    def test_proof_english_prove(self):
        """English 'prove' keyword should trigger proof detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("prove that the identity is unique")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"
        assert msg.metadata["is_proof"] is True

    def test_proof_english_proof(self):
        """English 'proof' keyword should trigger proof detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("here is a proof of associativity")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"

    def test_proof_chinese_woyaozheng(self):
        """'我要证' keyword should trigger proof detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("我要证群中逆元唯一")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"

    def test_proof_chinese_yanzheng(self):
        """'验证以下' keyword should trigger proof detection."""
        agent = PerceptionAgent()
        ctx = make_ctx("验证以下结构是否为群")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"

    def test_proof_case_insensitive_english(self):
        """English proof keywords should be case-insensitive."""
        agent = PerceptionAgent()
        ctx = make_ctx("PROVE that this holds")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"

    def test_proof_metadata_structure(self):
        """Verify exact metadata keys for proof_attempt input type."""
        agent = PerceptionAgent()
        ctx = make_ctx("证明单位元唯一")
        msg = run_agent(agent, ctx)

        meta = msg.metadata
        assert meta["input_type"] == "proof_attempt"
        assert meta["is_proof"] is True
        assert meta["is_conjecture"] is False
        assert "raw_text" in meta
        assert meta["raw_text"] == "证明单位元唯一"

    def test_proof_confidence(self):
        """Proof detection should have confidence 0.9."""
        agent = PerceptionAgent()
        ctx = make_ctx("证明单位元唯一")
        msg = run_agent(agent, ctx)

        assert msg.confidence == 0.9


class TestPerceptionQuestion:
    """Test regular question classification in PerceptionAgent."""

    def test_question_chinese(self):
        """A regular Chinese question should be classified as 'question'."""
        agent = PerceptionAgent()
        ctx = make_ctx("什么是群？")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "question"
        assert msg.metadata["is_conjecture"] is False

    def test_question_english(self):
        """A regular English question should be classified as 'question'."""
        agent = PerceptionAgent()
        ctx = make_ctx("what is a group?")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "question"

    def test_question_simple_word(self):
        """A simple word with no keywords should be classified as 'question'."""
        agent = PerceptionAgent()
        ctx = make_ctx("help")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "question"

    def test_question_metadata_structure(self):
        """Verify exact metadata keys for question input type."""
        agent = PerceptionAgent()
        ctx = make_ctx("什么是群？")
        msg = run_agent(agent, ctx)

        meta = msg.metadata
        assert meta["input_type"] == "question"
        assert meta["is_conjecture"] is False
        assert "raw_text" in meta
        # question should NOT have is_proof key
        assert "is_proof" not in meta

    def test_question_confidence(self):
        """Question/conjecture should have confidence 0.8."""
        agent = PerceptionAgent()
        ctx = make_ctx("什么是群？")
        msg = run_agent(agent, ctx)

        assert msg.confidence == 0.8


class TestPerceptionEdgeCases:
    """Test edge cases and priority in PerceptionAgent."""

    def test_proof_takes_priority_over_conjecture(self):
        """When text contains both proof and conjecture keywords,
        proof should take priority (proof is checked first)."""
        agent = PerceptionAgent()
        ctx = make_ctx("证明所有群都是交换群")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] == "proof_attempt"
        assert msg.metadata["is_proof"] is True
        assert msg.metadata["is_conjecture"] is False

    def test_empty_input(self):
        """Empty input should be classified as 'question'."""
        agent = PerceptionAgent()
        ctx = make_ctx("")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] in ("question", "conjecture")
        # Empty string has no conjecture keywords, so it should be "question"
        assert msg.metadata["input_type"] == "question"

    def test_call_count_increments(self):
        """Each call to run() should increment call_count."""
        agent = PerceptionAgent()
        assert agent.call_count == 0

        ctx = make_ctx("什么是群？")
        run_agent(agent, ctx)
        assert agent.call_count == 1

        ctx2 = make_ctx("证明单位元唯一")
        run_agent(agent, ctx2)
        assert agent.call_count == 2

    def test_role_is_perception(self):
        """PerceptionAgent should have role PERCEPTION."""
        agent = PerceptionAgent()
        assert agent.role == AgentRole.PERCEPTION

    def test_cayley_table_with_negative_values(self):
        """A table with negative values should not be detected as Cayley table."""
        agent = PerceptionAgent()
        # Values must be 0 <= v < n. Negative values fail the check.
        ctx = make_ctx("[[0,-1],[-1,0]]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] != "cayley_table"

    def test_cayley_table_not_list_of_lists(self):
        """A flat JSON list should not be detected as Cayley table."""
        agent = PerceptionAgent()
        ctx = make_ctx("[1, 2, 3]")
        msg = run_agent(agent, ctx)

        assert msg.metadata["input_type"] != "cayley_table"


# ===========================================================================
# EpistemicAgent Tests
# ===========================================================================

class TestEpistemicCognitiveLoad:
    """Test cognitive load calculation from response time."""

    def test_overload_high_response_time(self):
        """A very high response time should trigger OVERLOAD state.

        rt=20000, baseline=5000 -> z=(20000-5000)/5000=3.0
        z > 1.5 -> OVERLOAD, load=min(0.5+3.0*0.2, 1.0)=min(1.1,1.0)=1.0
        """
        agent = EpistemicAgent()
        state = make_state(baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 20000},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["rt_zscore"] == pytest.approx(3.0)
        assert msg.metadata["cognitive_load"] == pytest.approx(1.0)
        # Cognitive state should be OVERLOAD in field_updates
        assert msg.field_updates["cognitive"]["state"] == CognitiveState.OVERLOAD

    def test_optimal_fast_response(self):
        """A fast response time should trigger OPTIMAL state with low load.

        rt=1000, baseline=5000 -> z=(1000-5000)/5000=-0.8
        z < -0.5 -> OPTIMAL, load=max(0.3, 0.5+(-0.8)*0.15)=max(0.3, 0.38)=0.38
        """
        agent = EpistemicAgent()
        state = make_state(baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 1000},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["rt_zscore"] == pytest.approx(-0.8)
        assert msg.metadata["cognitive_load"] == pytest.approx(0.38)
        assert msg.field_updates["cognitive"]["state"] == CognitiveState.OPTIMAL

    def test_optimal_normal_response(self):
        """A normal response time (z in [-0.5, 1.5]) should be OPTIMAL with load=0.5.

        rt=5000, baseline=5000 -> z=0.0
        -0.5 <= 0.0 <= 1.5 -> OPTIMAL, load=0.5
        """
        agent = EpistemicAgent()
        state = make_state(baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 5000},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["rt_zscore"] == pytest.approx(0.0)
        assert msg.metadata["cognitive_load"] == pytest.approx(0.5)
        assert msg.field_updates["cognitive"]["state"] == CognitiveState.OPTIMAL

    def test_overload_boundary(self):
        """At z=1.5 exactly, should NOT be OVERLOAD (z > 1.5 is strict).

        rt=12500, baseline=5000 -> z=(12500-5000)/5000=1.5
        1.5 is NOT > 1.5, so falls to else branch: OPTIMAL, load=0.5
        """
        agent = EpistemicAgent()
        state = make_state(baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 12500},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["rt_zscore"] == pytest.approx(1.5)
        # z == 1.5 does NOT trigger OVERLOAD (strict >)
        assert msg.field_updates["cognitive"]["state"] == CognitiveState.OPTIMAL
        assert msg.metadata["cognitive_load"] == pytest.approx(0.5)

    def test_optimal_boundary(self):
        """At z=-0.5 exactly, should be OPTIMAL with formula (z < -0.5 is strict).

        rt=2500, baseline=5000 -> z=(2500-5000)/5000=-0.5
        -0.5 is NOT < -0.5, so falls to else: OPTIMAL, load=0.5
        """
        agent = EpistemicAgent()
        state = make_state(baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 2500},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["rt_zscore"] == pytest.approx(-0.5)
        # z == -0.5 does NOT trigger the fast-OPTIMAL branch (strict <)
        assert msg.field_updates["cognitive"]["state"] == CognitiveState.OPTIMAL
        assert msg.metadata["cognitive_load"] == pytest.approx(0.5)

    def test_overload_load_capped_at_1(self):
        """Cognitive load should be capped at 1.0 even for extreme response times.

        rt=100000, baseline=1000 -> z=(100000-1000)/1000=99.0
        load=min(0.5+99*0.2, 1.0)=min(20.3, 1.0)=1.0
        """
        agent = EpistemicAgent()
        state = make_state(baseline_rt=1000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 100000},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["cognitive_load"] == pytest.approx(1.0)

    def test_optimal_load_floored_at_03(self):
        """Cognitive load for fast responses should not go below 0.3.

        rt=1, baseline=5000 -> z=(1-5000)/5000=-0.9998
        load=max(0.3, 0.5+(-0.9998)*0.15)=max(0.3, 0.5-0.15)=max(0.3, 0.35)=0.35

        For even faster: rt=0, baseline=5000 -> z=-1.0
        load=max(0.3, 0.5-0.15)=0.35
        """
        agent = EpistemicAgent()
        state = make_state(baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 1},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["cognitive_load"] >= 0.3

    def test_response_time_recorded_in_updates(self):
        """The response time should be recorded in cognitive field_updates."""
        agent = EpistemicAgent()
        state = make_state(baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 7000},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["cognitive"]["response_time_ms"] == 7000

    def test_default_response_time(self):
        """When no response_time_ms is provided, default 5000 should be used."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        # Default rt=5000, default baseline=5000, z=0
        assert msg.metadata["rt_zscore"] == pytest.approx(0.0)


class TestEpistemicMastery:
    """Test mastery estimate updates."""

    def test_mastery_increases_on_correct(self):
        """When is_group=True, mastery should increase by 0.05."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.3)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["knowledge"]["mastery_estimate"] == pytest.approx(0.35)
        assert msg.metadata["mastery_delta"] == pytest.approx(0.05)

    def test_mastery_decreases_on_incorrect(self):
        """When is_group=False, mastery should decrease by 0.03."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.5)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": False}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["knowledge"]["mastery_estimate"] == pytest.approx(0.47)
        assert msg.metadata["mastery_delta"] == pytest.approx(-0.03)

    def test_mastery_unchanged_without_verification(self):
        """Without verification result, mastery should stay unchanged."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.5)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.field_updates["knowledge"]["mastery_estimate"] == pytest.approx(0.5)
        assert msg.metadata["mastery_delta"] == pytest.approx(0.0)

    def test_mastery_capped_at_1(self):
        """Mastery should be capped at 1.0 even with many correct answers."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.98)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["knowledge"]["mastery_estimate"] == pytest.approx(1.0)

    def test_mastery_floored_at_0(self):
        """Mastery should not go below 0.0."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.01)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": False}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["knowledge"]["mastery_estimate"] >= 0.0

    def test_consecutive_correct_increments(self):
        """When is_group=True, consecutive_correct should increment."""
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=2)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["interaction"]["consecutive_correct"] == 3

    def test_consecutive_correct_resets_on_wrong(self):
        """When is_group=False, consecutive_correct should reset to 0."""
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=5)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": False}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["interaction"]["consecutive_correct"] == 0

    def test_consecutive_correct_unchanged_without_verification(self):
        """Without verification, consecutive_correct should stay the same."""
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=3)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.field_updates["interaction"]["consecutive_correct"] == 3


class TestEpistemicZPD:
    """Test ZPD (Zone of Proximal Development) detection."""

    def test_in_zpd_within_range(self):
        """Mastery within [zpd_lower, zpd_upper] should be in_zpd=True.

        Default zpd: [0.4, 0.6]. mastery=0.5 is within range.
        """
        agent = EpistemicAgent()
        state = make_state(mastery=0.5, zpd_lower=0.4, zpd_upper=0.6)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.metadata["in_zpd"] is True

    def test_below_zpd(self):
        """Mastery below zpd_lower should be in_zpd=False."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.3, zpd_lower=0.4, zpd_upper=0.6)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.metadata["in_zpd"] is False

    def test_above_zpd(self):
        """Mastery above zpd_upper should be in_zpd=False."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.7, zpd_lower=0.4, zpd_upper=0.6)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.metadata["in_zpd"] is False

    def test_at_zpd_lower_boundary(self):
        """Mastery at zpd_lower should be in_zpd=True (<= check)."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.4, zpd_lower=0.4, zpd_upper=0.6)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.metadata["in_zpd"] is True

    def test_at_zpd_upper_boundary(self):
        """Mastery at zpd_upper should be in_zpd=True (<= check)."""
        agent = EpistemicAgent()
        state = make_state(mastery=0.6, zpd_lower=0.4, zpd_upper=0.6)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.metadata["in_zpd"] is True

    def test_zpd_uses_updated_mastery(self):
        """ZPD check should use the UPDATED mastery, not the old one.

        Start with mastery=0.50 (in ZPD [0.4,0.6]), is_group=True
        -> new mastery=0.55, which is still in ZPD.
        """
        agent = EpistemicAgent()
        state = make_state(mastery=0.50, zpd_lower=0.4, zpd_upper=0.6)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
        )
        msg = run_agent(agent, ctx)

        # mastery goes from 0.50 to 0.55, still in [0.4, 0.6]
        assert msg.metadata["in_zpd"] is True

    def test_zpd_exits_after_correct_answer(self):
        """A correct answer can push mastery above ZPD.

        Start with mastery=0.58 (in ZPD [0.4,0.6]), is_group=True
        -> new mastery=0.63, which is above 0.6 -> NOT in ZPD.
        """
        agent = EpistemicAgent()
        state = make_state(mastery=0.58, zpd_lower=0.4, zpd_upper=0.6)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["in_zpd"] is False


class TestEpistemicEmotionalState:
    """Test emotional state detection: anxiety, flow, engaged."""

    def test_default_emotional_state_engaged(self):
        """With no special conditions, emotional state should be ENGAGED."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        assert msg.metadata["emotional_state"] == "engaged"
        assert msg.field_updates["emotional"]["state"] == EmotionalState.ENGAGED

    def test_anxiety_from_backtrack(self):
        """backtrack_count > 2 should trigger ANXIOUS state.

        Note: state.cognitive.backtrack_count is the OLD value from input.
        """
        agent = EpistemicAgent()
        state = make_state(backtrack_count=3)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.metadata["emotional_state"] == "anxious"
        assert msg.field_updates["emotional"]["state"] == EmotionalState.ANXIOUS

    def test_anxiety_increases_anxiety_index(self):
        """ANXIOUS state should increase anxiety_index by 0.1."""
        agent = EpistemicAgent()
        state = make_state(backtrack_count=3, anxiety=0.3)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.field_updates["emotional"]["anxiety_index"] == pytest.approx(0.4)

    def test_anxiety_decreases_flow_score(self):
        """ANXIOUS state should decrease flow_score by 0.05."""
        agent = EpistemicAgent()
        state = make_state(backtrack_count=3, flow=0.5)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.field_updates["emotional"]["flow_score"] == pytest.approx(0.45)

    def test_flow_from_streak_and_fast_response(self):
        """consecutive >= 3 and z < 0 should trigger FLOW state.

        Need: consecutive_correct=2 initially, is_group=True (-> consecutive=3),
        and rt fast (z < 0).
        """
        agent = EpistemicAgent()
        state = make_state(
            consecutive_correct=2,
            baseline_rt=5000,
        )
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
            metadata={"response_time_ms": 1000},  # z = -0.8 < 0
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["emotional_state"] == "flow"
        assert msg.field_updates["emotional"]["state"] == EmotionalState.FLOW

    def test_flow_increases_flow_score(self):
        """FLOW state should increase flow_score by 0.1."""
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=2, baseline_rt=5000, flow=0.5)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
            metadata={"response_time_ms": 1000},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["emotional"]["flow_score"] == pytest.approx(0.6)

    def test_flow_decreases_anxiety(self):
        """FLOW state should decrease anxiety_index by 0.05."""
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=2, baseline_rt=5000, anxiety=0.3)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
            metadata={"response_time_ms": 1000},
        )
        msg = run_agent(agent, ctx)

        assert msg.field_updates["emotional"]["anxiety_index"] == pytest.approx(0.25)

    def test_flow_requires_fast_response(self):
        """FLOW should NOT trigger if z >= 0, even with consecutive >= 3.

        consecutive_correct=2, is_group=True (-> consecutive=3),
        but rt=5000 (z=0.0, NOT < 0) -> ENGAGED, not FLOW.
        """
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=2, baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
            metadata={"response_time_ms": 5000},  # z = 0.0, NOT < 0
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["emotional_state"] == "engaged"

    def test_flow_requires_streak(self):
        """FLOW should NOT trigger with fast response but consecutive < 3.

        consecutive_correct=1, is_group=True (-> consecutive=2),
        rt=1000 (z=-0.8 < 0) -> ENGAGED (consecutive < 3).
        """
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=1, baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
            metadata={"response_time_ms": 1000},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["emotional_state"] == "engaged"

    def test_anxiety_takes_priority_over_engaged(self):
        """ANXIOUS (backtrack > 2) should take priority over ENGAGED,
        but NOT over FLOW (FLOW is checked first)."""
        agent = EpistemicAgent()
        state = make_state(backtrack_count=3, consecutive_correct=2, baseline_rt=5000)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
            metadata={"response_time_ms": 1000},  # z < 0, consecutive becomes 3
        )
        msg = run_agent(agent, ctx)

        # FLOW is checked first (consecutive >= 3 and z < 0)
        assert msg.metadata["emotional_state"] == "flow"


class TestEpistemicStruggling:
    """Test struggling detection and scaffold fading."""

    def test_is_struggling_from_backtrack(self):
        """backtrack_count > 2 should set is_struggling=True."""
        agent = EpistemicAgent()
        state = make_state(backtrack_count=3)
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.metadata["is_struggling"] is True

    def test_is_struggling_from_wrong_and_backtrack(self):
        """not is_group and backtrack_count > 1 should set is_struggling=True."""
        agent = EpistemicAgent()
        state = make_state(backtrack_count=2)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": False}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["is_struggling"] is True

    def test_not_struggling_without_backtrack(self):
        """With backtrack_count=0, should not be struggling."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        assert msg.metadata["is_struggling"] is False

    def test_should_fade_scaffold(self):
        """When consecutive_correct >= scaffold_fade_threshold, should fade.

        consecutive_correct=2, is_group=True (-> consecutive=3),
        scaffold_fade_threshold=3 -> should_fade=True.
        """
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=2, scaffold_fade_threshold=3)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["should_fade_scaffold"] is True

    def test_should_not_fade_scaffold_below_threshold(self):
        """When consecutive_correct < scaffold_fade_threshold, should not fade."""
        agent = EpistemicAgent()
        state = make_state(consecutive_correct=1, scaffold_fade_threshold=3)
        ctx = make_ctx(
            student_input="test",
            state=state,
            prior_results={"counter_example": {"metadata": {"is_group": True}}},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["should_fade_scaffold"] is False

    def test_struggle_duration_updated_when_struggling(self):
        """When is_struggling, struggle_duration_s should be in field_updates."""
        agent = EpistemicAgent()
        state = make_state(backtrack_count=3)
        ctx = make_ctx(
            student_input="test",
            state=state,
            metadata={"response_time_ms": 5000},
        )
        msg = run_agent(agent, ctx)

        assert "struggle_duration_s" in msg.field_updates["interaction"]
        assert msg.field_updates["interaction"]["struggle_duration_s"] == pytest.approx(5.0)

    def test_struggle_duration_not_updated_when_not_struggling(self):
        """When not struggling, struggle_duration_s should NOT be in field_updates."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        assert "struggle_duration_s" not in msg.field_updates["interaction"]


class TestEpistemicMetadataAndFields:
    """Test metadata fields and field_updates structure."""

    def test_metadata_contains_all_fields(self):
        """Metadata should contain all expected fields."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        meta = msg.metadata
        expected_keys = {
            "rt_zscore", "cognitive_load", "mastery_delta",
            "in_zpd", "is_struggling", "should_fade_scaffold",
            "emotional_state",
        }
        assert expected_keys.issubset(set(meta.keys()))

    def test_field_updates_contains_all_fields(self):
        """field_updates should contain all four field categories."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        fu = msg.field_updates
        assert "knowledge" in fu
        assert "cognitive" in fu
        assert "emotional" in fu
        assert "interaction" in fu

    def test_field_updates_knowledge(self):
        """knowledge field_updates should contain mastery_estimate."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        assert "mastery_estimate" in msg.field_updates["knowledge"]

    def test_field_updates_cognitive(self):
        """cognitive field_updates should contain all cognitive fields."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test", metadata={"response_time_ms": 7000})
        msg = run_agent(agent, ctx)

        cog = msg.field_updates["cognitive"]
        assert "response_time_ms" in cog
        assert "rt_zscore" in cog
        assert "cognitive_load" in cog
        assert "state" in cog
        assert cog["response_time_ms"] == 7000

    def test_field_updates_emotional(self):
        """emotional field_updates should contain all emotional fields."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        emo = msg.field_updates["emotional"]
        assert "anxiety_index" in emo
        assert "flow_score" in emo
        assert "state" in emo

    def test_field_updates_interaction(self):
        """interaction field_updates should contain consecutive_correct and hint_dependency."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        inter = msg.field_updates["interaction"]
        assert "consecutive_correct" in inter
        assert "hint_dependency" in inter

    def test_hint_dependency_decreases(self):
        """hint_dependency should decrease by 0.01 each turn (min 0)."""
        agent = EpistemicAgent()
        state = make_state()
        state.interaction.hint_dependency = 0.5
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.field_updates["interaction"]["hint_dependency"] == pytest.approx(0.49)

    def test_hint_dependency_floored_at_0(self):
        """hint_dependency should not go below 0."""
        agent = EpistemicAgent()
        state = make_state()
        state.interaction.hint_dependency = 0.005
        ctx = make_ctx(student_input="test", state=state)
        msg = run_agent(agent, ctx)

        assert msg.field_updates["interaction"]["hint_dependency"] >= 0.0

    def test_content_is_non_empty(self):
        """The diagnosis content should be a non-empty string."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        assert isinstance(msg.content, str)
        assert len(msg.content) > 0

    def test_role_is_epistemic(self):
        """EpistemicAgent should have role EPISTEMIC."""
        agent = EpistemicAgent()
        assert agent.role == AgentRole.EPISTEMIC

    def test_confidence(self):
        """EpistemicAgent should have confidence 0.85."""
        agent = EpistemicAgent()
        ctx = make_ctx(student_input="test")
        msg = run_agent(agent, ctx)

        assert msg.confidence == pytest.approx(0.85)


# ===========================================================================
# CollaborationAgent Tests
# ===========================================================================

class TestCollaborationCayleyHints:
    """Test Socratic hint escalation for Cayley table verification (is_group+is_abelian)."""

    def _make_cayley_ctx(self, hint_level, is_group=True, is_abelian=True,
                        in_zpd=True, is_struggling=False, emotional_state="engaged"):
        """Create a context for Cayley table Socratic synthesis."""
        ce_meta = {"is_group": is_group, "is_abelian": is_abelian}
        ep_meta = {
            "in_zpd": in_zpd,
            "is_struggling": is_struggling,
            "emotional_state": emotional_state,
        }
        return make_ctx(
            student_input="[[0,1],[1,0]]",
            prior_results={
                "counter_example": {"metadata": ce_meta},
                "epistemic": {"metadata": ep_meta, "content": "诊断结果"},
            },
            metadata={
                "pedagogical_decision": {
                    "action": "continue",
                    "hint_level": hint_level,
                },
            },
        )

    def test_hint_level_0_abelian_group(self):
        """Hint level 0 for abelian group should ask guiding questions."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=0)
        msg = run_agent(agent, ctx)

        assert "观察" in msg.content or "运算表" in msg.content
        assert "对称" in msg.content

    def test_hint_level_1_abelian_group(self):
        """Hint level 1 for abelian group should point to properties."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=1)
        msg = run_agent(agent, ctx)

        assert "封闭性" in msg.content or "交换性" in msg.content
        assert "单位元" in msg.content

    def test_hint_level_2_abelian_group(self):
        """Hint level 2 for abelian group should give concrete hints."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=2)
        msg = run_agent(agent, ctx)

        assert "交换群" in msg.content
        assert "第一行" in msg.content or "对角线" in msg.content

    def test_hint_level_3_abelian_group(self):
        """Hint level 3 for abelian group should nearly state the answer."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=3)
        msg = run_agent(agent, ctx)

        assert "Abel" in msg.content or "交换群" in msg.content
        assert "群公理" in msg.content

    def test_hint_level_0_non_abelian_group(self):
        """Hint level 0 for non-abelian group should point to asymmetry."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=0, is_abelian=False)
        msg = run_agent(agent, ctx)

        assert "对角线" in msg.content or "对称" in msg.content

    def test_hint_level_1_non_abelian_group(self):
        """Hint level 1 for non-abelian group should mention commutativity."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=1, is_abelian=False)
        msg = run_agent(agent, ctx)

        assert "交换" in msg.content

    def test_hint_level_0_not_a_group(self):
        """Hint level 0 for non-group should ask which axiom fails."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=0, is_group=False, is_abelian=False)
        msg = run_agent(agent, ctx)

        assert "公理" in msg.content or "问题" in msg.content

    def test_hint_level_2_not_a_group_with_axiom_violation(self):
        """Hint level 2 for non-group with axiom_violation should show it."""
        agent = CollaborationAgent()
        ce_meta = {
            "is_group": False,
            "is_abelian": False,
            "axiom_violation": "单位元缺失",
        }
        ep_meta = {"in_zpd": True, "is_struggling": False, "emotional_state": "engaged"}
        ctx = make_ctx(
            student_input="[[0,1],[1,0]]",
            prior_results={
                "counter_example": {"metadata": ce_meta},
                "epistemic": {"metadata": ep_meta, "content": "诊断"},
            },
            metadata={
                "pedagogical_decision": {"action": "continue", "hint_level": 2},
            },
        )
        msg = run_agent(agent, ctx)

        assert "单位元缺失" in msg.content

    def test_advance_action_adds_next_step(self):
        """When action='advance' and is_group, should suggest S3."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=0)
        ctx.metadata["pedagogical_decision"]["action"] = "advance"
        msg = run_agent(agent, ctx)

        assert "S₃" in msg.content or "非交换" in msg.content

    def test_emotional_support_adds_encouragement(self):
        """When action='emotional_support', should add encouragement."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=0)
        ctx.metadata["pedagogical_decision"]["action"] = "emotional_support"
        msg = run_agent(agent, ctx)

        assert "你的思考方向很好" in msg.content

    def test_struggling_adds_hint(self):
        """When is_struggling and hint_level < 3, should add guiding hint."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=0, is_struggling=True)
        msg = run_agent(agent, ctx)

        assert "单位元" in msg.content or "想一想" in msg.content

    def test_metadata_template_path(self):
        """Template path metadata should have llm_generated=False."""
        agent = CollaborationAgent()
        ctx = self._make_cayley_ctx(hint_level=0)
        msg = run_agent(agent, ctx)

        assert msg.metadata["llm_generated"] is False
        assert msg.metadata["socratic_style"] is True
        assert msg.metadata["hint_level"] == 0


class TestCollaborationTextHints:
    """Test Socratic hint escalation for text-based questions."""

    def _make_text_ctx(self, student_input, hint_level):
        """Create a context for text-based Socratic synthesis."""
        return make_ctx(
            student_input=student_input,
            prior_results={},
            metadata={
                "pedagogical_decision": {
                    "action": "continue",
                    "hint_level": hint_level,
                },
            },
        )

    def test_text_hint_0_group_definition(self):
        """Hint level 0 for 'what is a group' should ask guiding question."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是群", 0)
        msg = run_agent(agent, ctx)

        assert "想象" in msg.content or "集合" in msg.content
        assert "条件" in msg.content

    def test_text_hint_1_group_definition(self):
        """Hint level 1 should mention four properties."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是群", 1)
        msg = run_agent(agent, ctx)

        assert "四条" in msg.content or "性质" in msg.content

    def test_text_hint_2_group_definition(self):
        """Hint level 2 should list the axioms."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是群", 2)
        msg = run_agent(agent, ctx)

        assert "封闭性" in msg.content
        assert "结合律" in msg.content
        assert "单位元" in msg.content
        assert "逆元" in msg.content

    def test_text_hint_3_group_definition(self):
        """Hint level 3 should nearly state the definition."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是群", 3)
        msg = run_agent(agent, ctx)

        assert "群" in msg.content
        assert "集合" in msg.content
        assert "运算" in msg.content

    def test_text_hint_0_associativity(self):
        """Hint level 0 for associativity question."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是结合律", 0)
        msg = run_agent(agent, ctx)

        assert "顺序" in msg.content or "结合律" in msg.content

    def test_text_hint_2_associativity(self):
        """Hint level 2 for associativity should give formula."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是结合律", 2)
        msg = run_agent(agent, ctx)

        assert "(a·b)·c" in msg.content or "a·(b·c)" in msg.content or "结合律" in msg.content

    def test_text_hint_0_abelian(self):
        """Hint level 0 for abelian question."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是交换群", 0)
        msg = run_agent(agent, ctx)

        assert "交换" in msg.content or "a·b" in msg.content

    def test_text_unknown_question(self):
        """Unknown question should still produce a response (empty parts)."""
        agent = CollaborationAgent()
        ctx = self._make_text_ctx("什么是量子力学", 0)
        msg = run_agent(agent, ctx)

        # No specific template matches, so parts may be empty,
        # but content should still be a string
        assert isinstance(msg.content, str)

    def test_text_epistemic_diagnosis_surfaced(self):
        """When epistemic mentions cognitive load, it should be surfaced subtly."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="什么是群",
            prior_results={
                "epistemic": {
                    "metadata": {},
                    "content": "响应时间偏长，认知负荷较高",
                },
            },
            metadata={
                "pedagogical_decision": {"action": "continue", "hint_level": 0},
            },
        )
        msg = run_agent(agent, ctx)

        assert "概念确实有点多" in msg.content or "只看一个" in msg.content


class TestCollaborationGrillMode:
    """Test grill mode responses."""

    def _make_grill_question(self):
        """Create a sample grill question dict."""
        return {
            "qid": "test_q1",
            "concept_name": "群",
            "question": "什么是群的定义？",
            "recommended_answer": "群是一个集合加上一个运算，满足四条公理。",
            "branch_type": "concept",
            "difficulty": 0.5,
        }

    def _make_grill_summary(self):
        """Create a sample grill summary dict."""
        return {
            "active": True,
            "total_branches": 3,
            "resolved_branches": 0,
            "correct_answers": 0,
            "conjecture_count": 0,
            "cayley_tables_seen": 0,
            "progress": "0/3",
            "adaptive": {
                "streak_correct": 0,
                "streak_wrong": 0,
                "total_questions": 0,
                "difficulty_band": "standard",
                "trend": "stable",
                "current_difficulty": 0.4,
                "accuracy_rate": 0.0,
                "conjecture_success_rate": 0.0,
            },
        }

    def test_grill_first_question(self):
        """Grill mode with short input should show '开始审问模式'."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="考",  # len <= 3 -> is_first_question
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": self._make_grill_question(),
                    "summary": self._make_grill_summary(),
                },
            },
        )
        msg = run_agent(agent, ctx)

        assert "开始审问模式" in msg.content
        assert "什么是群的定义" in msg.content
        assert msg.metadata["grill_mode"] is True
        assert msg.metadata["grill_question_id"] == "test_q1"
        assert msg.metadata["grill_concept"] == "群"

    def test_grill_shows_progress(self):
        """Grill response should show progress."""
        agent = CollaborationAgent()
        summary = self._make_grill_summary()
        summary["resolved_branches"] = 1
        summary["total_branches"] = 3
        ctx = make_ctx(
            student_input="考",
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": self._make_grill_question(),
                    "summary": summary,
                },
            },
        )
        msg = run_agent(agent, ctx)

        assert "1/3" in msg.content or "进度" in msg.content

    def test_grill_shows_difficulty(self):
        """Grill response should show difficulty band."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="考",
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": self._make_grill_question(),
                    "summary": self._make_grill_summary(),
                },
            },
        )
        msg = run_agent(agent, ctx)

        assert "难度" in msg.content

    def test_grill_shows_recommended_answer(self):
        """Grill response should show the recommended answer."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="考",
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": self._make_grill_question(),
                    "summary": self._make_grill_summary(),
                },
            },
        )
        msg = run_agent(agent, ctx)

        assert "参考答案" in msg.content
        assert "群是一个集合加上一个运算" in msg.content

    def test_grill_subsequent_answer(self):
        """Grill mode with a longer student answer should show the answer."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="我认为群需要满足封闭性",  # len > 3 -> not first
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": self._make_grill_question(),
                    "summary": self._make_grill_summary(),
                },
            },
        )
        msg = run_agent(agent, ctx)

        assert "你认为" in msg.content or "你回答" in msg.content or "封闭性" in msg.content

    def test_grill_complete(self):
        """When next_question is None, should show completion message."""
        agent = CollaborationAgent()
        summary = self._make_grill_summary()
        summary["resolved_branches"] = 3
        summary["correct_answers"] = 2
        ctx = make_ctx(
            student_input="考",
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": None,
                    "summary": summary,
                },
            },
        )
        msg = run_agent(agent, ctx)

        assert "完成" in msg.content or "审问模式完成" in msg.content
        assert msg.metadata.get("grill_complete") is True

    def test_grill_not_active(self):
        """When grill is not active, should NOT trigger grill mode."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="什么是群",
            metadata={
                "grill_session": {"active": False},
            },
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata.get("grill_mode") is not True

    def test_grill_metadata_structure(self):
        """Grill mode metadata should have all expected keys."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="考",
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": self._make_grill_question(),
                    "summary": self._make_grill_summary(),
                },
            },
        )
        msg = run_agent(agent, ctx)

        meta = msg.metadata
        assert meta["llm_generated"] is False
        assert meta["socratic_style"] is True
        assert meta["grill_mode"] is True
        assert "grill_question_id" in meta
        assert "grill_concept" in meta
        assert "pedagogical_action" in meta
        assert "hint_level" in meta


class TestCollaborationProofMode:
    """Test proof mode responses."""

    def _make_proof_result(self, is_complete=True, theorem_name="identity_unique",
                           steps=None, missing=None):
        """Create a sample proof_result dict."""
        if steps is None and is_complete:
            steps = [
                {"step_number": 1, "claim": "e*f = f", "is_valid": True,
                 "feedback": "正确", "matched_expected": "identity_left",
                 "implicit_steps": []},
                {"step_number": 2, "claim": "e*f = e", "is_valid": True,
                 "feedback": "正确", "matched_expected": "identity_right",
                 "implicit_steps": []},
                {"step_number": 3, "claim": "e = f", "is_valid": True,
                 "feedback": "正确", "matched_expected": "transitivity",
                 "implicit_steps": []},
            ]
        elif steps is None:
            steps = [
                {"step_number": 1, "claim": "e*f = f", "is_valid": True,
                 "feedback": "正确", "matched_expected": "identity_left",
                 "implicit_steps": []},
            ]
        return {
            "theorem_name": theorem_name,
            "is_complete": is_complete,
            "progress": f"{len(steps)}/3",
            "overall_feedback": "证明进行中" if not is_complete else "证明完整",
            "socratic_hint": "想想下一步该怎么推导" if not is_complete else "",
            "steps": steps,
            "missing_steps": missing or [],
            "available_theorems": [],
        }

    def test_proof_complete(self):
        """A complete proof should show celebration message."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="证明单位元唯一",
            metadata={
                "proof_result": self._make_proof_result(is_complete=True),
                "pedagogical_decision": {"action": "continue", "hint_level": 0},
            },
        )
        msg = run_agent(agent, ctx)

        assert "证明完整" in msg.content or "正确" in msg.content
        assert msg.metadata["proof_mode"] is True
        assert msg.metadata["proof_complete"] is True

    def test_proof_partial(self):
        """A partial proof should show progress and missing steps."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="证明单位元唯一",
            metadata={
                "proof_result": self._make_proof_result(
                    is_complete=False,
                    missing=["传递性：e = f"],
                ),
                "pedagogical_decision": {"action": "continue", "hint_level": 0},
            },
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["proof_complete"] is False
        assert "还需完成" in msg.content or "e = f" in msg.content

    def test_proof_no_theorem_matched(self):
        """When theorem_name is None, should show available theorems."""
        agent = CollaborationAgent()
        available = [
            {
                "name": "identity_unique",
                "description": "单位元唯一性",
                "given": ["G 是群", "e, f 是单位元"],
                "to_prove": "e = f",
                "num_expected_steps": 3,
            },
        ]
        ctx = make_ctx(
            student_input="证明某个东西",
            metadata={
                "proof_result": {
                    "theorem_name": None,
                    "is_complete": False,
                    "progress": "0/0",
                    "steps": [],
                    "available_theorems": available,
                },
                "pedagogical_decision": {"action": "continue", "hint_level": 0},
            },
        )
        msg = run_agent(agent, ctx)

        assert "可以帮你验证" in msg.content or "定理" in msg.content
        assert "identity_unique" in msg.content or "单位元" in msg.content

    def test_proof_metadata_structure(self):
        """Proof mode metadata should have all expected keys."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="证明单位元唯一",
            metadata={
                "proof_result": self._make_proof_result(is_complete=True),
                "pedagogical_decision": {"action": "continue", "hint_level": 0},
            },
        )
        msg = run_agent(agent, ctx)

        meta = msg.metadata
        assert meta["llm_generated"] is False
        assert meta["proof_mode"] is True
        assert "proof_complete" in meta
        assert "proof_progress" in meta

    def test_proof_shows_step_verification(self):
        """Proof response should show each step's verification status."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="证明单位元唯一",
            metadata={
                "proof_result": self._make_proof_result(is_complete=True),
                "pedagogical_decision": {"action": "continue", "hint_level": 0},
            },
        )
        msg = run_agent(agent, ctx)

        # Should mention step 1
        assert "第 1 步" in msg.content or "第1步" in msg.content or "1 步" in msg.content


class TestCollaborationConjectureMode:
    """Test conjecture mode responses."""

    def _make_conjecture_ctx(self, verdict, claim="所有群都是交换群",
                              counter_example="S3 群",
                              explanation="S3 是非交换群"):
        """Create a context for conjecture mode."""
        ce_meta = {
            "is_conjecture": True,
            "conjecture_verdict": verdict,
            "conjecture_counter_example": counter_example,
            "conjecture_result": {
                "claim": claim,
                "explanation": explanation,
            },
            "conjecture_socratic_prompt": "想想看，为什么？",
        }
        return make_ctx(
            student_input="我猜所有群都是交换群",
            prior_results={
                "counter_example": {"metadata": ce_meta},
                "epistemic": {
                    "metadata": {"in_zpd": True, "is_struggling": False,
                                 "emotional_state": "engaged"},
                    "content": "诊断",
                },
            },
            metadata={
                "pedagogical_decision": {"action": "continue", "hint_level": 0},
            },
        )

    def test_conjecture_refuted(self):
        """A refuted conjecture should mention the counter-example."""
        agent = CollaborationAgent()
        ctx = self._make_conjecture_ctx("refuted")
        msg = run_agent(agent, ctx)

        assert "反驳" in msg.content or "不成立" in msg.content
        assert msg.metadata.get("conjecture_handled") is True
        assert msg.metadata.get("conjecture_verdict") == "refuted"

    def test_conjecture_confirmed(self):
        """A confirmed conjecture should acknowledge it."""
        agent = CollaborationAgent()
        ctx = self._make_conjecture_ctx("confirmed")
        msg = run_agent(agent, ctx)

        assert "对" in msg.content or "正确" in msg.content or "成立" in msg.content
        assert msg.metadata.get("conjecture_verdict") == "confirmed"

    def test_conjecture_undecidable(self):
        """An undecidable conjecture should ask to refine."""
        agent = CollaborationAgent()
        ctx = self._make_conjecture_ctx("undecidable")
        msg = run_agent(agent, ctx)

        assert "无法" in msg.content or "具体" in msg.content

    def test_conjecture_hint_level_0_refuted(self):
        """Hint level 0 for refuted should be minimal."""
        agent = CollaborationAgent()
        ctx = self._make_conjecture_ctx("refuted")
        ctx.metadata["pedagogical_decision"]["hint_level"] = 0
        msg = run_agent(agent, ctx)

        # Should mention the conjecture was refuted
        assert "反驳" in msg.content

    def test_conjecture_hint_level_2_refuted(self):
        """Hint level 2 for refuted should show explanation."""
        agent = CollaborationAgent()
        ctx = self._make_conjecture_ctx("refuted")
        ctx.metadata["pedagogical_decision"]["hint_level"] = 2
        msg = run_agent(agent, ctx)

        assert "S3" in msg.content or "反例" in msg.content

    def test_conjecture_metadata_structure(self):
        """Conjecture mode metadata should have conjecture_handled."""
        agent = CollaborationAgent()
        ctx = self._make_conjecture_ctx("refuted")
        msg = run_agent(agent, ctx)

        assert msg.metadata.get("conjecture_handled") is True
        assert "conjecture_verdict" in msg.metadata


class TestCollaborationGeneral:
    """Test general CollaborationAgent properties."""

    def test_role_is_collaboration(self):
        """CollaborationAgent should have role COLLABORATION."""
        agent = CollaborationAgent()
        assert agent.role == AgentRole.COLLABORATION

    def test_call_count_increments(self):
        """Each call to run() should increment call_count."""
        agent = CollaborationAgent()
        assert agent.call_count == 0

        ctx = make_ctx(
            student_input="什么是群",
            metadata={"pedagogical_decision": {"action": "continue", "hint_level": 0}},
        )
        run_agent(agent, ctx)
        assert agent.call_count == 1

        run_agent(agent, ctx)
        assert agent.call_count == 2

    def test_no_llm_uses_template(self):
        """Without LLM, collaboration should use template (llm_generated=False)."""
        agent = CollaborationAgent()  # no LLM client
        ctx = make_ctx(
            student_input="什么是群",
            metadata={"pedagogical_decision": {"action": "continue", "hint_level": 0}},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["llm_generated"] is False

    def test_with_llm_uses_llm(self):
        """With an LLM client, collaboration should use LLM (llm_generated=True)."""
        from mathweaver.llm.client import MockLLMClient

        agent = CollaborationAgent(llm_client=MockLLMClient())
        ctx = make_ctx(
            student_input="什么是群",
            metadata={"pedagogical_decision": {"action": "continue", "hint_level": 0}},
        )
        msg = run_agent(agent, ctx)

        assert msg.metadata["llm_generated"] is True

    def test_template_confidence(self):
        """Template path should have confidence 0.7."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="什么是群",
            metadata={"pedagogical_decision": {"action": "continue", "hint_level": 0}},
        )
        msg = run_agent(agent, ctx)

        assert msg.confidence == pytest.approx(0.7)

    def test_grill_confidence(self):
        """Grill mode should have confidence 0.8."""
        agent = CollaborationAgent()
        ctx = make_ctx(
            student_input="考",
            metadata={
                "grill_session": {
                    "active": True,
                    "next_question": {
                        "qid": "q1",
                        "concept_name": "群",
                        "question": "什么是群？",
                        "recommended_answer": "test",
                        "branch_type": "concept",
                        "difficulty": 0.5,
                    },
                    "summary": {
                        "total_branches": 1,
                        "resolved_branches": 0,
                        "correct_answers": 0,
                        "conjecture_count": 0,
                        "cayley_tables_seen": 0,
                        "progress": "0/1",
                        "adaptive": {
                            "streak_correct": 0,
                            "streak_wrong": 0,
                            "total_questions": 0,
                            "difficulty_band": "standard",
                            "trend": "stable",
                            "current_difficulty": 0.4,
                            "accuracy_rate": 0.0,
                            "conjecture_success_rate": 0.0,
                        },
                    },
                },
            },
        )
        msg = run_agent(agent, ctx)

        assert msg.confidence == pytest.approx(0.8)



