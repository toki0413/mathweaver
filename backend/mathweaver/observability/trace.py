"""Trace span tree: hierarchical observability for agent execution.

The trace system captures timing, agent invocations, tool usage, and LLM
calls as a tree of spans. A root span wraps the entire student-input
processing cycle, and each agent call becomes a child span.

This is complementary to the evidence chain (``evidence.chain``):
  - Trace  -> observability (span trees, timing, call graphs)
  - Evidence -> tamper-evidence (hash-linked, append-only audit)

Acceptance criterion 7.2: "trace span tree for observability"
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Span status
# ---------------------------------------------------------------------------

class SpanStatus(str, Enum):
    """Outcome of a trace span."""

    OK = "ok"
    ERROR = "error"


# ---------------------------------------------------------------------------
# TraceSpan
# ---------------------------------------------------------------------------

@dataclass
class TraceSpan:
    """A single span in the trace span tree.

    A span represents one unit of work -- typically a single agent
    invocation, or the root span that wraps an entire student-input
    processing cycle.

    Attributes:
        span_id: Unique identifier for this span (UUID).
        trace_id: Shared identifier for the entire trace/session.
        parent_span_id: Identifier of the parent span, or ``None``
            for the root span.
        agent_name: Name of the agent that produced this span
            (e.g. ``"perception"``, ``"abstraction"``).
        phase: Processing phase (e.g. ``"perceive"``, ``"abstract"``,
            ``"verify"``).
        start_time: ISO 8601 UTC timestamp when the span started.
        end_time: ISO 8601 UTC timestamp when the span ended, or
            ``None`` if the span is still open.
        duration_ms: Wall-clock duration in milliseconds, computed
            when the span is ended.
        input_summary: Truncated summary of the span's input.
        output_summary: Truncated summary of the span's output.
        tool_calls: List of tool invocations made during this span.
            Each entry is a dict (e.g. ``{"name": "z3", "args": ...}``).
        llm_calls: List of LLM invocations made during this span.
            Each entry is a dict (e.g. ``{"model": "...", "tokens": ...}``).
        status: ``SpanStatus.OK`` or ``SpanStatus.ERROR``.
        metadata: Additional free-form metadata for this span.
    """

    span_id: str
    trace_id: str
    parent_span_id: str | None
    agent_name: str
    phase: str
    start_time: str                          # ISO 8601 UTC
    end_time: str | None = None
    duration_ms: float | None = None
    input_summary: str = ""
    output_summary: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    llm_calls: list[dict[str, Any]] = field(default_factory=list)
    status: SpanStatus = SpanStatus.OK
    metadata: dict[str, Any] = field(default_factory=dict)

    def end(self, end_time: str | None = None) -> None:
        """Finalize the span: set ``end_time`` and compute ``duration_ms``.

        Args:
            end_time: Optional explicit end timestamp. If omitted,
                ``datetime.now()`` is used.
        """
        now = datetime.now(timezone.utc)
        self.end_time = end_time or now.isoformat()
        start = datetime.fromisoformat(self.start_time)
        self.duration_ms = round(
            (now - start).total_seconds() * 1000, 2
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize this span to a plain dict.

        The ``status`` enum is converted to its string value so the
        result is JSON-serializable.
        """
        d = asdict(self)
        d["status"] = self.status.value
        return d


# ---------------------------------------------------------------------------
# TraceCollector
# ---------------------------------------------------------------------------

