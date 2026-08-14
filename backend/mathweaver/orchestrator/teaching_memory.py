"""Long-horizon teaching memory.

Adapted for Socratic teaching from the "handoff summary" pattern used by
OpenAI Codex' local compaction path, and the "model-visible means logged"
principle of DeepSeek Harness:

- Recent turns are kept verbatim (bounded window, oldest folds out).
- When the verbatim window reaches its budget, turns are folded into a rolling
  structured handoff summary written in "notes-to-self" register so a successor
  request resumes naturally instead of restarting (Codex "handoff > summary":
  forward-looking --- progress / constraints / next steps).
- Compaction can be LLM-driven via ``compact_with_llm`` (Codex local compaction
  path), or fall back to naive truncation.
- Raw history is never destroyed: every turn is kept in an append-only log
  (Harness "model-visible means logged"); pruning only changes the surface the
  model sees, so audit/replay/persistence stay possible.
- The emitted context block enforces a soft token budget (Codex
  ``_enforce_token_budget``), keeping the newest, most task-relevant content.

The model-visible block emitted by ``to_context_block`` is injected into both
the routing LLM input and the Collaboration agent so the teacher can recall
what was already covered across a long session.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

#: Handoff compaction prompt (adapted from Codex' context-checkpoint prompt).
#: Written to produce a forward-looking handoff, not a backward-looking recap.
HANDOFF_PROMPT = """You are performing a CONTEXT CHECKPOINT for a long-running Socratic math teaching session.
Create a handoff summary for another LLM (the teacher) that will resume guiding this student.

Include:
- 已达成进度 (progress): what the student has accomplished and understood so far
- 关键决策与约束 (constraints): pedagogical decisions, difficulty calibration, pacing rules
- 学生状态 (student state): mastery level, common mistakes, emotional/engagement signals, learning habits
- 下一步 (next steps): what to teach next, which concepts remain uncovered

