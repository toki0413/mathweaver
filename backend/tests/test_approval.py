"""Contract tests for the HITL approval gate (safety 6.4).

Verifies the gating policy, the request lifecycle (pending → approved /
rejected / auto-approved), fail-safe behaviour for unknown ids, and both the
non-interactive and polling modes of ``await_approval``.
"""

from __future__ import annotations

import threading
import time

from mathweaver.safety.approval import (
    HIGH_RISK_OPERATIONS,
    MASTERY_CHANGE_THRESHOLD,
    ApprovalGate,
    ApprovalStatus,
    RiskLevel,
)

# ---------------------------------------------------------------------------
# Gating policy
# ---------------------------------------------------------------------------


def test_high_risk_policy_contains_all_sensitive_operations():
    assert "advance_dag_node" in HIGH_RISK_OPERATIONS
    assert "mastery_change" in HIGH_RISK_OPERATIONS
    assert "state_rollback" in HIGH_RISK_OPERATIONS


def test_mastery_change_threshold_is_contractual():
    assert MASTERY_CHANGE_THRESHOLD == 0.1


def test_should_gate_only_high_risk_operations():
    gate = ApprovalGate()
    assert gate.should_gate("advance_dag_node") is True
    assert gate.should_gate("state_rollback") is True
    assert gate.should_gate("deliver_message") is False
    assert gate.should_gate("") is False


# ---------------------------------------------------------------------------
# Request lifecycle
# ---------------------------------------------------------------------------


def test_high_risk_request_starts_pending():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("advance_dag_node", "reason", RiskLevel.HIGH)
    assert gate.check_approval(rid) == ApprovalStatus.PENDING


def test_low_risk_request_is_auto_approved_when_enabled():
    gate = ApprovalGate(auto_approve_low_risk=True)
    rid = gate.request_approval("some_op", "reason", RiskLevel.LOW)
    assert gate.check_approval(rid) == ApprovalStatus.AUTO_APPROVED


def test_low_risk_request_stays_pending_when_auto_approve_disabled():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("some_op", "reason", RiskLevel.LOW)
    assert gate.check_approval(rid) == ApprovalStatus.PENDING


def test_approve_transitions_pending_to_approved():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("advance_dag_node", "reason", RiskLevel.HIGH)
    gate.approve(rid)
    assert gate.check_approval(rid) == ApprovalStatus.APPROVED
    req = gate.get_request(rid)
    assert req is not None
    assert req.decision_timestamp is not None


def test_reject_records_reason():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("mastery_change", "reason", RiskLevel.HIGH)
    gate.reject(rid, "not yet")
    assert gate.check_approval(rid) == ApprovalStatus.REJECTED
    assert gate.get_request(rid).rejection_reason == "not yet"


def test_approve_is_idempotent_on_non_pending():
    gate = ApprovalGate(auto_approve_low_risk=True)
    rid = gate.request_approval("some_op", "reason", RiskLevel.LOW)
    gate.approve(rid)  # already AUTO_APPROVED — must not become APPROVED
    assert gate.check_approval(rid) == ApprovalStatus.AUTO_APPROVED


def test_reject_is_idempotent_on_non_pending():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("advance_dag_node", "reason", RiskLevel.HIGH)
    gate.reject(rid, "no")
    gate.reject(rid, "still no")
    req = gate.get_request(rid)
    assert req.status == ApprovalStatus.REJECTED
    assert req.rejection_reason == "no"


# ---------------------------------------------------------------------------
# Fail-safe for unknown ids
# ---------------------------------------------------------------------------


def test_check_approval_unknown_returns_pending():
    gate = ApprovalGate()
    assert gate.check_approval("does-not-exist") == ApprovalStatus.PENDING


def test_approve_unknown_is_noop():
    gate = ApprovalGate()
    gate.approve("does-not-exist")  # must not raise
    assert len(gate) == 0


def test_reject_unknown_is_noop():
    gate = ApprovalGate()
    gate.reject("does-not-exist", "why")
    assert len(gate) == 0


def test_get_request_unknown_returns_none():
    gate = ApprovalGate()
    assert gate.get_request("does-not-exist") is None


# ---------------------------------------------------------------------------
# Await approval
# ---------------------------------------------------------------------------


def test_await_approval_non_interactive_returns_immediately():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("advance_dag_node", "reason", RiskLevel.HIGH)
    start = time.monotonic()
    status = gate.await_approval(rid)  # timeout=0 — no polling
    assert time.monotonic() - start < 0.2
    assert status == ApprovalStatus.PENDING


def test_await_approval_returns_immediately_when_already_decided():
    gate = ApprovalGate(auto_approve_low_risk=True)
    rid = gate.request_approval("some_op", "reason", RiskLevel.LOW)
    assert gate.await_approval(rid, timeout=5.0) == ApprovalStatus.AUTO_APPROVED


def test_await_approval_polls_until_approved_from_another_thread():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("advance_dag_node", "reason", RiskLevel.HIGH)

    def _approve_later():
        time.sleep(0.1)
        gate.approve(rid)

    thread = threading.Thread(target=_approve_later)
    thread.start()
    try:
        status = gate.await_approval(rid, timeout=2.0)
    finally:
        thread.join()
    assert status == ApprovalStatus.APPROVED


def test_await_approval_times_out_returning_pending():
    gate = ApprovalGate(auto_approve_low_risk=False)
    rid = gate.request_approval("advance_dag_node", "reason", RiskLevel.HIGH)
    status = gate.await_approval(rid, timeout=0.05)
    assert status == ApprovalStatus.PENDING


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------


def test_len_reflects_number_of_requests():
    gate = ApprovalGate()
    assert len(gate) == 0
    gate.request_approval("advance_dag_node", "a", RiskLevel.HIGH)
    gate.request_approval("mastery_change", "b", RiskLevel.HIGH)
    assert len(gate) == 2
