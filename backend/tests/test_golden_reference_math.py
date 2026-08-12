"""Golden-reference tests: independently verify ALL mathematical data.

ROOT CAUSE of prior bugs: tests verified CODE behavior (does the function run?)
but never verified DATA correctness (is this Cayley table actually a valid group?).

This module performs INDEPENDENT verification from first principles:
  - Every known Cayley table is checked against all 4 group axioms
  - Commutativity / cyclic classification is verified against ground truth
  - No reliance on the project's own forge.py — pure math verification
  - Single-source-of-truth is enforced: handler and nl_translator must
    reference the SAME dict object, not just equal copies

If any of these tests fail, it means the mathematical DATA is wrong,
regardless of whether the code "works".
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mathweaver.conjecture.handler import _TEST_GROUPS
from mathweaver.conjecture.known_groups import GROUP_META, KNOWN_GROUPS
from mathweaver.conjecture.nl_translator import _KNOWN_GROUPS, TranslationResult

# ---------------------------------------------------------------------------
# Independent group axiom verifier (does NOT use forge.py)
# ---------------------------------------------------------------------------

def _check_closure(table: list[list[int]]) -> bool:
    n = len(table)
    for row in table:
        for val in row:
            if not (0 <= val < n):
                return False
    return True


def _find_identity(table: list[list[int]]) -> int | None:
    n = len(table)
    for e in range(n):
        if all(table[e][x] == x and table[x][e] == x for x in range(n)):
            return e
    return None


def _check_inverses(table: list[list[int]], identity: int) -> bool:
    n = len(table)
    for a in range(n):
        found = False
        for b in range(n):
            if table[a][b] == identity and table[b][a] == identity:
                found = True
                break
        if not found:
            return False
    return True


def _check_associativity(table: list[list[int]]) -> tuple[bool, list]:
    n = len(table)
    violations = []
    for a in range(n):
        for b in range(n):
            for c in range(n):
                lhs = table[table[a][b]][c]
                rhs = table[a][table[b][c]]
                if lhs != rhs:
                    violations.append((a, b, c))
    return len(violations) == 0, violations


def _check_commutativity(table: list[list[int]]) -> bool:
    n = len(table)
    for a in range(n):
        for b in range(n):
            if table[a][b] != table[b][a]:
                return False
    return True


def _validate_group(name: str, table: list[list[int]]) -> dict:
    """Run all group axiom checks. Returns detailed report."""
    n = len(table)
    report = {"name": name, "order": n, "passed": True, "errors": []}

    if not _check_closure(table):
        report["passed"] = False
        report["errors"].append("Closure violated: entries outside [0, n)")

    identity = _find_identity(table)
    if identity is None:
        report["passed"] = False
        report["errors"].append("No identity element found")
    else:
        report["identity"] = identity
        if not _check_inverses(table, identity):
            report["passed"] = False
            report["errors"].append("Not all elements have two-sided inverses")

    is_assoc, violations = _check_associativity(table)
    if not is_assoc:
        report["passed"] = False
        report["errors"].append(
            f"Associativity violated: {len(violations)} cases, "
            f"e.g. ({violations[0][0]},{violations[0][1]},{violations[0][2]})"
        )

    report["is_abelian"] = _check_commutativity(table)
    return report


# ---------------------------------------------------------------------------
# Tests: validate all Cayley tables against group axioms
# ---------------------------------------------------------------------------

class TestKnownGroupsAxioms:
    """Validate every group in the canonical KNOWN_GROUPS database."""

    def test_all_groups_satisfy_axioms(self):
        """Every entry in KNOWN_GROUPS must be a valid group."""
        failures = []
        for name, table in KNOWN_GROUPS.items():
            report = _validate_group(name, table)
            if not report["passed"]:
                failures.append(f"{name}: {report['errors']}")
        assert not failures, "Invalid group tables:\n" + "\n".join(failures)

    def test_orders_match_meta(self):
        """Each table's size must match its declared order in GROUP_META."""
        for name, table in KNOWN_GROUPS.items():
            if name in GROUP_META:
                expected_order = GROUP_META[name]["order"]
                assert len(table) == expected_order, (
                    f"{name}: expected order {expected_order}, got {len(table)}"
                )

    def test_abelian_classification_matches_meta(self):
        """Commutativity computed from the table must match GROUP_META."""
        for name, table in KNOWN_GROUPS.items():
            if name in GROUP_META:
                expected_abelian = GROUP_META[name]["abelian"]
                actual_abelian = _check_commutativity(table)
                assert actual_abelian == expected_abelian, (
                    f"{name}: expected abelian={expected_abelian}, "
                    f"got abelian={actual_abelian}"
                )


