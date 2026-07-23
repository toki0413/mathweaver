"""Tests for the proof assistant (``mathweaver/proof/assistant.py``).

Covers:
- All 16 theorem templates load (5 group-theory, 4 high-school,
  4 middle-school, 3 elementary).
- ``submit_proof`` for a correct proof of every theorem (parametrised).
- ``submit_proof`` edge cases: partial proof, merged student steps
  (greedy multi-match), empty steps, extra/unexpected steps.
- ``get_theorems_by_level`` for all four curriculum levels.
- Keyword normalisation (superscripts -> ASCII, math operators stripped).
- Unknown ``theorem_id`` returns an error listing available theorems.
"""

from __future__ import annotations

import pytest

from mathweaver.proof.assistant import (
    ProofAssistant,
    ProofResult,
    ProofStep,
    ProofTemplate,
)


# ---------------------------------------------------------------------------
# Expected theorem inventory per curriculum level.
# ---------------------------------------------------------------------------

LEVEL_THEOREMS = {
    "group_theory": [
        "identity_unique",
        "inverse_unique",
        "cancellation_law",
        "trivial_subgroup",
        "abelian_subgroup_of_squares",
    ],
    "high_school": [
        "function_monotonicity",
        "am_gm_inequality",
        "arithmetic_sequence_sum",
        "cos_double_angle",
    ],
    "middle_school": [
        "pythagorean_theorem",
        "triangle_angle_sum",
        "quadratic_formula",
        "congruent_sss",
    ],
    "elementary": [
        "commutative_addition",
        "fraction_equivalence",
        "distributive_law",
    ],
}

ALL_THEOREMS = [t for level in LEVEL_THEOREMS.values() for t in level]


# ---------------------------------------------------------------------------
# Correct proofs for every theorem.
#
# Each step's claim/justification is crafted to satisfy the keyword-pattern
# group defined in ``ProofAssistant._get_keyword_patterns`` for that step.
# The matching normalises input (lowercase, strip spaces/math operators,
# superscripts -> ASCII) so we exercise both ASCII and unicode forms.
# ---------------------------------------------------------------------------

