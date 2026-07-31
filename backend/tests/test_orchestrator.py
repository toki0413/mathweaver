"""Tests for the orchestrator (``mathweaver/orchestrator/engine.py``).

These tests exercise the orchestration engine with the default
``MockLLMClient`` (no real LLM is available in the test environment):

- ``start_session`` creates a session with correct defaults.
- ``process_student_input`` for: a regular question, a grill-mode
  trigger, a proof-mode trigger, and a curriculum switch.
- ``switch_curriculum`` swaps the DAG and resets the grill session.
- ``get_state_snapshot`` / ``get_metrics`` / ``get_curriculum_info``.
"""

from __future__ import annotations

import asyncio

import pytest

from mathweaver.orchestrator.engine import Orchestrator, SessionPhase


def _run(coro):
    """Run an async coroutine to completion (no pytest-asyncio config needed)."""
    return asyncio.run(coro)


@pytest.fixture()
def engine():
    """A fresh orchestrator backed by the MockLLMClient (default)."""
    e = Orchestrator()
    e.start_session("stu_test", "Tester")
    return e


# ---------------------------------------------------------------------------
# start_session
# ---------------------------------------------------------------------------


def test_start_session_creates_session_with_defaults():
    o = Orchestrator()
    result = o.start_session("stu1", "Alice")

    assert result["session_id"].startswith("sess_stu1_")
    assert result["phase"] == SessionPhase.PERCEIVE.value
    assert o.phase == SessionPhase.PERCEIVE
    assert o.profile is not None
    assert o.profile.student_id == "stu1"
    assert o.profile.name == "Alice"
    assert o.curriculum_level == "group_theory"


def test_start_session_with_target_node():
    o = Orchestrator()
    result = o.start_session("stu2", "Bob", target_node_id="group_definition")

    assert result["target_node"] == "group_definition"
    assert result["node_name"]
    assert "learning_path" in result
    assert "prerequisite_gaps" in result
    assert o.state.knowledge.current_node_id == "group_definition"


def test_start_session_switches_curriculum():
    o = Orchestrator()
    result = o.start_session("stu3", "Carol", curriculum_level="elementary")

    assert o.curriculum_level == "elementary"
    assert o.dag.get_level() == "elementary"
    assert result["phase"] == SessionPhase.PERCEIVE.value


def test_start_session_id_is_unique_per_student():
    o = Orchestrator()
    r1 = o.start_session("stuA", "A")
    r2 = o.start_session("stuB", "B")
    assert r1["session_id"] != r2["session_id"]
    assert "stuA" in r1["session_id"]
    assert "stuB" in r2["session_id"]


# ---------------------------------------------------------------------------
# process_student_input — regular question
# ---------------------------------------------------------------------------


def test_process_regular_question(engine):
    r = _run(engine.process_student_input("什么是群？"))

    assert r["response"]  # non-empty response
    assert r["grill_mode"] is False
    assert r["proof_mode"] is False
    assert r["curriculum_level"] == "group_theory"
    # the agent loop ran perception -> abstraction -> epistemic -> collaboration
    assert "perceive" in r["phase_trace"]
    assert "collaborate" in r["phase_trace"]
    assert r["four_fields"] is not None
    assert r["phase_trace"][-1] == "collaborate"


def test_process_input_advances_phase_to_deliver(engine):
    assert engine.phase == SessionPhase.PERCEIVE
    _run(engine.process_student_input("什么是子群？"))
    assert engine.phase == SessionPhase.DELIVER


def test_process_input_increments_interaction_count(engine):
    before = engine.profile.total_interactions
    _run(engine.process_student_input("什么是群？"))
    assert engine.profile.total_interactions == before + 1


def test_process_input_returns_decision_and_evidence(engine):
    r = _run(engine.process_student_input("什么是群？"))
    assert "decision" in r
    assert "action" in r["decision"]
    assert "evidence" in r
    assert "evidence_intact" in r


# ---------------------------------------------------------------------------
# process_student_input — grill mode trigger
# ---------------------------------------------------------------------------


