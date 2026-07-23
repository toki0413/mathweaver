"""Parameter learner: Bayesian online update + multi-armed bandit.

Tunes hardcoded parameters in the system based on feedback from
the DecisionEffectivenessTracker:

1. AdaptiveDifficulty weights (W_ACCURACY, W_SPEED, W_CONJECTURE, W_HINT)
   → Multi-armed bandit (Thompson Sampling) selects weight configurations
   → Each "arm" is a weight preset; reward = decision effectiveness

2. EpistemicAgent thresholds (overload z-score, mastery deltas)
   → Bayesian online update with Beta prior
   → Posterior mean replaces hardcoded threshold

3. Prompt variants for CollaborationAgent
   → Epsilon-greedy selection with decay
   → Track average response quality per variant

All parameter changes are versioned and can be rolled back.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ParameterVersion:
    """A versioned parameter set."""

    version: int
    weights: dict[str, float]
    thresholds: dict[str, float]
    prompt_variant: str
    effectiveness: float = 0.0
    sample_count: int = 0


class WeightOptimizer:
    """Multi-armed bandit (Thompson Sampling) for AdaptiveDifficulty weights.

    Instead of fixed weights (0.35, 0.25, 0.25, 0.15), maintains
    multiple weight "arms" and uses Thompson Sampling to balance
    exploration vs exploitation.

    Each arm is a weight preset. Reward is the decision effectiveness
    score from the feedback tracker.
    """

    # Candidate weight presets (arms)
    WEIGHT_PRESETS = [
        # Original weights
        {"accuracy": 0.35, "speed": 0.25, "conjecture": 0.25, "hint": 0.15},
        # Accuracy-focused
        {"accuracy": 0.50, "speed": 0.20, "conjecture": 0.15, "hint": 0.15},
        # Conjecture-focused
        {"accuracy": 0.25, "speed": 0.20, "conjecture": 0.40, "hint": 0.15},
        # Speed-focused (fast-paced learners)
        {"accuracy": 0.30, "speed": 0.40, "conjecture": 0.15, "hint": 0.15},
        # Hint-sensitive
        {"accuracy": 0.30, "speed": 0.15, "conjecture": 0.20, "hint": 0.35},
        # Balanced
        {"accuracy": 0.25, "speed": 0.25, "conjecture": 0.25, "hint": 0.25},
    ]

    def __init__(self) -> None:
        # Beta distribution parameters per arm: alpha=1, beta=1 (uniform prior)
        self._alpha: list[float] = [1.0] * len(self.WEIGHT_PRESETS)
        self._beta: list[float] = [1.0] * len(self.WEIGHT_PRESETS)
        self._current_arm: int = 0
        self._pull_count: int = 0
        self._reward_history: list[dict[str, Any]] = []

    @property
    def current_weights(self) -> dict[str, float]:
        return self.WEIGHT_PRESETS[self._current_arm]

    @property
    def current_arm(self) -> int:
        return self._current_arm

    def select_arm(self) -> int:
        """Thompson Sampling: sample from each arm's Beta posterior."""
        samples = []
        for i in range(len(self.WEIGHT_PRESETS)):
            sample = random.betavariate(self._alpha[i], self._beta[i])
            samples.append(sample)
        self._current_arm = samples.index(max(samples))
        self._pull_count += 1
        return self._current_arm

    def update(self, arm: int, reward: float) -> None:
        """Update the Beta posterior for an arm.

        Args:
            arm: The arm index that was played
            reward: Effectiveness score [-1, 1], mapped to [0, 1] for Beta
        """
        # Map reward from [-1, 1] to [0, 1]
        normalized = (reward + 1) / 2
        # Bayesian update: success if reward > 0
        if reward > 0:
            self._alpha[arm] += normalized
        else:
            self._beta[arm] += (1 - normalized)

        self._reward_history.append({
            "arm": arm,
            "reward": reward,
            "pull": self._pull_count,
        })

        logger.debug(
            "WeightOptimizer: arm %d updated (reward=%.2f, alpha=%.1f, beta=%.1f)",
            arm, reward, self._alpha[arm], self._beta[arm],
        )

    def get_best_arm(self) -> int:
        """Get the arm with highest expected reward."""
        expectations = [
            self._alpha[i] / (self._alpha[i] + self._beta[i])
            for i in range(len(self.WEIGHT_PRESETS))
        ]
        return expectations.index(max(expectations))

    def to_dict(self) -> dict[str, Any]:
        return {
            "current_arm": self._current_arm,
            "current_weights": self.current_weights,
            "pull_count": self._pull_count,
            "best_arm": self.get_best_arm(),
            "best_weights": self.WEIGHT_PRESETS[self.get_best_arm()],
            "arm_stats": [
                {
                    "arm": i,
                    "weights": self.WEIGHT_PRESETS[i],
                    "alpha": round(self._alpha[i], 2),
                    "beta": round(self._beta[i], 2),
                    "expected_reward": round(
                        self._alpha[i] / (self._alpha[i] + self._beta[i]), 3
                    ),
                }
                for i in range(len(self.WEIGHT_PRESETS))
            ],
        }