CORRECT_PROOFS: dict[str, list[dict[str, str]]] = {
    # -- Group theory --
    "identity_unique": [
        {"claim": "e·f = f", "justification": "因为 e 是单位元"},
        {"claim": "e·f = e", "justification": "因为 f 是单位元"},
        {"claim": "e = f", "justification": "传递性"},
    ],
    "inverse_unique": [
        {"claim": "b = b·e", "justification": "e 是单位元"},
        {"claim": "e = a·c", "justification": "c 是 a 的逆元"},
        {"claim": "b·e = b·(a·c)", "justification": "代入 e = a·c"},
        {"claim": "b·(a·c) = (b·a)·c", "justification": "结合律"},
        {"claim": "(b·a)·c = e·c", "justification": "b·a = e，b 是 a 的逆元"},
        {"claim": "e·c = c", "justification": "e 是单位元"},
        {"claim": "b = c", "justification": "传递性"},
    ],
    "cancellation_law": [
        {"claim": "左乘 a⁻¹：a⁻¹·(a·b) = a⁻¹·(a·c)", "justification": "左乘逆元"},
        {"claim": "(a⁻¹·a)·b = (a⁻¹·a)·c", "justification": "结合律"},
        {"claim": "a⁻¹·a = e", "justification": "逆元定义"},
        {"claim": "e·b = e·c", "justification": "代入"},
        {"claim": "b = c", "justification": "单位元"},
    ],
    "trivial_subgroup": [
        {"claim": "e·e = e ∈ {e}", "justification": "封闭性"},
        {"claim": "e ∈ {e}", "justification": "单位元显然"},
        {"claim": "e⁻¹ = e ∈ {e}", "justification": "逆元"},
        {"claim": "{e} 是子群", "justification": "三条件满足"},
    ],
    "abelian_subgroup_of_squares": [
        {"claim": "(ab)² = a²·b²", "justification": "交换性"},
        {"claim": "e = e²", "justification": "单位元"},
        {"claim": "(g²)⁻¹ = (g⁻¹)²", "justification": "逆元"},
        {"claim": "H 是子群", "justification": "三条件满足"},
    ],
    # -- High school --
    # NOTE: subscripts (₁ ₂) are NOT normalised by the assistant — only
    # superscripts (¹ ²) and operators are — so we use ASCII x1/x2 here.
    "function_monotonicity": [
        {"claim": "f(x2) - f(x1) = x2² - x1²", "justification": "作差"},
        {"claim": "x2² - x1² = (x2 - x1)(x2 + x1)", "justification": "因式分解"},
        {"claim": "x2 - x1 > 0", "justification": "由 x2 > x1"},
        {"claim": "x2 + x1 > 0", "justification": "非负"},
        {"claim": "f(x2) - f(x1) > 0", "justification": "两个正数相乘为正"},
    ],
    "am_gm_inequality": [
        {"claim": "(√a - √b)² ≥ 0", "justification": "构造"},
        {"claim": "(√a)² - 2√(ab) + (√b)² ≥ 0", "justification": "展开"},
        {"claim": "a - 2√(ab) + b ≥ 0", "justification": "化简"},
        {"claim": "a + b ≥ 2√(ab)", "justification": "移项"},
        {"claim": "等号成立当 a = b", "justification": "√a = √b"},
    ],
    "arithmetic_sequence_sum": [
        # ASCII a1/a2/an: subscripts aren't normalised, superscripts are.
        {"claim": "Sn = a1 + a2 + ... + an", "justification": "写出"},
        {"claim": "Sn = an + a(n-1) + ... + a1", "justification": "倒序"},
        {"claim": "2Sn = (a1+an) + ... + (an+a1)", "justification": "两式相加"},
        {"claim": "a_k + a(n+1-k) = a1 + an", "justification": "首尾配对相等"},
        {"claim": "Sn = n(a1 + an)/2", "justification": "共 n 项"},
    ],
    "cos_double_angle": [
        {"claim": "cos2a = cos²a - sin²a", "justification": "令 β = α"},
        {"claim": "sin²a + cos²a = 1", "justification": "消去 sin²a"},
        {"claim": "sin²a = 1 - cos²a", "justification": "毕达哥拉斯"},
        {"claim": "cos2a = cos²a - (1 - cos²a)", "justification": "代入"},
        {"claim": "cos2a = 2cos²a - 1", "justification": "化简"},
    ],
    # -- Middle school --
    "pythagorean_theorem": [
        {"claim": "作 CD⊥AB 于 D，设 CD = h", "justification": "作高线"},
        {"claim": "△ACD ∽ △ABC，b² = p·c", "justification": "射影定理"},
        {"claim": "△BCD ∽ △ABC，a² = q·c", "justification": "射影定理"},
        {"claim": "a² + b² = (p+q)c", "justification": "两式相加"},
        {"claim": "p + q = c，所以 a² + b² = c²", "justification": ""},
    ],
    "triangle_angle_sum": [
        {"claim": "过 A 作 DE ∥ BC", "justification": "平行线辅助"},
        {"claim": "∠DAB = ∠B", "justification": "内错角相等"},
        {"claim": "∠EAC = ∠C", "justification": "内错角相等"},
        {"claim": "∠DAB + ∠A + ∠EAC = 180°", "justification": "平角"},
        {"claim": "∠B + ∠A + ∠C = 180°", "justification": "代入"},
    ],
    "quadratic_formula": [
        {"claim": "两边除以 a：x² + (b/a)x + c/a = 0", "justification": ""},
        {"claim": "配方：x² + (b/a)x + (b/2a)²", "justification": "配方"},
        {"claim": "(x + b/2a)² = (b² - 4ac)/4a²", "justification": "完全平方"},
        {"claim": "开平方：x + b/2a = ±√(b²-4ac)/2a", "justification": "开平方"},
        {"claim": "移项：x = (-b ± √(b²-4ac))/2a", "justification": "移项"},
    ],
    "congruent_sss": [
        {"claim": "叠合放置：EF 与 BC 重合，D 在异侧", "justification": ""},
        {"claim": "连接 AD", "justification": "辅助线"},
        {"claim": "△ABD 是等腰三角形，AB = DE，∠BAD = ∠DAC", "justification": "底角相等"},
        {"claim": "△ACD 是等腰三角形，AC = DF，∠CAD = ∠DAB", "justification": "底角相等"},
        {"claim": "∠BAC = ∠DAE，△ABC ≅ △DEF (SAS)", "justification": "全等"},
    ],
    # -- Elementary --
    "commutative_addition": [
        {"claim": "a + b 表示先数 a 个再数 b 个", "justification": "计数模型"},
        {"claim": "b + a 表示先数 b 个再数 a 个", "justification": "计数"},
        {"claim": "两种数法总数相同", "justification": ""},
        {"claim": "a + b = b + a", "justification": ""},
    ],
    "fraction_equivalence": [
        {"claim": "a/b 表示把单位分成 b 份取 a 份", "justification": ""},
        {"claim": "(a×k)/(b×k) 表示分成 b×k 份取 a×k 份", "justification": ""},
        {"claim": "每 b 份一组，共 k 组", "justification": "分组"},
        {"claim": "等价于分成 b 份取 a 份", "justification": "等价"},
        {"claim": "a/b = (a×k)/(b×k)", "justification": ""},
    ],
    "distributive_law": [
        {"claim": "a × (b + c) 表示 (b + c) 个 a 相加", "justification": "连加"},
        {"claim": "拆成 b 个 a 加 c 个 a", "justification": "拆"},
        {"claim": "b 个 a = a × b", "justification": ""},
        {"claim": "c 个 a = a × c", "justification": ""},
        {"claim": "a × (b + c) = a×b + a×c", "justification": ""},
    ],
}


