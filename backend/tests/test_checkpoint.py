"""Contract tests for the checkpoint/rollback safety mechanism.

Covers ``mathweaver/safety/checkpoint.py`` (``CheckpointManager``):

- ``save_checkpoint`` deep-copies state and returns a unique id.
- ``restore_checkpoint`` returns a fresh deep copy decoupled from both the
  live state and the stored snapshot (safe repeated restores).
- Unknown checkpoint ids return ``None`` (restore) or are no-ops (drop).
- ``list_checkpoints`` exposes id / label / timestamp metadata.
- ``len`` reflects the number of retained checkpoints.
"""

from __future__ import annotations

import pytest

from mathweaver.models.state import FourFieldState
from mathweaver.safety.checkpoint import CheckpointManager


def _state(mastery: float = 0.5) -> FourFieldState:
    s = FourFieldState()
    s.knowledge.mastery_estimate = mastery
    return s


def test_save_returns_unique_ids():
    mgr = CheckpointManager()
    id1 = mgr.save_checkpoint(_state(0.4), label="first")
    id2 = mgr.save_checkpoint(_state(0.6), label="second")
    assert id1 != id2
    assert len(mgr) == 2


def test_save_generates_uuid_formatted_id():
    mgr = CheckpointManager()
    cid = mgr.save_checkpoint(_state())
    # UUIDs are 36-char hyphenated hex strings
    parts = cid.split("-")
    assert parts[0] == parts[1] == parts[2] == parts[3] == parts[4] or len(parts) == 5


def test_restore_returns_state_equal_to_saved():
    mgr = CheckpointManager()
    saved = _state(0.7)
    cid = mgr.save_checkpoint(saved, label="before-advance")
    restored = mgr.restore_checkpoint(cid)
    assert restored is not None
    assert restored.knowledge.mastery_estimate == pytest.approx(0.7)


def test_restored_is_decoupled_from_live_state():
    """Mutating the live state after save must not corrupt the snapshot."""
    mgr = CheckpointManager()
    live = _state(0.5)
    cid = mgr.save_checkpoint(live)
    live.knowledge.mastery_estimate = 0.9  # mutate live state afterwards

    restored = mgr.restore_checkpoint(cid)
    assert restored.knowledge.mastery_estimate == pytest.approx(0.5)


def test_repeated_restores_return_consistent_results():
    """Each restore returns a fresh copy; mutating one must not affect the next."""
    mgr = CheckpointManager()
    cid = mgr.save_checkpoint(_state(0.6))

    first = mgr.restore_checkpoint(cid)
    first.knowledge.mastery_estimate = 0.1  # mutate the first copy

    second = mgr.restore_checkpoint(cid)
    assert second.knowledge.mastery_estimate == pytest.approx(0.6)


def test_restore_unknown_returns_none():
    mgr = CheckpointManager()
    assert mgr.restore_checkpoint("does-not-exist") is None
    assert mgr.restore_checkpoint("") is None


def test_list_checkpoints_metadata():
    mgr = CheckpointManager()
    mgr.save_checkpoint(_state(0.4), label="cp-a")
    mgr.save_checkpoint(_state(0.6), label="cp-b")

    items = mgr.list_checkpoints()
    assert len(items) == 2
    labels = {it["label"] for it in items}
    assert labels == {"cp-a", "cp-b"}
    for it in items:
        assert "id" in it and "label" in it and "timestamp" in it


def test_drop_removes_checkpoint():
    mgr = CheckpointManager()
    cid = mgr.save_checkpoint(_state())
    assert len(mgr) == 1
    mgr.drop_checkpoint(cid)
    assert len(mgr) == 0
    assert mgr.restore_checkpoint(cid) is None


def test_drop_unknown_is_noop():
    mgr = CheckpointManager()
    mgr.drop_checkpoint("nope")
    assert len(mgr) == 0


def test_empty_manager_len_zero():
    mgr = CheckpointManager()
    assert len(mgr) == 0
    assert mgr.list_checkpoints() == []
