"""Decision effectiveness tracker: feedback pipeline.

Connects the MetricsCollector's output (which was previously write-only)
to the Orchestrator's decision-making process. This creates the first
feedback loop in the system:

  1. Orchestrator makes a teaching decision (e.g. "reduce_abstraction")
  2. Tracker records the four-field state BEFORE the decision
  3. After N turns, tracker evaluates: did the decision help?
  4. Effectiveness scores are aggregated per decision type
  5. MetaEvolutionAgent (S3) uses these scores to tune parameters

Effectiveness is measured by comparing pre-decision and post-decision
state changes across the four fields:
  - reduce_abstraction → expect cognitive load to decrease
  - emotional_support → expect anxiety to decrease
  - advance → expect mastery to increase without overload
  - provide_hint → expect struggle to decrease
  - guided_discovery → expect mastery to increase
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# How many turns to wait before evaluating a decision's effectiveness
EVALUATION_WINDOW = 3


@dataclass
class DecisionRecord:
    """A teaching decision recorded for later evaluation."""

    decision_id: str
    turn_id: str
    action: str  # "reduce_abstraction", "emotional_support", etc.
    reason: str
    timestamp: str
    hint_level: int

    # Pre-decision state snapshot
    pre_cognitive_load: float
    pre_rt_zscore: float
    pre_is_overloaded: bool
    pre_anxiety_index: float
    pre_flow_score: float
    pre_is_anxious: bool
    pre_in_flow: bool
    pre_mastery: float
    pre_in_zpd: bool
    pre_ready_to_advance: bool
    pre_struggle_duration: float
    pre_hint_level: int

    # Post-decision state (filled after EVALUATION_WINDOW turns)
    post_cognitive_load: float | None = None
    post_anxiety_index: float | None = None
    post_flow_score: float | None = None
    post_mastery: float | None = None
    post_struggle_duration: float | None = None
    post_hint_level: int | None = None

    # Evaluation result
    effectiveness: float | None = None  # -1.0 (harmful) to +1.0 (helpful)
    evaluated: bool = False
    turns_since_decision: int = 0
    improvement_areas: list[str] = field(default_factory=list)

    def evaluate(self, current_state: Any) -> None:
        """Evaluate this decision's effectiveness against current state."""
        self.post_cognitive_load = current_state.cognitive.cognitive_load
        self.post_anxiety_index = current_state.emotional.anxiety_index
        self.post_flow_score = current_state.emotional.flow_score
        self.post_mastery = current_state.knowledge.mastery_estimate
        self.post_struggle_duration = current_state.interaction.struggle_duration_s
        self.post_hint_level = current_state.interaction.current_hint_level

        # Calculate effectiveness based on decision type
        score = 0.0
        improvements: list[str] = []

        if self.action == "reduce_abstraction":
            # Expect: cognitive load should decrease
            delta = self.pre_cognitive_load - (self.post_cognitive_load or 0)
            score += max(-0.5, min(0.5, delta * 2))
            if delta > 0:
                improvements.append("cognitive_load_decreased")
            elif delta < 0:
                improvements.append("cognitive_load_increased")

        elif self.action == "emotional_support":
            # Expect: anxiety should decrease
            delta = self.pre_anxiety_index - (self.post_anxiety_index or 0)
            score += max(-0.5, min(0.5, delta * 2))
            if delta > 0:
                improvements.append("anxiety_decreased")

        elif self.action == "advance":
            # Expect: mastery should increase without overload
            mastery_delta = (self.post_mastery or 0) - self.pre_mastery
            overload_penalty = 1.0 if (self.post_cognitive_load or 0) > 0.7 else 0.0
            score += max(-0.3, min(0.5, mastery_delta * 5)) - overload_penalty * 0.3
            if mastery_delta > 0:
                improvements.append("mastery_increased")

        elif self.action == "provide_hint":
            # Expect: struggle duration should decrease
            delta = self.pre_struggle_duration - (self.post_struggle_duration or 0)
            score += max(-0.3, min(0.3, delta / 30))
            if delta > 0:
                improvements.append("struggle_decreased")

        elif self.action == "guided_discovery":
            # Expect: mastery should increase slightly
            mastery_delta = (self.post_mastery or 0) - self.pre_mastery
            score += max(-0.3, min(0.3, mastery_delta * 5))
            if mastery_delta > 0:
                improvements.append("mastery_increased")

        # General: flow score improvement is always positive
        flow_delta = (self.post_flow_score or 0) - self.pre_flow_score
        score += max(-0.2, min(0.2, flow_delta))

        # Clamp to [-1, 1]
        self.effectiveness = max(-1.0, min(1.0, score))
        self.improvement_areas = improvements
        self.evaluated = True

        logger.info(
            "Decision %s (%s) effectiveness: %.2f (%s)",
            self.decision_id[:8],
            self.action,
            self.effectiveness,
            ", ".join(self.improvement_areas) or "no_change",
        )


