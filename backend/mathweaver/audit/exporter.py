"""Audit log export: persist the evidence chain to verifiable files.

The :class:`AuditExporter` bridges the in-memory :class:`EvidenceChain`
and persistent audit storage. It supports two formats:

  - **JSONL** (``export_to_file``): one JSON object per line, written in
    append-only mode.  Each line carries ``entry_hash`` and ``prev_hash``
    so the file can be independently verified.
  - **JSON array** (``export_to_json``): a single snapshot of the full
    chain.

``verify_file`` reads a JSONL file and recomputes every hash, checking
both per-entry integrity and chain linking -- mirroring the logic in
:class:`~mathweaver.evidence.chain.EvidenceEntry.compute_hash`.

Acceptance criterion 7.1: "audit log export"
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from ..evidence.chain import EvidenceChain

logger = logging.getLogger(__name__)

# Genesis hash for the first entry in a chain (matches EvidenceChain)
_GENESIS_HASH = "0" * 64


class AuditExporter:
    """Export an :class:`EvidenceChain` to persistent audit files.

    The exporter tracks how many entries have already been written so
    that repeated calls to :meth:`export_to_file` append **only new**
    entries.  This gives true append-only semantics: the resulting
    file is always a single, contiguous, verifiable hash chain.

    Usage::

        chain = EvidenceChain(session_id="abc")
        chain.append(agent_name="perception", ...)
        exporter = AuditExporter(chain)

        exporter.export_to_file("audit.jsonl")   # writes all current entries
        chain.append(agent_name="abstraction", ...)
        exporter.export_to_file("audit.jsonl")   # appends only the new entry

        ok = exporter.verify_file("audit.jsonl") # True if chain is intact

    All file handles are opened, written, and closed immediately --
    no long-lived handles are kept.
    """

    def __init__(self, chain: EvidenceChain) -> None:
        self.chain = chain
        self._exported_count: int = 0

    # ------------------------------------------------------------------
    # Export methods
    # ------------------------------------------------------------------

    def export_to_file(self, path: str | Path) -> int:
        """Export new entries as JSONL (one JSON object per line).

        Uses append mode (``'a'``) so existing audit data is never
        overwritten.  Only entries not yet exported by this exporter
        instance are written, enabling safe incremental appends across
        the lifetime of the chain.

        Each written line is a JSON object containing the full entry,
        including ``entry_hash`` and ``prev_hash`` for independent
        verification.

        Args:
            path: Destination file path.  Parent directories are
                created automatically.

        Returns:
            The number of entries written in this call.
        """
        entries = self.chain.export()
        new_entries = entries[self._exported_count :]
        if not new_entries:
            return 0

        file_path = Path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, "a", encoding="utf-8") as f:
            for entry in new_entries:
                line = json.dumps(entry, ensure_ascii=False)
                f.write(line + "\n")

        self._exported_count = len(entries)
        logger.info(
            "Exported %d entries to %s (total exported: %d)",
            len(new_entries),
            file_path,
            self._exported_count,
        )
        return len(new_entries)

    def export_to_json(self, path: str | Path) -> int:
        """Export the full chain as a single JSON array.

        Writes a complete snapshot of **all** entries (regardless of
        how many have been incrementally exported) as a JSON array.
        Uses write mode (``'w'``) since this is a snapshot, not an
        append.

        Args:
            path: Destination file path.  Parent directories are
                created automatically.

        Returns:
            The number of entries written.
        """
        entries = self.chain.export()
        file_path = Path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)

        logger.info(
            "Exported %d entries to %s (JSON array snapshot)",
            len(entries),
            file_path,
        )
        return len(entries)

    # ------------------------------------------------------------------
    # Verification
    # ------------------------------------------------------------------

    def verify_file(self, path: str | Path) -> bool:
        """Verify the hash-chain integrity of a JSONL audit file.

        Reads each non-empty line, parses the JSON object, recomputes
        the SHA-256 hash (excluding ``entry_hash``), and checks that:

        1. The recomputed hash matches the stored ``entry_hash``
           (per-entry tamper detection).
        2. Each entry's ``prev_hash`` equals the previous entry's
           ``entry_hash`` (chain-link integrity).

        The hash computation mirrors
        :meth:`~mathweaver.evidence.chain.EvidenceEntry.compute_hash`:
        ``json.dumps(d, sort_keys=True, ensure_ascii=False)`` followed
        by SHA-256.

        Args:
            path: Path to the JSONL file to verify.

        Returns:
            ``True`` if every entry is intact and properly linked,
            ``False`` otherwise (including when the file is missing).
        """
        file_path = Path(path)
        if not file_path.exists():
            logger.warning("Audit file does not exist: %s", file_path)
            return False

        prev_hash = _GENESIS_HASH
        line_no = 0

        with open(file_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                line_no += 1

                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON at line %d in %s", line_no, file_path)
                    return False

                stored_hash = entry.get("entry_hash", "")
                entry_prev_hash = entry.get("prev_hash", "")

                # Recompute hash (exclude entry_hash, same canonical form as EvidenceEntry)
                d = dict(entry)
                d.pop("entry_hash", None)
                canonical = json.dumps(d, sort_keys=True, ensure_ascii=False)
                computed_hash = hashlib.sha256(
                    canonical.encode("utf-8")
                ).hexdigest()

                # 1. Per-entry hash verification
                if computed_hash != stored_hash:
                    logger.warning(
                        "Audit tampered at line %d (seq=%s): hash mismatch "
                        "(expected %s..., got %s...)",
                        line_no,
                        entry.get("sequence", "?"),
                        stored_hash[:12],
                        computed_hash[:12],
                    )
                    return False

                # 2. Chain-link verification
                if entry_prev_hash != prev_hash:
                    logger.warning(
                        "Audit broken at line %d (seq=%s): prev_hash mismatch "
                        "(expected %s..., got %s...)",
                        line_no,
                        entry.get("sequence", "?"),
                        prev_hash[:12],
                        entry_prev_hash[:12],
                    )
                    return False

                prev_hash = stored_hash

        if line_no == 0:
            logger.info("Audit file is empty: %s", file_path)
        else:
            logger.info(
                "Audit file verified: %s (%d entries, intact)",
                file_path,
                line_no,
            )
        return True

    # ------------------------------------------------------------------
    # State management
    # ------------------------------------------------------------------

    @property
    def exported_count(self) -> int:
        """Number of entries already written to JSONL by this exporter."""
        return self._exported_count

    def reset(self) -> None:
        """Reset the export counter.

        After calling this, the next :meth:`export_to_file` will
        re-export **all** entries from the chain.  Useful when starting
        a fresh audit file.
        """
        self._exported_count = 0
