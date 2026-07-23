"""Epistemic Agent: diagnoses cognitive state from four-field model."""

from __future__ import annotations

import logging
from typing import Any

from ..models.state import AgentMessage, AgentRole, CognitiveState, EmotionalState
from .base import AgentContext, BaseAgent

logger = logging.getLogger(__name__)


class EpistemicAgent(BaseAgent):
    """Diagnoses the student's cognitive and emotional state.

    Updates the four-field state model based on:
    - Response time (cognitive load)
    - Correctness (mastery estimate)
    - Pattern of errors (struggle detection)
    - Consecutive correct (flow detection)
    """

    def __init__(self, llm_client: Any = None) -> None:
        super().__init__(AgentRole.EPISTEMIC, llm_client)

    async def run(self, ctx: AgentContext) -> AgentMessage:
        self.call_count += 1
        state = ctx.four_field_state
        counter_example = ctx.prior_results.get("counter_example", {})
        ce_meta = counter_example.get("metadata", {})

        is_group = ce_meta.get("is_group", False)
        has_verification = "is_group" in ce_meta
        rt_ms = ctx.metadata.get("response_time_ms", 5000)
        baseline = state.cognitive.baseline_rt_ms or 5000

        # Compute RT z-score
        if baseline > 0:
            # Simple z-score: (rt - baseline) / baseline
            z = (rt_ms - baseline) / max(baseline, 1)
        else:
            z = 0.0

        # Cognitive load (dead-code-free formula)
        if z > 1.5:
            cognitive_load = min(0.5 + abs(z) * 0.2, 1.0)
            cognitive_state = CognitiveState.OVERLOAD
        elif z < -0.5:
            cognitive_load = max(0.3, 0.5 + z * 0.15)
            cognitive_state = CognitiveState.OPTIMAL
        else:
            cognitive_load = 0.5
            cognitive_state = CognitiveState.OPTIMAL

        # Mastery estimate
        if not has_verification:
            # No verification result — text-based question
            mastery = state.knowledge.mastery_estimate
            consecutive = state.interaction.consecutive_correct
        elif is_group:
            mastery = min(state.knowledge.mastery_estimate + 0.05, 1.0)
            consecutive = state.interaction.consecutive_correct + 1
        else:
            mastery = max(state.knowledge.mastery_estimate - 0.03, 0.0)
            consecutive = 0

        # Emotional state
        if consecutive >= 3 and z < 0:
            emotional_state = EmotionalState.FLOW
            flow_score = min(state.emotional.flow_score + 0.1, 1.0)
            anxiety = max(state.emotional.anxiety_index - 0.05, 0.0)
        elif state.cognitive.backtrack_count > 2:
            emotional_state = EmotionalState.ANXIOUS
            anxiety = min(state.emotional.anxiety_index + 0.1, 1.0)
            flow_score = max(state.emotional.flow_score - 0.05, 0.0)
        else:
            emotional_state = EmotionalState.ENGAGED
            anxiety = state.emotional.anxiety_index
            flow_score = state.emotional.flow_score

        # ZPD check
        zpd_lower = state.knowledge.zpd_lower
        zpd_upper = state.knowledge.zpd_upper
        in_zpd = zpd_lower <= mastery <= zpd_upper

        # Struggling detection
        is_struggling = state.cognitive.backtrack_count > 2 or (
            not is_group and state.cognitive.backtrack_count > 1
        )

        # Scaffolding fade
        should_fade = consecutive >= state.interaction.scaffold_fade_threshold

        field_updates = {
            "knowledge": {
                "mastery_estimate": mastery,
            },
            "cognitive": {
                "response_time_ms": rt_ms,
                "rt_zscore": z,
                "cognitive_load": cognitive_load,
                "state": cognitive_state,
            },
            "emotional": {
                "anxiety_index": anxiety,
                "flow_score": flow_score,
                "state": emotional_state,
            },
            "interaction": {
                "consecutive_correct": consecutive,
                "hint_dependency": max(0, state.interaction.hint_dependency - 0.01),
            },
        }

        if is_struggling:
            field_updates["interaction"]["struggle_duration_s"] = (
                state.interaction.struggle_duration_s + rt_ms / 1000
            )

        diagnosis = self._diagnose(z, is_group, has_verification, consecutive, emotional_state, in_zpd)

        return AgentMessage(
            role=self.role,
            content=diagnosis,
            field_updates=field_updates,
            tool_calls=[],
            confidence=0.85,
            metadata={
                "rt_zscore": z,
                "cognitive_load": cognitive_load,
                "mastery_delta": mastery - state.knowledge.mastery_estimate,
                "in_zpd": in_zpd,
                "is_struggling": is_struggling,
                "should_fade_scaffold": should_fade,
                "emotional_state": emotional_state.value,
            },
        )

    def _diagnose(self, z, is_group, has_verification, consecutive, emotional_state, in_zpd) -> str:
        parts = []
        if z > 1.5:
            parts.append("学生停顿较久，可能在消化新概念")
        elif z < -0.5:
            parts.append("学生回答迅速，思路流畅")
        if has_verification:
            if is_group:
                parts.append(f"已连续答对 {consecutive} 次")
            else:
                parts.append("这次的答案有偏差，需要引导")
        else:
            parts.append("收到学生的文字提问")
        if emotional_state == EmotionalState.FLOW:
            parts.append("学生进入了心流")
        elif emotional_state == EmotionalState.ANXIOUS:
            parts.append("学生似乎有些焦虑")
        if not in_zpd:
            parts.append("当前内容略超出学生的舒适区")
        return "；".join(parts) + "。"
