"""Tests for the long-horizon teaching memory (``orchestrator/teaching_memory.py``).

Covers the Codex-inspired handoff compaction, the DeepSeek-Harness
"model-visible means logged" append-only log, token-budget enforcement, and
the preventive compaction trigger.
"""

from __future__ import annotations

import asyncio

import pytest

from mathweaver.orchestrator.teaching_memory import (
    HANDOFF_PROMPT,
    TeachingMemory,
    TeachingTurn,
    estimate_tokens,
)


def turn(n: int, **kwargs) -> TeachingTurn:
    data = {
        "student": f"学生问题 {n}",
        "teacher": f"教师回应 {n}",
        "action": "hint",
        "hint_level": n % 3,
    }
    data.update(kwargs)
    return TeachingTurn(**data)


def test_keeps_recent_turns_verbatim_up_to_window_budget() -> None:
    m = TeachingMemory(max_verbatim_turns=3)
    for i in range(1, 6):
        m.record_turn(turn(i))
    assert m.verbatim_turn_count == 3
    # Newest survive; oldest folded into the summary.
    block = m.to_context_block()
    assert "学生问题 5" in block
    assert "较早对话摘要" in block


def test_append_only_log_never_destroys_raw_history() -> None:
    m = TeachingMemory(max_verbatim_turns=2)
    for i in range(1, 11):
        m.record_turn(turn(i))
    assert m.verbatim_turn_count == 2
    assert m.total_turn_count == 10
    assert [t.student for t in m.log] == [f"学生问题 {i}" for i in range(1, 11)]


def test_token_usage_budget() -> None:
    m = TeachingMemory(session_token_budget=100)
    assert m.tokens_used == 0
    assert not m.over_budget
    m.record_turn(turn(1), 40)
    m.record_turn(turn(2), 70)
    assert m.tokens_used == 110
    assert m.over_budget


def test_concepts_dedup_and_hint_level() -> None:
    m = TeachingMemory()
    m.record_turn(turn(1, concept="单位元", hint_level=1))
    m.record_turn(turn(2, concept="单位元", hint_level=2))
    m.record_turn(turn(3, concept="逆元", hint_level=0))
    assert m.concepts == ["单位元", "逆元"]
    assert m.current_hint_level == 0


def test_should_compact_preventive_trigger() -> None:
    m = TeachingMemory(max_verbatim_turns=3)
    assert not m.should_compact()
    m.record_turn(turn(1))
    m.record_turn(turn(2))
    assert not m.should_compact()
    m.record_turn(turn(3))
    assert m.should_compact()


def test_compact_with_llm_handoff_summary() -> None:
    async def run() -> None:
        m = TeachingMemory(max_verbatim_turns=2)
        m.record_turn(turn(1))
        m.record_turn(turn(2))
        prompt: str = ""

        async def summarizer(p, turns):
            nonlocal prompt
            prompt = p
            return f"进度: 已覆盖 {len(turns)} 轮\n下一步: 逆元"

        summary = await m.compact_with_llm(summarizer)
        assert "进度" in summary
        assert "下一步" in summary
        # Handoff prompt is forward-looking (Codex "handoff > summary").
        assert "CONTEXT CHECKPOINT" in prompt
        assert "下一步" in prompt
        assert m.verbatim_turn_count == 0
        assert m.total_turn_count == 2

    asyncio.run(run())


def test_compact_with_llm_sync_summarizer() -> None:
    async def run() -> None:
        m = TeachingMemory(max_verbatim_turns=1)
        m.record_turn(turn(1))
        m.record_turn(turn(2))
        summary = await m.compact_with_llm(lambda p, turns: "同步交接摘要")
        assert "同步交接摘要" in summary

    asyncio.run(run())


def test_compact_with_llm_falls_back_on_error() -> None:
    async def run() -> None:
        m = TeachingMemory(max_verbatim_turns=1)
        m.record_turn(turn(1))
        m.record_turn(turn(2))

        def boom(p, turns):
            raise RuntimeError("boom")

        summary = await m.compact_with_llm(boom)
        assert summary  # naive truncation fallback produced something
        assert m.verbatim_turn_count == 0

    asyncio.run(run())


def test_context_block_token_budget() -> None:
    m = TeachingMemory(max_verbatim_turns=5)
    for i in range(1, 6):
        m.record_turn(turn(i, concept="群论"))
    block = m.to_context_block(max_tokens=20)
    assert estimate_tokens(block) <= 20
    # Concepts + hint level always survive.
    assert "已覆盖概念" in block
    assert "当前提示等级" in block


def test_reset_clears_everything() -> None:
    m = TeachingMemory()
    m.record_turn(turn(1), 10)
    m.reset()
    assert m.total_turn_count == 0
    assert m.tokens_used == 0
    assert m.concepts == []
    assert m.verbatim_turn_count == 0
    # The hint-level header is always emitted; nothing else survives reset.
    assert m.to_context_block() == "当前提示等级: 0"


def test_handoff_prompt_constant() -> None:
    assert "已达成进度" in HANDOFF_PROMPT
    assert "下一步" in HANDOFF_PROMPT