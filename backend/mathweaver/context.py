"""Explicit context passing schema.

Acceptance criterion 2.2: "agent 间传递的结构化上下文有明确 schema，
且每次传递可序列化记录"

This replaces implicit shared-instance-variable passing with explicit,
serializable context objects.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


@dataclass
class ContextMessage:
    """A message passed between agents or from orchestrator to agent.

    This is the explicit context schema. Every agent receives one and
    produces one. The schema is serializable to JSON/dict.
    """

    message_id: str
    session_id: str
    timestamp: str                          # ISO 8601 UTC
    from_agent: str                         # "orchestrator" or agent name
    to_agent: str                           # target agent name
    student_input: str                      # original student input
    task_decomposition: list[dict[str, Any]] = field(default_factory=list)
    prior_results: dict[str, Any] = field(default_factory=dict)
    four_field_snapshot: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        session_id: str,
        from_agent: str,
        to_agent: str,
        student_input: str,
        prior_results: dict[str, Any] | None = None,
        four_field_snapshot: dict[str, Any] | None = None,
        task_decomposition: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ContextMessage:
        return cls(
            message_id=str(uuid4()),
            session_id=session_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            from_agent=from_agent,
            to_agent=to_agent,
            student_input=student_input,
            task_decomposition=task_decomposition or [],
            prior_results=prior_results or {},
            four_field_snapshot=four_field_snapshot or {},
            metadata=metadata or {},
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def add_result(self, agent_name: str, result: dict[str, Any]) -> None:
        """Add a prior agent's result to the context."""
        self.prior_results[agent_name] = result


@dataclass
class TaskDecomposition:
    """LLM-generated task decomposition.

    Acceptance criterion 2.1: "分解由 LLM 生成而非硬编码；对开放性数学题
    ≥3 题产生 ≥2 种分解结构"
    """

    task_id: str
    student_input: str
    steps: list[dict[str, Any]] = field(default_factory=list)
    # Each step: {"agent": "counter_example", "reason": "need Z3 verification", "optional": false}

    @classmethod
    def create(cls, student_input: str, steps: list[dict[str, Any]]) -> TaskDecomposition:
        return cls(
            task_id=str(uuid4()),
            student_input=student_input,
            steps=steps,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
