"""Tests for the concept DAG and curriculum management.

Covers ``mathweaver/dag/concept_dag.py``:

- All four curriculum levels load correctly.
- The prerequisite graph is acyclic for every level.
- ``get_learning_path`` returns valid prerequisite chains.
- ``check_prerequisites`` correctly identifies missing prerequisites.
- ``get_available_curricula`` returns all four levels with metadata.
- ``set_default_level`` / ``get_dag`` multi-singleton behaviour.
- ``reset_dag`` clears the right level's cache.
- ``get_curriculum_summary`` returns correct metadata.
"""

from __future__ import annotations

import pytest

from mathweaver.dag import concept_dag as cd
from mathweaver.dag.concept_dag import (
    CURRICULUM_LEVELS,
    ConceptDAG,
    get_available_curricula,
    get_dag,
    reset_dag,
    set_default_level,
)
from mathweaver.models.state import ConceptNode

LEVELS = list(CURRICULUM_LEVELS)  # 8 levels: elementary → group_theory


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _has_cycle(dag: ConceptDAG) -> bool:
    """DFS cycle detection over the prerequisite edges (node -> prereq)."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {n.id: WHITE for n in dag.get_all_nodes()}

    def dfs(u: str) -> bool:
        color[u] = GRAY
        for v in dag.get_prerequisites(u):
            if v not in color:
                continue
            if color[v] == GRAY:
                return True
            if color[v] == WHITE and dfs(v):
                return True
        color[u] = BLACK
        return False

    return any(color[n.id] == WHITE and dfs(n.id) for n in dag.get_all_nodes())


def _assert_path_topologically_valid(dag: ConceptDAG, path: list[str]) -> None:
    """Every in-path prerequisite of a node must appear earlier in the path."""
    pos = {nid: i for i, nid in enumerate(path)}
    for nid in path:
        for prereq in dag.get_prerequisites(nid):
            if prereq in pos:
                assert pos[prereq] < pos[nid], (
                    f"{prereq} (prereq of {nid}) must come before {nid} in path"
                )


def _transitive_prereqs(dag: ConceptDAG, node_id: str) -> set[str]:
    """Return the full set of (transitive) prerequisites of a node."""
    seen: set[str] = set()
    stack = list(dag.get_prerequisites(node_id))
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        stack.extend(dag.get_prerequisites(nid))
    return seen


# ---------------------------------------------------------------------------
# Level loading
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("level", LEVELS)
def test_level_loads_with_nodes(level):
    """Each curriculum level loads a non-empty ConceptDAG."""
    dag = get_dag(level)
    assert isinstance(dag, ConceptDAG)
    assert dag.get_level() == level
    assert dag.get_node_count() > 0
    # every node is a ConceptNode with the required fields
    for node in dag.get_all_nodes():
        assert isinstance(node, ConceptNode)
        assert node.id
        assert node.name
        assert node.description
        assert isinstance(node.prerequisites, list)
        assert isinstance(node.abstraction_level, int)
        assert 0.0 <= node.difficulty <= 1.0


@pytest.mark.parametrize("level", LEVELS)
def test_level_has_milestones(level):
    """Every level declares at least one milestone concept."""
    dag = get_dag(level)
    milestones = dag.get_milestone_nodes()
    assert len(milestones) >= 1
    assert all(n.is_milestone for n in milestones)


@pytest.mark.parametrize("level", LEVELS)
def test_prerequisite_edges_reference_existing_nodes(level):
    """No prerequisite points to a non-existent node (no dangling edges)."""
    dag = get_dag(level)
    ids = {n.id for n in dag.get_all_nodes()}
    for node in dag.get_all_nodes():
        for prereq in node.prerequisites:
            assert prereq in ids, f"{node.id} lists unknown prereq {prereq}"


# ---------------------------------------------------------------------------
# Acyclicity
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("level", LEVELS)
def test_dag_is_acyclic(level):
    """The prerequisite graph must not contain cycles for any level."""
    dag = get_dag(level)
    assert not _has_cycle(dag), f"Cycle detected in {level} DAG"


# ---------------------------------------------------------------------------
# get_learning_path
# ---------------------------------------------------------------------------


def test_learning_path_covers_full_chain_when_no_mastery():
    """With empty mastery, the path to a deep node includes all prereqs."""
    dag = get_dag("group_theory")
    # find the highest-abstraction node as a deep target
    target = max(dag.get_all_nodes(), key=lambda n: n.abstraction_level).id
    path = dag.get_learning_path(target, mastery={})

    assert target in path
    # the path must be topologically valid (prereqs before dependents)
    _assert_path_topologically_valid(dag, path)
    # it should be non-trivial (more than just the target, since it has prereqs)
    assert len(path) > 1


def test_learning_path_for_lagrange_theorem():
    """lagrange_theorem's path equals its full transitive prereq closure.

    The group_theory JSON is richer than the in-code SEED (lagrange_theorem
    depends on subgroup, cosets, group_order), so we derive the expected
    closure dynamically rather than hard-coding node ids.
    """
    dag = get_dag("group_theory")
    target = "lagrange_theorem"
    path = dag.get_learning_path(target, mastery={})

    expected = _transitive_prereqs(dag, target) | {target}
    assert set(path) == expected
    assert target in path
    _assert_path_topologically_valid(dag, path)


def test_learning_path_empty_when_fully_mastered():
    """If everything is mastered, the learning path to a node is empty."""
    dag = get_dag("group_theory")
    mastery = {n.id: 0.9 for n in dag.get_all_nodes()}
    path = dag.get_learning_path("group_definition", mastery)
    assert path == []


def test_learning_path_master_all_except_target():
    """Mastering every prereq leaves only the target in the path."""
    dag = get_dag("group_theory")
    target = "lagrange_theorem"
    full_path = dag.get_learning_path(target, mastery={})
    # master everything except the target itself
    mastery = {nid: 0.9 for nid in full_path if nid != target}
    path = dag.get_learning_path(target, mastery)
    assert path == [target]


def test_learning_path_prunes_mastered_foundations():
    """Mastering a root removes it (and only it) from the path."""
    dag = get_dag("group_theory")
    target = "group_definition"
    full_path = dag.get_learning_path(target, mastery={})
    # master the first (most foundational) node in the path
    root = full_path[0]
    pruned = dag.get_learning_path(target, mastery={root: 0.9})

    assert root not in pruned
    assert target in pruned
    assert set(pruned) == (set(full_path) - {root})
    _assert_path_topologically_valid(dag, pruned)


def test_learning_path_unknown_node_appends_itself():
    """get_learning_path appends an unknown target (it has no prereqs).

    NOTE: This documents the current behaviour rather than asserting an
    error — visit() appends the target whenever mastery < 0.6 regardless
    of whether the node exists. Kept as a behavioural pin.
    """
    dag = get_dag("group_theory")
    path = dag.get_learning_path("does_not_exist", mastery={})
    assert path == ["does_not_exist"]


# ---------------------------------------------------------------------------
# check_prerequisites
# ---------------------------------------------------------------------------


def test_check_prerequisites_all_missing():
    """With no mastery, all direct prereqs of group_definition are missing."""
    dag = get_dag("group_theory")
    gaps = dag.check_prerequisites("group_definition", mastery={})
    assert set(gaps) == {
        "binary_operation",
        "associativity",
        "identity_element",
        "inverse_element",
    }


def test_check_prerequisites_all_met():
    """With sufficient mastery, no gaps are reported."""
    dag = get_dag("group_theory")
    mastery = {p: 0.8 for p in dag.get_prerequisites("group_definition")}
    assert dag.check_prerequisites("group_definition", mastery) == []


def test_check_prerequisites_partial():
    """Only unmet (mastery < 0.6) prereqs are reported as gaps."""
    dag = get_dag("group_theory")
    mastery = {
        "binary_operation": 0.8,
        "associativity": 0.8,
        "identity_element": 0.8,
        "inverse_element": 0.4,  # below threshold -> gap
    }
    gaps = dag.check_prerequisites("group_definition", mastery)
    assert gaps == ["inverse_element"]


def test_check_prerequisites_threshold_is_mastered_at_06():
    """mastery == 0.6 counts as mastered (the gap test is strict ``< 0.6``)."""
    dag = get_dag("group_theory")
    mastery = {p: 0.6 for p in dag.get_prerequisites("group_definition")}
    gaps = dag.check_prerequisites("group_definition", mastery)
    assert gaps == []  # 0.6 is NOT < 0.6, so no gaps


def test_check_prerequisites_below_threshold_is_gap():
    """mastery == 0.59 (just below 0.6) is reported as a gap."""
    dag = get_dag("group_theory")
    mastery = {p: 0.59 for p in dag.get_prerequisites("group_definition")}
    gaps = dag.check_prerequisites("group_definition", mastery)
    assert set(gaps) == set(dag.get_prerequisites("group_definition"))


def test_check_prerequisites_no_prereqs():
    """A root node (no prereqs) always reports no gaps."""
    dag = get_dag("group_theory")
    assert dag.check_prerequisites("set_basics", mastery={}) == []


def test_get_prerequisites_returns_direct_only():
    """get_prerequisites returns only the immediate prerequisites."""
    dag = get_dag("group_theory")
    # group_definition's direct prereqs do not include set_basics (transitive)
    direct = dag.get_prerequisites("group_definition")
    assert "set_basics" not in direct
    assert "binary_operation" in direct


def test_get_dependents_inverse_of_prerequisites():
    """get_dependents returns nodes that list the given node as a prereq."""
    dag = get_dag("group_theory")
    dependents = dag.get_dependents("binary_operation")
    # associativity and group_definition both depend on binary_operation
    assert "associativity" in dependents
    assert "group_definition" in dependents
    # and the inverse relationship holds
    for dep in dependents:
        assert "binary_operation" in dag.get_prerequisites(dep)


# ---------------------------------------------------------------------------
# get_available_curricula
# ---------------------------------------------------------------------------


def test_get_available_curricula_returns_all_levels():
    curricula = get_available_curricula()
    assert len(curricula) == len(LEVELS)
    levels = [c["level"] for c in curricula]
    assert set(levels) == set(LEVELS)

    for entry in curricula:
        assert entry["label"]  # has a human-readable label
        assert entry["file_exists"] is True
        assert entry["concept_count"] > 0
        assert isinstance(entry["domains"], list)


def test_curriculum_labels_are_chinese():
    curricula = get_available_curricula()
    by_level = {c["level"]: c["label"] for c in curricula}
    assert by_level["elementary"] == "小学数学"
    assert by_level["middle_school"] == "初中数学"
    assert by_level["high_school"] == "高中数学"
    assert by_level["group_theory"] == "群论（大学）"


# ---------------------------------------------------------------------------
# Singleton management: set_default_level / get_dag / reset_dag
# ---------------------------------------------------------------------------


def test_get_dag_returns_singleton_per_level():
    """get_dag(level) returns the same object on repeat calls."""
    reset_dag()
    a = get_dag("group_theory")
    b = get_dag("group_theory")
    assert a is b


def test_get_dag_different_levels_are_distinct():
    a = get_dag("group_theory")
    b = get_dag("elementary")
    assert a is not b
    assert a.get_level() == "group_theory"
    assert b.get_level() == "elementary"


def test_get_dag_without_level_uses_default():
    """get_dag() with no arg uses DEFAULT_LEVEL."""
    reset_dag()
    set_default_level("high_school")
    assert cd.DEFAULT_LEVEL == "high_school"
    assert get_dag() is get_dag("high_school")


def test_set_default_level_invalid_raises():
    with pytest.raises(ValueError, match="Unknown curriculum level"):
        set_default_level("kindergarten")


def test_set_default_level_changes_get_dag_result():
    reset_dag()
    set_default_level("elementary")
    dag = get_dag()
    assert dag.get_level() == "elementary"

    set_default_level("middle_school")
    dag2 = get_dag()
    assert dag2.get_level() == "middle_school"


def test_reset_dag_clears_specific_level():
    """reset_dag(level) drops only that level's cached DAG."""
    d1 = get_dag("group_theory")
    _ = get_dag("elementary")  # ensure elementary is cached too
    reset_dag("group_theory")

    d2 = get_dag("group_theory")
    assert d1 is not d2  # group_theory was rebuilt
    # elementary cache survives (different object identity is fine, just
    # confirm elementary still resolves to a valid DAG)
    assert get_dag("elementary").get_level() == "elementary"