@pytest.fixture()
def pa() -> ProofAssistant:
    return ProofAssistant()


# ---------------------------------------------------------------------------
# Template loading & inventory
# ---------------------------------------------------------------------------

def test_all_16_templates_loaded(pa: ProofAssistant):
    """Exactly 16 templates should be registered across the four levels."""
    available = pa.get_available_theorems()
    assert len(available) == 16
    assert sorted(available) == sorted(ALL_THEOREMS)


@pytest.mark.parametrize("level,theorems", list(LEVEL_THEOREMS.items()))
def test_get_theorems_by_level(pa: ProofAssistant, level, theorems):
    """Each curriculum level returns exactly its expected theorem set."""
    result = pa.get_theorems_by_level(level)
    assert sorted(result) == sorted(theorems)


def test_get_theorems_by_level_counts(pa: ProofAssistant):
    """Level counts: 5 + 4 + 4 + 3 = 16."""
    counts = {
        "group_theory": 5,
        "high_school": 4,
        "middle_school": 4,
        "elementary": 3,
    }
    for level, count in counts.items():
        assert len(pa.get_theorems_by_level(level)) == count


def test_get_theorems_by_unknown_level_returns_all(pa: ProofAssistant):
    """An unknown level falls back to the full theorem list."""
    assert sorted(pa.get_theorems_by_level("nonexistent")) == sorted(ALL_THEOREMS)


@pytest.mark.parametrize("theorem", ALL_THEOREMS)
def test_get_template_for_each_theorem(pa: ProofAssistant, theorem):
    """Every theorem resolves to a non-None template with expected steps."""
    template = pa.get_template(theorem)
    assert isinstance(template, ProofTemplate)
    assert template.theorem_name == theorem
    assert len(template.expected_steps) > 0
    assert template.description
    assert template.to_prove
    assert template.key_insights  # every template has key insights


@pytest.mark.parametrize("level,theorems", list(LEVEL_THEOREMS.items()))
def test_template_counts_per_level(pa: ProofAssistant, level, theorems):
    """Group-theory has 5 templates, the others 4/4/3."""
    for theorem in theorems:
        template = pa.get_template(theorem)
        assert template is not None, f"{theorem} missing for level {level}"


# ---------------------------------------------------------------------------
# Correct proofs (parametrised over all 16)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("theorem", ALL_THEOREMS)
def test_submit_correct_proof_completes(pa: ProofAssistant, theorem):
    """A correct, fully-matching proof completes for every theorem."""
    steps = CORRECT_PROOFS[theorem]
    result = pa.submit_proof(theorem, steps)

    assert isinstance(result, ProofResult)
    assert result.theorem_name == theorem
    assert result.is_complete, (
        f"{theorem} should complete. "
        f"progress={result.progress} missing={result.missing_steps} "
        f"steps={[s.to_dict() for s in result.steps]}"
    )
    # progress reports matched / total expected
    template = pa.get_template(theorem)
    assert result.progress == f"{len(template.expected_steps)}/{len(template.expected_steps)}"
    # every submitted step is valid when the proof is correct
    assert all(s.is_valid for s in result.steps)
    assert not result.missing_steps


def test_correct_proof_completion_feedback(pa: ProofAssistant):
    """A complete proof carries a celebratory overall feedback."""
    result = pa.submit_proof("identity_unique", CORRECT_PROOFS["identity_unique"])
    assert result.is_complete
    assert result.overall_feedback  # non-empty
    assert result.socratic_hint


# ---------------------------------------------------------------------------
# Partial / empty / extra step scenarios
# ---------------------------------------------------------------------------