def test_process_grill_trigger(engine):
    r = _run(engine.process_student_input("考考我"))

    assert r["grill_mode"] is True
    assert r["grill_summary"] is not None
    assert r["grill_summary"]["active"] is True
    assert r["grill_summary"]["total_branches"] > 0
    # the engine itself now holds an active grill session
    assert engine.grill_session is not None
    assert engine.grill_session.is_active is True
    # exactly one branch was just asked -> a question was prepared
    asked = [b for b in engine.grill_session.branches.values() if b.status == "asked"]
    assert len(asked) == 1
    assert asked[0].question is not None
    assert asked[0].question.question


def test_grill_trigger_response_contains_question(engine):
    r = _run(engine.process_student_input("考考我"))
    # the collaboration agent surfaces the grill question in its response
    assert r["response"]
    # grill responses open with the interrogation-mode banner
    assert "审问" in r["response"]
    asked = next(b for b in engine.grill_session.branches.values() if b.status == "asked")
    # the prepared question text is echoed in the response
    assert asked.question.concept_name in r["response"]


# ---------------------------------------------------------------------------
# process_student_input — proof mode trigger
# ---------------------------------------------------------------------------


def test_process_proof_trigger(engine):
    proof_text = (
        "证明单位元唯一\n"
        "第一步：e·f = f 因为 e 是单位元\n"
        "第二步：e·f = e 因为 f 是单位元\n"
        "第三步：e = f 传递性"
    )
    r = _run(engine.process_student_input(proof_text))

    assert r["proof_mode"] is True
    assert r["proof_result"] is not None
    assert r["proof_result"]["theorem_name"] == "identity_unique"
    assert r["proof_result"]["is_complete"] is True
    assert r["proof_result"]["progress"] == "3/3"


def test_process_proof_named_theorem_no_steps(engine):
    """Naming a theorem without steps returns the template prompt."""
    r = _run(engine.process_student_input("证明单位元唯一"))

    assert r["proof_mode"] is True
    pr = r["proof_result"]
    assert pr["theorem_name"] == "identity_unique"
    assert pr["is_complete"] is False
    assert pr["progress"] == "0/3"
    assert pr["missing_steps"]  # all expected steps listed


def test_process_proof_unknown_theorem(engine):
    """An unrecognised proof request lists available theorems."""
    r = _run(engine.process_student_input("证明某个我没说清楚的定理"))

    assert r["proof_mode"] is True
    pr = r["proof_result"]
    assert pr["theorem_name"] is None
    assert pr["is_complete"] is False
    assert pr["available_theorems"]  # lists theorems for the current level


# ---------------------------------------------------------------------------
# process_student_input — curriculum switch
# ---------------------------------------------------------------------------


def test_process_curriculum_switch_to_elementary(engine):
    r = _run(engine.process_student_input("我想学小学数学"))

    assert r["curriculum_switched"] is True
    assert r["curriculum_level"] == "elementary"
    assert r["curriculum_label"] == "小学数学"
    assert engine.curriculum_level == "elementary"
    assert engine.dag.get_level() == "elementary"
    # the switch response mentions the new curriculum
    assert "小学数学" in r["response"]


def test_process_curriculum_switch_to_middle_school(engine):
    r = _run(engine.process_student_input("切换到初中数学"))
    assert r["curriculum_switched"] is True
    assert r["curriculum_level"] == "middle_school"
    assert engine.dag.get_level() == "middle_school"


def test_process_curriculum_switch_no_match(engine):
    """Input without a level keyword is not treated as a switch."""
    r = _run(engine.process_student_input("什么是群？"))
    assert "curriculum_switched" not in r
    assert r["curriculum_level"] == "group_theory"


# ---------------------------------------------------------------------------
# switch_curriculum
# ---------------------------------------------------------------------------