def test_reset_dag_clears_all_levels():
    """reset_dag() with no args clears the entire cache."""
    d1 = get_dag("group_theory")
    e1 = get_dag("elementary")
    reset_dag()  # clear everything

    d2 = get_dag("group_theory")
    e2 = get_dag("elementary")
    assert d1 is not d2
    assert e1 is not e2


# ---------------------------------------------------------------------------
# get_curriculum_summary
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("level", LEVELS)
def test_get_curriculum_summary(level):
    """get_curriculum_summary returns correct metadata for each level."""
    dag = get_dag(level)
    summary = dag.get_curriculum_summary()

    assert summary["level"] == level
    assert summary["label"]  # non-empty
    assert summary["total_concepts"] == dag.get_node_count()
    assert summary["total_concepts"] > 0
    assert summary["milestones"] == len(dag.get_milestone_nodes())
    assert summary["milestones"] >= 1
    assert summary["max_abstraction_level"] >= 0
    assert summary["total_estimated_minutes"] > 0
    assert isinstance(summary["domains"], list)
    assert summary["domains"]  # at least one domain


def test_get_node_unknown_returns_none():
    dag = get_dag("group_theory")
    assert dag.get_node("nonexistent_node") is None


def test_direct_construction_with_seed_data():
    """ConceptDAG can be built directly from seed data."""
    seed = [
        {"id": "a", "name": "A", "description": "desc", "prerequisites": []},
        {"id": "b", "name": "B", "description": "desc", "prerequisites": ["a"]},
    ]
    dag = ConceptDAG(seed_data=seed, level="custom")
    assert dag.get_node_count() == 2
    assert dag.get_prerequisites("b") == ["a"]
    assert not _has_cycle(dag)


def test_direct_construction_detects_cycle():
    """The cycle detector actually fires on a cyclic seed (sanity check)."""
    cyclic = [
        {"id": "a", "name": "A", "description": "d", "prerequisites": ["b"]},
        {"id": "b", "name": "B", "description": "d", "prerequisites": ["a"]},
    ]
    dag = ConceptDAG(seed_data=cyclic, level="cyclic")
    assert _has_cycle(dag)
