"""Adaptive difficulty engine: dynamically adjust question difficulty.

Tracks student performance signals and computes a target difficulty:
- Correct/wrong streak
- Average response time vs baseline
- Conjecture success rate
- Hint usage frequency

The engine uses a sigmoid-based adjustment:
- High accuracy + fast responses → increase difficulty
- Low accuracy + slow responses → decrease difficulty
- Mixed signals → hold steady

Difficulty range: 0.0 (trivial) → 1.0 (challenging)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class PerformanceSignal:
    """A single performance data point from the student."""

    timestamp: str
    question_difficulty: float  # 0-1, difficulty of the question answered
    is_correct: bool
    response_time_ms: float
    hint_used: bool = False
    conjecture_verdict: str | None = None  # "confirmed", "refuted", "undecidable"


class AdaptiveDifficulty:
    """Dynamically adjusts target question difficulty based on performance.

    Algorithm:
    1. Maintain a rolling window of recent PerformanceSignals (last N=8)
    2. Compute composite score from:
       - Accuracy rate (weight: 0.35)
       - Speed factor: baseline_rt / actual_rt (weight: 0.25)
       - Conjecture success rate (weight: 0.25)
       - Hint independence: 1 - hint_rate (weight: 0.15)
    3. Map composite score [0, 1] to difficulty via sigmoid:
       - score > 0.7 → difficulty increases by up to +0.15
       - score < 0.4 → difficulty decreases by up to -0.15
       - 0.4 ≤ score ≤ 0.7 → hold steady (±0.05)
    4. Clamp difficulty to [0.1, 0.9] to avoid trivial/impossible questions
    """

    WINDOW_SIZE = 8  # rolling window of recent signals
    BASELINE_RT_MS = 5000.0  # 5 seconds baseline response time
    MIN_DIFFICULTY = 0.1
    MAX_DIFFICULTY = 0.9
    INITIAL_DIFFICULTY = 0.4

    # Weights for composite score
    W_ACCURACY = 0.35
    W_SPEED = 0.25
    W_CONJECTURE = 0.25
    W_HINT_INDEPENDENCE = 0.15

    def __init__(self) -> None:
        self._signals: list[PerformanceSignal] = []
        self._current_difficulty: float = self.INITIAL_DIFFICULTY
        self._streak_correct: int = 0
        self._streak_wrong: int = 0
        self._total_questions: int = 0
        self._total_correct: int = 0
        self._total_conjectures: int = 0
        self._confirmed_conjectures: int = 0
        self._hint_count: int = 0

    @property
    def current_difficulty(self) -> float:
        return self._current_difficulty

    @property
    def streak_correct(self) -> int:
        return self._streak_correct

    @property
    def streak_wrong(self) -> int:
        return self._streak_wrong

    @property
    def accuracy_rate(self) -> float:
        if self._total_questions == 0:
            return 0.5
        return self._total_correct / self._total_questions

    @property
    def conjecture_success_rate(self) -> float:
        if self._total_conjectures == 0:
            return 0.5
        return self._confirmed_conjectures / self._total_conjectures

    def record_signal(self, signal: PerformanceSignal) -> None:
        """Record a performance signal and adjust difficulty."""
        self._signals.append(signal)
        if len(self._signals) > self.WINDOW_SIZE:
            self._signals.pop(0)

        self._total_questions += 1
        if signal.is_correct:
            self._total_correct += 1
            self._streak_correct += 1
            self._streak_wrong = 0
        else:
            self._streak_correct = 0
            self._streak_wrong += 1

        if signal.hint_used:
            self._hint_count += 1

        if signal.conjecture_verdict:
            self._total_conjectures += 1
            if signal.conjecture_verdict == "confirmed":
                self._confirmed_conjectures += 1

        self._adjust_difficulty()
        logger.info(
            "Adaptive difficulty: %.2f (accuracy=%.0f%%, streak=%d, conj_rate=%.0f%%)",
            self._current_difficulty,
            self.accuracy_rate * 100,
            self._streak_correct - self._streak_wrong,
            self.conjecture_success_rate * 100,
        )

    def _adjust_difficulty(self) -> None:
        """Compute composite score and adjust target difficulty."""
        if not self._signals:
            return

        recent = self._signals[-self.WINDOW_SIZE:]

        # 1. Accuracy rate (recent window)
        recent_correct = sum(1 for s in recent if s.is_correct)
        accuracy = recent_correct / len(recent)

        # 2. Speed factor: ratio of baseline to actual time
        avg_rt = sum(s.response_time_ms for s in recent) / len(recent)
        speed_factor = min(1.0, self.BASELINE_RT_MS / max(avg_rt, 500.0))

        # 3. Conjecture success rate (recent window)
        recent_conj = [s for s in recent if s.conjecture_verdict]
        if recent_conj:
            conj_success = sum(
                1 for s in recent_conj if s.conjecture_verdict == "confirmed"
            ) / len(recent_conj)
        else:
            conj_success = 0.5  # neutral if no conjectures

        # 4. Hint independence: 1 - hint_rate
        hint_rate = sum(1 for s in recent if s.hint_used) / len(recent)
        hint_independence = 1.0 - hint_rate

        # Composite score [0, 1]
        composite = (
            self.W_ACCURACY * accuracy
            + self.W_SPEED * speed_factor
            + self.W_CONJECTURE * conj_success
            + self.W_HINT_INDEPENDENCE * hint_independence
        )

        # Sigmoid-based adjustment
        # Map composite [0, 1] to delta [-0.15, +0.15]
        # sigmoid center at 0.55, so slightly above 50% is "holding steady"
        center = 0.55
        # Use a smoothed step function
        if composite > 0.7:
            delta = 0.15 * (composite - 0.7) / 0.3
        elif composite < 0.4:
            delta = -0.15 * (0.4 - composite) / 0.4
        else:
            # In the "hold" zone, small adjustments
            delta = 0.05 * (composite - center) / 0.15

        # Streak bonus: accelerate adjustment on streaks
        if self._streak_correct >= 3:
            delta += 0.05 * min(self._streak_correct - 2, 3)
        elif self._streak_wrong >= 2:
            delta -= 0.05 * min(self._streak_wrong - 1, 3)

        new_difficulty = self._current_difficulty + delta
        self._current_difficulty = max(
            self.MIN_DIFFICULTY, min(self.MAX_DIFFICULTY, new_difficulty)
        )

    def get_target_difficulty(self) -> float:
        """Get the current target difficulty for question selection."""
        return self._current_difficulty

    def get_difficulty_band(self) -> str:
        """Get a human-readable difficulty band label."""
        d = self._current_difficulty
        if d < 0.3:
            return "warmup"
        elif d < 0.45:
            return "foundation"
        elif d < 0.6:
            return "standard"
        elif d < 0.75:
            return "advanced"
        else:
            return "challenge"

    def should_increase_difficulty(self) -> bool:
        """Check if the engine recommends harder questions."""
        return self._streak_correct >= 3 and self.accuracy_rate > 0.7

    def should_decrease_difficulty(self) -> bool:
        """Check if the engine recommends easier questions."""
        return self._streak_wrong >= 2 or self.accuracy_rate < 0.4

    def get_trend(self) -> str:
        """Get the difficulty trend direction."""
        if len(self._signals) < 2:
            return "stable"
        recent = self._signals[-3:]
        if len(recent) >= 2:
            if all(s.is_correct for s in recent):
                return "rising"
            elif all(not s.is_correct for s in recent):
                return "falling"
        return "stable"

    def to_dict(self) -> dict[str, Any]:
        """Serialize adaptive difficulty state for visualization."""
        return {
            "current_difficulty": round(self._current_difficulty, 3),
            "difficulty_band": self.get_difficulty_band(),
            "target_difficulty": round(self.get_target_difficulty(), 3),
            "accuracy_rate": round(self.accuracy_rate, 3),
            "conjecture_success_rate": round(self.conjecture_success_rate, 3),
            "streak_correct": self._streak_correct,
            "streak_wrong": self._streak_wrong,
            "total_questions": self._total_questions,
            "total_correct": self._total_correct,
            "total_conjectures": self._total_conjectures,
            "confirmed_conjectures": self._confirmed_conjectures,
            "hint_count": self._hint_count,
            "trend": self.get_trend(),
            "should_increase": self.should_increase_difficulty(),
            "should_decrease": self.should_decrease_difficulty(),
        }
