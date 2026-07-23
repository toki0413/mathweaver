"""Metrics collection: success rate, token usage, tool calls, latency (7.3).

Acceptance criterion 7.3: "暴露任务成功率、token、工具调用次数、延迟"
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class TurnMetrics:
    """Metrics for a single student input processing turn."""

    turn_id: str
    timestamp: str
    student_input: str
    success: bool
    duration_ms: float
    agent_calls: int
    tool_calls: int
    llm_calls: int
    tokens_used: int
    agents_called: list[str]
    phase_trace: list[str]
    evidence_entries: int
    error: str | None = None


class MetricsCollector:
    """Collects and exposes system metrics (7.3).

    Tracks:
    - Task success rate (per session, per topic)
    - Token usage (total, per agent, per turn)
    - Tool call count (per agent, per tool)
    - Latency (per turn, per agent, p50/p95)
    """

    def __init__(self) -> None:
        self._turns: list[TurnMetrics] = []
        self._agent_durations: dict[str, list[float]] = defaultdict(list)
        self._tool_counts: dict[str, int] = defaultdict(int)
        self._agent_tokens: dict[str, int] = defaultdict(int)
        self._session_start = datetime.now(timezone.utc)

    def record_turn(
        self,
        turn_id: str,
        student_input: str,
        success: bool,
        duration_ms: float,
        agent_calls: int,
        tool_calls: int,
        llm_calls: int,
        tokens_used: int,
        agents_called: list[str],
        phase_trace: list[str],
        evidence_entries: int,
        error: str | None = None,
    ) -> None:
        """Record metrics for a completed turn."""
        m = TurnMetrics(
            turn_id=turn_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            student_input=student_input[:200],
            success=success,
            duration_ms=duration_ms,
            agent_calls=agent_calls,
            tool_calls=tool_calls,
            llm_calls=llm_calls,
            tokens_used=tokens_used,
            agents_called=agents_called,
            phase_trace=phase_trace,
            evidence_entries=evidence_entries,
            error=error,
        )
        self._turns.append(m)
        logger.debug("Recorded turn %s: success=%s duration=%.1fms", turn_id, success, duration_ms)

    def record_agent_duration(self, agent_name: str, duration_ms: float) -> None:
        """Record per-agent execution duration."""
        self._agent_durations[agent_name].append(duration_ms)

    def record_tool_call(self, tool_name: str) -> None:
        """Record a tool invocation."""
        self._tool_counts[tool_name] += 1

    def record_tokens(self, agent_name: str, tokens: int) -> None:
        """Record token usage by an agent."""
        self._agent_tokens[agent_name] += tokens

    def summary(self) -> dict[str, Any]:
        """Return a summary of all collected metrics."""
        total = len(self._turns)
        if total == 0:
            return {
                "total_turns": 0,
                "success_rate": 0.0,
                "total_tokens": 0,
                "total_tool_calls": 0,
                "avg_latency_ms": 0.0,
                "p95_latency_ms": 0.0,
            }

        successes = sum(1 for t in self._turns if t.success)
        durations = sorted(t.duration_ms for t in self._turns)
        p95_idx = max(0, int(len(durations) * 0.95) - 1)

        return {
            "total_turns": total,
            "success_rate": successes / total,
            "total_tokens": sum(t.tokens_used for t in self._turns),
            "total_tool_calls": sum(t.tool_calls for t in self._turns),
            "total_llm_calls": sum(t.llm_calls for t in self._turns),
            "avg_latency_ms": sum(durations) / len(durations),
            "p50_latency_ms": durations[len(durations) // 2],
            "p95_latency_ms": durations[p95_idx],
            "tool_breakdown": dict(self._tool_counts),
            "agent_tokens": dict(self._agent_tokens),
            "agent_durations": {
                name: {
                    "count": len(durs),
                    "avg_ms": sum(durs) / len(durs),
                    "max_ms": max(durs),
                }
                for name, durs in self._agent_durations.items()
            },
            "uptime_s": (datetime.now(timezone.utc) - self._session_start).total_seconds(),
        }

    def get_metrics(self) -> dict[str, Any]:
        """Alias for summary() — for /metrics endpoint compatibility."""
        return self.summary()

    def export_turns(self) -> list[dict[str, Any]]:
        """Export all turn records for audit."""
        return [
            {
                "turn_id": t.turn_id,
                "timestamp": t.timestamp,
                "student_input": t.student_input,
                "success": t.success,
                "duration_ms": t.duration_ms,
                "agent_calls": t.agent_calls,
                "tool_calls": t.tool_calls,
                "llm_calls": t.llm_calls,
                "tokens_used": t.tokens_used,
                "agents_called": t.agents_called,
                "phase_trace": t.phase_trace,
                "evidence_entries": t.evidence_entries,
                "error": t.error,
            }
            for t in self._turns
        ]