def test_switch_curriculum_changes_dag_and_resets_grill(engine):
    # activate grill first so we can verify it gets reset
    _run(engine.process_student_input("考考我"))
    assert engine.grill_session is not None

    # switch_curriculum returns None; verify via state
    engine.switch_curriculum("high_school")

    assert engine.curriculum_level == "high_school"
    assert engine.dag.get_level() == "high_school"
    # grill session is reset on curriculum switch
    assert engine.grill_session is None
    # knowledge node moves to the first concept of the new curriculum
    assert engine.state.knowledge.current_node_id is not None
    assert engine.dag.get_node(engine.state.knowledge.current_node_id) is not None


def test_switch_curriculum_invalid_raises(engine):
    with pytest.raises(ValueError, match="Unknown curriculum level"):
        engine.switch_curriculum("kindergarten")


def test_switch_curriculum_updates_current_node_to_first(engine):
    engine.switch_curriculum("elementary")
    dag = engine.dag
    nodes = dag.get_all_nodes()
    expected_first = min(nodes, key=lambda n: n.abstraction_level).id
    assert engine.state.knowledge.current_node_id == expected_first


# ---------------------------------------------------------------------------
# Snapshot / metrics / curriculum info
# ---------------------------------------------------------------------------


def test_get_state_snapshot_returns_four_field_state(engine):
    snap = engine.get_state_snapshot()
    assert snap["phase"] == SessionPhase.PERCEIVE.value
    assert "four_fields" in snap
    assert "current_node" in snap
    assert "in_zpd" in snap
    assert "cognitive_overloaded" in snap
    assert "emotional_state" in snap
    assert "in_flow" in snap
    assert "should_fade_scaffold" in snap


def test_get_state_snapshot_after_input(engine):
    _run(engine.process_student_input("什么是群？"))
    snap = engine.get_state_snapshot()
    assert snap["phase"] == SessionPhase.DELIVER.value
    # four_fields is a nested snapshot dict
    assert isinstance(snap["four_fields"], dict)


def test_get_metrics_returns_tracking_data(engine):
    metrics = engine.get_metrics()
    assert isinstance(metrics, dict)
    # before any turn, totals are zero
    assert metrics.get("total_turns", 0) == 0

    _run(engine.process_student_input("什么是群？"))
    metrics2 = engine.get_metrics()
    assert metrics2["total_turns"] == 1
    assert "avg_latency_ms" in metrics2
    assert metrics2["avg_latency_ms"] >= 0.0
    assert "success_rate" in metrics2


def test_get_curriculum_info_returns_current_and_available(engine):
    info = engine.get_curriculum_info()
    assert info["current_level"] == "group_theory"
    assert info["current_label"] == "群论（大学）"
    assert "current_summary" in info
    assert info["current_summary"]["total_concepts"] > 0
    available = info["available"]
    assert len(available) == 10  # 10 curriculum levels
    assert {c["level"] for c in available} == {
        "elementary",
        "middle_school",
        "high_school",
        "calculus",
        "linear_algebra",
        "discrete_math",
        "number_theory",
        "group_theory",
        "physics",
        "chemistry",
    }


def test_get_curriculum_info_reflects_switch(engine):
    engine.switch_curriculum("middle_school")
    info = engine.get_curriculum_info()
    assert info["current_level"] == "middle_school"
    assert info["current_label"] == "初中数学"


# ---------------------------------------------------------------------------
# Integration: a multi-turn dialogue
# ---------------------------------------------------------------------------


def test_multi_turn_dialogue(engine):
    """A short dialogue across modes stays consistent."""
    # turn 1: regular question
    r1 = _run(engine.process_student_input("什么是群？"))
    assert r1["grill_mode"] is False

    # turn 2: grill
    r2 = _run(engine.process_student_input("考考我"))
    assert r2["grill_mode"] is True

    # turn 3: switch curriculum
    r3 = _run(engine.process_student_input("我想学初中数学"))
    assert r3["curriculum_switched"] is True
    assert engine.curriculum_level == "middle_school"

    # turn 4: grill in the new curriculum
    r4 = _run(engine.process_student_input("考考我"))
    assert r4["grill_mode"] is True
    # the grill question now belongs to middle_school
    assert engine.grill_session.dag.get_level() == "middle_school"
