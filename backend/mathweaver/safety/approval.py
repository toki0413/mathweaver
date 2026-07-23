"""Human-in-the-loop (HITL) approval gate (safety 6.4).

Gates high-risk pedagogical operations behind an explicit approval step.
High-risk operations include advancing a DAG node, mastery changes larger
than a threshold, and state rollbacks. Low-risk operations may be
auto-approved when ``auto_approve_low_risk`` is enabled.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class RiskLevel(str, Enum):
    """Risk classification for a gated operation."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ApprovalStatus(str, Enum):
    """Lifecycle states of an approval request."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    AUTO_APPROVED = "auto_approved"


# ---------------------------------------------------------------------------
# High-risk operation policy
# ---------------------------------------------------------------------------

# Operations that are inherently sensitive and require an approval gate.
HIGH_RISK_OPERATIONS: frozenset[str] = frozenset({
    "advance_dag_node",   # advancing the current DAG node
    "mastery_change",      # updating a learner's mastery estimate
    "state_rollback",      # rolling back the four-field state
})

# Mastery deltas with absolute value above this threshold are high-risk.
MASTERY_CHANGE_THRESHOLD: float = 0.1


# ---------------------------------------------------------------------------
# Approval request
# ---------------------------------------------------------------------------

@dataclass
class ApprovalRequest:
    """A single approval request tracked by the gate.

    ``reason`` describes why the operation is being requested; when the
    request is rejected, ``rejection_reason`` records the reviewer's
    justification.
    """

    request_id: str
    operation: str
    reason: str
    risk_level: RiskLevel
    status: ApprovalStatus
    timestamp: datetime
    decision_timestamp: datetime | None = None
    rejection_reason: str = ""


# ---------------------------------------------------------------------------
# Approval gate
# ---------------------------------------------------------------------------

class ApprovalGate:
    """HITL approval gate for high-risk operations (safety 6.4).

    Usage::

        gate = ApprovalGate()
        if gate.should_gate("advance_dag_node"):
            rid = gate.request_approval(
                "advance_dag_node", reason="...", risk_level=RiskLevel.HIGH
            )
            status = gate.await_approval(rid)   # non-interactive: returns immediately
            if status in (ApprovalStatus.APPROVED, ApprovalStatus.AUTO_APPROVED):
                ...  # proceed with the operation
    """

    def __init__(self, auto_approve_low_risk: bool = True) -> None:
        self.auto_approve_low_risk = auto_approve_low_risk
        self._requests: dict[str, ApprovalRequest] = {}

    # -- gating policy --

    def should_gate(self, operation: str) -> bool:
        """Return True if *operation* requires approval before execution."""
        return operation in HIGH_RISK_OPERATIONS

    # -- request lifecycle --

    def request_approval(
        self,
        operation: str,
        reason: str,
        risk_level: RiskLevel = RiskLevel.HIGH,
    ) -> str:
        """Create an approval request and return its id.

        When ``auto_approve_low_risk`` is True and *risk_level* is ``LOW``,
        the request is marked ``AUTO_APPROVED`` immediately.
        """
        request_id = str(uuid4())
        now = datetime.now(timezone.utc)

        status = ApprovalStatus.PENDING
        decision_ts: datetime | None = None
        if self.auto_approve_low_risk and risk_level == RiskLevel.LOW:
            status = ApprovalStatus.AUTO_APPROVED
            decision_ts = now

        self._requests[request_id] = ApprovalRequest(
            request_id=request_id,
            operation=operation,
            reason=reason,
            risk_level=risk_level,
            status=status,
            timestamp=now,
            decision_timestamp=decision_ts,
        )

        logger.info(
            "Approval request %s: op=%s risk=%s status=%s",
            request_id,
            operation,
            risk_level.value,
            status.value,
        )
        return request_id

    def check_approval(self, request_id: str) -> ApprovalStatus:
        """Return the current status of a request.

        Returns ``PENDING`` for an unknown id (fail-safe: never approve an
        unrecognised request).
        """
        req = self._requests.get(request_id)
        if req is None:
            logger.warning("Check failed: unknown request %s", request_id)
            return ApprovalStatus.PENDING
        return req.status

    def approve(self, request_id: str) -> None:
        """Manually approve a pending request."""
        req = self._requests.get(request_id)
        if req is None:
            logger.warning("Approve failed: unknown request %s", request_id)
            return
        if req.status != ApprovalStatus.PENDING:
            logger.warning(
                "Approve skipped: request %s already %s",
                request_id,
                req.status.value,
            )
            return
        req.status = ApprovalStatus.APPROVED
        req.decision_timestamp = datetime.now(timezone.utc)
        logger.info("Approved request %s", request_id)

    def reject(self, request_id: str, reason: str = "") -> None:
        """Manually reject a pending request."""
        req = self._requests.get(request_id)
        if req is None:
            logger.warning("Reject failed: unknown request %s", request_id)
            return
        if req.status != ApprovalStatus.PENDING:
            logger.warning(
                "Reject skipped: request %s already %s",
                request_id,
                req.status.value,
            )
            return
        req.status = ApprovalStatus.REJECTED
        req.decision_timestamp = datetime.now(timezone.utc)
        req.rejection_reason = reason
        logger.info("Rejected request %s: %s", request_id, reason)

    def await_approval(self, request_id: str, timeout: float = 0.0) -> ApprovalStatus:
        """Return the status of a request, optionally polling.

        In non-interactive mode (``timeout == 0.0``, the default) this
        returns immediately with the current status — typically ``PENDING``
        unless the request was auto-approved. With ``timeout > 0`` it polls
        until a decision is reached or the timeout elapses, which is useful
        when another thread is driving manual approvals.
        """
        if timeout <= 0.0:
            return self.check_approval(request_id)

        deadline = time.monotonic() + timeout
        while True:
            status = self.check_approval(request_id)
            if status in (
                ApprovalStatus.APPROVED,
                ApprovalStatus.REJECTED,
                ApprovalStatus.AUTO_APPROVED,
            ):
                return status
            remaining = deadline - time.monotonic()
            if remaining <= 0.0:
                return status
            time.sleep(min(0.1, remaining))

    # -- introspection --

    def get_request(self, request_id: str) -> ApprovalRequest | None:
        """Return the full ``ApprovalRequest``, or ``None`` if unknown."""
        return self._requests.get(request_id)

    def __len__(self) -> int:
        return len(self._requests)