class DecisionEffectivenessTracker:
    """Tracks teaching decisions and evaluates their effectiveness.

    This is the missing feedback loop: MetricsCollector collects data,
    this tracker connects it back to decision-making.

    Usage in Orchestrator:
        tracker = DecisionEffectivenessTracker()
        # After make_decision():
        tracker.record_decision(decision, state, turn_id)
        # After each turn:
        outcomes = tracker.evaluate_pending(state)
    """

    def __init__(self, evaluation_window: int = EVALUATION_WINDOW) -> None:
        self._records: list[DecisionRecord] = []
        self._evaluation_window = evaluation_window
        # Aggregated effectiveness per action type
        self._action_stats: dict[str, list[float]] = {}

    def record_decision(
        self,
        decision: Any,
        state: Any,
        turn_id: str,
    ) -> str:
        """Record a teaching decision for later evaluation.

        Args:
            decision: TeachingDecision object with action, reason, etc.
            state: FourFieldState object (the pre-decision state)
            turn_id: The turn ID when the decision was made

        Returns:
            decision_id for tracking
        """
        decision_id = f"dec_{len(self._records)}_{turn_id}"

        record = DecisionRecord(
            decision_id=decision_id,
            turn_id=turn_id,
            action=decision.action,
            reason=decision.reason,
            timestamp=datetime.now(timezone.utc).isoformat(),
            hint_level=decision.hint_level,
            pre_cognitive_load=state.cognitive.cognitive_load,
            pre_rt_zscore=state.cognitive.rt_zscore,
            pre_is_overloaded=state.cognitive.is_overloaded,
            pre_anxiety_index=state.emotional.anxiety_index,
            pre_flow_score=state.emotional.flow_score,
            pre_is_anxious=state.emotional.is_anxious,
            pre_in_flow=state.emotional.in_flow,
            pre_mastery=state.knowledge.mastery_estimate,
            pre_in_zpd=state.knowledge.in_zpd,
            pre_ready_to_advance=state.knowledge.ready_to_advance,
            pre_struggle_duration=state.interaction.struggle_duration_s,
            pre_hint_level=state.interaction.current_hint_level,
        )

        self._records.append(record)
        logger.debug(
            "Recorded decision %s: action=%s, hint_level=%d",
            decision_id, decision.action, decision.hint_level,
        )
        return decision_id

    def evaluate_pending(self, current_state: Any) -> list[DecisionRecord]:
        """Evaluate decisions that have waited long enough.

        Called after each turn. Increments turn counter for unevaluated
        decisions and evaluates those that have reached the window.

        Returns:
            List of newly evaluated DecisionRecords
        """
        newly_evaluated: list[DecisionRecord] = []

        for record in self._records:
            if record.evaluated:
                continue
            record.turns_since_decision += 1
            if record.turns_since_decision >= self._evaluation_window:
                record.evaluate(current_state)
                newly_evaluated.append(record)
                # Aggregate by action type
                self._action_stats.setdefault(record.action, []).append(
                    record.effectiveness or 0.0
                )

        return newly_evaluated

    def get_effectiveness_summary(self) -> dict[str, Any]:
        """Get aggregated effectiveness statistics per action type.

        This is the data that MetaEvolutionAgent (S3) will use to
        decide which parameters to tune.
        """
        summary: dict[str, Any] = {}

        for action, scores in self._action_stats.items():
            if not scores:
                continue
            avg = sum(scores) / len(scores)
            positive = sum(1 for s in scores if s > 0)
            negative = sum(1 for s in scores if s < 0)
            neutral = len(scores) - positive - negative

            summary[action] = {
                "count": len(scores),
                "avg_effectiveness": round(avg, 3),
                "positive_rate": round(positive / len(scores), 3),
                "negative_rate": round(negative / len(scores), 3),
                "neutral_rate": round(neutral / len(scores), 3),
                "best": round(max(scores), 3),
                "worst": round(min(scores), 3),
            }

        return {
            "total_decisions": len(self._records),
            "evaluated": sum(1 for r in self._records if r.evaluated),
            "pending": sum(1 for r in self._records if not r.evaluated),
            "action_stats": summary,
            "overall_avg": (
                sum(r.effectiveness or 0 for r in self._records if r.evaluated)
                / max(1, sum(1 for r in self._records if r.evaluated))
            ),
        }

    def get_recent_outcomes(self, limit: int = 10) -> list[dict[str, Any]]:
        """Get recent evaluated decisions for MetaEvolutionAgent."""
        evaluated = [r for r in self._records if r.evaluated]
        recent = evaluated[-limit:]
        return [
            {
                "decision_id": r.decision_id,
                "action": r.action,
                "reason": r.reason,
                "effectiveness": r.effectiveness,
                "improvement_areas": r.improvement_areas,
                "pre_cognitive_load": r.pre_cognitive_load,
                "post_cognitive_load": r.post_cognitive_load,
                "pre_anxiety": r.pre_anxiety_index,
                "post_anxiety": r.post_anxiety_index,
                "pre_mastery": r.pre_mastery,
                "post_mastery": r.post_mastery,
            }
            for r in recent
        ]

    def to_dict(self) -> dict[str, Any]:
        """Serialize for metrics endpoint."""
        return self.get_effectiveness_summary()
