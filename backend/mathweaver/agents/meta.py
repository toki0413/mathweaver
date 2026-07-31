"""MetaEvolutionAgent: recursive self-improvement agent.

Runs during the REFLECT phase to observe all agents' performance
and propose parameter improvements. This is the third layer of
self-evolution:

Layer 1 (S2): Feedback pipeline — tracks decision effectiveness
Layer 2 (S3a): ParameterLearner — Bayesian/bandit parameter tuning
Layer 3 (S3b): This agent — observes, analyzes, and proposes changes

The agent uses LLM to:
1. Analyze which agents are underperforming
2. Identify patterns in decision failures
3. Propose specific parameter adjustments
4. Generate new prompt variants

Safety: All proposed changes go through ApprovalGate before being applied.
"""

from __future__ import annotations

import logging
from typing import Any

from ..evolution.param_learner import ParameterLearner
from ..llm.client import extract_content
from ..models.state import AgentMessage, AgentRole
from .base import AgentContext, BaseAgent

logger = logging.getLogger(__name__)


class MetaEvolutionAgent(BaseAgent):
    """Meta-agent for recursive self-improvement.

    Observes system performance and evolves parameters using:
    1. Feedback data from DecisionEffectivenessTracker
    2. ParameterLearner for Bayesian/bandit optimization
    3. LLM for pattern analysis and prompt generation

    This agent does NOT directly modify other agents. Instead, it:
    - Proposes parameter changes (stored in ParameterLearner)
    - Generates evolution reports for the orchestrator
    - Suggests prompt variants for the CollaborationAgent
    """

    def __init__(
        self,
        llm_client: Any = None,
        param_learner: ParameterLearner | None = None,
    ) -> None:
        super().__init__(AgentRole.META, llm_client)
        self.param_learner = param_learner or ParameterLearner()
        self._evolution_count: int = 0
        self._last_evolution_turn: int = 0

    async def run(self, ctx: AgentContext) -> AgentMessage:
        """Execute meta-evolution: analyze performance and evolve parameters.

        This runs during the REFLECT phase, after historical context
        is provided but before the collaboration agent synthesizes
        the final response.
        """
        self.call_count += 1

        # Get feedback data from metadata
        feedback_data = ctx.metadata.get("feedback", {})
        metrics_summary = ctx.metadata.get("metrics", {})

        # Only evolve if we have enough data
        evaluated_count = feedback_data.get("evaluated", 0)
        if evaluated_count < 1:
            return AgentMessage(
                role=self.role,
                content="尚未积累足够的反馈数据，暂不进行参数调整。",
                metadata={
                    "meta_active": True,
                    "evolution_count": self._evolution_count,
                    "evaluated_decisions": evaluated_count,
                    "reason": "insufficient_data",
                },
            )

        # Evolve parameters
        version = self.param_learner.evolve(feedback_data)
        self._evolution_count += 1

        # Use LLM for deeper analysis if available
        analysis = ""
        if self.llm_client is not None:
            analysis = await self._llm_analyze(feedback_data, version, metrics_summary)

        # Generate evolution report
        report = self._generate_report(feedback_data, version, analysis)

        logger.info(
            "MetaEvolution: v%d, effectiveness=%.3f, weights=%s, prompt=%s",
            version.version,
            version.effectiveness,
            version.weights,
            version.prompt_variant,
        )

        return AgentMessage(
            role=self.role,
            content=report,
            metadata={
                "meta_active": True,
                "evolution_count": self._evolution_count,
                "version": version.version,
                "current_weights": version.weights,
                "current_thresholds": version.thresholds,
                "prompt_variant": version.prompt_variant,
                "effectiveness": version.effectiveness,
                "analysis": analysis,
                "param_learner_state": self.param_learner.to_dict(),
            },
        )

    async def _llm_analyze(
        self,
        feedback_data: dict[str, Any],
        version: Any,
        metrics: dict[str, Any],
    ) -> str:
        """Use LLM to analyze performance and suggest improvements."""
        action_stats = feedback_data.get("action_stats", {})

        system_prompt = (
            "你是一位在课后复盘的教练。翻看今天每一回合的教学记录，"
            "找出哪些策略奏效、哪些落空了。\n"
            "不必面面俱到——抓住最关键的一两个发现：\n"
            "哪个策略收效最差？为什么？怎么调？\n"
            "回复精炼，100字以内。像在笔记本上写给自己看的一句话。"
        )

        stats_str = "\n".join(
            f"  {action}: 平均效果={stats.get('avg_effectiveness', 0):.2f}, "
            f"正率={stats.get('positive_rate', 0):.0%}"
            for action, stats in action_stats.items()
        )

        user_message = (
            f"决策效果统计:\n{stats_str}\n\n"
            f"当前参数版本: v{version.version}\n"
            f"权重: {version.weights}\n"
            f"阈值: {version.thresholds}\n"
            f"Prompt变体: {version.prompt_variant}\n"
            f"总效果: {version.effectiveness:.3f}\n\n"
            f"系统指标: 成功率={metrics.get('success_rate', 0):.0%}, "
            f"平均延迟={metrics.get('avg_latency_ms', 0):.0f}ms\n\n"
            f"请分析并建议改进。"
        )

        try:
            resp = await self.llm_client.chat(
                system_prompt=system_prompt,
                user_message=user_message,
                temperature=0.5,
            )
            return extract_content(resp)
        except Exception as e:
            logger.warning("MetaEvolution LLM analysis failed: %s", e)
            return ""

    def _generate_report(
        self,
        feedback_data: dict[str, Any],
        version: Any,
        analysis: str,
    ) -> str:
        """Generate a human-readable evolution report."""
        lines = [
            f"复盘报告 · 第 {version.version} 版",
            f"已评估决策: {feedback_data.get('evaluated', 0)}",
            f"整体效果: {version.effectiveness:+.3f}",
            f"当前权重: {version.weights}",
            f"当前Prompt: {version.prompt_variant}",
        ]

        # Add per-action stats
        action_stats = feedback_data.get("action_stats", {})
        if action_stats:
            lines.append("\n策略效果:")
            for action, stats in sorted(
                action_stats.items(),
                key=lambda x: x[1].get("avg_effectiveness", 0),
            ):
                eff = stats.get("avg_effectiveness", 0)
                marker = "✓" if eff > 0 else "✗" if eff < 0 else "→"
                lines.append(
                    f"  {marker} {action}: {eff:+.3f} "
                    f"(正率 {stats.get('positive_rate', 0):.0%})"
                )

        if analysis:
            lines.append(f"\nLLM 分析: {analysis}")

        return "\n".join(lines)

    def describe(self) -> dict[str, Any]:
        """Return enhanced description for orchestrator."""
        base = super().describe()
        base.update({
            "evolution_count": self._evolution_count,
            "param_learner_version": self.param_learner._version,
            "current_weights": self.param_learner.weight_optimizer.current_weights,
            "current_thresholds": self.param_learner.threshold_optimizer.thresholds,
            "current_prompt_variant": self.param_learner.prompt_selector._current_variants.get(
                "collaboration", "socratic"
            ),
        })
        return base

    def get_evolution_summary(self) -> dict[str, Any]:
        """Get summary of evolution state for metrics endpoint."""
        return {
            "evolution_count": self._evolution_count,
            "param_learner": self.param_learner.to_dict(),
        }