def test_partial_proof_missing_step(pa: ProofAssistant):
    """Submitting only the first two steps of identity_unique is incomplete."""
    steps = CORRECT_PROOFS["identity_unique"][:2]
    result = pa.submit_proof("identity_unique", steps)

    assert not result.is_complete
    assert result.progress == "2/3"
    assert len(result.missing_steps) == 1
    # The missing step is the transitivity step
    assert "传递" in result.missing_steps[0]
    # Socratic hint should point the student forward
    assert result.socratic_hint
    assert "下一步" in result.overall_feedback


def test_empty_steps(pa: ProofAssistant):
    """An empty step list yields 0/N progress and all steps missing."""
    template = pa.get_template("identity_unique")
    result = pa.submit_proof("identity_unique", [])

    assert not result.is_complete
    assert result.progress == f"0/{len(template.expected_steps)}"
    assert result.missing_steps == template.expected_steps
    assert result.steps == []


def test_extra_unexpected_step(pa: ProofAssistant):
    """A correct proof plus one extra step still completes; extra is invalid."""
    steps = CORRECT_PROOFS["identity_unique"] + [
        {"claim": "所以 G 是交换群", "justification": "无关的额外结论"}
    ]
    result = pa.submit_proof("identity_unique", steps)

    assert result.is_complete  # the three expected steps were matched
    assert result.progress == "3/3"
    # The 4th step is flagged as out-of-structure and invalid
    extra = result.steps[-1]
    assert not extra.is_valid
    assert "超出" in extra.feedback or "预期结构" in extra.feedback


# ---------------------------------------------------------------------------
# Greedy multi-match: student merges several expected steps into one
# ---------------------------------------------------------------------------

def test_merged_steps_greedy_match(pa: ProofAssistant):
    """inverse_unique with one merged step still completes via greedy match.

    Steps 1 (e = a·c) and 2 (b·e = b·(a·c) by substitution) are merged into
    a single student step "b·e = b·(a·c) （代入 e = a·c）". The greedy matcher
    must keep the *furthest* matching expected index (step 2), implicitly
    covering step 1.
    """
    merged_proof = [
        {"claim": "b = b·e", "justification": "e 是单位元"},
        # Merged step covering expected steps 1 + 2
        {"claim": "b·e = b·(a·c)", "justification": "代入 e = a·c"},
        {"claim": "b·(a·c) = (b·a)·c", "justification": "结合律"},
        {"claim": "(b·a)·c = e·c", "justification": "b·a = e，b 是 a 的逆元"},
        {"claim": "e·c = c", "justification": "e 是单位元"},
        {"claim": "b = c", "justification": "传递性"},
    ]
    result = pa.submit_proof("inverse_unique", merged_proof)

    assert result.is_complete, (
        f"Merged proof should complete via greedy match. "
        f"progress={result.progress} missing={result.missing_steps}"
    )
    assert result.progress == "7/7"

    # The merged (2nd) student step should record one implicit step.
    merged_step = result.steps[1]
    assert merged_step.is_valid
    assert merged_step.implicit_steps, "merged step should list implicit coverage"
    assert len(merged_step.implicit_steps) == 1
    assert "隐含覆盖" in merged_step.feedback


def test_single_step_whole_proof(pa: ProofAssistant):
    """identity_unique condensed into one giant step still completes.

    This stress-tests the greedy multi-match: the single step's combined
    claim+justification text satisfies expected steps 0, 1, and 2.
    """
    one_step = [
        {
            "claim": "e·f = f 且 e·f = e，所以 e = f",
            "justification": "e 与 f 都是单位元，由传递性得 e = f",
        }
    ]
    result = pa.submit_proof("identity_unique", one_step)
    assert result.is_complete, (
        f"Condensed single-step proof should complete. "
        f"progress={result.progress} missing={result.missing_steps}"
    )
    assert result.progress == "3/3"
    # The single step implicitly covers the two skipped expected steps.
    assert len(result.steps[0].implicit_steps) == 2


# ---------------------------------------------------------------------------
# Keyword normalisation
# ---------------------------------------------------------------------------

def test_superscript_inverse_matches_ascii(pa: ProofAssistant):
    """cancellation_law step 0 matches whether written with ⁻¹ or -1."""
    # Unicode superscript form
    sup = pa.submit_proof(
        "cancellation_law",
        [{"claim": "左乘 a⁻¹", "justification": "逆元"}],
    )
    assert sup.steps[0].is_valid

    # ASCII form
    asc = pa.submit_proof(
        "cancellation_law",
        [{"claim": "左乘 a-1", "justification": "逆元"}],
    )
    assert asc.steps[0].is_valid