class TraceCollector:
    """Collects trace spans for a single session and builds span trees.

    Each collector owns one ``trace_id`` (a UUID generated on
    construction) that is shared by every span it creates.

    Usage::

        collector = TraceCollector(session_id="abc")
        root = collector.start_root_span(input_summary="2+2=?")
        child = collector.start_span(
            agent_name="perception",
            phase="perceive",
            parent_span_id=root,
            input_summary="2+2=?",
        )
        collector.end_span(child, output_summary="parsed arithmetic")
        collector.end_span(root, output_summary="answer: 4")
        tree = collector.get_trace_tree()
        exported = collector.export()
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.trace_id: str = str(uuid4())
        self._spans: list[TraceSpan] = []
        self._span_index: dict[str, TraceSpan] = {}

    # -- Span lifecycle --

    def start_root_span(
        self,
        input_summary: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Start the root span that wraps the entire student-input cycle.

        The root span has no parent (``parent_span_id is None``) and
        uses ``agent_name="root"`` / ``phase="root"``.

        Returns:
            The ``span_id`` of the newly created root span.
        """
        return self.start_span(
            agent_name="root",
            phase="root",
            parent_span_id=None,
            input_summary=input_summary,
            metadata=metadata,
        )

    def start_span(
        self,
        agent_name: str,
        phase: str,
        parent_span_id: str | None = None,
        input_summary: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Start a new span and return its ``span_id``.

        Args:
            agent_name: Name of the agent performing the work.
            phase: Processing phase label.
            parent_span_id: Parent span's id. Use ``None`` (or
                ``start_root_span``) for a root span.
            input_summary: Truncated summary of the span's input.
            metadata: Optional free-form metadata.

        Returns:
            The ``span_id`` of the newly created span.
        """
        span_id = str(uuid4())
        span = TraceSpan(
            span_id=span_id,
            trace_id=self.trace_id,
            parent_span_id=parent_span_id,
            agent_name=agent_name,
            phase=phase,
            start_time=datetime.now(timezone.utc).isoformat(),
            input_summary=input_summary[:500],
            metadata=metadata or {},
        )
        self._spans.append(span)
        self._span_index[span_id] = span

        logger.debug(
            "Span started: %s.%s (id=%s..., parent=%s)",
            agent_name,
            phase,
            span_id[:8],
            parent_span_id[:8] if parent_span_id else "root",
        )
        return span_id

    def end_span(
        self,
        span_id: str,
        output_summary: str = "",
        tool_calls: list[dict[str, Any]] | None = None,
        llm_calls: list[dict[str, Any]] | None = None,
        status: SpanStatus = SpanStatus.OK,
        metadata: dict[str, Any] | None = None,
    ) -> TraceSpan | None:
        """End a span by its ``span_id``.

        Sets the span's ``end_time``, ``duration_ms``, ``output_summary``,
        ``tool_calls``, ``llm_calls``, ``status``, and merges any
        additional ``metadata``.

        Args:
            span_id: The id returned by ``start_span``.
            output_summary: Truncated summary of the span's output.
            tool_calls: Tools invoked during this span.
            llm_calls: LLM invocations during this span.
            status: ``SpanStatus.OK`` or ``SpanStatus.ERROR``.
            metadata: Additional metadata to merge into the span.

        Returns:
            The finalized :class:`TraceSpan`, or ``None`` if the
            ``span_id`` is unknown.
        """
        span = self._span_index.get(span_id)
        if span is None:
            logger.warning("Cannot end unknown span: %s", span_id)
            return None

        span.output_summary = output_summary[:500]
        span.tool_calls = tool_calls or []
        span.llm_calls = llm_calls or []
        span.status = status
        if metadata:
            span.metadata.update(metadata)
        span.end()

        logger.debug(
            "Span ended: %s.%s (duration=%.1fms, status=%s)",
            span.agent_name,
            span.phase,
            span.duration_ms or 0.0,
            span.status.value,
        )
        return span

    # -- Tree construction --

    def get_trace_tree(self) -> dict[str, Any]:
        """Build and return the span tree as a nested dict.

        The root span (``parent_span_id is None``) is at the top.
        Each node has a ``"children"`` list containing its child spans
        in insertion order.

        Returns:
            The root span as a nested dict, or ``{}`` if there are
            no spans. If multiple root spans exist, they are returned
            under a ``"roots"`` key.
        """
        if not self._spans:
            return {}

        # Index children by parent_span_id
        children_map: dict[str | None, list[TraceSpan]] = {}
        for span in self._spans:
            children_map.setdefault(span.parent_span_id, []).append(span)

        roots = children_map.get(None, [])

        def build_node(span: TraceSpan) -> dict[str, Any]:
            node = span.to_dict()
            node["children"] = [
                build_node(child)
                for child in children_map.get(span.span_id, [])
            ]
            return node

        if len(roots) == 1:
            return build_node(roots[0])
        return {"roots": [build_node(r) for r in roots]}

    # -- Serialization --

    def export(self) -> dict[str, Any]:
        """Export the full trace as a serializable dict.

        Includes trace metadata, the flat span list (in insertion
        order), and the nested span tree.
        """
        return {
            "trace_id": self.trace_id,
            "session_id": self.session_id,
            "span_count": len(self._spans),
            "spans": [s.to_dict() for s in self._spans],
            "tree": self.get_trace_tree(),
        }

    def summary(self) -> dict[str, Any]:
        """Return a lightweight summary of the trace."""
        ended = [s for s in self._spans if s.end_time is not None]
        errors = [s for s in self._spans if s.status == SpanStatus.ERROR]
        total_tool_calls = sum(len(s.tool_calls) for s in self._spans)
        total_llm_calls = sum(len(s.llm_calls) for s in self._spans)
        total_duration = sum(s.duration_ms or 0.0 for s in ended)

        return {
            "trace_id": self.trace_id,
            "session_id": self.session_id,
            "span_count": len(self._spans),
            "ended_spans": len(ended),
            "error_spans": len(errors),
            "total_tool_calls": total_tool_calls,
            "total_llm_calls": total_llm_calls,
            "total_duration_ms": round(total_duration, 2),
            "agents": list({s.agent_name for s in self._spans}),
            "phases": [s.phase for s in self._spans],
        }

    # -- Accessors --

    def get_span(self, span_id: str) -> TraceSpan | None:
        """Return the span with the given id, or ``None``."""
        return self._span_index.get(span_id)

    @property
    def spans(self) -> list[TraceSpan]:
        """Return all spans in insertion order."""
        return list(self._spans)

    def __len__(self) -> int:
        return len(self._spans)
