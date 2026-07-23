"""Encouragement engine: growth-mindset language and emotional calibration.

Design principles:
- Never say "wrong" — say "not yet" or "let's explore why"
- Acknowledge effort, not just correctness
- Celebrate streaks and milestones
- Detect frustration and provide emotional support
- Use "yet" language to reinforce growth mindset
- Connect mistakes to famous mathematicians who made similar errors

The engine produces encouragement snippets that the collaboration agent
weaves into its responses.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class EncouragementContext:
    """Context for generating encouragement."""

    is_correct: bool
    streak_correct: int = 0
    streak_wrong: int = 0
    total_answered: int = 0
    emotional_state: str = "engaged"  # engaged, anxious, flow, frustrated, bored
    hint_used: bool = False
    is_conjecture: bool = False
    conjecture_verdict: str = ""  # confirmed, refuted, undecidable
    difficulty_band: str = "standard"
    trend: str = "stable"  # rising, falling, stable
    response_time_ms: float = 5000.0


class EncouragementEngine:
    """Generates growth-mindset encouragement based on student performance.

    Core philosophy — response to the New Math movement (1958-1975):
    The New Math assumed that understanding was inherently motivating, and
    ignored the emotional dimension of learning. When children cried over
    octal subtraction, "you're understanding structure" offered no comfort.
    This engine does the opposite: it detects frustration, celebrates effort,
    and reframes errors as discoveries. Emotional support is not a byproduct
    of education — it is the vehicle through which abstraction becomes
    accessible. See: docs/new-math-reflection.md
    """

    # Milestone thresholds
    MILESTONES = {
        3: "三连对！你的数学直觉在变强。",
        5: "五连对！你已经掌握了核心概念。",
        7: "七连对！这已经是进阶水平了。",
        10: "十连对！你准备好挑战更难的概念了。",
    }

    # Growth mindset phrases for wrong answers
    _GROWTH_MINDSET_WRONG = [
        "还没有到，但这正是学习发生的时刻。",
        "差一点了——让我们看看哪里可以调整。",
        "你的思路有价值。让我们换个角度看。",
        "数学发现往往从「不太对」开始。继续。",
        "这个错误很有启发性——它帮我们排除了一个方向。",
    ]

    # Growth mindset phrases for correct answers
    _GROWTH_MINDSET_RIGHT = [
        "对了！你的推理越来越扎实。",
        "很好！你抓住了关键性质。",
        "正确！你在建立真正的理解，不只是记忆。",
        "你的直觉在变得更敏锐。",
    ]

    # Frustration detection responses
    _FRUSTRATION_RESPONSES = [
        "我理解这个概念有挑战性。我们慢一点，一步一步来。",
        "没关系，数学里最难的概念每个人都挣扎过。让我们拆解它。",
        "你投入了努力，这本身就值得肯定。让我们换个角度。",
    ]

    # Conjecture encouragement
    _CONJECTURE_REFUTED = [
        "提出猜想本身就是最高级的数学思维。即使被反驳，你也排除了一个可能性。",
        "伟大的数学家都经历过猜想被反驳——这恰恰是进步的标志。",
        "这个反例帮你缩小了命题的边界。你在做真正的数学研究。",
    ]

    _CONJECTURE_CONFIRMED = [
        "你的猜想被验证了！你有数学家的直觉。",
        "猜对了！你在用归纳推理发现规律，这正是数学创造力的核心。",
    ]

    # Flow state encouragement
    _FLOW_RESPONSES = [
        "你进入了心流状态——继续探索！",
        "你今天的状态很好，要不要挑战更难的问题？",
    ]

    # Historical mathematician mistake connections
    _HISTORICAL_MISTAKES = {
        "abelian": "Abel 本人最初也以为所有群都交换——直到他发现了非交换结构。",
        "inverse": "Euler 在研究逆元时也走过弯路——他最初没有意识到逆元唯一性的重要性。",
        "associativity": "Hamilton 花了 15 年才接受非交换运算——你的困惑和天才数学家一样。",
        "cyclic": "Gauss 在研究循环群时也犯过类似的错误，后来才纠正。",
        "general": "历史上最伟大的数学家也经常提出后来被反驳的猜想——这是数学进步的方式。",
    }

    def generate(self, ctx: EncouragementContext) -> str:
        """Generate an encouragement snippet based on context.

        Returns:
            A short encouragement string (1-2 sentences) to prepend
            or append to the collaboration agent's response.
        """
        parts: list[str] = []

        # --- Frustration detection (highest priority) ---
        if ctx.emotional_state == "frustrated" or ctx.streak_wrong >= 3:
            idx = min(ctx.streak_wrong - 3, len(self._FRUSTRATION_RESPONSES) - 1) if ctx.streak_wrong >= 3 else 0
            parts.append(self._FRUSTRATION_RESPONSES[max(0, idx)])
            # Add historical comfort
            parts.append(self._HISTORICAL_MISTAKES.get("general", ""))
            return " ".join(p for p in parts if p)

        # --- Milestone celebration ---
        if ctx.is_correct and ctx.streak_correct in self.MILESTONES:
            parts.append(self.MILESTONES[ctx.streak_correct])
            return parts[0]

        # --- Conjecture-specific encouragement ---
        if ctx.is_conjecture:
            if ctx.conjecture_verdict == "refuted":
                idx = min(ctx.total_answered % len(self._CONJECTURE_REFUTED),
                          len(self._CONJECTURE_REFUTED) - 1)
                parts.append(self._CONJECTURE_REFUTED[idx])
                return parts[0]
            elif ctx.conjecture_verdict == "confirmed":
                parts.append(self._CONJECTURE_CONFIRMED[0])
                return parts[0]

        # --- Flow state ---
        if ctx.emotional_state == "flow" and ctx.is_correct:
            parts.append(self._FLOW_RESPONSES[0])
            return parts[0]

        # --- Standard correct/wrong ---
        if ctx.is_correct:
            idx = ctx.total_answered % len(self._GROWTH_MINDSET_RIGHT)
            parts.append(self._GROWTH_MINDSET_RIGHT[idx])
        else:
            idx = ctx.total_answered % len(self._GROWTH_MINDSET_WRONG)
            parts.append(self._GROWTH_MINDSET_WRONG[idx])

            # Add historical context for repeated mistakes on same topic
            if ctx.streak_wrong >= 2:
                parts.append(self._HISTORICAL_MISTAKES.get("general", ""))

        # --- Trend-aware adjustment ---
        if ctx.trend == "rising" and ctx.is_correct:
            parts.append("你在加速进步。")
        elif ctx.trend == "falling" and not ctx.is_correct:
            parts.append("让我们退一步，巩固一下基础。")

        return " ".join(p for p in parts if p)

    def generate_for_grill(
        self,
        is_correct: bool,
        streak_correct: int,
        streak_wrong: int,
        total_answered: int,
        emotional_state: str = "engaged",
        difficulty_band: str = "standard",
        trend: str = "stable",
    ) -> str:
        """Convenience: generate encouragement for a grill question answer."""
        ctx = EncouragementContext(
            is_correct=is_correct,
            streak_correct=streak_correct,
            streak_wrong=streak_wrong,
            total_answered=total_answered,
            emotional_state=emotional_state,
            difficulty_band=difficulty_band,
            trend=trend,
        )
        return self.generate(ctx)

    def generate_for_conjecture(
        self,
        verdict: str,
        conjecture_history: list[dict[str, Any]],
        streak_correct: int = 0,
    ) -> str:
        """Generate encouragement for a conjecture result."""
        total = len(conjecture_history)

        ctx = EncouragementContext(
            is_correct=(verdict == "confirmed"),
            streak_correct=streak_correct,
            total_answered=total,
            is_conjecture=True,
            conjecture_verdict=verdict,
            emotional_state="engaged",
        )
        return self.generate(ctx)

    def to_dict(self) -> dict[str, Any]:
        """Return engine state (stateless engine, returns config)."""
        return {
            "milestones": list(self.MILESTONES.keys()),
            "growth_mindset_phrases": len(self._GROWTH_MINDSET_RIGHT) + len(self._GROWTH_MINDSET_WRONG),
            "frustration_responses": len(self._FRUSTRATION_RESPONSES),
            "conjecture_encouragements": len(self._CONJECTURE_REFUTED) + len(self._CONJECTURE_CONFIRMED),
        }