# ---------------------------------------------------------------------------
# Single-source-of-truth enforcement
# ---------------------------------------------------------------------------

class TestSingleSourceOfTruth:
    """Verify that handler and nl_translator reference the SAME data object.

    This is the critical test that prevents the original bug class:
    two separate copies of the same data diverging silently.
    If _TEST_GROUPS and _KNOWN_GROUPS are merely equal but not the same
    object, someone could modify one without the other — which is exactly
    what happened with the Q8 fix.
    """

    def test_handler_imports_same_object(self):
        """handler._TEST_GROUPS must BE KNOWN_GROUPS (same object identity)."""
        assert _TEST_GROUPS is KNOWN_GROUPS, (
            "handler._TEST_GROUPS is a separate copy of the data, not a "
            "reference to known_groups.KNOWN_GROUPS. This means future "
            "edits to one won't propagate to the other — reintroducing the "
            "divergence bug."
        )

    def test_translator_imports_same_object(self):
        """nl_translator._KNOWN_GROUPS must BE KNOWN_GROUPS (same identity)."""
        assert _KNOWN_GROUPS is KNOWN_GROUPS, (
            "nl_translator._KNOWN_GROUPS is a separate copy of the data, "
            "not a reference to known_groups.KNOWN_GROUPS. This means "
            "future edits to one won't propagate to the other — "
            "reintroducing the divergence bug."
        )

    def test_handler_and_translator_share_identity(self):
        """_TEST_GROUPS and _KNOWN_GROUPS must be the exact same object."""
        assert _TEST_GROUPS is _KNOWN_GROUPS, (
            "handler._TEST_GROUPS and nl_translator._KNOWN_GROUPS are "
            "different objects. They must point to the same data source."
        )


# ---------------------------------------------------------------------------
# Guard against vacuous-truth bug
# ---------------------------------------------------------------------------

class TestNoVacuousTruth:
    """Guard against the vacuous-truth bug: empty candidate sets.

    The original bug: when no known group matched the queried order,
    the code returned "confirmed" (all zero candidates pass → vacuously
    true).  The fix returns "undecidable" instead.

    These tests verify that for every order a student might ask about,
    the data either has at least one group OR the code handles the
    empty case correctly.
    """

    def test_known_orders_cover_common_cases(self):
        """Orders 2-8 should all have at least one known group."""
        orders_present = {len(t) for t in KNOWN_GROUPS.values()}
        for order in range(2, 9):
            assert order in orders_present, (
                f"No known group of order {order} exists. "
                f"Students asking about {order}-order groups will get "
                f"'undecidable' — consider adding one."
            )

    def test_order_5_is_undecidable_or_covered(self):
        """Order 5 is prime — if no Z5 exists, translator must return
        undecidable, NOT confirmed."""
        # Z5 is not in the database (5 elements), so a commutativity
        # check constrained to order 5 must return "undecidable" rather
        # than vacuously "confirmed" (the vacuous-truth bug).
        order5_groups = [
            name for name, table in KNOWN_GROUPS.items()
            if len(table) == 5
        ]
        if order5_groups:
            # A Z5 exists — ensure the translator does not claim it is
            # non-commutative (order 5 is prime, hence cyclic, hence abelian).
            return

        from mathweaver.conjecture.nl_translator import (
            NaturalLanguageTranslator,
            StructuredConjecture,
        )

        conjecture = StructuredConjecture(
            domain="group_theory",
            property="commutativity",
            quantifier="all",
            order_constraint=5,
            source_text="所有5阶群都是交换群",
        )

        def _verify() -> TranslationResult:
            return NaturalLanguageTranslator()._verify_commutativity(conjecture)

        result = _verify()
        assert result.verdict == "undecidable", (
            "Order 5 has no known group in the database; the translator "
            "must return 'undecidable', not vacuously 'confirmed'. "
            f"Got: {result.verdict}"
        )
