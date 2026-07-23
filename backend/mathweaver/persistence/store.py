"""SQLite-backed state persistence for MathWeaver.

Provides a :class:`StateStore` that persists sessions, four-field state,
student profiles, the append-only evidence chain, and inter-agent context
messages to a SQLite database.

Design goals
------------
* **Standard library only** -- uses :mod:`sqlite3`, :mod:`json`,
  :mod:`datetime`.  No ORM, no external dependencies.
* **SQL-injection safe** -- every value is bound via parameterized queries;
  no string interpolation is ever used to build SQL.
* **Pydantic-friendly** -- serializes Pydantic v2 models via
  ``model_dump(mode="json")`` (falling back to ``snapshot()``) so datetimes
  and enums become JSON-safe primitives.
* **History-aware** -- ``save_session`` upserts the session row *and* appends
  a snapshot to the ``four_field_states`` table, giving a full audit trail of
  state evolution.

Schema
------
``sessions``
    One row per session: ``session_id``, ``student_id``, ``created_at``,
    ``updated_at``, ``state_json``, ``profile_json``.
``four_field_states``
    Append-only state history: ``id``, ``session_id``, ``snapshot_json``,
    ``recorded_at``.
``evidence_entries``
    Evidence chain entries: ``id``, ``session_id``, ``sequence``,
    ``entry_json``, ``entry_hash``.
``context_messages``
    Inter-agent context messages: ``id``, ``session_id``, ``message_json``.

Example
-------
>>> from mathweaver.persistence.store import StateStore
>>> from mathweaver.models.state import FourFieldState, StudentProfile
>>> store = StateStore()  # in-memory by default
>>> state = FourFieldState()
>>> store.save_session("s1", "stu-1", state, StudentProfile(student_id="stu-1"))
>>> loaded = store.load_session("s1")
>>> loaded["student_id"]
'stu-1'
>>> store.close()
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - type hints only
    from ..models.state import FourFieldState, StudentProfile


# ---------------------------------------------------------------------------
# Schema DDL
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id  TEXT PRIMARY KEY,
    student_id  TEXT,
    created_at  TEXT,
    updated_at  TEXT,
    state_json  TEXT,
    profile_json TEXT
);

CREATE TABLE IF NOT EXISTS four_field_states (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    recorded_at  TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE IF NOT EXISTS evidence_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT,
    sequence    INTEGER,
    entry_json  TEXT,
    entry_hash  TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE IF NOT EXISTS context_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT,
    message_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_session
    ON evidence_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_context_session
    ON context_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_four_field_session
    ON four_field_states(session_id);
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _serialize_model(model: Any) -> str:
    """Serialize a Pydantic model (or any object) to a JSON string.

    Prefers Pydantic v2's ``model_dump(mode="json")`` which yields JSON-native
    types; falls back to the explicit ``snapshot()`` method, and finally to a
    generic ``json.dumps`` with ``default=str``.
    """
    if hasattr(model, "model_dump"):
        try:
            data = model.model_dump(mode="json")
        except TypeError:
            # Pydantic v1 or custom signature without ``mode``.
            data = model.model_dump()
    elif hasattr(model, "snapshot") and callable(model.snapshot):
        data = model.snapshot()
    elif isinstance(model, dict):
        data = model
    else:
        data = model
    return json.dumps(data, ensure_ascii=False, default=str)


def _entry_hash(entry: dict[str, Any]) -> str:
    """Return the ``entry_hash`` field of an evidence entry if present.

    Evidence entries produced by :class:`~mathweaver.evidence.chain.EvidenceChain`
    already carry a sealed ``entry_hash``.  When absent (e.g. a plain dict),
    an empty string is stored so the column remains non-null.
    """
    value = entry.get("entry_hash", "")
    return value if isinstance(value, str) else str(value)


# ---------------------------------------------------------------------------
# StateStore
# ---------------------------------------------------------------------------

class StateStore:
    """SQLite-backed persistence layer for MathWeaver sessions.

    Parameters
    ----------
    db_path:
        Path to the SQLite database file.  Defaults to ``":memory:"`` for an
        ephemeral, in-memory database (ideal for tests).  Use a filesystem
        path for durable storage.
    """

    def __init__(self, db_path: str = ":memory:") -> None:
        self.db_path = db_path
        # ``check_same_thread=False`` allows the store to be used from any
        # thread (e.g. async backends); callers are responsible for
        # serialization if concurrent writes occur.
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        # Return rows as dicts for ergonomic access.
        self._conn.row_factory = sqlite3.Row
        # Enforce foreign keys (disabled by default in SQLite).
        self._conn.execute("PRAGMA foreign_keys = ON")
        self.init_schema()

    # -- schema -------------------------------------------------------------

    def init_schema(self) -> None:
        """Create all required tables if they do not already exist."""
        self._conn.executescript(_SCHEMA_SQL)
        self._conn.commit()

    # -- sessions -----------------------------------------------------------

    def save_session(
        self,
        session_id: str,
        student_id: str,
        state: FourFieldState,
        profile: StudentProfile | None = None,
    ) -> None:
        """Persist (upsert) a session and append a state-history snapshot.

        Parameters
        ----------
        session_id:
            Unique session identifier.
        student_id:
            Identifier of the student owning the session.
        state:
            The current :class:`FourFieldState` to persist.
        profile:
            Optional :class:`StudentProfile`.  When ``None`` any existing
            profile is cleared.
        """
        now = _utcnow_iso()
        state_json = _serialize_model(state)
        profile_json = _serialize_model(profile) if profile is not None else None

        # Determine created_at: keep the existing value when updating.
        existing = self._conn.execute(
            "SELECT created_at FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        created_at = existing["created_at"] if existing is not None else now

        with self._conn:
            self._conn.execute(
                """
                INSERT INTO sessions
                    (session_id, student_id, created_at, updated_at,
                     state_json, profile_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    student_id   = excluded.student_id,
                    updated_at   = excluded.updated_at,
                    state_json   = excluded.state_json,
                    profile_json = excluded.profile_json
                """,
                (session_id, student_id, created_at, now, state_json, profile_json),
            )
            # Append a snapshot to the state-history table.
            self._conn.execute(
                """
                INSERT INTO four_field_states
                    (session_id, snapshot_json, recorded_at)
                VALUES (?, ?, ?)
                """,
                (session_id, state_json, now),
            )

    def load_session(self, session_id: str) -> dict[str, Any] | None:
        """Load a session by id.

        Returns a dict with keys ``session_id``, ``student_id``,
        ``created_at``, ``updated_at``, ``state`` and ``profile`` (the latter
        is ``None`` when no profile was stored), or ``None`` if the session
        does not exist.
        """
        row = self._conn.execute(
            """
            SELECT session_id, student_id, created_at, updated_at,
                   state_json, profile_json
            FROM sessions
            WHERE session_id = ?
            """,
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "session_id": row["session_id"],
            "student_id": row["student_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "state": json.loads(row["state_json"]) if row["state_json"] else None,
            "profile": (
                json.loads(row["profile_json"])
                if row["profile_json"]
                else None
            ),
        }

    def list_sessions(self) -> list[dict[str, Any]]:
        """List all sessions, newest first.

        Each entry contains ``session_id``, ``student_id``, ``created_at`` and
        ``updated_at``.
        """
        rows = self._conn.execute(
            """
            SELECT session_id, student_id, created_at, updated_at
            FROM sessions
            ORDER BY updated_at DESC
            """
        ).fetchall()
        return [dict(r) for r in rows]

    # -- evidence chain -----------------------------------------------------

    def save_evidence(self, session_id: str, entries: list[dict[str, Any]]) -> None:
        """Persist the evidence chain for a session.

        The stored entries for ``session_id`` are replaced wholesale by
        ``entries`` (delete-then-insert within a single transaction), making
        the operation idempotent: re-saving the full chain yields the same
        database state.  Each entry is expected to be a serializable dict,
        typically the output of
        :meth:`EvidenceChain.export <mathweaver.evidence.chain.EvidenceChain.export>`.

        The ``sequence`` and ``entry_hash`` columns are populated from the
        entry's own ``sequence`` / ``entry_hash`` fields when present, so the
        tamper-evident chain can be verified after a reload.
        """
        with self._conn:
            self._conn.execute(
                "DELETE FROM evidence_entries WHERE session_id = ?",
                (session_id,),
            )
            for entry in entries:
                sequence = entry.get("sequence", 0)
                entry_json = json.dumps(entry, ensure_ascii=False, default=str)
                self._conn.execute(
                    """
                    INSERT INTO evidence_entries
                        (session_id, sequence, entry_json, entry_hash)
                    VALUES (?, ?, ?, ?)
                    """,
                    (session_id, sequence, entry_json, _entry_hash(entry)),
                )

    def load_evidence(self, session_id: str) -> list[dict[str, Any]]:
        """Load the evidence chain for a session, ordered by sequence."""
        rows = self._conn.execute(
            """
            SELECT entry_json, entry_hash
            FROM evidence_entries
            WHERE session_id = ?
            ORDER BY sequence ASC, id ASC
            """,
            (session_id,),
        ).fetchall()
        return [
            {
                **json.loads(row["entry_json"]),
                "entry_hash": row["entry_hash"],
            }
            for row in rows
        ]

    # -- context messages ---------------------------------------------------

    def save_context_messages(
        self, session_id: str, messages: list[dict[str, Any]]
    ) -> None:
        """Persist inter-agent context messages for a session.

        As with :meth:`save_evidence`, stored messages for ``session_id`` are
        replaced by ``messages`` within a single transaction.
        """
        with self._conn:
            self._conn.execute(
                "DELETE FROM context_messages WHERE session_id = ?",
                (session_id,),
            )
            for message in messages:
                message_json = json.dumps(message, ensure_ascii=False, default=str)
                self._conn.execute(
                    """
                    INSERT INTO context_messages
                        (session_id, message_json)
                    VALUES (?, ?)
                    """,
                    (session_id, message_json),
                )

    def load_context_messages(self, session_id: str) -> list[dict[str, Any]]:
        """Load context messages for a session in insertion order."""
        rows = self._conn.execute(
            """
            SELECT message_json
            FROM context_messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()
        return [json.loads(row["message_json"]) for row in rows]

    # -- lifecycle ----------------------------------------------------------

    def close(self) -> None:
        """Close the underlying database connection."""
        if self._conn is not None:
            self._conn.close()
            self._conn = None  # type: ignore[assignment]

    # context-manager convenience

    def __enter__(self) -> StateStore:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