class ThresholdOptimizer:
    """Bayesian online update for EpistemicAgent thresholds.

    Instead of hardcoded thresholds (z>1.5 for overload, consecutive≥3
    for flow, +0.05/-0.03 for mastery deltas), maintains a Bayesian
    posterior and updates based on whether the threshold correctly
    predicted student state changes.
    """

    def __init__(self) -> None:
        # Default thresholds (current hardcoded values)
        self._thresholds: dict[str, float] = {
            "overload_zscore": 1.5,
            "flow_streak": 3,
            "anxiety_backtrack": 2,
            "mastery_correct_delta": 0.05,
            "mastery_wrong_delta": -0.03,
            "scaffold_fade_threshold": 3,
            "zpd_lower": 0.3,
            "zpd_upper": 0.7,
        }
        # Beta priors for each threshold (for binary "was this threshold good?")
        self._priors: dict[str, tuple[float, float]] = {
            key: (1.0, 1.0) for key in self._thresholds
        }
        self._update_count: int = 0

    @property
    def thresholds(self) -> dict[str, float]:
        return dict(self._thresholds)

    def get_threshold(self, name: str, default: float = 0.0) -> float:
        return self._thresholds.get(name, default)

    def update_threshold(
        self,
        name: str,
        effectiveness: float,
        direction: str = "decrease",
    ) -> None:
        """Update a threshold based on effectiveness.

        If effectiveness > 0, the current threshold is good → reinforce.
        If effectiveness < 0, the threshold needs adjustment → nudge.

        Args:
            name: Threshold name
            effectiveness: -1.0 to 1.0
            direction: "increase" or "decrease" — which way to nudge
        """
        if name not in self._thresholds:
            return

        alpha, beta = self._priors[name]
        normalized = (effectiveness + 1) / 2

        if effectiveness > 0:
            self._priors[name] = (alpha + normalized, beta)
        else:
            self._priors[name] = (alpha, beta + (1 - normalized))

            # Nudge the threshold
            current = self._thresholds[name]
            nudge = abs(effectiveness) * 0.1  # max 10% change
            if direction == "increase":
                self._thresholds[name] = current * (1 + nudge)
            else:
                self._thresholds[name] = current * (1 - nudge)

            # Clamp to reasonable bounds
            if "zscore" in name:
                self._thresholds[name] = max(0.5, min(3.0, self._thresholds[name]))
            elif "streak" in name or "threshold" in name:
                self._thresholds[name] = max(1, min(10, self._thresholds[name]))
            elif "delta" in name:
                self._thresholds[name] = max(0.01, min(0.15, abs(self._thresholds[name])))
                if name == "mastery_wrong_delta":
                    self._thresholds[name] = -self._thresholds[name]
            elif "zpd" in name:
                self._thresholds[name] = max(0.1, min(0.9, self._thresholds[name]))

        self._update_count += 1
        logger.debug(
            "ThresholdOptimizer: %s → %.4f (effectiveness=%.2f)",
            name, self._thresholds[name], effectiveness,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "thresholds": {k: round(v, 4) for k, v in self._thresholds.items()},
            "update_count": self._update_count,
            "posteriors": {
                k: {
                    "alpha": round(a, 2),
                    "beta": round(b, 2),
                    "mean": round(a / (a + b), 3),
                }
                for k, (a, b) in self._priors.items()
            },
        }


