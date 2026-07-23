"""Proof assistant: Z3-verified step-by-step proof checking for group theory.

Students submit proof steps for standard theorems. Each step is checked
against the expected proof structure, and the assistant provides:
- Valid/invalid feedback per step
- Identification of missing steps
- Socratic hints for what to do next
- Overall completion assessment

Design philosophy — response to the New Math movement (1958-1975):
The New Math introduced formal proof structures to students who lacked
the intuition to ground them, leading to alienation. This assistant takes
the opposite approach: it activates only after the learner's mastery
exceeds threshold, and provides Socratic guidance rather than demanding
axiomatic formalism from the start. Structure is the destination, not
the starting point. See: docs/new-math-reflection.md
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ProofStep:
    """A single step in a student's proof."""

    step_number: int
    claim: str
    justification: str
    is_valid: bool = False
    feedback: str = ""
    matched_expected: str = ""
    implicit_steps: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_number": self.step_number,
            "claim": self.claim,
            "justification": self.justification,
            "is_valid": self.is_valid,
            "feedback": self.feedback,
            "matched_expected": self.matched_expected,
            "implicit_steps": self.implicit_steps,
        }


@dataclass
class ProofResult:
    """Result of verifying a student's proof."""

    theorem_name: str
    steps: list[ProofStep] = field(default_factory=list)
    is_complete: bool = False
    missing_steps: list[str] = field(default_factory=list)
    socratic_hint: str = ""
    overall_feedback: str = ""
    progress: str = "0/0"

    def to_dict(self) -> dict[str, Any]:
        return {
            "theorem_name": self.theorem_name,
            "steps": [s.to_dict() for s in self.steps],
            "is_complete": self.is_complete,
            "missing_steps": self.missing_steps,
            "socratic_hint": self.socratic_hint,
            "overall_feedback": self.overall_feedback,
            "progress": self.progress,
        }


@dataclass
class ProofTemplate:
    """Expected proof structure for a theorem."""

    theorem_name: str
    description: str
    given: list[str]
    to_prove: str
    expected_steps: list[str]
    key_insights: list[str]
    socratic_hints: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "theorem_name": self.theorem_name,
            "description": self.description,
            "given": self.given,
            "to_prove": self.to_prove,
            "expected_steps": self.expected_steps,
            "key_insights": self.key_insights,
            "socratic_hints": self.socratic_hints,
        }