def test_operator_stripping(pa: ProofAssistant):
    """The '·' operator is stripped so 'e·f = f' matches 'ef=f'."""
    result = pa.submit_proof(
        "identity_unique",
        [{"claim": "e·f = f", "justification": "单位元"}],
    )
    assert result.steps[0].is_valid


def test_case_insensitive_matching(pa: ProofAssistant):
    """Uppercase ASCII letters are lowercased so 'EF=F' matches 'ef=f'."""
    result = pa.submit_proof(
        "identity_unique",
        [{"claim": "EF = F", "justification": "E 是单位元"}],
    )
    # 'EF' -> 'ef' and 'F' -> 'f'; combined contains 'ef=f' and '单位元'.
    assert result.steps[0].is_valid


def test_cjk_variants_not_normalised(pa: ProofAssistant):
    """The normaliser folds ASCII case/operators/superscripts but not CJK.

    Traditional '單位元' must NOT satisfy a '单位元' (simplified) keyword.
    We target trivial_subgroup step 1, whose only keyword groups require
    '单位元', so the step should remain invalid (only partially matched).
    """
    result = pa.submit_proof(
        "trivial_subgroup",
        [{"claim": "e ∈ {e}", "justification": "單位元显然"}],
    )
    assert not result.steps[0].is_valid


def test_partial_match_feedback(pa: ProofAssistant):
    """A step with some but not all keywords yields a '部分正确' feedback."""
    result = pa.submit_proof(
        "identity_unique",
        [{"claim": "e·f", "justification": ""}],  # has 'ef' but not '=f' or 单位元
    )
    assert not result.steps[0].is_valid
    fb = result.steps[0].feedback
    assert "部分正确" in fb or "不匹配" in fb


# ---------------------------------------------------------------------------
# Unknown theorem handling
# ---------------------------------------------------------------------------

def test_unknown_theorem_returns_error_with_available(pa: ProofAssistant):
    """An unknown theorem_id yields an incomplete result listing available theorems."""
    result = pa.submit_proof("does_not_exist", [{"claim": "x", "justification": "y"}])

    assert isinstance(result, ProofResult)
    assert not result.is_complete
    assert result.theorem_name == "does_not_exist"
    assert "未知定理" in result.overall_feedback
    # The error message embeds the list of available theorems
    for theorem in ["identity_unique", "distributive_law", "cos_double_angle"]:
        assert theorem in result.overall_feedback


# ---------------------------------------------------------------------------
# Hint retrieval
# ---------------------------------------------------------------------------

def test_get_hint_in_range(pa: ProofAssistant):
    """get_hint returns a socratic hint for a valid step index."""
    hint = pa.get_hint("identity_unique", 0)
    assert "单位元" in hint

    hint2 = pa.get_hint("identity_unique", 1)
    assert hint2


def test_get_hint_out_of_range(pa: ProofAssistant):
    """get_hint past the last step still returns a non-empty string."""
    hint = pa.get_hint("identity_unique", 99)
    assert hint  # never empty


def test_get_hint_unknown_theorem(pa: ProofAssistant):
    """get_hint for an unknown theorem reports it."""
    hint = pa.get_hint("nope", 0)
    assert "未知定理" in hint


def test_get_theorem_info(pa: ProofAssistant):
    """get_theorem_info returns one entry per template with step counts."""
    info = pa.get_theorem_info()
    assert len(info) == 16
    first = info[0]
    assert {"name", "description", "given", "to_prove", "num_expected_steps"} <= set(first)
    assert all(entry["num_expected_steps"] > 0 for entry in info)


def test_proof_step_to_dict_roundtrip():
    """ProofStep.to_dict exposes all public fields."""
    step = ProofStep(step_number=1, claim="x", justification="y", is_valid=True)
    d = step.to_dict()
    assert d["step_number"] == 1
    assert d["claim"] == "x"
    assert d["is_valid"] is True
    assert d["implicit_steps"] == []


def test_proof_result_to_dict(pa: ProofAssistant):
    """ProofResult.to_dict serialises the full verification result."""
    result = pa.submit_proof("identity_unique", CORRECT_PROOFS["identity_unique"])
    d = result.to_dict()
    assert d["is_complete"] is True
    assert d["progress"] == "3/3"
    assert len(d["steps"]) == 3
    assert all("feedback" in s for s in d["steps"])
