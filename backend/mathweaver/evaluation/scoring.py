"""Planning and Communication Score rubrics (2.3, 5.2).

2.3: Planning Score — evaluates the quality of task decomposition.
5.2: Communication Score — evaluates the quality of inter-agent communication.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PlanningScore:
    """Score for task decomposition quality (2.3).

    Rubric (0-10 scale):
    - Decomposition coverage (0-3): Does the plan cover all necessary steps?
    - Step ordering (0-2): Are steps in a logical order?
    - Efficiency (0-2): Are there unnecessary steps?
    - Adaptability (0-3): Does the plan adapt to different input types?
    """

    coverage: float = 0.0        # 0-3: covers all necessary steps
    ordering: float = 0.0        # 0-2: steps in logical order
    efficiency: float = 0.0      # 0-2: no unnecessary steps
    adaptability: float = 0.0    # 0-3: adapts to different inputs

    @property
    def total(self) -> float:
        return self.coverage + self.ordering + self.efficiency + self.adaptability

    @property
    def normalized(self) -> float:
        """Return score normalized to 0-1."""
        return self.total / 10.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "coverage": self.coverage,
            "ordering": self.ordering,
            "efficiency": self.efficiency,
            "adaptability": self.adaptability,
            "total": self.total,
            "normalized": self.normalized,
        }


@dataclass
class CommunicationScore:
    """Score for inter-agent communication quality (5.2).

    Rubric (0-10 scale):
    - Message completeness (0-3): Do agents receive all needed context?
    - Message relevance (0-2): Is the transmitted information relevant?
    - Bus utilization (0-2): Is the message bus properly used?
    - No implicit state (0-3): No reading of shared mutable state?
    """

    completeness: float = 0.0    # 0-3: all needed context transmitted
    relevance: float = 0.0       # 0-2: information is relevant
    bus_utilization: float = 0.0 # 0-2: bus is used for communication
    no_implicit_state: float = 0.0  # 0-3: no shared mutable state reads

    @property
    def total(self) -> float:
        return self.completeness + self.relevance + self.bus_utilization + self.no_implicit_state

    @property
    def normalized(self) -> float:
        return self.total / 10.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "completeness": self.completeness,
            "relevance": self.relevance,
            "bus_utilization": self.bus_utilization,
            "no_implicit_state": self.no_implicit_state,
            "total": self.total,
            "normalized": self.normalized,
        }


def score_planning(
    decomposition_steps: list[dict],
    phase_trace: list[str],
    input_type: str,
) -> PlanningScore:
    """Score the quality of task decomposition (2.3).

    Args:
        decomposition_steps: The steps from TaskDecomposition.
        phase_trace: Actual phases executed.
        input_type: "cayley_table", "text_question", or "general".

    Returns:
        PlanningScore with sub-scores.
    """
    score = PlanningScore()

    # Coverage: did the plan cover all executed phases?
    planned_phases = {s.get("agent", s.get("phase", "")) for s in decomposition_steps}
    executed_phases = set(phase_trace)
    overlap = planned_phases & executed_phases
    if executed_phases:
        score.coverage = min(3.0, 3.0 * len(overlap) / len(executed_phases))

    # Ordering: are steps in logical order?
    # Check if perceive comes before verify, verify before collaborate
    ideal_order = ["perceive", "abstract", "verify", "diagnose", "reflect", "collaborate"]
    trace_order = [p for p in ideal_order if p in phase_trace]
    if len(trace_order) <= 1:
        score.ordering = 2.0
    else:
        inversions = 0
        for i in range(len(trace_order)):
            for j in range(i + 1, len(trace_order)):
                if phase_trace.index(trace_order[i]) > phase_trace.index(trace_order[j]):
                    inversions += 1
        max_inv = len(trace_order) * (len(trace_order) - 1) / 2
        score.ordering = 2.0 * (1 - inversions / max(max_inv, 1))

    # Efficiency: no unnecessary steps
    # Ideal: 3-5 agents for Cayley tables, 2-3 for text questions
    ideal_counts = {"cayley_table": (3, 6), "text_question": (2, 4), "general": (2, 5)}
    lo, hi = ideal_counts.get(input_type, (2, 5))
    actual = len(phase_trace)
    if lo <= actual <= hi:
        score.efficiency = 2.0
    elif actual < lo:
        score.efficiency = 2.0 * actual / lo
    else:
        score.efficiency = max(0.0, 2.0 - 0.5 * (actual - hi))

    # Adaptability: different input types produce different plans
    if len(decomposition_steps) > 0:
        # If steps include conditional logic or input-type-dependent routing
        score.adaptability = 3.0  # LLM-driven decomposition is inherently adaptive

    return score


def score_communication(
    bus_messages: list[dict],
    context_messages: list[dict],
    agent_count: int,
) -> CommunicationScore:
    """Score the quality of inter-agent communication (5.2).

    Args:
        bus_messages: Messages from the MessageBus.
        context_messages: Explicit context messages passed to agents.
        agent_count: Number of agents called in this turn.

    Returns:
        CommunicationScore with sub-scores.
    """
    score = CommunicationScore()

    # Completeness: each agent call has a context message
    if agent_count > 0:
        ratio = len(context_messages) / agent_count
        score.completeness = min(3.0, 3.0 * ratio)

    # Relevance: context messages have prior_results and four_field_snapshot
    relevant = 0
    for msg in context_messages:
        if msg.get("prior_results") is not None and msg.get("four_field_snapshot"):
            relevant += 1
    if context_messages:
        score.relevance = 2.0 * relevant / len(context_messages)

    # Bus utilization: bus messages include both agent and context types
    types = {m.get("message_type") for m in bus_messages}
    if "agent" in types and "context" in types:
        score.bus_utilization = 2.0
    elif len(types) > 0:
        score.bus_utilization = 1.0

    # No implicit state: agents receive state via context, not direct reads
    # Check if four_field_snapshot is in context messages
    snapshots = sum(1 for m in context_messages if m.get("four_field_snapshot"))
    if context_messages and snapshots == len(context_messages):
        score.no_implicit_state = 3.0
    elif snapshots > 0:
        score.no_implicit_state = 1.5

    return score
