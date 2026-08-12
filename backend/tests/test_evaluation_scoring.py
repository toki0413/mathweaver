"""Tests for the evaluation scoring rubrics (mathweaver/evaluation/scoring.py).

Covers the Planning Score (2.3) and Communication Score (5.2) functions and
their boundary cases, so the pure scoring logic is exercised offline.
"""

from __future__ import annotations

from mathweaver.evaluation.scoring import (
    CommunicationScore,
    PlanningScore,
    score_communication,
    score_planning,
)

# ---------------------------------------------------------------------------
# PlanningScore dataclass
# ---------------------------------------------------------------------------


def test_planning_score_total_and_normalized():
    s = PlanningScore(coverage=3.0, ordering=2.0, efficiency=2.0, adaptability=3.0)
    assert s.total == 10.0
    assert s.normalized == 1.0


def test_planning_score_to_dict():
    s = PlanningScore(coverage=1.5, ordering=1.0, efficiency=0.5, adaptability=2.0)
    d = s.to_dict()
    assert d["total"] == 5.0
    assert d["normalized"] == 0.5
    assert set(d) == {"coverage", "ordering", "efficiency", "adaptability", "total", "normalized"}


def test_communication_score_total_and_normalized():
    s = CommunicationScore(completeness=3.0, relevance=2.0, bus_utilization=2.0, no_implicit_state=3.0)
    assert s.total == 10.0
    assert s.normalized == 1.0


def test_communication_score_to_dict():
    s = CommunicationScore(completeness=1.0, relevance=0.0, bus_utilization=1.0, no_implicit_state=1.5)
    d = s.to_dict()
    assert d["total"] == 3.5
    assert d["normalized"] == 0.35


# ---------------------------------------------------------------------------
# score_planning
# ---------------------------------------------------------------------------


def test_score_planning_full_coverage():
    steps = [
        {"agent": "perceive"},
        {"agent": "abstract"},
        {"agent": "verify"},
        {"agent": "collaborate"},
    ]
    trace = ["perceive", "abstract", "verify", "collaborate"]
    s = score_planning(steps, trace, "text_question")
    assert s.coverage == 3.0
    assert s.ordering == 2.0
    assert s.efficiency == 2.0  # 4 phases within (2,4)
    assert s.adaptability == 3.0


def test_score_planning_no_executed_phases():
    s = score_planning([], [], "general")
    assert s.coverage == 0.0
    assert s.ordering == 2.0  # single/empty trace -> ordering saturates


def test_score_planning_partial_order():
    steps = [{"agent": "perceive"}, {"agent": "collaborate"}]
    trace = ["collaborate", "perceive"]  # inverted
    s = score_planning(steps, trace, "general")
    assert s.ordering < 2.0


def test_score_planning_efficiency_too_few_agents():
    s = score_planning([{"agent": "perceive"}], ["perceive"], "cayley_table")
    assert s.efficiency < 2.0  # below ideal lower bound


def test_different_input_types_hit_different_branches():
    # cayley_table with a large trace -> efficiency penalty path
    long_trace = ["p"] * 20
    s = score_planning([{"agent": "p"}], long_trace, "cayley_table")
    assert s.efficiency == 0.0


# ---------------------------------------------------------------------------
# score_communication
# ---------------------------------------------------------------------------


def test_score_communication_full():
    bus = [
        {"message_type": "agent"},
        {"message_type": "context"},
    ]
    ctx = [
        {"prior_results": {}, "four_field_snapshot": {"x": 1}},
        {"prior_results": {}, "four_field_snapshot": {"x": 2}},
    ]
    s = score_communication(bus, ctx, agent_count=2)
    assert s.completeness == 3.0
    assert s.relevance == 2.0
    assert s.bus_utilization == 2.0
    assert s.no_implicit_state == 3.0


def test_score_communication_zero_agents():
    s = score_communication([], [], agent_count=0)
    assert s.completeness == 0.0
    assert s.bus_utilization == 0.0


def test_score_communication_partial_relevance():
    ctx = [
        {"prior_results": {}, "four_field_snapshot": {"x": 1}},
        {"prior_results": {}, "four_field_snapshot": None},
    ]
    s = score_communication([], ctx, agent_count=2)
    assert s.relevance == 1.0
    assert s.no_implicit_state == 1.5


def test_score_communication_single_bus_type():
    s = score_communication([{"message_type": "agent"}], [], agent_count=1)
    assert s.bus_utilization == 1.0
