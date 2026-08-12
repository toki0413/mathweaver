"""Contract tests for the dynamic question generator.

Covers ``mathweaver/grill/generator.py`` (``QuestionGenerator``):

- LLM path: a well-formed JSON response yields a valid ``GeneratedQuestion``.
- Template fallback: when the LLM is unavailable or returns garbage, the
  generator degrades to a deterministic template.
- JSON parsing: brace-matching extraction across plain and code-fenced text.
- Validation: rejects too-short / too-long text and concept-name echoing.
- Difficulty: clamped to [0.0, 1.0]; non-numeric falls back to the target.
- Caching: per-concept cache, generation counters, and export.
- Difficulty-description mapping for prompt engineering.
"""

from __future__ import annotations

import pytest

from mathweaver.grill.generator import (
    GeneratedQuestion,
    QuestionGenerator,
    _difficulty_to_description,
)
from mathweaver.models.state import ConceptNode

# A question text long enough (>10 chars) to pass generator validation.
_VALID_QUESTION = "请解释什么是逆元？并说明它与单位元的关系。"


def _node(**overrides) -> ConceptNode:
    """Build a ConceptNode with sane curriculum metadata."""
    defaults = dict(
        id="inverse_element",
        name="逆元",
        description="群中每个元素都存在一个逆元素，使得两者运算得到单位元。",
        prerequisites=["单位元", "群"],
        abstraction_level=2,
        domain="group_theory",
        learning_objectives=["会计算给定元素的逆元"],
        examples=["在加法群 Z3 中，2 的逆元是 1"],
        common_misconceptions=["误以为逆元唯一地等于自身"],
        related_theorems=["逆元唯一性定理"],
    )
    defaults.update(overrides)
    return ConceptNode(**defaults)


class _FakeLLM:
    """Deterministic fake LLM client returning a canned response."""

    def __init__(self, text: str):
        self.text = text
        self.calls: list[tuple[str, str]] = []

    async def chat(self, system_prompt, user_message, tools=None, temperature=0.7):
        self.calls.append((system_prompt, user_message))
        return type("R", (), {"content": self.text})()


class _FailingLLM:
    """LLM client that always raises, forcing template fallback."""

    async def chat(self, system_prompt, user_message, tools=None, temperature=0.7):
        raise RuntimeError("simulated network failure")


# ---------------------------------------------------------------------------
# LLM success path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_with_llm_returns_valid_question():
    text = '{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元是使得两元素相乘为单位元的元素。", "difficulty": 0.6}'
    llm = _FakeLLM(text)
    gen = QuestionGenerator(llm_client=llm)

    q = await gen.generate(_node(), target_difficulty=0.5, curriculum_level="group_theory")

    assert isinstance(q, GeneratedQuestion)
    assert q.generation_method == "llm"
    assert q.question_type == "concept"
    assert q.concept_node_id == "inverse_element"
    assert q.difficulty == pytest.approx(0.6)
    assert q.question
    assert q.recommended_answer


@pytest.mark.asyncio
async def test_generate_llm_prompt_mentions_concept_and_difficulty():
    llm = _FakeLLM('{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元是群论中的核心概念，需要深入理解。", "difficulty": 0.5}')
    gen = QuestionGenerator(llm_client=llm)

    await gen.generate(_node(), target_difficulty=0.5, curriculum_level="group_theory")

    _, user_msg = llm.calls[0]
    assert "逆元" in user_msg
    assert "0.50" in user_msg
    assert "group_theory" in user_msg
    assert "逆元" in user_msg  # concept name appears in the ask


@pytest.mark.asyncio
async def test_generate_llm_uses_student_profile_context():
    llm = _FakeLLM('{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元定义。", "difficulty": 0.5}')
    gen = QuestionGenerator(llm_client=llm)

    await gen.generate(
        _node(),
        target_difficulty=0.5,
        curriculum_level="group_theory",
        student_profile={"mastery": 0.3, "weak_areas": ["逆元"]},
    )

    _, user_msg = llm.calls[0]
    assert "30%" in user_msg         # mastery formatted as percent
    assert "逆元" in user_msg        # weak area surfaced


# ---------------------------------------------------------------------------
# Template fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_falls_back_to_template_without_llm():
    gen = QuestionGenerator(llm_client=None)
    q = await gen.generate(_node(), target_difficulty=0.5, question_type="concept")

    assert q.generation_method == "template_fallback"
    assert "逆元" in q.question
    assert q.difficulty == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_generate_falls_back_when_llm_raises():
    gen = QuestionGenerator(llm_client=_FailingLLM())
    q = await gen.generate(_node(), target_difficulty=0.4, question_type="application")

    assert q.generation_method == "template_fallback"
    assert "应用" in q.question
    assert q.difficulty == pytest.approx(0.4)


@pytest.mark.asyncio
async def test_generate_falls_back_when_llm_returns_garbage():
    gen = QuestionGenerator(llm_client=_FakeLLM("not json at all"))
    q = await gen.generate(_node(), target_difficulty=0.3)

    assert q.generation_method == "template_fallback"


@pytest.mark.parametrize(
    "q_type,keyword",
    [
        ("concept", "解释"),
        ("application", "应用"),
        ("edge_case", "边界"),
        ("proof", "证明"),
    ],
)
@pytest.mark.asyncio
async def test_template_variants_per_question_type(q_type, keyword):
    gen = QuestionGenerator(llm_client=None)
    q = await gen.generate(_node(), target_difficulty=0.5, question_type=q_type)
    assert q.question_type == q_type
    assert keyword in q.question


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------


def test_extract_json_plain_object():
    gen = QuestionGenerator()
    assert gen._extract_json('{"a": 1}') == '{"a": 1}'


