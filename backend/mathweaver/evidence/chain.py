"""Execution evidence chain: append-only, tamper-evident trace.

Each entry is hashed and chained to the previous entry's hash,
forming a cryptographic chain. Any tampering breaks the chain.

Acceptance criterion 4.2: "任务后可回放完整证据链
（输入/输出/工具调用/耗时/token），append-only 不可篡改"
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class EvidenceEntry:
    """A single entry in the execution evidence chain."""

    sequence: int                          # 0-based index
    timestamp: str                         # ISO 8601 UTC
    session_id: str
    agent_name: str
    phase: str                             # perceive, abstract, verify, etc.
    input_summary: str                     # truncated input
    output_summary: str                    # truncated output
    tool_calls: list[dict[str, Any]]        # tools invoked
    field_updates: dict[str, Any]           # state changes proposed
    confidence: float
    prev_hash: str                         # hash of previous entry
    entry_hash: str = ""                   # computed hash of this entry
    metadata: dict[str, Any] = field(default_factory=dict)

    def compute_hash(self) -> str:
        """Compute SHA-256 hash of this entry (excluding entry_hash field)."""
        d = asdict(self)
        d.pop("entry_hash", None)
        canonical = json.dumps(d, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def seal(self) -> None:
        """Compute and set the entry_hash."""
        self.entry_hash = self.compute_hash()


class EvidenceChain:
    """Append-only evidence chain with hash linking.

    Usage:
        chain = EvidenceChain(session_id="abc")
        chain.append(agent="perception", phase="perceive", ...)
        chain.verify()  # True if chain is intact
        chain.export()  # list of dict entries
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._entries: list[EvidenceEntry] = []
        self._seq = 0

    def append(
        self,
        agent_name: str,
        phase: str,
        input_summary: str,
        output_summary: str,
        tool_calls: list[dict[str, Any]] | None = None,
        field_updates: dict[str, Any] | None = None,
        confidence: float = 0.0,
        metadata: dict[str, Any] | None = None,
    ) -> EvidenceEntry:
        """Append a new entry to the chain. Cannot modify existing entries."""
        prev_hash = self._entries[-1].entry_hash if self._entries else "0" * 64

        entry = EvidenceEntry(
            sequence=self._seq,
            timestamp=datetime.now(timezone.utc).isoformat(),
            session_id=self.session_id,
            agent_name=agent_name,
            phase=phase,
            input_summary=input_summary[:500],
            output_summary=output_summary[:500],
            tool_calls=tool_calls or [],
            field_updates=field_updates or {},
            confidence=confidence,
            prev_hash=prev_hash,
            metadata=metadata or {},
        )
        entry.seal()
        self._entries.append(entry)
        self._seq += 1

        logger.debug("Evidence #%d: %s.%s hash=%s...)",
                      entry.sequence, agent_name, phase, entry.entry_hash[:12])
        return entry

    def verify(self) -> bool:
        """Verify the chain is intact (no tampering).

        Returns True if every entry's hash matches and prev_hash links are correct.
        """
        prev_hash = "0" * 64
        for entry in self._entries:
            # Recompute hash
            computed = entry.compute_hash()
            if computed != entry.entry_hash:
                logger.warning("Evidence tampered at #%d: hash mismatch", entry.sequence)
                return False
            # Verify chain link
            if entry.prev_hash != prev_hash:
                logger.warning("Evidence broken at #%d: prev_hash mismatch", entry.sequence)
                return False
            prev_hash = entry.entry_hash
        return True

    def export(self) -> list[dict[str, Any]]:
        """Export the full chain as a list of serializable dicts."""
        return [asdict(e) for e in self._entries]

    def summary(self) -> dict[str, Any]:
        """Return a summary of the chain."""
        return {
            "session_id": self.session_id,
            "entries": len(self._entries),
            "agents_used": list({e.agent_name for e in self._entries}),
            "phases": [e.phase for e in self._entries],
            "total_tool_calls": sum(len(e.tool_calls) for e in self._entries),
            "intact": self.verify(),
        }

    def __len__(self) -> int:
        return len(self._entries)

    def __getitem__(self, idx: int) -> EvidenceEntry:
        return self._entries[idx]