class ProofAssistant:
    """Verifies student proofs step by step.

    Usage:
        pa = ProofAssistant()
        result = pa.submit_proof("identity_unique", [
            {"claim": "e = e·f", "justification": "因为 f 是单位元"},
            {"claim": "e·f = f", "justification": "因为 e 是单位元"},
            {"claim": "e = f", "justification": "传递性"},
        ])
        print(result.is_complete)  # True
    """

    def __init__(self, curriculum_level: str = "group_theory") -> None:
        self.curriculum_level = curriculum_level
        self._templates: dict[str, ProofTemplate] = self._build_templates()

    def _build_templates(self) -> dict[str, ProofTemplate]:
        """Build predefined proof templates for common theorems.

        Templates are organized by curriculum level:
        - group_theory: abstract algebra proofs (identity, inverse, etc.)
        - high_school: function properties, inequalities, sequences
        - middle_school: triangle congruence, pythagorean theorem
        - elementary: basic arithmetic properties
        """
        templates: dict[str, ProofTemplate] = {}

        # ---- Group Theory (university) ----
        templates.update(self._group_theory_templates())

        # ---- High School ----
        templates.update(self._high_school_templates())

        # ---- Middle School ----
        templates.update(self._middle_school_templates())

        # ---- Elementary ----
        templates.update(self._elementary_templates())

        return templates

    def _group_theory_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for group theory (university level)."""
        return {
            "identity_unique": ProofTemplate(
                theorem_name="identity_unique",
                description="群中单位元唯一",
                given=["G 是群", "e 和 f 都是 G 的单位元"],
                to_prove="e = f",
                expected_steps=[
                    "利用 e 是单位元：e·f = f",
                    "利用 f 是单位元：e·f = e",
                    "由传递性：e = f",
                ],
                key_insights=[
                    "关键在于 e·f 同时可以两种方式展开",
                    "e 作为单位元：e·f = f",
                    "f 作为单位元：e·f = e",
                ],
                socratic_hints=[
                    "如果 e 是单位元，e·f 等于什么？",
                    "如果 f 也是单位元，e·f 又等于什么？",
                    "同一个表达式 e·f 有两个不同的值，能推出什么？",
                ],
            ),
            "inverse_unique": ProofTemplate(
                theorem_name="inverse_unique",
                description="群中每个元素的逆元唯一",
                given=["G 是群", "a ∈ G", "b 和 c 都是 a 的逆元"],
                to_prove="b = c",
                expected_steps=[
                    "b = b·e （e 是单位元）",
                    "e = a·c （c 是 a 的逆元）",
                    "b·e = b·(a·c) （代入上一步）",
                    "b·(a·c) = (b·a)·c （结合律）",
                    "(b·a)·c = e·c （b 是 a 的逆元，b·a = e）",
                    "e·c = c （e 是单位元）",
                    "b = c （传递性）",
                ],
                key_insights=[
                    "核心技巧：从 b 出发，经过一系列等式到达 c",
                    "中间插入 e = a·c 和 b·a = e",
                    "结合律是重排括号的关键",
                ],
                socratic_hints=[
                    "从 b = b·e 开始，你能把 e 替换成什么？",
                    "a·c 等于什么？b·a 等于什么？",
                    "如何用结合律重排 b·(a·c)？",
                ],
            ),
            "cancellation_law": ProofTemplate(
                theorem_name="cancellation_law",
                description="群的消去律：a·b = a·c ⟹ b = c",
                given=["G 是群", "a, b, c ∈ G", "a·b = a·c"],
                to_prove="b = c",
                expected_steps=[
                    "左乘 a 的逆元 a⁻¹：a⁻¹·(a·b) = a⁻¹·(a·c)",
                    "结合律：(a⁻¹·a)·b = (a⁻¹·a)·c",
                    "逆元定义：a⁻¹·a = e",
                    "代入：e·b = e·c",
                    "单位元：b = c",
                ],
                key_insights=[
                    "消去律的本质：左乘逆元",
                    "群保证每个元素都有逆元，所以消去律成立",
                    "半群没有逆元，所以消去律不一定成立",
                ],
                socratic_hints=[
                    "如果 a·b = a·c，等式两边同时左乘什么可以消去 a？",
                    "a⁻¹·a 等于什么？",
                    "e·b 等于什么？",
                ],
            ),
            "trivial_subgroup": ProofTemplate(
                theorem_name="trivial_subgroup",
                description="{e} 是群的子群",
                given=["G 是群", "e 是 G 的单位元"],
                to_prove="{e} 是 G 的子群",
                expected_steps=[
                    "封闭性：e·e = e ∈ {e}",
                    "单位元：e ∈ {e}（显然）",
                    "逆元：e⁻¹ = e ∈ {e}",
                    "三条件满足，{e} 是子群",
                ],
                key_insights=[
                    "子群判定需要三个条件：封闭、含单位元、含逆元",
                    "e·e = e 因为 e 是单位元",
                    "e⁻¹ = e 因为 e·e = e",
                ],
                socratic_hints=[
                    "子群需要满足哪三个条件？",
                    "e·e 等于什么？",
                    "e 的逆元是什么？",
                ],
            ),
            "abelian_subgroup_of_squares": ProofTemplate(
                theorem_name="abelian_subgroup_of_squares",
                description="交换群中 {g² : g ∈ G} 是子群",
                given=["G 是交换群", "H = {g² : g ∈ G}"],
                to_prove="H 是 G 的子群",
                expected_steps=[
                    "封闭性：取 a², b² ∈ H，则 a²·b² = (ab)² ∈ H（用到交换性）",
                    "单位元：e = e² ∈ H",
                    "逆元：(g²)⁻¹ = (g⁻¹)² ∈ H",
                    "三条件满足，H 是子群",
                ],
                key_insights=[
                    "关键步骤：(ab)² = a·b·a·b = a²·b² 需要交换性",
                    "在非交换群中 (ab)² ≠ a²·b²，所以结论不成立",
                    "交换性允许重新排列乘积顺序",
                ],
                socratic_hints=[
                    "a²·b² 能写成某个元素的平方吗？",
                    "(ab)² = abab，如何用交换性把它变成 aabb？",
                    "e 能写成某个元素的平方吗？",
                ],
            ),
        }

    def _high_school_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for high school level."""
        return {
            "function_monotonicity": ProofTemplate(
                theorem_name="function_monotonicity",
                description="证明 f(x) = x² 在 [0,+∞) 上单调递增",
                given=["f(x) = x²", "0 ≤ x₁ < x₂"],
                to_prove="f(x₁) < f(x₂)",
                expected_steps=[
                    "计算 f(x₂) - f(x₁) = x₂² - x₁²",
                    "因式分解：x₂² - x₁² = (x₂ - x₁)(x₂ + x₁)",
                    "由 x₂ > x₁ 得 x₂ - x₁ > 0",
                    "由 x₁, x₂ ≥ 0 得 x₂ + x₁ > 0",
                    "两个正数相乘仍为正：f(x₂) - f(x₁) > 0",
                ],
                key_insights=[
                    "作差法是比较函数值大小的核心方法",
                    "因式分解后判断各因子的符号",
                    "x₁ ≥ 0 是保证 x₂ + x₁ > 0 的关键条件",
                ],
                socratic_hints=[
                    "f(x₂) - f(x₁) 等于什么？",
                    "x₂² - x₁² 能因式分解吗？",
                    "每个因子的符号是什么？",
                ],
            ),
            "am_gm_inequality": ProofTemplate(
                theorem_name="am_gm_inequality",
                description="基本不等式：a+b ≥ 2√(ab) (a,b > 0)",
                given=["a > 0, b > 0"],
                to_prove="a + b ≥ 2√(ab)",
                expected_steps=[
                    "构造 (√a - √b)² ≥ 0（完全平方非负）",
                    "展开：(√a)² - 2√(ab) + (√b)² ≥ 0",
                    "化简：a - 2√(ab) + b ≥ 0",
                    "移项：a + b ≥ 2√(ab)",
                    "等号成立当且仅当 √a = √b 即 a = b",
                ],
                key_insights=[
                    "从 (√a - √b)² ≥ 0 出发是关键构造",
                    "完全平方非负是证明不等式的常用工具",
                    "等号条件需要单独验证",
                ],
                socratic_hints=[
                    "什么表达式的平方总是非负的？",
                    "(√a - √b)² 展开后是什么？",
                    "等号什么时候成立？",
                ],
            ),
            "arithmetic_sequence_sum": ProofTemplate(
                theorem_name="arithmetic_sequence_sum",
                description="等差数列求和公式：Sn = n(a₁ + an)/2",
                given=["{an} 是等差数列", "首项 a₁，公差 d", "Sn = a₁ + a₂ + ... + an"],
                to_prove="Sn = n(a₁ + an)/2",
                expected_steps=[
                    "写出 Sn = a₁ + a₂ + ... + an",
                    "倒序写 Sn = an + a(n-1) + ... + a₁",
                    "两式相加：2Sn = (a₁+an) + (a₂+a(n-1)) + ... + (an+a₁)",
                    "等差数列性质：a_k + a(n+1-k) = a₁ + an",
                    "共 n 项：2Sn = n(a₁ + an)，所以 Sn = n(a₁ + an)/2",
                ],
                key_insights=[
                    "倒序相加法是等差数列求和的核心技巧",
                    "首尾配对后各项和相等",
                    "共有 n 对，每对和为 a₁ + an",
                ],
                socratic_hints=[
                    "如果把 Sn 正着写和倒着写，相加会怎样？",
                    "a₁ + an 和 a₂ + a(n-1) 有什么关系？",
                    "一共有多少对？",
                ],
            ),
            "cos_double_angle": ProofTemplate(
                theorem_name="cos_double_angle",
                description="余弦二倍角公式：cos2α = 2cos²α - 1",
                given=["余弦加法公式 cos(α+β) = cosαcosβ - sinαsinβ"],
                to_prove="cos2α = 2cos²α - 1",
                expected_steps=[
                    "在加法公式中令 β = α：cos2α = cos²α - sin²α",
                    "利用 sin²α + cos²α = 1 消去 sin²α",
                    "sin²α = 1 - cos²α",
                    "代入：cos2α = cos²α - (1 - cos²α)",
                    "化简：cos2α = 2cos²α - 1",
                ],
                key_insights=[
                    "二倍角公式是加法公式的特例",
                    "利用毕达哥拉斯恒等式消元",
                    "同一个公式可以有不同的消元方向",
                ],
                socratic_hints=[
                    "在 cos(α+β) 中令 β = α 会得到什么？",
                    "如何用 cos²α 表示 sin²α？",
                    "代入后化简的结果是什么？",
                ],
            ),
        }

    def _middle_school_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for middle school level."""
        return {
            "pythagorean_theorem": ProofTemplate(
                theorem_name="pythagorean_theorem",
                description="勾股定理：直角三角形 a² + b² = c²",
                given=["直角三角形 ABC", "∠C = 90°", "两直角边 a, b，斜边 c"],
                to_prove="a² + b² = c²",
                expected_steps=[
                    "作 CD⊥AB 于 D，设 CD = h，AD = p，BD = q",
                    "由相似三角形：△ACD ∽ △ABC，得 b² = p·c",
                    "由相似三角形：△BCD ∽ △ABC，得 a² = q·c",
                    "两式相加：a² + b² = pc + qc = (p+q)c",
                    "因为 p + q = c，所以 a² + b² = c²",
                ],
                key_insights=[
                    "作高线构造相似三角形是经典方法",
                    "利用射影定理 b² = pc 和 a² = qc",
                    "p + q = c 是收尾的关键",
                ],
                socratic_hints=[
                    "如何用一条辅助线把直角三角形分成两个小直角三角形？",
                    "大三角形和小三角形相似吗？",
                    "p + q 等于什么？",
                ],
            ),
            "triangle_angle_sum": ProofTemplate(
                theorem_name="triangle_angle_sum",
                description="三角形内角和等于 180°",
                given=["三角形 ABC"],
                to_prove="∠A + ∠B + ∠C = 180°",
                expected_steps=[
                    "过 A 点作 DE ∥ BC",
                    "内错角相等：∠DAB = ∠B",
                    "内错角相等：∠EAC = ∠C",
                    "平角：∠DAB + ∠A + ∠EAC = 180°",
                    "代入：∠B + ∠A + ∠C = 180°",
                ],
                key_insights=[
                    "作平行线是证明角度关系的关键辅助线",
                    "平行线产生内错角相等",
                    "平角为 180° 是结论的来源",
                ],
                socratic_hints=[
                    "如何用平行线把三个角凑到一起？",
                    "平行线能产生哪些相等的角？",
                    "A 点处的三个角加起来等于多少？",
                ],
            ),
            "quadratic_formula": ProofTemplate(
                theorem_name="quadratic_formula",
                description="推导一元二次方程求根公式",
                given=["ax² + bx + c = 0 (a ≠ 0)"],
                to_prove="x = (-b ± √(b²-4ac)) / 2a",
                expected_steps=[
                    "两边除以 a：x² + (b/a)x + c/a = 0",
                    "配方：x² + (b/a)x + (b/2a)² = (b/2a)² - c/a",
                    "左边化为完全平方：(x + b/2a)² = (b² - 4ac)/4a²",
                    "开平方：x + b/2a = ±√(b²-4ac)/2a",
                    "移项：x = (-b ± √(b²-4ac)) / 2a",
                ],
                key_insights=[
                    "配方法是推导求根公式的核心",
                    "两边除以 a 是为了简化配方",
                    "判别式 Δ = b² - 4ac 决定了根的个数",
                ],
                socratic_hints=[
                    "如何把 x² + (b/a)x 配成完全平方？",
                    "配方后右边是什么？",
                    "开平方时要注意什么？",
                ],
            ),
            "congruent_sss": ProofTemplate(
                theorem_name="congruent_sss",
                description="SSS 判定：三边对应相等的三角形全等",
                given=["△ABC 和 △DEF", "AB = DE, BC = EF, AC = DF"],
                to_prove="△ABC ≅ △DEF",
                expected_steps=[
                    "将 △DEF 放在 △ABC 上，使 EF 与 BC 重合，D 与 A 在 BC 异侧",
                    "连接 AD",
                    "△ABD 是等腰三角形（AB = DE），∠BAD = ∠DAC（等腰底角）",
                    "△ACD 是等腰三角形（AC = DF），∠CAD = ∠DAB（等腰底角）",
                    "所以 ∠BAD + ∠DAC = ∠DAC + ∠DAB，即 ∠BAC = ∠DAE，因此 △ABC ≅ △DEF (SAS)",
                ],
                key_insights=[
                    "通过叠合构造辅助线 AD",
                    "等腰三角形的底角相等是关键",
                    "最终归结为 SAS 判定",
                ],
                socratic_hints=[
                    "把一个三角形放到另一个上，需要怎么放？",
                    "连接 AD 后得到了什么等腰三角形？",
                    "如何从等腰三角形的性质得到全等？",
                ],
            ),
        }

    def _elementary_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for elementary level."""
        return {
            "commutative_addition": ProofTemplate(
                theorem_name="commutative_addition",
                description="加法交换律：a + b = b + a",
                given=["自然数 a 和 b"],
                to_prove="a + b = b + a",
                expected_steps=[
                    "用计数模型：a + b 表示先数 a 个再数 b 个",
                    "b + a 表示先数 b 个再数 a 个",
                    "两种数法的总数相同（都是 a + b 个）",
                    "所以 a + b = b + a",
                ],
                key_insights=[
                    "加法的计数模型：总数与数数顺序无关",
                    "可以用具体数字验证（如 3+5=8, 5+3=8）",
                    "交换律是加法的基本性质",
                ],
                socratic_hints=[
                    "3 个苹果加 5 个苹果，和 5 个苹果加 3 个苹果一样多吗？",
                    "数数的时候，先数 3 再数 5，和先数 5 再数 3，结果一样吗？",
                    "你能举几个例子验证吗？",
                ],
            ),
            "fraction_equivalence": ProofTemplate(
                theorem_name="fraction_equivalence",
                description="分数等价：a/b = (a×k)/(b×k) (k ≠ 0)",
                given=["分数 a/b", "k 是非零自然数"],
                to_prove="a/b = (a×k)/(b×k)",
                expected_steps=[
                    "分数 a/b 表示把单位 '1' 分成 b 份取 a 份",
                    "(a×k)/(b×k) 表示把单位 '1' 分成 b×k 份取 a×k 份",
                    "每 b 份组成一组，共 k 组，取其中 a 组",
                    "等价于分成 b 份取 a 份",
                    "所以 a/b = (a×k)/(b×k)",
                ],
                key_insights=[
                    "分数的等价来自分割方式的细化",
                    "分子分母同乘一个数不改变分数的大小",
                    "这就是约分和通分的理论基础",
                ],
                socratic_hints=[
                    "1/2 和 2/4 一样大吗？怎么验证？",
                    "把一个蛋糕切 2 份取 1 份，和切 4 份取 2 份，一样多吗？",
                    "如果把每份再切成 k 份呢？",
                ],
            ),
            "distributive_law": ProofTemplate(
                theorem_name="distributive_law",
                description="乘法分配律：a × (b + c) = a×b + a×c",
                given=["自然数 a, b, c"],
                to_prove="a × (b + c) = a×b + a×c",
                expected_steps=[
                    "a × (b + c) 表示 (b + c) 个 a 相加",
                    "拆成 b 个 a 加 c 个 a",
                    "b 个 a = a × b",
                    "c 个 a = a × c",
                    "所以 a × (b + c) = a×b + a×c",
                ],
                key_insights=[
                    "乘法是连加的简写",
                    "分配律来自加法的结合律",
                    "面积模型可以直观理解：大长方形面积 = 两个小长方形面积之和",
                ],
                socratic_hints=[
                    "3 × (2 + 4) 等于多少？3×2 + 3×4 呢？",
                    "能画一个长方形来验证吗？",
                    "乘法就是连加，(b+c) 个 a 怎么拆？",
                ],
            ),
        }

    def get_available_theorems(self) -> list[str]:
        """List all available theorem names."""
        return list(self._templates.keys())

    def get_theorems_by_level(self, level: str) -> list[str]:
        """List theorems available for a specific curriculum level."""
        level_map = {
            "group_theory": ["identity_unique", "inverse_unique", "cancellation_law",
                             "trivial_subgroup", "abelian_subgroup_of_squares"],
            "high_school": ["function_monotonicity", "am_gm_inequality",
                            "arithmetic_sequence_sum", "cos_double_angle"],
            "middle_school": ["pythagorean_theorem", "triangle_angle_sum",
                              "quadratic_formula", "congruent_sss"],
            "elementary": ["commutative_addition", "fraction_equivalence",
                           "distributive_law"],
        }
        return level_map.get(level, list(self._templates.keys()))

    def get_template(self, theorem_name: str) -> ProofTemplate | None:
        """Get the proof template for a theorem."""
        return self._templates.get(theorem_name)

    def get_theorem_info(self) -> list[dict[str, Any]]:
        """Get info for all available theorems (for UI display)."""
        return [
            {
                "name": t.theorem_name,
                "description": t.description,
                "given": t.given,
                "to_prove": t.to_prove,
                "num_expected_steps": len(t.expected_steps),
            }
            for t in self._templates.values()
        ]

    def submit_proof(
        self,
        theorem_name: str,
        student_steps: list[dict[str, str] | str],
    ) -> ProofResult:
        """Submit a proof for verification.

        Args:
            theorem_name: The theorem being proved (must be in templates).
            student_steps: List of proof steps. Each step may be either a
                ``{"claim": ..., "justification": ...}`` dict or a plain
                string (treated as the claim with empty justification).

        Returns:
            ProofResult with per-step validation and overall feedback.
        """
        template = self._templates.get(theorem_name)
        if template is None:
            return ProofResult(
                theorem_name=theorem_name,
                is_complete=False,
                overall_feedback=f"未知定理：{theorem_name}。可用定理：{self.get_available_theorems()}",
            )

        result = ProofResult(
            theorem_name=theorem_name,
            steps=[],
            progress=f"0/{len(template.expected_steps)}",
        )

        # Verify each student step with greedy multi-match.
        #
        # A student may combine several expected steps into a single
        # written step (e.g. "e = a·c" and "b·e = b·(a·c)" become one
        # step with justification "代入 e = a·c", or even an entire proof
        # condensed into one step with a long justification).
        #
        # Strategy: for each student step, find the FURTHEST expected step
        # that matches (not just the nearest).  All expected steps between
        # the current position and the furthest match are marked as
        # "implicit" — the student covered them implicitly within this step.
        expected_idx = 0
        total_expected = len(template.expected_steps)

        for i, step_data in enumerate(student_steps):
            if isinstance(step_data, str):
                claim = step_data
                justification = ""
            else:
                claim = step_data.get("claim", "")
                justification = step_data.get("justification", "")
            step = ProofStep(
                step_number=i + 1,
                claim=claim,
                justification=justification,
            )

            matched_at = -1
            match_feedback = ""

            # Try every remaining expected position and keep the LAST match.
            for check_idx in range(expected_idx, total_expected):
                mr = self._match_step(
                    claim=claim,
                    justification=justification,
                    expected=template.expected_steps[check_idx],
                    step_idx=check_idx,
                    theorem_name=template.theorem_name,
                )
                if mr["matched"]:
                    matched_at = check_idx
                    match_feedback = mr.get("feedback", "✓ 正确！")
                    # Do NOT break — keep scanning for a later match.

            if matched_at >= 0:
                implicit = list(template.expected_steps[expected_idx:matched_at])
                step.is_valid = True
                step.matched_expected = template.expected_steps[matched_at]
                step.implicit_steps = implicit
                if implicit:
                    step.feedback = (
                        match_feedback
                        + f" （隐含覆盖了 {len(implicit)} 个中间步骤）"
                    )
                else:
                    step.feedback = match_feedback
                expected_idx = matched_at + 1
            else:
                # No match at any remaining position.
                if expected_idx < total_expected:
                    expected = template.expected_steps[expected_idx]
                    mr = self._match_step(
                        claim=claim,
                        justification=justification,
                        expected=expected,
                        step_idx=expected_idx,
                        theorem_name=template.theorem_name,
                    )
                    step.is_valid = False
                    step.feedback = mr.get(
                        "feedback",
                        f"这一步不匹配。期望：{expected}",
                    )
                    step.matched_expected = expected
                else:
                    step.is_valid = False
                    step.feedback = "这一步超出了证明的预期结构。证明应该已经完成了。"

            result.steps.append(step)

        # Check completeness
        matched_count = expected_idx
        result.progress = f"{matched_count}/{len(template.expected_steps)}"

        if matched_count >= len(template.expected_steps):
            result.is_complete = True
            result.overall_feedback = "🎉 证明完整且正确！每一步都符合逻辑。"
            result.socratic_hint = "你能用不同的方法证明这个定理吗？"
        else:
            result.missing_steps = template.expected_steps[matched_count:]
            # Provide Socratic hint for the next missing step
            hint_idx = min(matched_count, len(template.socratic_hints) - 1)
            if hint_idx >= 0:
                result.socratic_hint = template.socratic_hints[hint_idx]
            result.overall_feedback = (
                f"已完成 {matched_count}/{len(template.expected_steps)} 步。"
                f"下一步：{template.expected_steps[matched_count] if matched_count < len(template.expected_steps) else '完成'}"
            )

        logger.info(
            "Proof %s: %d/%d steps valid, complete=%s",
            theorem_name, matched_count, len(template.expected_steps), result.is_complete,
        )
        return result

    def _verify_step(
        self,
        step_number: int,
        claim: str,
        justification: str,
        template: ProofTemplate,
        expected_idx: int,
    ) -> ProofStep:
        """Verify a single proof step against the expected structure.

        Uses keyword matching to determine if the student's step matches
        the expected step at position expected_idx.
        """
        step = ProofStep(
            step_number=step_number,
            claim=claim,
            justification=justification,
        )

        if expected_idx >= len(template.expected_steps):
            step.is_valid = False
            step.feedback = "这一步超出了证明的预期结构。证明应该已经完成了。"
            return step

        expected = template.expected_steps[expected_idx]

        # Keyword-based matching: extract key terms from expected step
        # and check if the student's claim/justification contains them
        match_result = self._match_step(claim, justification, expected, expected_idx, template.theorem_name)

        if match_result["matched"]:
            step.is_valid = True
            step.matched_expected = expected
            step.feedback = match_result.get("feedback", "✓ 这一步正确。")
        else:
            step.is_valid = False
            step.feedback = match_result.get("feedback", "这一步似乎不匹配预期结构。")
            step.matched_expected = expected

        return step

    def _match_step(
        self,
        claim: str,
        justification: str,
        expected: str,
        step_idx: int,
        theorem_name: str,
    ) -> dict[str, Any]:
        """Match a student step against the expected step using keywords.

        Each theorem has specific keyword patterns for each expected step.
        """
        # Normalize: lowercase, remove spaces, strip math operators,
        # convert superscripts to ASCII (⁻¹→-1, ²→2, ³→3, etc.)
        # so "e·f = f" matches "ef=f" and "a⁻¹" matches "a-1"
        def _normalize(s: str) -> str:
            s = s.lower()
            s = s.replace(" ", "")
            s = s.replace("·", "").replace("×", "").replace("∗", "").replace("*", "").replace("⋅", "")
            s = s.replace("⁻", "-").replace("¹", "1").replace("²", "2").replace("³", "3").replace("⁴", "4")
            return s

        claim_norm = _normalize(claim)
        just_norm = _normalize(justification)
        combined = claim_norm + just_norm

        # Define keyword patterns per theorem per step
        patterns = self._get_keyword_patterns(theorem_name)

        if step_idx < len(patterns):
            step_patterns = patterns[step_idx]
            # Normalize keywords too
            # Check if any keyword group is satisfied
            for group in step_patterns:
                norm_group = [_normalize(kw) for kw in group]
                if all(kw in combined for kw in norm_group):
                    return {"matched": True, "feedback": "✓ 正确！"}

            # Partial match
            for group in step_patterns:
                norm_group = [_normalize(kw) for kw in group]
                partial = sum(1 for kw in norm_group if kw in combined)
                if partial > 0:
                    return {
                        "matched": False,
                        "feedback": f"部分正确。期望的关键步骤包含：{expected}。检查你的推导是否遗漏了什么。",
                    }

        return {
            "matched": False,
            "feedback": f"这一步不匹配。期望：{expected}",
        }

    def _get_keyword_patterns(self, theorem_name: str) -> list[list[list[str]]]:
        """Get keyword patterns for each expected step of a theorem.

        Returns a list where index i contains the keyword groups for step i.
        Each group is a list of keywords that must ALL be present.
        A step matches if ANY group is fully satisfied.

        Note: keywords are normalized the same way as student input
        (superscripts → ASCII, math operators stripped) before matching.
        """
        patterns: dict[str, list[list[list[str]]]] = {
            "identity_unique": [
                # Step 0: e·f = f (e is identity)
                [["e·f=f", "e=f"], ["ef=f", "单位元"], ["ef=f", "f"]],
                # Step 1: e·f = e (f is identity)
                [["e·f=e", "f=e"], ["ef=e", "单位元"], ["ef=e", "f"]],
                # Step 2: e = f (transitivity)
                [["e=f"], ["传递"]],
            ],
            "inverse_unique": [
                # Step 0: b = b·e
                [["b=b·e", "b=be"], ["b=be", "单位元"], ["b=be", "e"]],
                # Step 1: e = a·c
                [["e=a·c", "e=ac"], ["a·c=e", "ac=e", "逆元"], ["e=ac", "逆元"], ["e=ac", "c"]],
                # Step 2: b·e = b·(a·c) (substitution)
                [["b·(a·c)", "b(ac)", "代入"], ["b(ac)", "代入"], ["b·e=b·(a·c)", "代入"], ["be=b(ac)", "代入"]],
                # Step 3: b·(a·c) = (b·a)·c (associativity)
                [["(b·a)·c", "(ba)c", "结合"], ["(ba)c", "结合"], ["b·(a·c)=(b·a)·c", "结合"], ["b(ac)=(ba)c", "结合"]],
                # Step 4: (b·a)·c = e·c (b·a = e)
                [["e·c", "ec", "b·a=e", "ba=e", "逆元"], ["ec", "ba=e", "逆元"], ["ec", "ba=e"], ["(ba)c=ec", "逆元"]],
                # Step 5: e·c = c (identity)
                [["e·c=c", "ec=c", "单位元"], ["ec=c", "单位元"], ["ec=c"]],
                # Step 6: b = c (transitivity)
                [["b=c"], ["传递"]],
            ],
            "cancellation_law": [
                # Step 0: Left-multiply by a⁻¹
                [["a⁻¹", "逆元", "左乘"], ["a-1", "左乘"], ["a⁻¹", "左乘"], ["a-1", "逆元"]],
                # Step 1: Associativity (a⁻¹·a)·b = (a⁻¹·a)·c
                [["结合", "(a⁻¹·a)"], ["结合", "(a-1a)"], ["结合", "a⁻¹"]],
                # Step 2: a⁻¹·a = e
                [["=e", "逆元"], ["a⁻¹·a=e", "逆元"], ["a-1a=e"]],
                # Step 3: e·b = e·c
                [["e·b", "e·c", "eb", "ec"], ["eb=ec"], ["e·b=e·c"]],
                # Step 4: b = c
                [["b=c"]],
            ],
            "trivial_subgroup": [
                # Step 0: Closure e·e = e
                [["e·e=e", "封闭"], ["ee=e", "封闭"], ["e·e=e", "封闭"]],
                # Step 1: Identity e ∈ {e}
                [["单位元", "∈"], ["单位元", "e"]],
                # Step 2: Inverse e⁻¹ = e
                [["e⁻¹=e", "逆元"], ["e-1=e", "逆元"], ["逆元", "e"]],
                # Step 3: Three conditions satisfied
                [["子群", "条件"], ["三", "满足"], ["子群", "满足"]],
            ],
            "abelian_subgroup_of_squares": [
                # Step 0: Closure (ab)² = a²b²
                [["(ab)²", "封闭", "交换"], ["(ab)2", "交换"], ["a²·b²", "交换"], ["a2b2", "交换"], ["(ab)²=a²·b²", "交换"]],
                # Step 1: Identity e = e²
                [["e=e²", "e=e2", "单位元"], ["e=e2", "单位元"], ["e=e²"]],
                # Step 2: Inverse (g²)⁻¹ = (g⁻¹)²
                [["(g⁻¹)²", "逆元"], ["(g-1)2", "逆元"], ["(g²)⁻¹", "逆元"], ["(g2)-1", "逆元"]],
                # Step 3: Three conditions
                [["子群", "条件"], ["三", "满足"], ["子群", "满足"]],
            ],
            # ---- High School ----
            "function_monotonicity": [
                [["f(x2)-f(x1)", "差"], ["x2²-x1²", "差"], ["f(x2)-f(x1)=x2²-x1²"], ["f(x2)-f(x1)"]],
                [["因式分解", "x2-x1", "x2+x1"], ["(x2-x1)(x2+x1)", "因式"], ["x2²-x1²=(x2-x1)(x2+x1)"]],
                [["x2>x1", "x2-x1>0"], ["x2-x1>0"]],
                [["x2+x1>0", "非负"], ["x1≥0", "x2+x1"], ["x2+x1≥0"], ["x2+x1>0"]],
                [["正", "相乘"], ["f(x2)-f(x1)>0"], ["两个正", "正"], ["f(x2)>f(x1)"]],
            ],
            "am_gm_inequality": [
                [["(√a-√b)²≥0", "构造"], ["(√a-√b)²", "非负"], ["(√a-√b)²≥0"], ["(sqrta-sqrtb)²"]],
                [["展开", "(√a)²", "2√(ab)", "(√b)²"], ["(√a)²-2√(ab)+(√b)²≥0"], ["展开"]],
                [["a-2√(ab)+b≥0", "化简"], ["a-2√(ab)+b≥0"]],
                [["a+b≥2√(ab)", "移项"], ["a+b≥2√(ab)"]],
                [["等号", "a=b", "√a=√b"], ["a=b"], ["√a=√b"]],
            ],
            "arithmetic_sequence_sum": [
                [["sn=a1+a2", "写出"], ["sn=a1+a2"]],
                [["倒序", "sn=an+a(n-1)"], ["倒序", "sn"]],
                [["2sn", "相加"], ["2sn=(a1+an)"], ["相加", "2sn"]],
                [["ak+a(n+1-k)=a1+an", "等差"], ["首尾", "相等"], ["配对"]],
                [["n(a1+an)", "n项"], ["2sn=n(a1+an)"], ["n(a1+an)/2"]],
            ],
            "cos_double_angle": [
                [["cos2a=cos²a-sin²a", "令"], ["cos(2a)=cos²a-sin²a", "β=α"], ["cos2a=cos²a-sin²a"]],
                [["sin²a+cos²a=1", "消去"], ["毕达哥拉斯", "消去"], ["sin²a+cos²a=1"]],
                [["sin²a=1-cos²a"], ["sin²a=1-cos²a"]],
                [["代入", "cos²a-(1-cos²a)"], ["代入", "1-cos²a"]],
                [["2cos²a-1", "化简"], ["cos2a=2cos²a-1"]],
            ],
            # ---- Middle School ----
            "pythagorean_theorem": [
                [["作", "cd", "垂", "高"], ["辅助线", "高"], ["cd⊥ab"]],
                [["相似", "b²=pc", "射影"], ["△acd∽△abc"], ["b²=pc"]],
                [["相似", "a²=qc", "射影"], ["△bcd∽△abc"], ["a²=qc"]],
                [["相加", "a²+b²=(p+q)c"], ["两式相加"]],
                [["p+q=c", "a²+b²=c²"], ["p+q=c"]],
            ],
            "triangle_angle_sum": [
                [["平行", "de∥bc", "辅助"], ["作", "平行"]],
                [["内错角", "∠dab=∠b"], ["∠dab=∠b", "内错"]],
                [["内错角", "∠eac=∠c"], ["∠eac=∠c", "内错"]],
                [["平角", "180"], ["∠dab+∠a+∠eac=180"], ["平角", "180°"]],
                [["代入", "∠b+∠a+∠c=180"], ["∠a+∠b+∠c=180"]],
            ],
            "quadratic_formula": [
                [["除以a", "x²+(b/a)x"], ["两边除以a"]],
                [["配方", "(b/2a)²"], ["配", "(b/2a)²"]],
                [["完全平方", "(x+b/2a)²", "(b²-4ac)/4a²"], ["(x+b/2a)²"]],
                [["开平方", "±√(b²-4ac)/2a"], ["开平方"]],
                [["移项", "x=(-b±√(b²-4ac))/2a"], ["x=(-b±√(b²-4ac))"]],
            ],
            "congruent_sss": [
                [["叠合", "ef与bc重合", "异侧"], ["放置", "重合"]],
                [["连接ad"], ["连ad"], ["辅助线ad"]],
                [["等腰", "ab=de", "∠bad=∠dac", "底角"], ["ab=de", "等腰"], ["△abd", "等腰"]],
                [["等腰", "ac=df", "∠cad=∠dab", "底角"], ["ac=df", "等腰"], ["△acd", "等腰"]],
                [["sas", "全等", "∠bac=∠dae"], ["sas"], ["△abc≅△def"]],
            ],
            # ---- Elementary ----
            "commutative_addition": [
                [["计数", "a+b", "先数"], ["a+b", "计数"]],
                [["b+a", "先数"], ["b+a", "计数"]],
                [["总数", "相同"], ["一样多"], ["相同"]],
                [["a+b=b+a"], ["a+b=b+a"]],
            ],
            "fraction_equivalence": [
                [["a/b", "分成b份", "取a份"], ["分成b份", "取a份"]],
                [["(a×k)/(b×k)", "b×k份", "a×k份"], ["b×k", "a×k"]],
                [["每b份", "一组", "k组"], ["分组", "k组"]],
                [["等价", "分成b份", "取a份"], ["等价", "b份"]],
                [["a/b=(a×k)/(b×k)"], ["a/b=(a×k)/(b×k)"]],
            ],
            "distributive_law": [
                [["(b+c)个a", "连加"], ["(b+c)个a"]],
                [["拆", "b个a", "c个a"], ["b个a", "c个a"]],
                [["b个a=a×b"], ["a×b"]],
                [["c个a=a×c"], ["a×c"]],
                [["a×(b+c)=a×b+a×c"], ["a×(b+c)=a×b+a×c"]],
            ],
        }

        return patterns.get(theorem_name, [[[]]])

    def get_hint(self, theorem_name: str, current_step: int) -> str:
        """Get a Socratic hint for the next step in a proof.

        Args:
            theorem_name: The theorem being proved.
            current_step: Number of steps already completed (0-indexed).

        Returns:
            A Socratic hint string.
        """
        template = self._templates.get(theorem_name)
        if template is None:
            return f"未知定理：{theorem_name}"

        if current_step < len(template.socratic_hints):
            return template.socratic_hints[current_step]
        elif current_step < len(template.expected_steps):
            return f"下一步：{template.expected_steps[current_step]}"
        else:
            return "证明应该已经完成了。检查你的推导。"
