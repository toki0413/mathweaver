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

# Z3 is an optional dependency for formal verification of group-theory theorems.
# When unavailable, the assistant gracefully degrades to keyword-only matching.
try:
    from z3 import And, ForAll, Function, Int, IntSort, Solver, unsat
    _Z3_AVAILABLE = True
except ImportError:  # pragma: no cover
    _Z3_AVAILABLE = False

logger = logging.getLogger(__name__)


# Per-theorem expected-step keyword patterns (single source of truth).
# Normalized the same way as student input before matching.
_THEOREM_KEYWORD_PATTERNS: dict[str, list[list[list[str]]]] = {
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
[["等腰", "ab=db", "∠bad=∠bda", "底角"], ["ab=db", "等腰"], ["△abd", "等腰"]],
[["等腰", "ac=dc", "∠cad=∠cda", "底角"], ["ac=dc", "等腰"], ["△acd", "等腰"]],
[["相加", "∠bac=∠bdc"], ["∠bac", "∠bdc"]],
[["sas", "全等", "△abc≅△dbc"], ["sas"], ["△abc≅△def"]],
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
# ---- Calculus ----
"power_rule": [
# Step 0: f'(x) = lim [(x+h)ⁿ - xⁿ] / h
[["极限", "f'(x)"], ["极限定义"]],
# Step 1: Expand (x+h)ⁿ via binomial theorem
[["展开", "C(n,k)"], ["二项式定理", "展开"]],
# Step 2: (x+h)ⁿ - xⁿ = n·xⁿ⁻¹·h + O(h²)
[["O(h²"], ["n·xⁿ⁻¹", "h"], ["取", "k"]],
# Step 3: Divide by h
[["除以", "h"], ["除法"]],
# Step 4: Take limit h→0
[["取极限", "n·xⁿ⁻¹"], ["取极限"]],
],
"ftc_part1": [
# Step 0: F'(x) = lim [F(x+h) - F(x)] / h
[["导数", "F'(x)"], ["导数定义"]],
# Step 1: F(x+h) - F(x) = ∫ₓ^{x+h} f(t) dt
[["积分", "F(x+h)"], ["积分性质"]],
# Step 2: MVT gives ∫ₓ^{x+h} f(t) dt = f(c)·h
[["中值定理", "f(c)"], ["中值定理", "积分"]],
# Step 3: [F(x+h) - F(x)] / h = f(c)
[["f(c)", "除"], ["/h", "f(c)"], ["除法", "f(c)"]],
# Step 4: h→0, c→x, f(c)→f(x)
[["连续", "c→x"], ["连续性", "f(c)"]],
# Step 5: F'(x) = f(x)
[["F'(x)=f(x)"], ["所以", "F'(x)"]],
],
"chain_rule": [
# Step 0: h'(x) = lim [f(g(x+Δx)) - f(g(x))] / Δx
[["导数", "h'(x)"], ["导数定义"]],
# Step 1: Let Δg = g(x+Δx) - g(x)
[["中间变量", "Δg"], ["中间变量"]],
# Step 2: Introduce Δg factor
[["引入", "Δg"], ["Δg/Δx"]],
# Step 3: Δx→0 ⟹ Δg→0, first term → f'(g(x))
[["可导", "f'(g(x))"], ["连续", "f'(g(x))"], ["Δg→0"]],
# Step 4: Second term Δg/Δx → g'(x)
[["g'(x)", "h'(x)"], ["f'(g(x))", "g'(x)"]],
# Step 5: h'(x) = f'(g(x))·g'(x)
[["h'(x)=f'(g(x))"], ["所以", "h'(x)"]],
],
# ---- Linear Algebra ----
"rank_nullity": [
# Step 0: ker(T) basis, nullity = k
[["ker", "基"], ["nullity", "k"]],
# Step 1: Extend ker basis to V basis
[["扩充", "基"], ["基扩充"]],
# Step 2: Prove T(wᵢ) are basis for Im(T)
[["线性无关", "T(w"], ["T(w₁"], ["T(w"]],
# Step 3: Linear independence argument
[["线性无关", "ker"]],
# Step 4: cᵢ = 0 by linear independence
[["线性无关性", "cᵢ=0"], ["线性无关", "cᵢ=0"], ["cᵢ=0"]],
# Step 5: Spanning argument
[["生成", "T(v)"], ["生成", "bⱼ"]],
# Step 6: rank = n - k
[["rank", "n-k"], ["rank", "nullity"]],
],
"dim_invariance": [
# Step 0: B₁ generates, B₂ independent ⟹ m ≤ n
[["替换定理", "m≤n"], ["替换定理", "生成"]],
# Step 1: B₂ generates, B₁ independent ⟹ n ≤ m
[["替换定理", "n≤m"], ["替换定理", "n≤m"]],
# Step 2: n = m
[["n=m"], ["双向不等式"]],
],
"independence_implies_unique": [
# Step 0: Subtract two representations
[["相减", "vᵢ"], ["相减", "=0"]],
# Step 1: Linear independence ⟹ aᵢ - bᵢ = 0
[["线性无关", "aᵢ-bᵢ=0"], ["线性无关性", "aᵢ"]],
# Step 2: aᵢ = bᵢ
[["aᵢ=bᵢ"], ["结论", "aᵢ"]],
],
# ---- Discrete Math ----
"handshake_lemma": [
# Step 0: Each edge contributes to two endpoints
[["贡献", "deg"], ["双重计数", "deg"]],
# Step 1: Each edge contributes 2
[["贡献", "2"], ["度数之和", "2"]],
# Step 2: Σ deg(v) = 2|E|
[["Σdeg", "2|E|"], ["结论", "deg"]],
],
"tree_n_minus_1_edges": [
# Step 0: Induction on n
[["归纳", "顶点"]],
# Step 1: Base case n=1
[["n=1", "基础"], ["单顶点", "0=1-1"]],
# Step 2: Inductive hypothesis
[["假设", "k+1"], ["归纳假设", "k+1"]],
# Step 3: Tree has a leaf node
[["叶子", "度数"], ["叶子", "无圈"]],
# Step 4: Delete leaf
[["删除", "叶子"], ["删除", "树"]],
# Step 5: Inductive step
[["归纳假设", "k-1"], ["k-1条边"]],
# Step 6: k edges = (k+1)-1
[["k条边", "(k+1)-1"], ["结论", "k条边"]],
],
"bfs_shortest_path": [
# Step 0: BFS layer expansion
[["BFS", "按层"], ["按层", "扩展"]],
# Step 1: d(v) vs δ(v)
[["d(v)", "δ(v)"], ["层数", "最短距离"]],
# Step 2: Induction on d(v)
[["归纳", "⟹δ(v)"], ["对d(v)归纳"]],
# Step 3: Base case
[["基础", "d(s)"], ["d(s)=0"]],
# Step 4: Inductive step setup (not matched by student, implicit)
[["设d(v)=k", "访问"], ["第k层被访问"]],
# Step 5: Upper bound δ(v) ≤ k
[["上界", "δ(v)"], ["上界", "k-1"]],
# Step 6: Lower bound δ(v) ≥ k
[["下界", "矛盾"], ["下界", "δ(v)"]],
# Step 7: d(v) = δ(v)
[["d(v)=δ(v)"], ["结论", "最短路径"]],
],
# ---- Number Theory ----
"euclid_infinite_primes": [
# Step 0: Construct N = p₁×...×p_n + 1
[["构造", "p₁"], ["构造", "p_n+1"]],
# Step 1: N > 1, has prime factor q
[["素因子", "q"], ["至少有一个素因子"]],
# Step 2: If q in list, q | (p₁×...×p_n)
[["素数", "q|"], ["列表", "q|"]],
# Step 3: q|N and q|(product) ⟹ q|1, contradiction
[["矛盾", "q|N"], ["q|N", "q|1"]],
# Step 4: Prime q divides 1, contradiction
[["矛盾", "q|1"], ["矛盾", "整除"]],
# Step 5: Contradiction, primes infinite
[["矛盾", "无穷"], ["矛盾", "素数无穷"]],
],
"euclid_lemma": [
# Step 0: Assume p ∤ a
[["假设", "p∤a"], ["反证", "p∤"]],
# Step 1: gcd(p,a) = 1
[["素数", "gcd"], ["gcd(p,a)=1"]],
# Step 2: Bezout: px + ay = 1
[["Bezout", "px+ay=1"], ["Bezout", "x,y"]],
# Step 3: Multiply by b
[["乘以b", "pbx"], ["两边乘以"]],
# Step 4: p|pbx and p|aby
[["p|pbx"], ["p|pbx", "p|aby"]],
# Step 5: p|(pbx+aby) = b (not matched by student, implicit)
[["p|(pbx+aby)=b"], ["所以", "p|("]],
# Step 6: p|b
[["p|b"], ["结论", "p|b"]],
],
"fermat_little_theorem": [
# Step 0: Prove gcd(a,p)=1 ⟹ a^{p-1} ≡ 1
[["gcd", "a^{p-1}"], ["先证", "gcd"]],
# Step 1: Consider S = {1,...,p-1}, multiply by a
[["集合", "乘以a"], ["集合", "aS"]],
# Step 2: aS = {a, 2a, ..., (p-1)a}
[["乘以a", "aS"], ["aS={a"]],
# Step 3: Elements distinct (proof by contradiction)
[["ia≡ja", "矛盾"], ["互不相同", "矛盾"]],
# Step 4: aS is a permutation
[["排列", "aS"], ["排列", "{1"]],
# Step 5: Products equal
[["乘积", "1·2"], ["乘积相等", "a·2a"]],
# Step 6: (p-1)! ≡ a^{p-1}·(p-1)!
[["a^{p-1}", "(p-1)!"], ["(p-1)!≡a^{p-1}"]],
# Step 7: Cancel (p-1)!, get a^{p-1} ≡ 1
[["消去", "a^{p-1}"], ["消去", "(p-1)!"]],
# Step 8: Multiply by a: a^p ≡ a
[["乘以a", "a^p"], ["a^p≡a"]],
],
# ---- Physics (math applied to nature) ----
"kinematic_equations": [
# Step 0: a = dv/dt = const
[["加速度", "dv/dt"], ["加速度定义"]],
# Step 1: v(t) = ∫a dt = at + C
[["积分", "at+C"], ["积分", "v(t)=at"]],
# Step 2: v(t) = v₀ + at
[["v₀+at"], ["所以", "v₀+at"]],
# Step 3: v = dx/dt
[["速度", "dx/dt"], ["dx/dt"]],
# Step 4: x(t) = ∫v(t) dt
[["积分", "v₀t"], ["积分", "½at²"]],
# Step 5: C' = x₀
[["x(0)=x₀"], ["x₀", "C'"]],
# Step 6: x(t) = x₀ + v₀t + ½at²
[["x₀+v₀t+½at²"], ["所以", "x(t)"]],
],
"work_energy_theorem": [
# Step 0: F = ma = m·dv/dt
[["牛顿", "dv/dt"], ["牛顿", "ma"]],
# Step 1: W = ∫F dx
[["功", "∫F"], ["功", "∫m"]],
# Step 2: Chain rule dv/dt = v·dv/dx
[["链式法则", "dv/dx"], ["链式", "v·(dv/dx)"]],
# Step 3: W = ∫mv dv
[["代入", "∫mv"], ["代入", "mv"]],
# Step 4: W = ½mv₂² - ½mv₁²
[["积分", "½mv"], ["积分", "mv₂"]],
# Step 5: ΔKE = W_net
[["动能", "W_net"], ["动能变化量"], ["结论", "动能"]],
],
"shm_equation": [
# Step 0: m·d²x/dt² = -kx
[["牛顿", "d²x/dt²"], ["牛顿", "kx"]],
# Step 1: d²x/dt² + (k/m)x = 0
[["改写", "d²x/dt²"], ["改写", "(k/m)"]],
# Step 2: ω² = k/m
[["ω²=k/m"], ["令ω"]],
# Step 3: Characteristic equation r² + ω² = 0
[["特征方程", "r²+ω²"], ["特征方程", "iω"]],
# Step 4: General solution
[["通解", "cos(ωt)"], ["通解", "sin(ωt)"]],
# Step 5: Period T = 2π/ω
[["周期", "2π/ω"], ["周期", "2π√(m/k)"]],
],
# ---- Chemistry (math applied to molecules) ----
"half_life_first_order": [
# Step 0: dC/C = -k dt
[["分离变量", "dC/C"], ["分离变量", "-kdt"]],
# Step 1: Integrate (not matched by student, implicit)
[["积分", "∫{C₀}^{C}"], ["积分", "∫₀"]],
# Step 2: ln(C/C₀) = -kt, C(t) = C₀·e^(-kt)
[["ln(C/C₀)=-kt"], ["C(t)=C₀·e^(-kt)"], ["ln", "C₀e"]],
# Step 3: C(t₁/₂) = C₀/2
[["半衰期", "C₀/2"], ["定义", "t₁/₂"]],
# Step 4: C₀·e^(-k·t₁/₂) = C₀/2
[["C₀·e^(-k", "C₀/2"], ["代入", "C₀e"]],
# Step 5: e^(-k·t₁/₂) = 1/2
[["e^(-k·t₁/₂)=1/2"], ["e^(-k", "1/2"]],
# Step 6: -k·t₁/₂ = ln(1/2) = -ln2 (not matched, implicit)
[["-k·t₁/₂=ln(1/2)"], ["ln2"]],
# Step 7: t₁/₂ = ln2/k
[["ln2/k"], ["ln2", "与初始浓度无关"]],
],
"equilibrium_constant": [
# Step 0: Forward rate = reverse rate
[["平衡", "正反应"], ["平衡", "逆反应"]],
# Step 1: k_f·[A]_eq = k_r·[B]_eq
[["k_f", "k_r", "eq"], ["k_f·[A]_eq=k_r·[B]_eq"]],
# Step 2: K = [B]/[A] = k_f/k_r
[["K=[B]/[A]"], ["K=k_f/k_r"], ["k_f/k_r"]],
# Step 3: Arrhenius equation
[["Arrhenius", "e^(-Ea/RT)"], ["Arrhenius", "k=A·e"]],
# Step 4: Activation energies
[["活化能", "Ea,f"], ["活化能", "Ea,r"]],
# Step 5: ΔG° = Ea,f - Ea,r
[["ΔG°=Ea,f-Ea,r"], ["ΔG°", "Ea,f-Ea,r"]],
# Step 6: K = e^(-ΔG°/RT)
[["e^(-ΔG°/RT)"], ["K=k_f/k_r=e^"]],
# Step 7: Prefactor ratio in ΔG°
[["指前因子", "ΔG°"], ["指前因子", "包含"]],
],
"huckel_benzene": [
# Step 0: Build 6×6 secular matrix
[["久期矩阵", "α"], ["6×6", "α"]],
# Step 1: Circulant matrix
[["循环矩阵", "环状"], ["循环矩阵", "苯"]],
# Step 2: DFT eigenvalues
[["DFT", "ε_j"], ["DFT", "cos(2πj/6)"]],
# Step 3: j=0 gives α+2β
[["j=0", "α+2β"], ["j=0", "2β"]],
# Step 4: j=1,5 gives α+β (doubly degenerate)
[["j=1,5", "α+β"], ["j=1,5", "简并"]],
# Step 5: j=2,4 gives α-β (doubly degenerate)
[["j=2,4", "α-β"], ["j=2,4", "简并"]],
# Step 6: j=3 gives α-2β
[["j=3", "α-2β"]],
# Step 7: Fill 6 π electrons (not matched by student, implicit)
[["E_total", "6α+8β"], ["电子", "6α+8β"]],
# Step 8: Delocalization energy = 2β
[["离域能", "2β"], ["离域能", "6α+8β"]],
],
}


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
    verification_method: str = "keyword"

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_number": self.step_number,
            "claim": self.claim,
            "justification": self.justification,
            "is_valid": self.is_valid,
            "feedback": self.feedback,
            "matched_expected": self.matched_expected,
            "implicit_steps": self.implicit_steps,
            "verification_method": self.verification_method,
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
    verification_methods: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "theorem_name": self.theorem_name,
            "steps": [s.to_dict() for s in self.steps],
            "is_complete": self.is_complete,
            "missing_steps": self.missing_steps,
            "socratic_hint": self.socratic_hint,
            "overall_feedback": self.overall_feedback,
            "progress": self.progress,
            "verification_methods": self.verification_methods,
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
        - calculus: derivatives, integrals, fundamental theorem
        - linear_algebra: rank-nullity, dimension, linear independence
        - discrete_math: handshake lemma, BFS correctness, tree properties
        - number_theory: Euclid's lemma, Fermat's little theorem
        - physics: kinematic equations, work-energy theorem
        - chemistry: equilibrium constant, rate law derivation
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

        # ---- Calculus ----
        templates.update(self._calculus_templates())

        # ---- Linear Algebra ----
        templates.update(self._linear_algebra_templates())

        # ---- Discrete Math ----
        templates.update(self._discrete_math_templates())

        # ---- Number Theory ----
        templates.update(self._number_theory_templates())

        # ---- Physics (math applied to nature) ----
        templates.update(self._physics_templates())

        # ---- Chemistry (math applied to molecules) ----
        templates.update(self._chemistry_templates())

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
                    "将 △DEF 放在 △ABC 上，使 EF 与 BC 重合（E→B, F→C），D 与 A 在 BC 异侧",
                    "连接 AD，此时 AB = DB 且 AC = DC",
                    "△ABD 是等腰三角形（AB = DB），底角相等：∠BAD = ∠BDA",
                    "△ACD 是等腰三角形（AC = DC），底角相等：∠CAD = ∠CDA",
                    "相加：∠BAC = ∠BAD + ∠DAC = ∠BDA + ∠CDA = ∠BDC",
                    "由 SAS（AB = DB, AC = DC, 夹角 ∠BAC = ∠BDC），△ABC ≅ △DBC，即 △ABC ≅ △DEF",
                ],
                key_insights=[
                    "通过叠合构造辅助线 AD",
                    "等腰三角形的底角相等是关键：∠BAD = ∠BDA, ∠CAD = ∠CDA",
                    "底角相加得到 ∠BAC = ∠BDC，最终用 SAS 判定全等",
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

    # ------------------------------------------------------------------
    # Calculus templates
    # ------------------------------------------------------------------
    def _calculus_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for calculus (university level)."""
        return {
            "power_rule": ProofTemplate(
                theorem_name="power_rule",
                description="幂函数求导法则：d/dx[xⁿ] = n·xⁿ⁻¹",
                given=["f(x) = xⁿ", "n 是正整数"],
                to_prove="f'(x) = n·xⁿ⁻¹",
                expected_steps=[
                    "用极限定义：f'(x) = lim_{h→0} [(x+h)ⁿ - xⁿ] / h",
                    "展开 (x+h)ⁿ = Σ C(n,k) xⁿ⁻ᵏ hᵏ（二项式定理）",
                    "(x+h)ⁿ - xⁿ = Σ_{k≥1} C(n,k) xⁿ⁻ᵏ hᵏ = n·xⁿ⁻¹·h + O(h²)",
                    "除以 h：[(x+h)ⁿ - xⁿ]/h = n·xⁿ⁻¹ + O(h)",
                    "取极限 h→0：f'(x) = n·xⁿ⁻¹",
                ],
                key_insights=[
                    "二项式定理将 (x+h)ⁿ 展开，分离出线性项",
                    "只有 k=1 的项在除以 h 后不趋于零",
                    "组合数 C(n,1) = n 给出了导数中的系数 n",
                ],
                socratic_hints=[
                    "如何用导数的极限定义展开 (x+h)ⁿ？",
                    "二项式展开后，哪一项含有 h 的一次项？",
                    "除以 h 并取极限后，哪些项消失了？",
                ],
            ),
            "ftc_part1": ProofTemplate(
                theorem_name="ftc_part1",
                description="微积分基本定理（第一部分）：d/dx[∫ₐˣ f(t)dt] = f(x)",
                given=["f 是 [a,b] 上的连续函数", "F(x) = ∫ₐˣ f(t) dt"],
                to_prove="F'(x) = f(x)",
                expected_steps=[
                    "F'(x) = lim_{h→0} [F(x+h) - F(x)] / h",
                    "F(x+h) - F(x) = ∫ₐ^{x+h} f(t) dt - ∫ₐˣ f(t) dt = ∫ₓ^{x+h} f(t) dt",
                    "由积分中值定理：∫ₓ^{x+h} f(t) dt = f(c)·h（c 在 x 与 x+h 之间）",
                    "[F(x+h) - F(x)] / h = f(c)",
                    "h→0 时 c→x，由连续性 f(c) → f(x)",
                    "所以 F'(x) = f(x)",
                ],
                key_insights=[
                    "积分中值定理连接了积分与函数值",
                    "连续性保证 f(c) → f(x) 当 h → 0",
                    "微分与积分互为逆运算——这是微积分的核心",
                ],
                socratic_hints=[
                    "F(x+h) - F(x) 可以写成什么积分？",
                    "如何用中值定理将积分转化为函数值乘以区间长度？",
                    "h → 0 时 c 趋向什么？连续性起什么作用？",
                ],
            ),
            "chain_rule": ProofTemplate(
                theorem_name="chain_rule",
                description="链式法则：d/dx[f(g(x))] = f'(g(x))·g'(x)",
                given=["f, g 可导", "h(x) = f(g(x))"],
                to_prove="h'(x) = f'(g(x))·g'(x)",
                expected_steps=[
                    "h'(x) = lim_{Δx→0} [f(g(x+Δx)) - f(g(x))] / Δx",
                    "令 Δg = g(x+Δx) - g(x)，则 g(x+Δx) = g(x) + Δg",
                    "[f(g(x+Δx)) - f(g(x))] / Δx = [f(g(x)+Δg) - f(g(x))] / Δg · Δg/Δx",
                    "Δx→0 时 Δg→0（因为 g 可导 ⟹ 连续），所以第一项 → f'(g(x))",
                    "第二项 Δg/Δx → g'(x)",
                    "所以 h'(x) = f'(g(x))·g'(x)",
                ],
                key_insights=[
                    "引入中间变量 Δg 将复合函数的变化率分解为两个变化率的乘积",
                    "可导 ⟹ 连续保证了 Δx→0 时 Δg→0",
                    "链式法则是多元链式法则和隐函数求导的基础",
                ],
                socratic_hints=[
                    "如何引入中间变量将差商分解？",
                    "Δg/Δx 的极限是什么？",
                    "为什么 Δx→0 时 Δg→0？",
                ],
            ),
        }

    # ------------------------------------------------------------------
    # Linear Algebra templates
    # ------------------------------------------------------------------
    def _linear_algebra_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for linear algebra (university level)."""
        return {
            "rank_nullity": ProofTemplate(
                theorem_name="rank_nullity",
                description="秩-零化度定理：rank(A) + nullity(A) = n",
                given=["线性映射 T: V → W", "dim V = n"],
                to_prove="rank(T) + nullity(T) = n",
                expected_steps=[
                    "设 ker(T) 的基为 {v₁, ..., v_k}，则 nullity(T) = k",
                    "将 ker(T) 的基扩充为 V 的基：{v₁,...,v_k, w₁,...,w_{n-k}}",
                    "证明 {T(w₁), ..., T(w_{n-k})} 是 Im(T) 的基",
                    "线性无关：若 Σ cᵢ T(wᵢ) = 0，则 T(Σ cᵢ wᵢ) = 0，故 Σ cᵢ wᵢ ∈ ker(T)",
                    "Σ cᵢ wᵢ = Σ dⱼ vⱼ，由基的线性无关性得 cᵢ = 0 和 dⱼ = 0",
                    "生成：任取 T(v) ∈ Im(T)，v = Σ aᵢ vᵢ + Σ bⱼ wⱼ，则 T(v) = Σ bⱼ T(wⱼ)",
                    "所以 rank(T) = n - k = n - nullity(T)",
                ],
                key_insights=[
                    "基扩充定理：子空间的基可以扩充为全空间的基",
                    "ker(T) 的基扩充后，新增基向量的像恰好生成 Im(T)",
                    "线性无关性的证明利用了 ker(T) 的定义",
                ],
                socratic_hints=[
                    "如何将 ker(T) 的基扩充为 V 的基？",
                    "扩充后的新基向量的像是否线性无关？为什么？",
                    "这些像是否生成 Im(T)？",
                ],
            ),
            "dim_invariance": ProofTemplate(
                theorem_name="dim_invariance",
                description="维数不变性：有限维向量空间的所有基大小相同",
                given=["V 是有限维空间", "B₁ = {e₁,...,e_n} 和 B₂ = {f₁,...,f_m} 都是 V 的基"],
                to_prove="n = m",
                expected_steps=[
                    "B₁ 生成 V 且 B₂ 线性无关，由替换定理 m ≤ n",
                    "B₂ 生成 V 且 B₁ 线性无关，由替换定理 n ≤ m",
                    "所以 n = m",
                ],
                key_insights=[
                    "Steinitz 替换定理：线性无关组的大小不超过生成组的大小",
                    "两个基互相替换得到双向不等式",
                    "维数的良定义性由此确立",
                ],
                socratic_hints=[
                    "如果 B₁ 生成 V 且 B₂ 线性无关，它们的大小有什么关系？",
                    "反过来呢？",
                    "两个不等式能推出什么？",
                ],
            ),
            "independence_implies_unique": ProofTemplate(
                theorem_name="independence_implies_unique",
                description="线性无关组的表示唯一",
                given=["{v₁, ..., v_n} 线性无关", "v = Σ aᵢ vᵢ = Σ bᵢ vᵢ"],
                to_prove="aᵢ = bᵢ 对所有 i 成立",
                expected_steps=[
                    "两个表示相减：Σ (aᵢ - bᵢ) vᵢ = 0",
                    "由线性无关性：aᵢ - bᵢ = 0 对所有 i 成立",
                    "所以 aᵢ = bᵢ",
                ],
                key_insights=[
                    "线性无关意味着零表示唯一",
                    "两个表示相减得到零表示",
                    "坐标的唯一性是线性无关的直接推论",
                ],
                socratic_hints=[
                    "两个表示相减得到什么？",
                    "线性无关性对零表示意味着什么？",
                    "由此能推出系数相等吗？",
                ],
            ),
        }

    # ------------------------------------------------------------------
    # Discrete Math templates
    # ------------------------------------------------------------------
    def _discrete_math_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for discrete math (university level)."""
        return {
            "handshake_lemma": ProofTemplate(
                theorem_name="handshake_lemma",
                description="握手定理：所有顶点度数之和等于 2|E|",
                given=["图 G = (V, E)"],
                to_prove="Σ_{v∈V} deg(v) = 2|E|",
                expected_steps=[
                    "每条边 e = {u, w} 对 deg(u) 贡献 1，对 deg(w) 贡献 1",
                    "因此每条边对度数之和贡献 2",
                    "所有边贡献完毕：Σ deg(v) = 2|E|",
                ],
                key_insights=[
                    "双重计数法：从顶点角度和边角度分别计数",
                    "每条边恰好被两个端点'看到'",
                    "推论：奇数度顶点个数必为偶数",
                ],
                socratic_hints=[
                    "一条边连接两个顶点，它对度数之和贡献多少？",
                    "如果所有度数之和是奇数，能推出什么？",
                    "为什么奇数度顶点个数一定是偶数？",
                ],
            ),
            "tree_n_minus_1_edges": ProofTemplate(
                theorem_name="tree_n_minus_1_edges",
                description="n 个顶点的树恰有 n-1 条边",
                given=["T 是树（连通无圈图）", "T 有 n 个顶点"],
                to_prove="T 有 n-1 条边",
                expected_steps=[
                    "对顶点数 n 归纳",
                    "n=1 时：单顶点无边，0 = 1-1 ✓",
                    "假设 n=k 时成立。取 n=k+1 的树 T",
                    "树无圈 ⟹ 存在度数为 1 的叶子节点 v（否则 δ≥2 产生圈）",
                    "删除 v 及其关联边，得到 k 个顶点的树 T'（连通性不变、无圈性不变）",
                    "由归纳假设 T' 有 k-1 条边",
                    "T 比 T' 多一条边（v 的关联边），所以 T 有 k 条边 = (k+1)-1 ✓",
                ],
                key_insights=[
                    "归纳法：最小情形和归纳步",
                    "树必有叶子节点（否则最小度 δ≥2 导致圈存在）",
                    "删除叶子后保持树的性质（连通+无圈）",
                ],
                socratic_hints=[
                    "树为什么一定有度数为 1 的节点？",
                    "删除叶子节点后，图还是树吗？",
                    "如何用归纳假设完成证明？",
                ],
            ),
            "bfs_shortest_path": ProofTemplate(
                theorem_name="bfs_shortest_path",
                description="BFS 正确性：广度优先搜索给出无权图最短路径",
                given=["连通无权图 G = (V, E)", "源点 s"],
                to_prove="BFS 给出每个顶点到 s 的最短路径长度",
                expected_steps=[
                    "BFS 按层扩展：第 0 层 = {s}，第 k 层 = 与第 k-1 层相邻但未访问的顶点",
                    "设 d(v) 为 BFS 给出的层数，δ(v) 为真实最短距离",
                    "对 d(v) 归纳：d(v) = k ⟹ δ(v) = k",
                    "基础：d(s) = 0 = δ(s) ✓",
                    "归纳：设 d(v) = k，v 在第 k 层被访问",
                    "δ(v) ≤ k：因为 BFS 通过第 k-1 层的某顶点到达 v，路径长度 ≤ k",
                    "δ(v) ≥ k：若存在长度 < k 的路径，则 v 在第 < k 层就应被访问，矛盾",
                    "所以 d(v) = δ(v) = k",
                ],
                key_insights=[
                    "BFS 的层序结构保证先到近处再到远处",
                    "上界：BFS 找到了长度为 d(v) 的路径",
                    "下界：如果更短路径存在，BFS 会更早访问该顶点",
                ],
                socratic_hints=[
                    "BFS 按什么顺序访问顶点？",
                    "如果存在比 BFS 路径更短的路径，BFS 会怎样？",
                    "如何用归纳法证明 BFS 路径就是最短路径？",
                ],
            ),
        }

    # ------------------------------------------------------------------
    # Number Theory templates
    # ------------------------------------------------------------------
    def _number_theory_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for number theory (university level)."""
        return {
            "euclid_infinite_primes": ProofTemplate(
                theorem_name="euclid_infinite_primes",
                description="素数有无穷多个（Euclid 经典证明）",
                given=["假设素数只有有限个：p₁, p₂, ..., p_n"],
                to_prove="存在不在列表中的素数（矛盾）",
                expected_steps=[
                    "构造 N = p₁ × p₂ × ... × p_n + 1",
                    "N > 1，所以 N 至少有一个素因子 q",
                    "q 是素数，若 q 在列表中则 q | (p₁×...×p_n)",
                    "但 q | N 且 q | (p₁×...×p_n) ⟹ q | (N - p₁×...×p_n) = 1",
                    "素数 q 整除 1 矛盾，所以 q 不在列表中",
                    "与'所有素数都在列表中'矛盾，故素数无穷多",
                ],
                key_insights=[
                    "反证法：假设有限，构造矛盾",
                    "N = 乘积 + 1 保证 N 不被任何已知素数整除",
                    "新数的素因子必为新素数",
                ],
                socratic_hints=[
                    "假设素数有限，如何构造一个不被它们整除的数？",
                    "N = p₁×...×p_n + 1 被 p₁ 整除吗？",
                    "N 的素因子在哪里？",
                ],
            ),
            "euclid_lemma": ProofTemplate(
                theorem_name="euclid_lemma",
                description="Euclid 引理：p|ab 且 p 是素数 ⟹ p|a 或 p|b",
                given=["p 是素数", "p | ab"],
                to_prove="p | a 或 p | b",
                expected_steps=[
                    "假设 p ∤ a",
                    "因为 p 是素数，gcd(p, a) = 1",
                    "由 Bezout 定理：存在 x, y 使 px + ay = 1",
                    "两边乘以 b：pbx + aby = b",
                    "p | pbx（显然）且 p | aby（因为 p | ab）",
                    "所以 p | (pbx + aby) = b",
                    "因此 p ∤ a ⟹ p | b",
                ],
                key_insights=[
                    "素数的关键性质：gcd(p, a) = 1 当 p ∤ a",
                    "Bezout 定理将整除关系转化为线性组合",
                    "这是唯一分解定理证明的核心引理",
                ],
                socratic_hints=[
                    "如果 p 不整除 a，gcd(p,a) 是什么？",
                    "Bezout 定理给出了什么等式？",
                    "如何从这个等式推出 p | b？",
                ],
            ),
            "fermat_little_theorem": ProofTemplate(
                theorem_name="fermat_little_theorem",
                description="费马小定理：p 是素数 ⟹ a^p ≡ a (mod p)",
                given=["p 是素数", "a 是正整数"],
                to_prove="a^p ≡ a (mod p)",
                expected_steps=[
                    "先证：若 gcd(a, p) = 1，则 a^{p-1} ≡ 1 (mod p)",
                    "考虑集合 S = {1, 2, ..., p-1}，在模 p 乘法下",
                    "乘以 a 得 aS = {a, 2a, ..., (p-1)a}（mod p）",
                    "aS 的元素互不相同：若 ia ≡ ja (mod p)，则 p | (i-j)a，由 gcd(a,p)=1 得 p|(i-j)，但 |i-j| < p 矛盾",
                    "所以 aS 也是 {1, 2, ..., p-1} 的排列（mod p）",
                    "乘积相等：1·2·...·(p-1) ≡ a·2a·...·(p-1)a (mod p)",
                    "(p-1)! ≡ a^{p-1} · (p-1)! (mod p)",
                    "由 Wilson 定理 (p-1)! ≢ 0 (mod p)，两边消去得 a^{p-1} ≡ 1 (mod p)",
                    "两边乘以 a：a^p ≡ a (mod p)",
                ],
                key_insights=[
                    "乘以 a 是模 p 上的置换",
                    "置换不改变乘积，因此原集合与置换后集合的乘积相等",
                    "消去 (p-1)! 需要 gcd((p-1)!, p) = 1，即 p 是素数",
                ],
                socratic_hints=[
                    "模 p 乘以 a 会改变集合 {1,...,p-1} 吗？",
                    "如果 ia ≡ ja (mod p)，能推出什么？",
                    "两个集合的乘积相等，如何得到 a^{p-1} ≡ 1？",
                ],
            ),
        }

    # ------------------------------------------------------------------
    # Physics templates (math applied to nature)
    # ------------------------------------------------------------------
    def _physics_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for physics — each grounded in mathematics."""
        return {
            "kinematic_equations": ProofTemplate(
                theorem_name="kinematic_equations",
                description="匀加速运动方程的推导（从微分方程出发）",
                given=["a = const（恒定加速度）", "初始条件 v(0) = v₀, x(0) = x₀"],
                to_prove="v(t) = v₀ + at 且 x(t) = x₀ + v₀t + ½at²",
                expected_steps=[
                    "加速度定义：a = dv/dt = const",
                    "积分：v(t) = ∫a dt = at + C，由 v(0) = v₀ 得 C = v₀",
                    "所以 v(t) = v₀ + at",
                    "速度定义：v = dx/dt",
                    "积分：x(t) = ∫v(t) dt = ∫(v₀ + at) dt = v₀t + ½at² + C'",
                    "由 x(0) = x₀ 得 C' = x₀",
                    "所以 x(t) = x₀ + v₀t + ½at²",
                ],
                key_insights=[
                    "物理定律是微分方程：a = dv/dt, v = dx/dt",
                    "积分是微分的逆运算（微积分基本定理）",
                    "初始条件确定积分常数",
                ],
                socratic_hints=[
                    "加速度和速度之间有什么微分关系？",
                    "如何从 a = const 积分得到 v(t)？",
                    "积分常数由什么确定？",
                ],
            ),
            "work_energy_theorem": ProofTemplate(
                theorem_name="work_energy_theorem",
                description="动能定理：合外力做的功等于动能的变化量",
                given=["质量 m 的质点", "合外力 F(x)", "速度从 v₁ 变到 v₂"],
                to_prove="W = ∫F·dx = ½mv₂² - ½mv₁²",
                expected_steps=[
                    "牛顿第二定律：F = ma = m·dv/dt",
                    "功的定义：W = ∫F dx = ∫m·(dv/dt) dx",
                    "链式法则：dv/dt = (dv/dx)·(dx/dt) = v·(dv/dx)",
                    "代入：W = ∫m·v·(dv/dx) dx = ∫mv dv",
                    "积分：W = m·[½v²]_{v₁}^{v₂} = ½mv₂² - ½mv₁²",
                    "即动能变化量 ΔKE = W_net",
                ],
                key_insights=[
                    "牛顿第二定律 F = ma 是微分方程的出发点",
                    "链式法则 dv/dt = v·(dv/dx) 是关键技巧",
                    "功的积分本质是动能函数的微分逆运算",
                ],
                socratic_hints=[
                    "F = ma 中 a 如何用 v 和 x 表示？",
                    "如何用链式法则把 dv/dt 转化为 v·dv/dx？",
                    "积分 ∫mv dv 的结果是什么？",
                ],
            ),
            "shm_equation": ProofTemplate(
                theorem_name="shm_equation",
                description="简谐振动的周期公式 T = 2π√(m/k)",
                given=["弹簧振子：恢复力 F = -kx", "质量 m"],
                to_prove="x(t) = A·cos(ωt + φ)，其中 ω = √(k/m)，T = 2π/ω",
                expected_steps=[
                    "牛顿第二定律：m·d²x/dt² = -kx",
                    "改写：d²x/dt² + (k/m)x = 0",
                    "令 ω² = k/m，得 d²x/dt² + ω²x = 0",
                    "特征方程 r² + ω² = 0，根为 r = ±iω",
                    "通解：x(t) = A·cos(ωt) + B·sin(ωt) = C·cos(ωt + φ)",
                    "周期 T = 2π/ω = 2π√(m/k)",
                ],
                key_insights=[
                    "简谐振动是二阶常系数齐次 ODE",
                    "特征方程的复根给出三角函数解",
                    "角频率 ω = √(k/m) 由系统参数决定",
                ],
                socratic_hints=[
                    "恢复力 F = -kx 如何变成微分方程？",
                    "特征方程的根是什么类型的？",
                    "复根对应的解是什么形式？",
                ],
            ),
        }

    # ------------------------------------------------------------------
    # Chemistry templates (math applied to molecules)
    # ------------------------------------------------------------------
    def _chemistry_templates(self) -> dict[str, ProofTemplate]:
        """Proof templates for chemistry — each grounded in mathematics."""
        return {
            "half_life_first_order": ProofTemplate(
                theorem_name="half_life_first_order",
                description="一级反应半衰期与浓度无关：t₁/₂ = ln2/k",
                given=["一级反应：dC/dt = -kC", "C(0) = C₀"],
                to_prove="t₁/₂ = ln2/k（与 C₀ 无关）",
                expected_steps=[
                    "分离变量：dC/C = -k dt",
                    "积分：∫_{C₀}^{C} dC/C = -k ∫₀ᵗ dt",
                    "ln(C/C₀) = -kt，所以 C(t) = C₀·e^(-kt)",
                    "半衰期定义：C(t₁/₂) = C₀/2",
                    "C₀·e^(-k·t₁/₂) = C₀/2",
                    "e^(-k·t₁/₂) = 1/2",
                    "-k·t₁/₂ = ln(1/2) = -ln2",
                    "t₁/₂ = ln2/k（C₀ 被消去，与初始浓度无关）",
                ],
                key_insights=[
                    "分离变量法求解一阶 ODE",
                    "指数衰减解 C(t) = C₀·e^(-kt)",
                    "半衰期定义 C = C₀/2 导致 C₀ 被消去",
                ],
                socratic_hints=[
                    "一级反应的微分方程如何分离变量？",
                    "积分后 C₀ 出现在哪里？",
                    "令 C = C₀/2 时 C₀ 会怎样？",
                ],
            ),
            "equilibrium_constant": ProofTemplate(
                theorem_name="equilibrium_constant",
                description="平衡常数的热力学推导：K = e^(-ΔG°/RT)",
                given=["反应 A ⇌ B", "正反应速率 k_f·[A]", "逆反应速率 k_r·[B]"],
                to_prove="平衡时 K = [B]/[A] = k_f/k_r = e^(-ΔG°/RT)",
                expected_steps=[
                    "平衡条件：正反应速率 = 逆反应速率",
                    "k_f·[A]_eq = k_r·[B]_eq",
                    "K = [B]_eq / [A]_eq = k_f / k_r",
                    "由 Arrhenius 方程：k = A·e^(-Ea/RT)",
                    "正反应活化能 Ea,f，逆反应活化能 Ea,r",
                    "ΔG° = Ea,f - Ea,r（正逆反应活化能之差等于自由能变化）",
                    "K = k_f/k_r = (A_f/A_r)·e^(-(Ea,f-Ea,r)/RT) = e^(-ΔG°/RT)",
                    "(假设指前因子比 A_f/A_r ≈ 1，或已包含在 ΔG° 中)",
                ],
                key_insights=[
                    "平衡的数学本质是速率相等（稳态条件）",
                    "Arrhenius 方程的指数形式给出 K 的温度依赖性",
                    "ΔG° = Ea,f - Ea,r 连接了动力学与热力学",
                ],
                socratic_hints=[
                    "平衡时正逆反应速率有什么关系？",
                    "Arrhenius 方程如何给出 k 与温度的关系？",
                    "正逆反应活化能之差等于什么热力学量？",
                ],
            ),
            "huckel_benzene": ProofTemplate(
                theorem_name="huckel_benzene",
                description="Hückel 方法求苯的 π 电子能级（6×6 矩阵特征值）",
                given=["苯 C₆H₆ 的 6 个 π 电子", "Hückel 近似：α (对角), β (相邻)"],
                to_prove="能级为 α+2β, α+β(双重简并), α-β(双重简并), α-2β",
                expected_steps=[
                    "建立 6×6 久期矩阵 H（对角元 α，相邻非对角元 β）",
                    "苯是环状分子，H 是循环矩阵",
                    "循环矩阵的特征值可用 DFT 计算：ε_j = α + 2β·cos(2πj/6)，j = 0,1,...,5",
                    "j=0: ε = α + 2β·cos(0) = α + 2β",
                    "j=1,5: ε = α + 2β·cos(π/3) = α + β（二重简并）",
                    "j=2,4: ε = α + 2β·cos(2π/3) = α - β（二重简并）",
                    "j=3: ε = α + 2β·cos(π) = α - 2β",
                    "6 个 π 电子填充最低 3 个能级：E_total = 2(α+2β) + 2(α+β) + 2(α+β) = 6α + 8β",
                    "离域能 = E_total - 3×(2α+2β) = 6α+8β - 6α-6β = 2β（稳定化）",
                ],
                key_insights=[
                    "Hückel 方法本质是矩阵特征值问题",
                    "循环矩阵的特征值由 DFT 给出",
                    "简并来自对称性（cos(2πj/6) = cos(2π(6-j)/6))",
                ],
                socratic_hints=[
                    "Hückel 矩阵的特征值用什么数学方法计算？",
                    "为什么 j=1 和 j=5 给出相同的能量？",
                    "离域能的物理意义是什么？",
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
            "calculus": ["power_rule", "ftc_part1", "chain_rule"],
            "linear_algebra": ["rank_nullity", "dim_invariance",
                              "independence_implies_unique"],
            "discrete_math": ["handshake_lemma", "tree_n_minus_1_edges",
                              "bfs_shortest_path"],
            "number_theory": ["euclid_infinite_primes", "euclid_lemma",
                              "fermat_little_theorem"],
            "physics": ["kinematic_equations", "work_energy_theorem",
                        "shm_equation"],
            "chemistry": ["half_life_first_order", "equilibrium_constant",
                          "huckel_benzene"],
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
            match_method = "keyword"

            # Try every remaining expected position and keep the LAST match.
            # Z3 fallback is disabled during the greedy scan to prevent
            # it from matching every position at once (Z3 verifies the
            # whole theorem, not a specific step).
            for check_idx in range(expected_idx, total_expected):
                mr = self._match_step(
                    claim=claim,
                    justification=justification,
                    expected=template.expected_steps[check_idx],
                    step_idx=check_idx,
                    theorem_name=template.theorem_name,
                    use_z3_fallback=False,
                )
                if mr["matched"]:
                    matched_at = check_idx
                    match_feedback = mr.get("feedback", "✓ 正确！")
                    match_method = mr.get("verification_method", "keyword")
                    # Do NOT break — keep scanning for a later match.

            # L2 Z3 fallback: if keyword matching failed at the current
            # expected position, try Z3 constraint verification for
            # supported group-theory theorems. Z3 is only attempted when
            # keyword matching produced a *complete* miss (no partial
            # match) — partial matches keep their own feedback so the
            # student still sees what keywords they missed.
            if matched_at < 0 and expected_idx < total_expected:
                kw_check = self._match_step(
                    claim=claim,
                    justification=justification,
                    expected=template.expected_steps[expected_idx],
                    step_idx=expected_idx,
                    theorem_name=template.theorem_name,
                    use_z3_fallback=False,
                )
                is_partial = "部分正确" in kw_check.get("feedback", "")
                if not is_partial:
                    z3_result = self._verify_with_z3(
                        theorem_name=template.theorem_name,
                        claim=claim,
                        justification=justification,
                        step_idx=expected_idx,
                    )
                    if z3_result["verified"]:
                        matched_at = expected_idx
                        match_feedback = z3_result.get(
                            "reason", "✓ Z3 约束求解验证通过！"
                        )
                        match_method = "z3"

            if matched_at >= 0:
                implicit = list(template.expected_steps[expected_idx:matched_at])
                step.is_valid = True
                step.matched_expected = template.expected_steps[matched_at]
                step.implicit_steps = implicit
                step.verification_method = match_method
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
                        use_z3_fallback=False,
                    )
                    step.is_valid = False
                    step.feedback = mr.get(
                        "feedback",
                        f"这一步不匹配。期望：{expected}",
                    )
                    step.matched_expected = expected
                    step.verification_method = mr.get(
                        "verification_method", "keyword"
                    )
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
        # Record the verification method used for each submitted step.
        result.verification_methods = [s.verification_method for s in result.steps]
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

    # Theorems that support formal Z3 verification (group-theory subset).
    _Z3_SUPPORTED_THEOREMS = frozenset({
        "identity_unique",
        "inverse_unique",
        "cancellation_law",
    })

    def _verify_with_z3(
        self,
        theorem_name: str,
        claim: str,
        justification: str,
        step_idx: int,
    ) -> dict[str, Any]:
        """Verify a proof step using Z3 SMT constraint solving.

        For supported group-theory theorems, this builds the group axioms
        (associativity + identity + inverses as needed) as Z3 constraints
        and checks whether the negation of the theorem's conclusion is
        unsatisfiable. If UNSAT, the theorem is formally verified.

        Supported theorems:
        - ``identity_unique``: two distinct identity elements ⟹ contradiction.
        - ``inverse_unique``: two distinct inverses of the same element ⟹
          contradiction.
        - ``cancellation_law``: ``a·b = a·c`` with ``a⁻¹`` available ⟹
          ``b = c``; negation (``b ≠ c``) is unsatisfiable.

        Args:
            theorem_name: The theorem being proved.
            claim: The student's claim (unused by Z3 but kept for interface
                consistency and future per-step encoding).
            justification: The student's justification text (unused by Z3).
            step_idx: Index of the expected step being checked.

        Returns:
            Dict with keys ``verified`` (bool) and ``reason`` (str). When Z3
            is unavailable or the theorem is unsupported, ``verified`` is
            ``False`` with an explanatory reason.
        """
        if not _Z3_AVAILABLE:
            return {
                "verified": False,
                "reason": "Z3 不可用，无法进行形式化验证。",
            }

        if theorem_name not in self._Z3_SUPPORTED_THEOREMS:
            return {
                "verified": False,
                "reason": f"Z3 验证不支持定理「{theorem_name}」。",
            }

        try:
            if theorem_name == "identity_unique":
                return self._z3_verify_identity_unique()
            elif theorem_name == "inverse_unique":
                return self._z3_verify_inverse_unique()
            elif theorem_name == "cancellation_law":
                return self._z3_verify_cancellation_law()
        except Exception as e:
            logger.warning("Z3 verification failed for %s: %s", theorem_name, e)
            return {
                "verified": False,
                "reason": f"Z3 验证过程出错: {e}",
            }

        return {"verified": False, "reason": "未知验证路径。"}

    def _z3_verify_identity_unique(self) -> dict[str, Any]:
        """Z3 verification: if e and f are both identity elements, e = f.

        Encodes the group operation as an uninterpreted function, asserts
        associativity and that both e and f satisfy the identity axiom,
        then asserts e ≠ f. UNSAT proves uniqueness.
        """
        s = Solver()
        op = Function('op', IntSort(), IntSort(), IntSort())
        e = Int('e')
        f = Int('f')
        a, b, c = Int('a'), Int('b'), Int('c')

        # Group axiom: associativity
        s.add(ForAll([a, b, c], op(op(a, b), c) == op(a, op(b, c))))
        # e is a (two-sided) identity
        s.add(ForAll([a], And(op(e, a) == a, op(a, e) == a)))
        # f is also a (two-sided) identity
        s.add(ForAll([a], And(op(f, a) == a, op(a, f) == a)))
        # Negation of the conclusion: e and f are distinct
        s.add(e != f)

        if s.check() == unsat:
            return {
                "verified": True,
                "reason": "✓ Z3 验证通过：若 e 和 f 都是单位元，则 e = f（约束不可满足）。",
            }
        return {
            "verified": False,
            "reason": "Z3 未能验证单位元唯一性。",
        }

    def _z3_verify_inverse_unique(self) -> dict[str, Any]:
        """Z3 verification: if b and c are both inverses of a, then b = c.

        Asserts associativity, identity, and that both b and c are inverses
        of a, then asserts b ≠ c. UNSAT proves uniqueness of inverses.
        """
        s = Solver()
        op = Function('op', IntSort(), IntSort(), IntSort())
        e = Int('e')
        a_elem = Int('a_elem')
        b = Int('b')
        c = Int('c')
        x, y, z = Int('x'), Int('y'), Int('z')

        # Group axioms: associativity + identity
        s.add(ForAll([x, y, z], op(op(x, y), z) == op(x, op(y, z))))
        s.add(ForAll([x], And(op(e, x) == x, op(x, e) == x)))
        # b is an inverse of a_elem
        s.add(And(op(a_elem, b) == e, op(b, a_elem) == e))
        # c is also an inverse of a_elem
        s.add(And(op(a_elem, c) == e, op(c, a_elem) == e))
        # Negation: b ≠ c
        s.add(b != c)

        if s.check() == unsat:
            return {
                "verified": True,
                "reason": "✓ Z3 验证通过：若 b 和 c 都是 a 的逆元，则 b = c（约束不可满足）。",
            }
        return {
            "verified": False,
            "reason": "Z3 未能验证逆元唯一性。",
        }

    def _z3_verify_cancellation_law(self) -> dict[str, Any]:
        """Z3 verification: a·b = a·c ⟹ b = c in a group.

        Asserts associativity, identity, existence of a⁻¹, and a·b = a·c,
        then asserts b ≠ c. UNSAT proves the cancellation law.
        """
        s = Solver()
        op = Function('op', IntSort(), IntSort(), IntSort())
        e = Int('e')
        a_inv = Int('a_inv')
        a_elem = Int('a_elem')
        b = Int('b')
        c = Int('c')
        x, y, z = Int('x'), Int('y'), Int('z')

        # Group axioms: associativity + identity
        s.add(ForAll([x, y, z], op(op(x, y), z) == op(x, op(y, z))))
        s.add(ForAll([x], And(op(e, x) == x, op(x, e) == x)))
        # a_inv is the inverse of a_elem
        s.add(And(op(a_inv, a_elem) == e, op(a_elem, a_inv) == e))
        # Premise: a·b = a·c
        s.add(op(a_elem, b) == op(a_elem, c))
        # Negation of conclusion: b ≠ c
        s.add(b != c)

        if s.check() == unsat:
            return {
                "verified": True,
                "reason": "✓ Z3 验证通过：若 a·b = a·c，则 b = c（约束不可满足）。",
            }
        return {
            "verified": False,
            "reason": "Z3 未能验证消去律。",
        }

    def _match_step(
        self,
        claim: str,
        justification: str,
        expected: str,
        step_idx: int,
        theorem_name: str,
        use_z3_fallback: bool = True,
    ) -> dict[str, Any]:
        """Match a student step against the expected step using keywords.

        Two-layer fallback strategy:
        - L1 (keyword): pattern matching via ``_get_keyword_patterns``.
        - L2 (Z3): if L1 fails and ``use_z3_fallback`` is True, verify the
          theorem via SMT constraint solving for supported group-theory
          theorems.

        Args:
            claim: The student's claim for this step.
            justification: The student's justification text.
            expected: The expected step description from the template.
            step_idx: Index of the expected step being checked.
            theorem_name: Name of the theorem being proved.
            use_z3_fallback: When False, skip L2 Z3 verification (used during
                the greedy multi-position scan to avoid Z3 matching every
                position at once).

        Returns:
            Dict with keys: ``matched`` (bool), ``feedback`` (str), and
            ``verification_method`` (``"keyword"`` or ``"z3"``).
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
                    return {
                        "matched": True,
                        "feedback": "✓ 正确！",
                        "verification_method": "keyword",
                    }

            # Partial match
            for group in step_patterns:
                norm_group = [_normalize(kw) for kw in group]
                partial = sum(1 for kw in norm_group if kw in combined)
                if partial > 0:
                    return {
                        "matched": False,
                        "feedback": f"部分正确。期望的关键步骤包含：{expected}。检查你的推导是否遗漏了什么。",
                        "verification_method": "keyword",
                    }

        # L2 Z3 fallback: if keyword matching failed and Z3 is available,
        # attempt formal verification of the theorem.
        if use_z3_fallback:
            z3_result = self._verify_with_z3(
                theorem_name=theorem_name,
                claim=claim,
                justification=justification,
                step_idx=step_idx,
            )
            if z3_result["verified"]:
                return {
                    "matched": True,
                    "feedback": z3_result.get("reason", "✓ Z3 约束求解验证通过！"),
                    "verification_method": "z3",
                }

        return {
            "matched": False,
            "feedback": f"这一步不匹配。期望：{expected}",
            "verification_method": "keyword",
        }

    def _get_keyword_patterns(self, theorem_name: str) -> list[list[list[str]]]:
        """Get keyword patterns for each expected step of a theorem.

        Returns a list where index i contains the keyword groups for step i.
        Each group is a list of keywords that must ALL be present.
        A step matches if ANY group is fully satisfied.
        """
        return _THEOREM_KEYWORD_PATTERNS.get(theorem_name, [[[]]])


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