def test_extract_json_from_code_fence():
    gen = QuestionGenerator()
    text = 'Sure, here it is:\n```json\n{"question": "q", "answer": "a"}\n```'
    assert '"question"' in gen._extract_json(text)


def test_extract_json_nested_braces():
    gen = QuestionGenerator()
    text = '{"question": "x", "nested": {"d": 1}, "answer": "y"}'
    extracted = gen._extract_json(text)
    assert extracted is not None
    assert extracted.endswith("}")


def test_extract_json_no_brace_returns_none():
    gen = QuestionGenerator()
    assert gen._extract_json("no json here") is None


# ---------------------------------------------------------------------------
# Validation & parsing
# ---------------------------------------------------------------------------


def test_parse_valid_llm_response():
    gen = QuestionGenerator()
    node = _node()
    q = gen._parse_llm_response(
        '{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元是核心概念，需要深入理解。", "difficulty": 0.7}',
        node,
        target_difficulty=0.5,
        q_type="concept",
    )
    assert q is not None
    assert q.difficulty == pytest.approx(0.7)
    assert q.generation_method == "llm"


@pytest.mark.parametrize(
    "text",
    [
        "no json",
        '{"difficulty": 0.5}',  # missing question/answer
    ],
)
def test_parse_rejects_invalid_payloads(text):
    gen = QuestionGenerator()
    assert gen._parse_llm_response(text, _node(), 0.5, "concept") is None


def test_parse_rejects_short_question():
    gen = QuestionGenerator()
    # question length < 10
    assert gen._parse_llm_response(
        '{"question": "太短", "answer": "这是一个足够长的参考答案用于通过校验。", "difficulty": 0.5}',
        _node(),
        0.5,
        "concept",
    ) is None


def test_parse_rejects_short_answer():
    gen = QuestionGenerator()
    assert gen._parse_llm_response(
        '{"question": "这是一个足够长的有效问题文本。", "answer": "短", "difficulty": 0.5}',
        _node(),
        0.5,
        "concept",
    ) is None


def test_parse_rejects_question_echoing_concept_name():
    gen = QuestionGenerator()
    node = _node(name="逆元")
    assert gen._parse_llm_response(
        '{"question": "逆元", "answer": "这是一个足够长的参考答案用于通过校验。", "difficulty": 0.5}',
        node,
        0.5,
        "concept",
    ) is None


def test_parse_clamps_difficulty_over_1():
    gen = QuestionGenerator()
    q = gen._parse_llm_response(
        '{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元是核心概念，需要深入理解。", "difficulty": 3.5}',
        _node(),
        0.5,
        "concept",
    )
    assert q.difficulty == 1.0


def test_parse_clamps_difficulty_under_0():
    gen = QuestionGenerator()
    q = gen._parse_llm_response(
        '{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元是核心概念，需要深入理解。", "difficulty": -2.0}',
        _node(),
        0.5,
        "concept",
    )
    assert q.difficulty == 0.0


def test_parse_non_numeric_difficulty_falls_back_to_target():
    gen = QuestionGenerator()
    q = gen._parse_llm_response(
        '{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元是核心概念，需要深入理解。", "difficulty": "easy"}',
        _node(),
        target_difficulty=0.5,
        q_type="concept",
    )
    assert q.difficulty == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# Difficulty description mapping
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "difficulty,expected_fragment",
    [
        (0.1, "非常简单"),
        (0.3, "简单"),
        (0.5, "中等"),
        (0.7, "较难"),
        (0.9, "挑战"),
    ],
)
def test_difficulty_to_description(difficulty, expected_fragment):
    assert expected_fragment in _difficulty_to_description(difficulty)


def test_difficulty_to_description_out_of_range():
    assert "中等" in _difficulty_to_description(5.0)


# ---------------------------------------------------------------------------
# Caching & export
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_caches_per_concept():
    gen = QuestionGenerator(llm_client=None)
    node = _node()
    await gen.generate(node, target_difficulty=0.5)
    await gen.generate(node, target_difficulty=0.6)

    assert gen.cache_size == 2
    assert len(gen.get_cached_questions("inverse_element")) == 2
    assert gen.generation_count == 2


@pytest.mark.asyncio
async def test_generation_count_tracks_llm_success_only_once_per_call():
    llm = _FakeLLM('{"question": "请解释什么是逆元并说明它与单位元的关系？", "answer": "逆元是核心概念，需要深入理解。", "difficulty": 0.6}')
    gen = QuestionGenerator(llm_client=llm)
    await gen.generate(_node(), target_difficulty=0.5)
    assert gen.generation_count == 1


@pytest.mark.asyncio
async def test_get_all_generated_exports_dicts():
    gen = QuestionGenerator(llm_client=None)
    await gen.generate(_node(), target_difficulty=0.5)
    exported = gen.get_all_generated()
    assert "inverse_element" in exported
    assert exported["inverse_element"][0]["generation_method"] == "template_fallback"


@pytest.mark.asyncio
async def test_generator_to_dict_shape():
    gen = QuestionGenerator(llm_client=None)
    await gen.generate(_node(), target_difficulty=0.5)
    d = gen.to_dict()
    assert d["generation_count"] == 1
    assert d["cache_size"] == 1
    assert "inverse_element" in d["cached_concepts"]


def test_generated_question_to_bank_format():
    q = GeneratedQuestion(
        question="q?",
        recommended_answer="ans",
        difficulty=0.5,
        question_type="concept",
        concept_node_id="c",
        concept_name="C",
    )
    bank = q.to_bank_format()
    assert set(bank) == {"question", "answer", "difficulty", "type"}
    assert bank["type"] == "concept"