Write in concise notes-to-self register (Chinese), not exposition. Preserve any concrete facts (numbers, exact student phrasing) that the successor needs to continue accurately."""


@dataclass
class TeachingTurn:
    """A single completed teaching exchange."""

    #: What the student said (verbatim).
    student: str
    #: What the teacher replied (the delivered response).
    teacher: str
    #: Pedagogical action taken this turn.
    action: str
    #: Hint level after this turn.
    hint_level: int
    #: Concept currently being worked on, if known.
    concept: str | None = None


def estimate_tokens(text: str) -> int:
    """Rough token estimate used for block-budget enforcement.

    CJK-heavy text runs ~1 token per character; latin ~4 chars/token. Dividing
    by 4 is a safe, over-estimating heuristic that keeps the block under budget.
    """
    if not text:
        return 0
    return (len(text) + 3) // 4


class TeachingMemory:
    """Per-session rolling memory of the teaching conversation."""

    def __init__(
        self,
        max_verbatim_turns: int = 6,
        max_summary_length: int = 1200,
        session_token_budget: int = -1,
        max_block_tokens: int = -1,
    ) -> None:
        self.max_verbatim_turns = max_verbatim_turns
        self.max_summary_length = max_summary_length
        self.session_token_budget = session_token_budget
        self.max_block_tokens = max_block_tokens
        self._recent_turns: list[TeachingTurn] = []
        #: Append-only log of every turn (Harness: raw history is never destroyed).
        self._all_turns: list[TeachingTurn] = []
        self._rolling_summary = ""
        self._covered_concepts: list[str] = []
        self._hint_level = 0
        self._total_tokens_used = 0

    # -- Read-only accessors ------------------------------------------------

    @property
    def concepts(self) -> list[str]:
        """Acknowledged concepts, deduplicated, in first-seen order."""
        return list(dict.fromkeys(self._covered_concepts))

    @property
    def current_hint_level(self) -> int:
        return self._hint_level

    @property
    def tokens_used(self) -> int:
        return self._total_tokens_used

    @property
    def over_budget(self) -> bool:
        return self.session_token_budget >= 0 and self._total_tokens_used > self.session_token_budget

    @property
    def verbatim_turn_count(self) -> int:
        return len(self._recent_turns)

    @property
    def log(self) -> list[TeachingTurn]:
        """Read-only copy of the append-only log (all turns, never pruned)."""
        return list(self._all_turns)

    @property
    def total_turn_count(self) -> int:
        """Number of turns ever recorded (== log length)."""
        return len(self._all_turns)

    # -- Mutation -----------------------------------------------------------

    def should_compact(self) -> bool:
        """Preventive compaction trigger (Codex: compact before the window fills).

        True once the verbatim window is at or beyond its budget, meaning the
        next turn would start folding.
        """
        return len(self._recent_turns) >= self.max_verbatim_turns

    def record_turn(self, turn: TeachingTurn, usage_tokens: int = 0) -> None:
        """Record one completed teaching turn and fold/trim as needed."""
        self._total_tokens_used += usage_tokens
        self._all_turns.append(turn)
        self._recent_turns.append(turn)
        if turn.concept:
            self._covered_concepts.append(turn.concept)
        self._hint_level = turn.hint_level
        self._prune()

    async def compact_with_llm(
        self,
        summarizer: Callable[[str, Sequence[TeachingTurn]], str | Awaitable[str]],
    ) -> str:
        """LLM-driven handoff compaction (Codex local compaction path).

        Fold the whole verbatim window into a structured handoff summary via the
        provided summarizer so a successor request resumes naturally. Falls back
        to naive truncation when the summarizer returns nothing or raises.

        Returns the folded rolling summary.
        """
        if not self._recent_turns:
            return self._rolling_summary
        turns = self._recent_turns
        self._recent_turns = []
        folded = ""
        try:
            result = summarizer(HANDOFF_PROMPT, turns)
            if isinstance(result, Awaitable):
                result = await result
            folded = result.strip() if isinstance(result, str) else ""
        except Exception:
            folded = ""
        if folded:
            self._rolling_summary = (
                f"{self._rolling_summary}\n---\n{folded}" if self._rolling_summary else folded
            )
        else:
            # Fallback: naive fold of the evicted turns.
            for t in turns:
                line = f"学生: {t.student}\n教师: {t.teacher}（{t.action}）"
                self._rolling_summary = (
                    f"{self._rolling_summary}\n---\n{line}" if self._rolling_summary else line
                )
        self._trim_summary()
        return self._rolling_summary

    def _prune(self) -> None:
        """Fold the oldest turns into the rolling summary until the window fits."""
        while len(self._recent_turns) > self.max_verbatim_turns:
            oldest = self._recent_turns.pop(0)
            line = f"学生: {oldest.student}\n教师: {oldest.teacher}（{oldest.action}）"
            self._rolling_summary = (
                f"{self._rolling_summary}\n---\n{line}" if self._rolling_summary else line
            )
        self._trim_summary()

    def _trim_summary(self) -> None:
        """Keep the summary within a bounded window (newest tail)."""
        if len(self._rolling_summary) > self.max_summary_length:
            self._rolling_summary = self._rolling_summary[-self.max_summary_length :]

    def reset(self) -> None:
        """Reset the memory (used when a new session starts)."""
        self._recent_turns = []
        self._all_turns = []
        self._rolling_summary = ""
        self._covered_concepts = []
        self._hint_level = 0
        self._total_tokens_used = 0

    # -- Rendering ----------------------------------------------------------

    def to_context_block(self, max_tokens: int | None = None) -> str:
        """Model-visible context block. Injected into LLM prompts.

        When ``max_tokens`` resolves to a positive budget, the block is trimmed
        to that soft budget keeping the newest, most task-relevant content
        (concepts + hint level always survive).
        """
        if max_tokens is None:
            max_tokens = self.max_block_tokens
        head: list[str] = []
        concepts = self.concepts
        if concepts:
            head.append(f"已覆盖概念: {', '.join(concepts)}")
        head.append(f"当前提示等级: {self._hint_level}")

        summary = self._rolling_summary
        recent = list(self._recent_turns)

        def render() -> str:
            parts: list[str] = list(head)
            if summary:
                parts.append(f"较早对话摘要:\n{summary}")
            if recent:
                parts.append("近几轮对话:")
                for t in recent:
                    parts.append(f"- 学生: {t.student}\n  教师: {t.teacher}")
            return "\n".join(parts)

        if max_tokens and max_tokens > 0:
            # 1) Shrink the folded summary (newest tail kept) until it fits.
            while summary and estimate_tokens(render()) > max_tokens:
                summary = summary[max(len(summary) * 6 // 10, 0) :]
            # 2) Drop the oldest verbatim turns until it fits.
            while recent and estimate_tokens(render()) > max_tokens:
                recent.pop(0)
        return render()