class PromptVariantSelector:
    """Epsilon-greedy selection for agent prompt variants.

    Each agent can have multiple prompt variants. This selector
    tracks which variant produces the best outcomes and uses
    epsilon-greedy to balance exploration vs exploitation.
    """

    # Prompt variants for CollaborationAgent
    PROMPT_VARIANTS = {
        "collaboration": [
            {
                "id": "socratic",
                "name": "苏格拉底式",
                "system_prompt": (
                    "你是数学教学协作智能体。使用苏格拉底式提问法，"
                    "通过反问引导学生自己发现答案。避免直接给出答案。"
                ),
            },
            {
                "id": "constructivist",
                "name": "建构主义",
                "system_prompt": (
                    "你是数学教学协作智能体。采用建构主义方法，"
                    "帮助学生从已有知识构建新理解。提供脚手架而非答案。"
                ),
            },
            {
                "id": "direct",
                "name": "直接教学",
                "system_prompt": (
                    "你是数学教学协作智能体。采用直接教学法，"
                    "清晰准确地解释概念，然后让学生复述和应用。"
                ),
            },
            {
                "id": "discovery",
                "name": "发现学习",
                "system_prompt": (
                    "你是数学教学协作智能体。采用引导发现法，"
                    "提供线索和提示，让学生通过探索发现规律。"
                ),
            },
        ],
    }

    def __init__(self, epsilon: float = 0.2) -> None:
        self._epsilon = epsilon
        self._variant_rewards: dict[str, dict[str, list[float]]] = {}
        for agent, variants in self.PROMPT_VARIANTS.items():
            self._variant_rewards[agent] = {
                v["id"]: [] for v in variants
            }
        self._current_variants: dict[str, str] = {
            agent: variants[0]["id"]
            for agent, variants in self.PROMPT_VARIANTS.items()
        }

    @property
    def epsilon(self) -> float:
        # Decay epsilon over time
        total_samples = sum(
            len(rewards)
            for agent_rewards in self._variant_rewards.values()
            for rewards in agent_rewards.values()
        )
        return max(0.05, self._epsilon * (1 - total_samples / 100))

    def select_variant(self, agent: str) -> str:
        """Select a prompt variant for the given agent."""
        if agent not in self._variant_rewards:
            return "default"

        variants = self._variant_rewards[agent]

        # Epsilon-greedy
        if random.random() < self.epsilon:
            # Explore: pick random
            variant_ids = list(variants.keys())
            chosen = random.choice(variant_ids)
        else:
            # Exploit: pick best average
            best_variant = None
            best_avg = -float("inf")
            for vid, rewards in variants.items():
                if rewards:
                    avg = sum(rewards) / len(rewards)
                else:
                    avg = 0.0  # Optimistic initialization
                if avg > best_avg:
                    best_avg = avg
                    best_variant = vid
            chosen = best_variant or list(variants.keys())[0]

        self._current_variants[agent] = chosen
        return chosen

    def get_prompt(self, agent: str) -> str:
        """Get the system prompt for the current variant."""
        if agent not in self.PROMPT_VARIANTS:
            return ""
        variant_id = self._current_variants.get(agent, "socratic")
        for v in self.PROMPT_VARIANTS[agent]:
            if v["id"] == variant_id:
                return v["system_prompt"]
        return self.PROMPT_VARIANTS[agent][0]["system_prompt"]

    def update(self, agent: str, variant_id: str, reward: float) -> None:
        """Update reward for a variant."""
        if agent in self._variant_rewards and variant_id in self._variant_rewards[agent]:
            self._variant_rewards[agent][variant_id].append(reward)

    def to_dict(self) -> dict[str, Any]:
        return {
            "epsilon": round(self.epsilon, 3),
            "current_variants": dict(self._current_variants),
            "variant_stats": {
                agent: {
                    vid: {
                        "count": len(rewards),
                        "avg_reward": round(sum(rewards) / len(rewards), 3)
                        if rewards else 0.0,
                    }
                    for vid, rewards in variants.items()
                }
                for agent, variants in self._variant_rewards.items()
            },
        }


