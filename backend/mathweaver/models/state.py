"""Domain models for MathWeaver.

This module defines the core data structures:
- FourFieldState: the coupling state of knowledge/cognitive/emotional/interaction fields
- AgentMessage: messages passed between agents via the orchestrator
- ConceptNode: nodes in the math concept DAG
- StudentProfile: persistent learner model
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class FieldType(str, Enum):
    KNOWLEDGE = "knowledge"
    COGNITIVE = "cognitive"
    EMOTIONAL = "emotional"
    INTERACTION = "interaction"


class AgentRole(str, Enum):
    PERCEPTION = "perception"
    ABSTRACTION = "abstraction"
    COUNTER_EXAMPLE = "counter_example"
    EPISTEMIC = "epistemic"
    HISTORICAL = "historical"
    COLLABORATION = "collaboration"
    META = "meta"


class CognitiveState(str, Enum):
    OPTIMAL = "optimal"
    OVERLOAD = "overload"
    BOREDOM = "boredom"
    FATIGUE = "fatigue"


class EmotionalState(str, Enum):
    FLOW = "flow"
    ENGAGED = "engaged"
    ANXIOUS = "anxious"
    FRUSTRATED = "frustrated"
    NEUTRAL = "neutral"


# ---------------------------------------------------------------------------
# Four-Field State
# ---------------------------------------------------------------------------

class KnowledgeField(BaseModel):
    """Knowledge field: ZPD grey-area model + concept mastery."""

    current_node_id: str | None = None
    mastery_estimate: float = Field(0.0, ge=0.0, le=1.0)
    zpd_lower: float = 0.4
    zpd_upper: float = 0.6
    prerequisite_gaps: list[str] = Field(default_factory=list)
    misconception_rate: float = 0.0

    @property
    def in_zpd(self) -> bool:
        return self.zpd_lower <= self.mastery_estimate <= self.zpd_upper

    @property
    def ready_to_advance(self) -> bool:
        return self.mastery_estimate > self.zpd_upper and not self.prerequisite_gaps


class CognitiveField(BaseModel):
    """Cognitive field: cognitive load estimation from interaction signals."""

    response_time_ms: float = 0.0
    baseline_rt_ms: float = 5000.0
    rt_zscore: float = 0.0
    backtrack_count: int = 0
    trial_sequence_length: int = 0
    state: CognitiveState = CognitiveState.OPTIMAL
    cognitive_load: float = Field(0.5, ge=0.0, le=1.0)

    def update_rt(self, rt_ms: float) -> None:
        self.response_time_ms = rt_ms
        self.rt_zscore = (rt_ms - self.baseline_rt_ms) / max(self.baseline_rt_ms * 0.3, 1.0)

    @property
    def is_overloaded(self) -> bool:
        return self.rt_zscore > 1.5 or self.cognitive_load > 0.85


class EmotionalField(BaseModel):
    """Emotional field: anxiety/flow estimation from behavior signals."""

    anxiety_index: float = Field(0.3, ge=0.0, le=1.0)
    flow_score: float = Field(0.5, ge=0.0, le=1.0)
    skip_rate: float = 0.0
    pause_after_counterexample: bool = False
    state: EmotionalState = EmotionalState.NEUTRAL

    @property
    def is_anxious(self) -> bool:
        return self.anxiety_index > 0.65

    @property
    def in_flow(self) -> bool:
        return self.flow_score > 0.75 and self.anxiety_index < 0.4


class InteractionField(BaseModel):
    """Interaction field: scaffolding fade-out tracking."""

    current_hint_level: int = 0
    consecutive_correct: int = 0
    struggle_duration_s: float = 0.0
    scaffold_fade_threshold: int = 3
    hint_dependency: float = Field(0.0, ge=0.0, le=1.0)

    @property
    def should_fade_scaffold(self) -> bool:
        return self.consecutive_correct >= self.scaffold_fade_threshold

    @property
    def is_struggling(self) -> bool:
        return 10.0 < self.struggle_duration_s < 120.0


class FourFieldState(BaseModel):
    """The complete four-field coupling state."""

    knowledge: KnowledgeField = Field(default_factory=KnowledgeField)
    cognitive: CognitiveField = Field(default_factory=CognitiveField)
    emotional: EmotionalField = Field(default_factory=EmotionalField)
    interaction: InteractionField = Field(default_factory=InteractionField)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def snapshot(self) -> dict[str, Any]:
        return {
            "knowledge": self.knowledge.model_dump(),
            "cognitive": self.cognitive.model_dump(),
            "emotional": self.emotional.model_dump(),
            "interaction": self.interaction.model_dump(),
            "updated_at": self.updated_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Agent Message
# ---------------------------------------------------------------------------

class AgentMessage(BaseModel):
    """Message produced by an agent, routed via Orchestrator (single-writer)."""

    role: AgentRole
    content: str
    field_updates: dict[str, dict[str, Any]] = Field(default_factory=dict)
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Concept DAG
# ---------------------------------------------------------------------------

class ConceptNode(BaseModel):
    """A node in the math concept DAG.

    Rich metadata for a complete learning unit:
    - Learning objectives: what the student should be able to do
    - Examples: concrete instances for intuition
    - Assessment criteria: how mastery is evaluated
    - Estimated time: minutes to master this concept
    - Historical context: who discovered it and when
    - Related theorems: formal results connected to this concept
    """

    id: str
    name: str
    description: str
    prerequisites: list[str] = Field(default_factory=list)
    abstraction_level: int = 0
    domain: str = "general"
    difficulty: float = Field(0.5, ge=0.0, le=1.0)
    is_milestone: bool = False

    # Extended curriculum metadata
    learning_objectives: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    assessment_criteria: list[str] = Field(default_factory=list)
    estimated_minutes: int = 30
    historical_context: str = ""
    related_theorems: list[str] = Field(default_factory=list)
    common_misconceptions: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Student Profile (Semantic Memory)
# ---------------------------------------------------------------------------

class StudentProfile(BaseModel):
    """Persistent learner model stored in semantic memory."""

    student_id: str
    name: str = ""
    dag_mastery: dict[str, float] = Field(default_factory=dict)
    learning_style: str = "balanced"
    total_sessions: int = 0
    total_interactions: int = 0
    key_events: list[dict[str, Any]] = Field(default_factory=list)

    def get_mastery(self, node_id: str) -> float:
        return self.dag_mastery.get(node_id, 0.0)

    def update_mastery(self, node_id: str, delta: float) -> None:
        current = self.get_mastery(node_id)
        self.dag_mastery[node_id] = max(0.0, min(1.0, current + delta))
