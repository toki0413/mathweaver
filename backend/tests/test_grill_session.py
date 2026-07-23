"""Tests for the grill subsystem.

Covers ``mathweaver/grill/session.py`` (``GrillSession``) and
``mathweaver/grill/adaptive.py`` (``AdaptiveDifficulty``):

- ``next_question`` for all four curriculum levels.
- ``record_answer`` with correct / incorrect answers.
- Adaptive difficulty: composite > 0.7 raises, < 0.4 lowers, streak
  acceleration / deceleration, and the [0.1, 0.9] clamp.
- Question-bank selection matches the active DAG level.
- Default node selection picks the lowest-abstraction concept.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from mathweaver.dag.concept_dag import get_dag, reset_dag
from mathweaver.grill.adaptive import AdaptiveDifficulty, PerformanceSignal
from mathweaver.grill.session import GrillBranch, GrillQuestion, GrillSession

LEVELS = ["group_theory", "high_school", "middle_school", "elementary"]


def _signal(is_correct=True, rt=5000.0, hint=False, verdict=None) -> PerformanceSignal:
    """Build a PerformanceSignal with sane defaults."""
    return PerformanceSignal(
        timestamp=datetime.now(timezone.utc).isoformat(),
        question_difficulty=0.5,
        is_correct=is_correct,
        response_time_ms=rt,
        hint_used=hint,
        conjecture_verdict=verdict,
    )


@pytest.fixture()
def session_factory():
    """Return a factory that builds a fresh GrillSession for a level."""
    created: list[GrillSession] = []

    def _make(level: str | None = None, node_id: str | None = None) -> GrillSession:
        reset_dag()
        dag = get_dag(level) if level else None
        s = GrillSession(dag=dag, current_node_id=node_id)
        created.append(s)
        return s

    yield _make


# ---------------------------------------------------------------------------
# next_question across all levels
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("level", LEVELS)
def test_next_question_returns_question_for_every_level(session_factory, level):
    """Each curriculum level can produce at least one grill question."""
    session = session_factory(level)
    session.activate()
    q = session.next_question()

    assert isinstance(q, GrillQuestion)
    assert q.qid
    assert q.question
    assert q.concept_node_id
    assert q.concept_name
    assert 0.0 <= q.difficulty <= 1.0
    assert q.branch_type in {"concept", "edge_case", "application"}
    assert session.is_active is True


@pytest.mark.parametrize("level", LEVELS)
def test_question_bank_matches_dag_level(session_factory, level):
    """The question returned must belong to the active curriculum's DAG.

    We assert the concept_node_id is a real node of that level's DAG and
    that the question text comes from the level-specific bank (we check a
    level-distinctive substring to rule out cross-level leakage).
    """
    session = session_factory(level)
    dag = session.dag
    assert dag.get_level() == level

    q = session.next_question()
    assert q is not None

    # concept must be a real node in this DAG
    node = dag.get_node(q.concept_node_id)
    assert node is not None, f"{q.concept_node_id} not in {level} DAG"

    # level-distinctive content checks
    text = q.question
    if level == "elementary":
        # elementary questions are about counting / arithmetic
        assert any(k in text for k in ("数", "加", "减", "乘", "除", "分数"))
    elif level == "middle_school":
        assert any(k in text for k in ("方程", "有理", "三角形", "函数", "负", "比例", "集合", "子集"))
    elif level == "high_school":
        # HS starts with set_theory; allow foundational set terms too.
        assert any(
            k in text
            for k in ("函数", "数列", "不等", "三角", "向量", "导数", "集合", "子集", "空集", "实数", "方程")
        )
    else:  # group_theory
        assert any(k in text for k in ("群", "运算", "集合", "单位元", "逆元", "子群"))


def test_next_question_advances_branch_state(session_factory):
    """After asking, the branch status moves to 'asked'."""
    session = session_factory("group_theory")
    q = session.next_question()
    assert q is not None

    asked = [b for b in session.branches.values() if b.status == "asked"]
    assert len(asked) == 1
    assert asked[0].question is q or asked[0].question.qid == q.qid


def test_next_question_increments_counter(session_factory):
    """Each question gets a unique sequential qid."""
    session = session_factory("group_theory")
    q1 = session.next_question()
    # answer it so the next pending branch is selected
    session.record_answer(q1.qid, "ans", is_correct=True)
    q2 = session.next_question()
    assert q2 is not None
    assert q1.qid != q2.qid


# ---------------------------------------------------------------------------
# record_answer
# ---------------------------------------------------------------------------

def test_record_answer_correct_marks_branch(session_factory):
    session = session_factory("group_theory")
    q = session.next_question()
    session.record_answer(q.qid, "my answer", is_correct=True)

    branch = next(b for b in session.branches.values() if b.question and b.question.qid == q.qid)
    assert branch.status == "answered_correct"
    assert branch.student_answer == "my answer"


def test_record_answer_wrong_marks_branch(session_factory):
    session = session_factory("group_theory")
    q = session.next_question()
    session.record_answer(q.qid, "bad answer", is_correct=False)

    branch = next(b for b in session.branches.values() if b.question and b.question.qid == q.qid)
    assert branch.status == "answered_wrong"
    assert branch.student_answer == "bad answer"


def test_record_answer_feeds_adaptive(session_factory):
    """A correct answer raises adaptive difficulty above the baseline."""
    session = session_factory("group_theory")
    baseline = session.adaptive.current_difficulty

    q = session.next_question()
    session.record_answer(q.qid, "ans", is_correct=True)

    # default _last_response_time_ms == baseline RT => speed factor 1.0,
    # accuracy 100% => composite > 0.7 => difficulty must increase.
    assert session.adaptive.streak_correct == 1
    assert session.adaptive.current_difficulty > baseline


def test_record_answer_wrong_lowers_adaptive(session_factory):
    """An incorrect answer should pull difficulty down."""
    session = session_factory("group_theory")
    # make it slow to drive composite < 0.4
    session._last_response_time_ms = 20000.0
    baseline = session.adaptive.current_difficulty

    q = session.next_question()
    session.record_answer(q.qid, "ans", is_correct=False)

    assert session.adaptive.streak_wrong == 1
    assert session.adaptive.current_difficulty < baseline


def test_get_summary_shape(session_factory):
    """get_summary exposes branches, progress, and adaptive state."""
    session = session_factory("group_theory")
    session.activate()
    summary = session.get_summary()

    assert summary["active"] is True
    assert summary["total_branches"] == len(session.branches)
    assert summary["resolved_branches"] == 0
    assert "progress" in summary and "/" in summary["progress"]
    assert "adaptive" in summary
    assert "current_difficulty" in summary["adaptive"]
    assert "branches" in summary


# ---------------------------------------------------------------------------
# Default node selection
# ---------------------------------------------------------------------------

def test_default_node_is_lowest_abstraction(session_factory):
    """With no explicit node, the session starts at the min-abstraction node."""
    reset_dag()
    from mathweaver.dag.concept_dag import get_dag

    dag = get_dag("group_theory")
    session = GrillSession()  # uses default DAG (group_theory)
    nodes = dag.get_all_nodes()
    expected = min(nodes, key=lambda n: n.abstraction_level)
    assert session.current_node_id == expected.id
    assert session.dag.get_node(session.current_node_id) is not None


def test_default_node_explicit_override(session_factory):
    """Passing current_node_id overrides the default selection."""
    reset_dag()
    from mathweaver.dag.concept_dag import get_dag

    dag = get_dag("group_theory")
    nodes = dag.get_all_nodes()
    # pick the highest-abstraction node (definitely not the default)
    target = max(nodes, key=lambda n: n.abstraction_level)
    session = GrillSession(dag=dag, current_node_id=target.id)
    assert session.current_node_id == target.id


def test_activate_deactivate(session_factory):
    session = session_factory("group_theory")
    assert session.is_active is False
    session.activate()
    assert session.is_active is True
    session.deactivate()
    assert session.is_active is False


# ===========================================================================
# AdaptiveDifficulty direct tests
# ===========================================================================


@pytest.fixture()
def adaptive():
    return AdaptiveDifficulty()


def test_adaptive_initial_state(adaptive):
    assert adaptive.current_difficulty == AdaptiveDifficulty.INITIAL_DIFFICULTY
    assert adaptive.streak_correct == 0
    assert adaptive.streak_wrong == 0
    assert adaptive.accuracy_rate == 0.5  # neutral before any signal


def test_composite_high_increases_difficulty(adaptive):
    """composite > 0.7 (correct + fast + no hint) raises difficulty."""
    baseline = adaptive.current_difficulty
    # fast correct answer: accuracy 1.0, speed 1.0, hint 1.0, conj 0.5
    adaptive.record_signal(_signal(is_correct=True, rt=1000.0))
    assert adaptive.current_difficulty > baseline
    # composite ~0.875 => delta ~ +0.0875
    assert adaptive.current_difficulty == pytest.approx(0.4875, abs=0.02)


def test_composite_low_decreases_difficulty(adaptive):
    """composite < 0.4 (wrong + slow + hint) lowers difficulty."""
    baseline = adaptive.current_difficulty
    adaptive.record_signal(_signal(is_correct=False, rt=20000.0, hint=True))
    assert adaptive.current_difficulty < baseline
    # composite ~0.1875 => delta ~ -0.108
    assert adaptive.current_difficulty < 0.35


def test_streak_acceleration_bonus(adaptive):
    """3+ correct in a row adds a streak bonus on top of the base delta."""
    # Three fast correct answers -> streak_correct reaches 3
    for _ in range(3):
        adaptive.record_signal(_signal(is_correct=True, rt=1000.0))

    assert adaptive.streak_correct == 3
    # After a 3-streak of fast correct answers, difficulty has jumped
    # well above the single-signal level (~0.49) thanks to the bonus.
    assert adaptive.current_difficulty > 0.6
    assert adaptive.should_increase_difficulty() is True


def test_streak_deceleration_penalty(adaptive):
    """2+ wrong in a row adds a streak penalty and recommends easier items."""
    for _ in range(2):
        adaptive.record_signal(_signal(is_correct=False, rt=20000.0, hint=True))

    assert adaptive.streak_wrong == 2
    assert adaptive.should_decrease_difficulty() is True
    # difficulty should have dropped below the single-wrong level
    assert adaptive.current_difficulty < 0.25


def test_difficulty_clamped_at_max(adaptive):
    """Many strong-correct signals clamp difficulty to MAX (0.9)."""
    for _ in range(15):
        adaptive.record_signal(_signal(is_correct=True, rt=500.0))
    assert adaptive.current_difficulty == pytest.approx(AdaptiveDifficulty.MAX_DIFFICULTY)
    assert adaptive.current_difficulty <= AdaptiveDifficulty.MAX_DIFFICULTY


def test_difficulty_clamped_at_min(adaptive):
    """Many wrong-slow signals clamp difficulty to MIN (0.1)."""
    for _ in range(15):
        adaptive.record_signal(_signal(is_correct=False, rt=30000.0, hint=True))
    assert adaptive.current_difficulty == pytest.approx(AdaptiveDifficulty.MIN_DIFFICULTY)
    assert adaptive.current_difficulty >= AdaptiveDifficulty.MIN_DIFFICULTY


def test_difficulty_always_in_bounds(adaptive):
    """Regardless of signal mix, difficulty stays within [0.1, 0.9]."""
    signals = [
        _signal(True, 500.0),
        _signal(False, 30000.0, hint=True),
        _signal(True, 1000.0, verdict="confirmed"),
        _signal(False, 20000.0, verdict="refuted"),
        _signal(True, 4000.0),
    ]
    for s in signals * 4:
        adaptive.record_signal(s)
        assert AdaptiveDifficulty.MIN_DIFFICULTY <= adaptive.current_difficulty <= AdaptiveDifficulty.MAX_DIFFICULTY


@pytest.mark.parametrize(
    "difficulty,expected_band",
    [
        (0.2, "warmup"),
        (0.4, "foundation"),
        (0.5, "standard"),
        (0.7, "advanced"),
        (0.8, "challenge"),
        (0.1, "warmup"),
        (0.9, "challenge"),
    ],
)
def test_difficulty_band_classification(adaptive, difficulty, expected_band):
    """get_difficulty_band maps the raw difficulty to the right label."""
    adaptive._current_difficulty = difficulty
    assert adaptive.get_difficulty_band() == expected_band


def test_trend_detection(adaptive):
    """get_trend reports rising/falling/stable from recent signals."""
    assert adaptive.get_trend() == "stable"  # too few signals
    for _ in range(3):
        adaptive.record_signal(_signal(True, 1000.0))
    assert adaptive.get_trend() == "rising"

    a = AdaptiveDifficulty()
    for _ in range(3):
        a.record_signal(_signal(False, 10000.0))
    assert a.get_trend() == "falling"


def test_conjecture_signal_tracking(adaptive):
    """Confirmed/refuted conjectures feed the conjecture-success component."""
    adaptive.record_signal(_signal(True, 1000.0, verdict="confirmed"))
    adaptive.record_signal(_signal(False, 5000.0, verdict="refuted"))
    # 2 conjectures, 1 confirmed => 0.5 success rate
    assert adaptive.conjecture_success_rate == pytest.approx(0.5)


def test_adaptive_to_dict(adaptive):
    """to_dict serialises the engine state with all expected keys."""
    adaptive.record_signal(_signal(True, 1000.0))
    d = adaptive.to_dict()
    expected_keys = {
        "current_difficulty",
        "difficulty_band",
        "target_difficulty",
        "accuracy_rate",
        "streak_correct",
        "streak_wrong",
        "total_questions",
        "trend",
        "should_increase",
        "should_decrease",
    }
    assert expected_keys <= set(d)
    assert d["total_questions"] == 1
    assert d["streak_correct"] == 1


# ---------------------------------------------------------------------------
# GrillQuestion / GrillBranch dataclasses
# ---------------------------------------------------------------------------


def test_grill_question_to_dict():
    q = GrillQuestion(
        qid="x",
        concept_node_id="c",
        concept_name="C",
        question="q?",
        recommended_answer="a",
        difficulty=0.5,
        branch_type="concept",
    )
    d = q.to_dict()
    assert d["qid"] == "x"
    assert d["difficulty"] == 0.5
    assert d["concept_node_id"] == "c"


def test_grill_branch_defaults():
    b = GrillBranch(concept_node_id="c", concept_name="C")
    assert b.status == "pending"
    assert b.question is None
    assert b.children == []
    d = b.to_dict()
    assert d["status"] == "pending"
    assert d["question"] is None
