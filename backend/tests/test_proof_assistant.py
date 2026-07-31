"""Tests for the proof assistant (``mathweaver/proof/assistant.py``).

Covers:
- All 34 theorem templates load (5 group-theory, 4 high-school,
  4 middle-school, 3 elementary, 3 calculus, 3 linear-algebra,
  3 discrete-math, 3 number-theory, 3 physics, 3 chemistry).
- ``submit_proof`` for a correct proof of every theorem (parametrised).
- ``submit_proof`` edge cases: partial proof, merged student steps
  (greedy multi-match), empty steps, extra/unexpected steps.
- ``get_theorems_by_level`` for all ten curriculum levels.
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
    "calculus": [
        "power_rule",
        "ftc_part1",
        "chain_rule",
    ],
    "linear_algebra": [
        "rank_nullity",
        "dim_invariance",
        "independence_implies_unique",
    ],
    "discrete_math": [
        "handshake_lemma",
        "tree_n_minus_1_edges",
        "bfs_shortest_path",
    ],
    "number_theory": [
        "euclid_infinite_primes",
        "euclid_lemma",
        "fermat_little_theorem",
    ],
    "physics": [
        "kinematic_equations",
        "work_energy_theorem",
        "shm_equation",
    ],
    "chemistry": [
        "half_life_first_order",
        "equilibrium_constant",
        "huckel_benzene",
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
        {"claim": "叠合放置：EF 与 BC 重合，E→B, F→C，D 在异侧", "justification": ""},
        {"claim": "连接 AD，此时 AB = DB 且 AC = DC", "justification": "辅助线"},
        {"claim": "△ABD 是等腰三角形，AB = DB，底角 ∠BAD = ∠BDA", "justification": "底角相等"},
        {"claim": "△ACD 是等腰三角形，AC = DC，底角 ∠CAD = ∠CDA", "justification": "底角相等"},
        {"claim": "相加：∠BAC = ∠BAD + ∠DAC = ∠BDA + ∠CDA = ∠BDC", "justification": "等量代换"},
        {"claim": "由 SAS（AB = DB, AC = DC, 夹角 ∠BAC = ∠BDC），△ABC ≅ △DBC", "justification": "SAS 全等判定"},
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
    # -- Calculus --
    "power_rule": [
        {"claim": "f'(x) = lim [(x+h)ⁿ - xⁿ] / h，二项式展开 (x+h)ⁿ", "justification": "极限定义"},
        {"claim": "(x+h)ⁿ 展开 Σ C(n,k) xⁿ⁻ᵏ hᵏ", "justification": "二项式定理"},
        {"claim": "(x+h)ⁿ - xⁿ = n·xⁿ⁻¹·h + O(h²)", "justification": "取 k≥1"},
        {"claim": "除以 h：n·xⁿ⁻¹ + O(h)", "justification": "除法"},
        {"claim": "取极限 f'(x) = n·xⁿ⁻¹", "justification": "h→0"},
    ],
    "ftc_part1": [
        {"claim": "F'(x) = lim [F(x+h) - F(x)] / h", "justification": "导数定义"},
        {"claim": "F(x+h) - F(x) = ∫ₓ^{x+h} f(t) dt", "justification": "积分性质"},
        {"claim": "由积分中值定理 ∫ₓ^{x+h} f(t) dt = f(c)·h", "justification": "中值定理"},
        {"claim": "[F(x+h) - F(x)] / h = f(c)", "justification": "除法"},
        {"claim": "h→0 时 c→x，f(c) → f(x)，F'(x) = f(x)", "justification": "连续性"},
    ],
    "chain_rule": [
        {"claim": "h'(x) = lim [f(g(x+Δx)) - f(g(x))] / Δx", "justification": "导数定义"},
        {"claim": "令 Δg = g(x+Δx) - g(x)", "justification": "中间变量"},
        {"claim": "[f(g(x)+Δg) - f(g(x))] / Δg · Δg/Δx", "justification": "引入 Δg"},
        {"claim": "Δx→0 时 Δg→0，第一项 → f'(g(x))", "justification": "可导连续"},
        {"claim": "第二项 Δg/Δx → g'(x)，h'(x) = f'(g(x))·g'(x)", "justification": "导数"},
    ],
    # -- Linear Algebra --
    "rank_nullity": [
        {"claim": "设 ker(T) 的基为 v₁,...,v_k，nullity(T) = k", "justification": ""},
        {"claim": "将 ker(T) 的基扩充为 V 的基 v₁,...,v_k,w₁,...,w_{n-k}", "justification": "基扩充"},
        {"claim": "T(w₁),...,T(w_{n-k}) 线性无关：Σ cᵢ T(wᵢ) = 0 则 Σ cᵢ wᵢ ∈ ker(T)", "justification": "线性无关"},
        {"claim": "由基的线性无关性 cᵢ = 0", "justification": "线性无关"},
        {"claim": "生成：T(v) = Σ bⱼ T(wⱼ)", "justification": "生成"},
        {"claim": "rank(T) = n - k = n - nullity(T)", "justification": "结论"},
    ],
    "dim_invariance": [
        {"claim": "B₁ 生成 V 且 B₂ 线性无关，由替换定理 m ≤ n", "justification": "替换定理"},
        {"claim": "B₂ 生成 V 且 B₁ 线性无关，由替换定理 n ≤ m", "justification": "替换定理"},
        {"claim": "所以 n = m", "justification": "双向不等式"},
    ],
    "independence_implies_unique": [
        {"claim": "两个表示相减：Σ (aᵢ - bᵢ) vᵢ = 0", "justification": "相减"},
        {"claim": "由线性无关性：aᵢ - bᵢ = 0", "justification": "线性无关"},
        {"claim": "所以 aᵢ = bᵢ", "justification": "结论"},
    ],
    # -- Discrete Math --
    "handshake_lemma": [
        {"claim": "每条边 e = {u, w} 对 deg(u) 贡献 1，对 deg(w) 贡献 1", "justification": "双重计数"},
        {"claim": "每条边对度数之和贡献 2", "justification": ""},
        {"claim": "所有边贡献完毕：Σ deg(v) = 2|E|", "justification": "结论"},
    ],
    "tree_n_minus_1_edges": [
        {"claim": "对顶点数 n 归纳", "justification": "归纳法"},
        {"claim": "n=1 时：单顶点无边，0 = 1-1 ✓", "justification": "基础"},
        {"claim": "假设 n=k 时成立。取 n=k+1 的树 T", "justification": "归纳假设"},
        {"claim": "树无圈 ⟹ 存在度数为 1 的叶子节点 v", "justification": "叶子"},
        {"claim": "删除 v 得到 k 个顶点的树 T'", "justification": "删除叶子"},
        {"claim": "由归纳假设 T' 有 k-1 条边", "justification": "归纳"},
        {"claim": "T 有 k 条边 = (k+1)-1 ✓", "justification": "结论"},
    ],
    "bfs_shortest_path": [
        {"claim": "BFS 按层扩展：第 0 层 = {s}，第 k 层 = 与第 k-1 层相邻但未访问", "justification": "BFS"},
        {"claim": "设 d(v) 为 BFS 给出的层数，δ(v) 为真实最短距离", "justification": ""},
        {"claim": "对 d(v) 归纳：d(v) = k ⟹ δ(v) = k", "justification": "归纳"},
        {"claim": "基础：d(s) = 0 = δ(s) ✓", "justification": "基础"},
        {"claim": "δ(v) ≤ k：BFS 通过第 k-1 层到达 v", "justification": "上界"},
        {"claim": "δ(v) ≥ k：若更短路径存在则 v 在 < k 层被访问，矛盾", "justification": "下界"},
        {"claim": "所以 d(v) = δ(v) = k，BFS 给出最短路径", "justification": "结论"},
    ],
    # -- Number Theory --
    "euclid_infinite_primes": [
        {"claim": "构造 N = p₁ × p₂ × ... × p_n + 1", "justification": "构造"},
        {"claim": "N > 1，所以 N 至少有一个素因子 q", "justification": ""},
        {"claim": "q 是素数，若 q 在列表中则 q | (p₁×...×p_n)", "justification": ""},
        {"claim": "q | N 且 q | (p₁×...×p_n) ⟹ q | 1，矛盾", "justification": "矛盾"},
        {"claim": "与所有素数都在列表中矛盾，故素数无穷多", "justification": "矛盾"},
    ],
    "euclid_lemma": [
        {"claim": "假设 p ∤ a", "justification": "反证"},
        {"claim": "因为 p 是素数，gcd(p, a) = 1", "justification": ""},
        {"claim": "由 Bezout 定理：存在 x, y 使 px + ay = 1", "justification": "Bezout"},
        {"claim": "两边乘以 b：pbx + aby = b", "justification": ""},
        {"claim": "p | pbx 且 p | aby（因为 p | ab）", "justification": ""},
        {"claim": "所以 p | b", "justification": "结论"},
    ],
    "fermat_little_theorem": [
        {"claim": "先证若 gcd(a,p)=1 则 a^{p-1} ≡ 1 (mod p)", "justification": ""},
        {"claim": "考虑集合 S = {1,...,p-1}，乘以 a 得 aS", "justification": ""},
        {"claim": "aS 的元素互不相同，aS 是 {1,...,p-1} 的排列", "justification": "排列"},
        {"claim": "乘积相等：(p-1)! ≡ a^{p-1}·(p-1)! (mod p)", "justification": ""},
        {"claim": "消去 (p-1)! 得 a^{p-1} ≡ 1 (mod p)", "justification": ""},
        {"claim": "两边乘以 a：a^p ≡ a (mod p)", "justification": "结论"},
    ],
    # -- Physics --
    "kinematic_equations": [
        {"claim": "加速度定义：a = dv/dt = const", "justification": "微分方程"},
        {"claim": "积分：v(t) = at + C，由 v(0) = v₀ 得 C = v₀，v(t) = v₀ + at", "justification": "积分"},
        {"claim": "速度定义：v = dx/dt", "justification": "微分"},
        {"claim": "积分：x(t) = v₀t + ½at² + C'，由 x(0) = x₀ 得 C' = x₀", "justification": "积分"},
        {"claim": "所以 x(t) = x₀ + v₀t + ½at²", "justification": "结论"},
    ],
    "work_energy_theorem": [
        {"claim": "牛顿第二定律：F = ma = m·dv/dt", "justification": "牛顿"},
        {"claim": "功的定义：W = ∫F dx = ∫m·(dv/dt) dx", "justification": "功"},
        {"claim": "链式法则：dv/dt = v·(dv/dx)", "justification": "链式法则"},
        {"claim": "代入：W = ∫mv dv", "justification": "代入"},
        {"claim": "积分：W = ½mv₂² - ½mv₁²", "justification": "积分"},
        {"claim": "动能变化量 ΔKE = W_net", "justification": "结论"},
    ],
    "shm_equation": [
        {"claim": "牛顿第二定律：m·d²x/dt² = -kx", "justification": "牛顿"},
        {"claim": "改写：d²x/dt² + (k/m)x = 0，令 ω² = k/m", "justification": ""},
        {"claim": "特征方程 r² + ω² = 0，根为 r = ±iω", "justification": "特征方程"},
        {"claim": "通解：x(t) = A·cos(ωt) + B·sin(ωt) = C·cos(ωt + φ)", "justification": "通解"},
        {"claim": "周期 T = 2π/ω = 2π√(m/k)，ω = √(k/m)", "justification": "周期"},
    ],
    # -- Chemistry --
    "half_life_first_order": [
        {"claim": "分离变量：dC/C = -k dt", "justification": "分离变量"},
        {"claim": "积分：ln(C/C₀) = -kt，C(t) = C₀·e^(-kt)", "justification": "积分"},
        {"claim": "半衰期定义：C(t₁/₂) = C₀/2", "justification": "定义"},
        {"claim": "C₀·e^(-k·t₁/₂) = C₀/2", "justification": "代入"},
        {"claim": "e^(-k·t₁/₂) = 1/2，C₀ 被消去", "justification": "消去 C₀"},
        {"claim": "t₁/₂ = ln2/k（与初始浓度无关）", "justification": "结论"},
    ],
    "equilibrium_constant": [
        {"claim": "平衡条件：正反应速率 = 逆反应速率", "justification": "平衡"},
        {"claim": "k_f·[A]_eq = k_r·[B]_eq，K = [B]/[A] = k_f/k_r", "justification": ""},
        {"claim": "由 Arrhenius 方程：k = A·e^(-Ea/RT)", "justification": "Arrhenius"},
        {"claim": "ΔG° = Ea,f - Ea,r", "justification": "活化能"},
        {"claim": "K = k_f/k_r = e^(-ΔG°/RT)", "justification": "结论"},
        {"claim": "指前因子比已包含在 ΔG° 中", "justification": ""},
    ],
    "huckel_benzene": [
        {"claim": "建立 6×6 久期矩阵 H（对角元 α，相邻非对角元 β）", "justification": ""},
        {"claim": "苯是环状分子，H 是循环矩阵", "justification": "循环矩阵"},
        {"claim": "循环矩阵特征值可用 DFT：ε_j = α + 2β·cos(2πj/6)", "justification": "DFT"},
        {"claim": "j=0: α + 2β；j=1,5: α + β（二重简并）", "justification": "简并"},
        {"claim": "j=2,4: α - β（二重简并）；j=3: α - 2β", "justification": "简并"},
        {"claim": "离域能 = 6α+8β - (6α+6β) = 2β（稳定化）", "justification": "离域能"},
    ],
}


@pytest.fixture()
def pa() -> ProofAssistant:
    return ProofAssistant()


# ---------------------------------------------------------------------------
# Template loading & inventory
# ---------------------------------------------------------------------------

def test_all_templates_loaded(pa: ProofAssistant):
    """Exactly 34 templates should be registered across all ten levels."""
    available = pa.get_available_theorems()
    assert len(available) == 34
    assert sorted(available) == sorted(ALL_THEOREMS)


@pytest.mark.parametrize("level,theorems", list(LEVEL_THEOREMS.items()))
def test_get_theorems_by_level(pa: ProofAssistant, level, theorems):
    """Each curriculum level returns exactly its expected theorem set."""
    result = pa.get_theorems_by_level(level)
    assert sorted(result) == sorted(theorems)


def test_get_theorems_by_level_counts(pa: ProofAssistant):
    """Level counts: 5+4+4+3+3+3+3+3+3+3 = 34."""
    counts = {
        "group_theory": 5,
        "high_school": 4,
        "middle_school": 4,
        "elementary": 3,
        "calculus": 3,
        "linear_algebra": 3,
        "discrete_math": 3,
        "number_theory": 3,
        "physics": 3,
        "chemistry": 3,
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
    assert len(info) == 34  # 5 group + 4 high + 4 middle + 3 elementary
                             # + 3 calculus + 3 linear + 3 discrete
                             # + 3 number + 3 physics + 3 chemistry
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
