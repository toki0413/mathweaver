"""Checkpoint/rollback mechanism for the four-field state (safety 6.5).

Provides in-memory snapshots of ``FourFieldState`` so the orchestrator can
roll back to a known-good state after a failed or regrettable pedagogical
action.

Each checkpoint deep-copies the state at save time, so subsequent mutations
of the live state never corrupt stored snapshots. Restoring likewise
returns a fresh deep copy, keeping the stored snapshot pristine for
repeated restores.
"""

from __future__ import annotations

import copy
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from ..models.state import FourFieldState

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Checkpoint record
# ---------------------------------------------------------------------------

@dataclass
class Checkpoint:
    """A stored snapshot of the four-field state.

    ``state`` is a deep copy captured at save time; it must not be mutated
    in place so that repeated restores return consistent results.
    """

    checkpoint_id: str
    label: str
    created_at: datetime
    state: FourFieldState


# ---------------------------------------------------------------------------
# Checkpoint manager
# ---------------------------------------------------------------------------

class CheckpointManager:
    """Manages in-memory checkpoints for state rollback (safety 6.5).

    Snapshots are taken with ``copy.deepcopy`` so the stored copy is fully
    decoupled from the live ``FourFieldState``.
    """

    def __init__(self) -> None:
        self._checkpoints: dict[str, Checkpoint] = {}

    def save_checkpoint(self, state: FourFieldState, label: str = "") -> str:
        """Deep-copy *state* and store it under a new checkpoint id.

        Args:
            state: the current ``FourFieldState`` to snapshot.
            label: optional human-readable label for the checkpoint.

        Returns:
            The checkpoint id (UUID string).
        """
        checkpoint_id = str(uuid4())
        snapshot = copy.deepcopy(state)
        self._checkpoints[checkpoint_id] = Checkpoint(
            checkpoint_id=checkpoint_id,
            label=label,
            created_at=datetime.now(timezone.utc),
            state=snapshot,
        )
        logger.debug(
            "Saved checkpoint %s (label=%r, state_updated_at=%s)",
            checkpoint_id,
            label,
            snapshot.updated_at.isoformat(),
        )
        return checkpoint_id

    def restore_checkpoint(self, checkpoint_id: str) -> FourFieldState | None:
        """Restore a previous state.

        Returns a fresh deep copy of the stored snapshot so the caller may
        mutate it freely without affecting the stored checkpoint. Returns
        ``None`` when *checkpoint_id* is unknown.
        """
        cp = self._checkpoints.get(checkpoint_id)
        if cp is None:
            logger.warning("Restore failed: unknown checkpoint %s", checkpoint_id)
            return None
        logger.debug(
            "Restoring checkpoint %s (label=%r, created_at=%s)",
            checkpoint_id,
            cp.label,
            cp.created_at.isoformat(),
        )
        return copy.deepcopy(cp.state)

    def list_checkpoints(self) -> list[dict[str, Any]]:
        """List all checkpoints with id, label and timestamp."""
        return [
            {
                "id": cp.checkpoint_id,
                "label": cp.label,
                "timestamp": cp.created_at.isoformat(),
            }
            for cp in self._checkpoints.values()
        ]

    def drop_checkpoint(self, checkpoint_id: str) -> None:
        """Remove a checkpoint. No-op if the id is unknown."""
        removed = self._checkpoints.pop(checkpoint_id, None)
        if removed is None:
            logger.warning("Drop failed: unknown checkpoint %s", checkpoint_id)
            return
        logger.debug("Dropped checkpoint %s", checkpoint_id)

    def __len__(self) -> int:
        return len(self._checkpoints)