class ParameterLearner:
    """Master parameter learning coordinator.

    Combines WeightOptimizer, ThresholdOptimizer, and PromptVariantSelector
    into a single interface used by the MetaEvolutionAgent.
    """

    def __init__(self) -> None:
        self.weight_optimizer = WeightOptimizer()
        self.threshold_optimizer = ThresholdOptimizer()
        self.prompt_selector = PromptVariantSelector()
        self._version: int = 0
        self._history: list[ParameterVersion] = []

    def evolve(self, feedback_summary: dict[str, Any]) -> ParameterVersion:
        """Evolve parameters based on feedback summary.

        Called by MetaEvolutionAgent during REFLECT phase.

        Args:
            feedback_summary: Output from DecisionEffectivenessTracker

        Returns:
            New ParameterVersion with updated parameters
        """
        self._version += 1

        # Update weights based on action effectiveness
        action_stats = feedback_summary.get("action_stats", {})
        for action, stats in action_stats.items():
            avg_effectiveness = stats.get("avg_effectiveness", 0.0)

            # Update weight optimizer
            arm = self.weight_optimizer.select_arm()
            self.weight_optimizer.update(arm, avg_effectiveness)

            # Update threshold optimizer
            # Map action types to threshold names
            threshold_mapping = {
                "reduce_abstraction": ("overload_zscore", "decrease"),
                "emotional_support": ("anxiety_backtrack", "decrease"),
                "advance": ("zpd_upper", "increase"),
                "provide_hint": ("scaffold_fade_threshold", "increase"),
                "guided_discovery": ("mastery_correct_delta", "increase"),
            }
            if action in threshold_mapping:
                threshold_name, direction = threshold_mapping[action]
                self.threshold_optimizer.update_threshold(
                    threshold_name, avg_effectiveness, direction
                )

            # Update prompt selector
            self.prompt_selector.update(
                "collaboration",
                self.prompt_selector._current_variants.get("collaboration", "socratic"),
                avg_effectiveness,
            )

        version = ParameterVersion(
            version=self._version,
            weights=self.weight_optimizer.current_weights,
            thresholds=self.threshold_optimizer.thresholds,
            prompt_variant=self.prompt_selector._current_variants.get("collaboration", "socratic"),
            effectiveness=feedback_summary.get("overall_avg", 0.0),
            sample_count=feedback_summary.get("evaluated", 0),
        )

        self._history.append(version)
        logger.info(
            "ParameterLearner: evolved to version %d (effectiveness=%.3f)",
            self._version,
            version.effectiveness,
        )

        return version

    @property
    def current_version(self) -> ParameterVersion | None:
        return self._history[-1] if self._history else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self._version,
            "weights": self.weight_optimizer.to_dict(),
            "thresholds": self.threshold_optimizer.to_dict(),
            "prompts": self.prompt_selector.to_dict(),
            "current_version": (
                {
                    "version": self.current_version.version,
                    "weights": self.current_version.weights,
                    "thresholds": self.current_version.thresholds,
                    "prompt_variant": self.current_version.prompt_variant,
                    "effectiveness": round(self.current_version.effectiveness, 3),
                    "sample_count": self.current_version.sample_count,
                }
                if self._history else None
            ),
            "history_count": len(self._history),
        }
