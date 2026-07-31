"""GrillSession: tracks the state of a grill-me interview session.

Core design principles (adapted from Matt Pocock's grill-me skill):

1. **Role inversion**: The system interviews the student, not the other way around.
2. **One question at a time**: Never overwhelm with multiple questions.
3. **Recommended answer**: Each question includes the system's best guess,
   so the student reacts to a hypothesis rather than staring at a blank.
4. **Decision tree walk**: Questions follow the concept DAG structure,
   resolving foundational dependencies before advanced topics.
5. **Codebase-first**: If the answer can be derived from Cayley tables
   the student already submitted, the system resolves it itself rather
   than asking — student time goes to genuine unknowns.
6. **Exhaustive**: Walks every branch of the student's understanding,
   not just the ones that look risky.
7. **Durable state**: The session persists across turns — the orchestrator
   holds the GrillSession so questions build on previous answers.

Usage in orchestrator:
    grill = GrillSession(dag=dag, current_node_id="group_definition")
    question = grill.next_question(student_history, cayley_tables_submitted)
    # ... student answers ...
    grill.record_answer(question.qid, student_answer, is_correct)
    next_q = grill.next_question(...)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..dag.concept_dag import ConceptDAG, get_dag

logger = logging.getLogger(__name__)


@dataclass
class GrillQuestion:
    """A single grill-me question with recommended answer."""

    qid: str
    concept_node_id: str
    concept_name: str
    question: str
    recommended_answer: str
    difficulty: float = 0.5  # 0.0 trivial → 1.0 hard
    branch_type: str = "concept"  # "concept", "edge_case", "application"

    def to_dict(self) -> dict[str, Any]:
        return {
            "qid": self.qid,
            "concept_node_id": self.concept_node_id,
            "concept_name": self.concept_name,
            "question": self.question,
            "recommended_answer": self.recommended_answer,
            "difficulty": self.difficulty,
            "branch_type": self.branch_type,
        }


@dataclass
class GrillBranch:
    """A branch in the understanding decision tree."""

    concept_node_id: str
    concept_name: str
    status: str = "pending"  # "pending", "asked", "answered_correct", "answered_wrong", "skipped"
    student_answer: str = ""
    question: GrillQuestion | None = None
    children: list[str] = field(default_factory=list)  # child branch IDs

    def to_dict(self) -> dict[str, Any]:
        return {
            "concept_node_id": self.concept_node_id,
            "concept_name": self.concept_name,
            "status": self.status,
            "student_answer": self.student_answer,
            "question": self.question.to_dict() if self.question else None,
            "children": self.children,
        }


class GrillSession:
    """Manages a grill-me interview session.

    Walks the concept DAG as a decision tree, asking the student one
    question at a time about each concept. Each question includes a
    recommended answer. The session tracks which branches have been
    resolved and which still need exploration.

    The "codebase-first" heuristic: if the student has already submitted
    Cayley tables that demonstrate understanding of a concept, the system
    resolves that branch itself rather than asking.
    """

    # Question templates per concept type, with recommended answers.
    # These are the "grill" questions — designed to probe understanding,
    # not just recall.
    _QUESTION_BANK: dict[str, list[dict[str, Any]]] = {
        "set_basics": [
            {
                "question": "一个集合 {0, 1, 2} 上可以定义多少种不同的二元运算？",
                "answer": "有限集上二元运算的数量是 |S|^(|S|²)。3 元素集合有 3^9 = 19683 种。",
                "difficulty": 0.4,
                "type": "concept",
            },
            {
                "question": "如果运算结果不在集合里，这违反了哪条性质？",
                "answer": "封闭性。运算必须映射 S×S → S。",
                "difficulty": 0.2,
                "type": "concept",
            },
        ],
        "binary_operation": [
            {
                "question": "Cayley 表的每一行和每一列都必须包含所有元素吗？为什么？",
                "answer": "不一定——只有群才满足。一般的二元运算不要求每行每列都是双射。",
                "difficulty": 0.5,
                "type": "edge_case",
            },
            {
                "question": "如果 Cayley 表有重复元素，这说明什么？",
                "answer": "该运算在该行不是双射。对于群来说，这不可能发生（消去律）。",
                "difficulty": 0.6,
                "type": "edge_case",
            },
        ],
        "associativity": [
            {
                "question": "矩阵乘法满足结合律吗？减法呢？",
                "answer": "矩阵乘法满足 (AB)C = A(BC)。减法不满足：(a-b)-c ≠ a-(b-c)。",
                "difficulty": 0.4,
                "type": "application",
            },
            {
                "question": "为什么结合律对群的定义如此重要？没有它会怎样？",
                "answer": "没有结合律，a·b·c 的计算结果依赖括号位置，表达式失去唯一性。群论的大部分定理依赖结合律。",
                "difficulty": 0.7,
                "type": "concept",
            },
        ],
        "identity_element": [
            {
                "question": "一个群能有多个单位元吗？为什么？",
                "answer": "不能。若 e 和 f 都是单位元，则 e = e·f = f。唯一性由公理直接推出。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "在 Cayley 表中，单位元对应哪一行和哪一列？",
                "answer": "单位元 e 对应的行和列与表头完全相同（e·a = a·e = a）。",
                "difficulty": 0.4,
                "type": "application",
            },
        ],
        "inverse_element": [
            {
                "question": "群的每个元素的逆元唯一吗？如何证明？",
                "answer": "唯一。若 b 和 c 都是 a 的逆元，则 b = b·e = b·(a·c) = (b·a)·c = e·c = c。",
                "difficulty": 0.5,
                "type": "concept",
            },
            {
                "question": "在 Z₄ = {0,1,2,3} 中，2 的逆元是什么？",
                "answer": "2 的逆元是 2，因为 2+2 = 4 ≡ 0 (mod 4)。",
                "difficulty": 0.3,
                "type": "application",
            },
        ],
        "group_definition": [
            {
                "question": "群需要满足哪四条公理？能用自己的话说吗？",
                "answer": "封闭性（运算结果在集合内）、结合律（运算顺序无关）、单位元（存在不改变元素的元素）、逆元（每个元素都可逆）。",
                "difficulty": 0.4,
                "type": "concept",
            },
            {
                "question": "如果去掉逆元公理，还剩下什么结构？",
                "answer": "幺半群（monoid）：满足封闭性、结合律、单位元，但不要求逆元。",
                "difficulty": 0.7,
                "type": "edge_case",
            },
        ],
        "abelian_group": [
            {
                "question": "所有群都是交换群吗？给一个反例。",
                "answer": "不是。S₃（3次对称群）是非交换群，其中 (12)·(13) ≠ (13)·(12)。",
                "difficulty": 0.5,
                "type": "edge_case",
            },
            {
                "question": "4 阶群都是交换群吗？为什么？",
                "answer": "是的。4 阶群只有 Z₄ 和 Klein 四元群两种，且都交换。",
                "difficulty": 0.6,
                "type": "concept",
            },
        ],
        "cyclic_group": [
            {
                "question": "Z₆ 是循环群吗？它的生成元有哪些？",
                "answer": "是。生成元是 1 和 5（即与 6 互素的元素）。⟨1⟩ = ⟨5⟩ = Z₆。",
                "difficulty": 0.4,
                "type": "application",
            },
            {
                "question": "素数阶群一定是循环群吗？为什么？",
                "answer": "是的。由 Lagrange 定理，素数阶群没有非平凡子群，任意非单位元生成整个群。",
                "difficulty": 0.7,
                "type": "concept",
            },
        ],
        "subgroup": [
            {
                "question": "子群的阶一定整除群的阶吗？这个定理叫什么？",
                "answer": "是的。这就是 Lagrange 定理：|H| 整除 |G|。",
                "difficulty": 0.5,
                "type": "concept",
            },
            {
                "question": "Z₆ 有哪些子群？",
                "answer": "Z₆ 有 4 个子群：{0}、⟨2⟩={0,2,4}、⟨3⟩={0,3}、Z₆ 本身。",
                "difficulty": 0.6,
                "type": "application",
            },
        ],
        "lagrange_theorem": [
            {
                "question": "一个 12 阶群可能有哪些阶的子群？",
                "answer": "子群的阶必须整除 12：1, 2, 3, 4, 6, 12。但并非每种都一定存在。",
                "difficulty": 0.7,
                "type": "application",
            },
            {
                "question": "Lagrange 定理的逆命题成立吗？即每个整除 |G| 的数都对应一个子群吗？",
                "answer": "不成立。A₄ 有 12 个元素但没有 6 阶子群。逆命题对幂零群成立（Sylow 定理）。",
                "difficulty": 0.8,
                "type": "edge_case",
            },
        ],
        "functions_and_mappings": [
            {
                "question": "什么是单射、满射、双射？请用自己的话区分它们。",
                "answer": "单射：不同输入对应不同输出（一对一但不一定到）。满射：陪域中每个元素都被取到。双射：既单射又满射（一一对应）。",
                "difficulty": 0.25,
                "type": "concept",
            },
            {
                "question": "f: R → R, f(x) = x² 是单射、满射还是双射？为什么？",
                "answer": "既非单射也非满射。非单射：f(1)=f(-1)=1；非满射：负数没有原像（x²≥0）。",
                "difficulty": 0.3,
                "type": "edge_case",
            },
        ],
        "equivalence_relations": [
            {
                "question": "等价关系需要满足哪三条公理？",
                "answer": "自反性（a~a）、对称性（a~b 则 b~a）、传递性（a~b 且 b~c 则 a~c）。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "整数模 3 同余将 Z 分成几个等价类？分别是什么？",
                "answer": "分成 3 个等价类：[0]={...,−3,0,3,...}、[1]={...,−2,1,4,...}、[2]={...,−1,2,5,...}。",
                "difficulty": 0.35,
                "type": "application",
            },
        ],
        "cayley_table": [
            {
                "question": "如何从 Cayley 表判断运算是否满足交换律？",
                "answer": "看表是否关于主对角线对称。若 a*b 的格子等于 b*a 的格子对所有 a,b 成立，则交换。",
                "difficulty": 0.3,
                "type": "application",
            },
            {
                "question": "Cayley 表的拉丁方性质（每行每列无重复元素）与群的什么性质相关？",
                "answer": "与消去律相关。群满足消去律，因此 Cayley 表每行每列都是双射，即拉丁方。",
                "difficulty": 0.4,
                "type": "concept",
            },
        ],
        "commutativity": [
            {
                "question": "函数复合满足交换律吗？举例说明。",
                "answer": "一般不满足。f(x)=x², g(x)=x+1：f(g(x))=(x+1)²，g(f(x))=x²+1，两者不同。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "矩阵乘法满足交换律吗？给一个反例。",
                "answer": "一般不满足。例如取 A=[[1,1],[0,1]], B=[[1,0],[1,1]]，则 AB≠BA。",
                "difficulty": 0.35,
                "type": "edge_case",
            },
        ],
        "monoid": [
            {
                "question": "幺半群比半群多了什么条件？比群少了什么条件？",
                "answer": "比半群多了单位元。比群少了逆元条件——幺半群的元素未必有逆元。",
                "difficulty": 0.42,
                "type": "concept",
            },
            {
                "question": "字符串在拼接运算下构成什么代数结构？单位元是什么？",
                "answer": "构成幺半群。单位元是空串。非空字符串没有逆元（拼接不可能变短），所以不是群。",
                "difficulty": 0.4,
                "type": "application",
            },
        ],
        "finite_group": [
            {
                "question": "Cayley 定理告诉我们什么？每个有限群都同构于什么？",
                "answer": "每个有限群 G 都同构于某个对称群 S_n 的子群。即任何有限群都可表示为置换群。",
                "difficulty": 0.5,
                "type": "concept",
            },
            {
                "question": "有限群一定可以用 Cayley 表完全描述吗？无限群呢？",
                "answer": "有限群可以——Cayley 表列出所有元素的运算结果即可。无限群无法用有限表格描述。",
                "difficulty": 0.45,
                "type": "edge_case",
            },
        ],
        "group_order": [
            {
                "question": "群的阶和元素的阶有什么区别？",
                "answer": "群的阶 |G| 是群中元素的总数。元素 g 的阶是使 gⁿ=e 的最小正整数 n。两者含义不同。",
                "difficulty": 0.45,
                "type": "concept",
            },
            {
                "question": "S₃ 的阶是多少？它的元素有哪些阶？",
                "answer": "|S₃| = 6。元素阶有：恒等元阶 1，对换（如 (12)）阶 2，3-轮换（如 (123)）阶 3。",
                "difficulty": 0.5,
                "type": "application",
            },
        ],
        "cosets": [
            {
                "question": "什么是子群的陪集？左陪集 gH 和右陪集 Hg 一定相等吗？",
                "answer": "左陪集 gH={gh | h∈H}，右陪集 Hg={hg | h∈H}。不一定相等——仅当 H 正规时 gH=Hg 对所有 g 成立。",
                "difficulty": 0.65,
                "type": "concept",
            },
            {
                "question": "陪集一定是子群吗？为什么？",
                "answer": "不一定。只有当 g∈H 时 gH=H 才是子群。一般陪集 gH（g∉H）不含单位元，不构成子群。",
                "difficulty": 0.6,
                "type": "edge_case",
            },
        ],
        "normal_subgroup": [
            {
                "question": "正规子群有哪些等价定义？为什么它对构造商群很重要？",
                "answer": "等价定义：gNg⁻¹=N（对所有 g）；或 gN=Ng（对所有 g）。正规性保证陪集的乘法良定义，从而构造商群。",
                "difficulty": 0.7,
                "type": "concept",
            },
            {
                "question": "交换群的子群都是正规子群吗？非交换群呢？给一个非正规子群的例子。",
                "answer": "交换群的子群都正规（因 gH=Hg 自动成立）。非交换群不一定：S₃ 中子群 {e,(12)} 不正规，因为 (13)(12)(13)⁻¹=(23) 不在该子群中。",
                "difficulty": 0.75,
                "type": "edge_case",
            },
        ],
        "quotient_group": [
            {
                "question": "商群 G/N 的元素是什么？运算如何定义？为什么需要 N 正规？",
                "answer": "元素是 N 的陪集 gN。运算 (aN)(bN)=(ab)N。需要 N 正规才能保证运算良定义（与代表元选取无关）。",
                "difficulty": 0.75,
                "type": "concept",
            },
            {
                "question": "S₃/A₃ 同构于什么群？商群的阶是多少？",
                "answer": "S₃/A₃ ≅ Z₂。|S₃/A₃| = |S₃|/|A₃| = 6/3 = 2，而 2 阶群只有 Z₂。",
                "difficulty": 0.7,
                "type": "application",
            },
        ],
        "group_homomorphism": [
            {
                "question": "群同态的定义是什么？同态的核和像分别是什么？",
                "answer": "同态 φ:G→H 满足 φ(ab)=φ(a)φ(b)。核 ker φ={g∈G | φ(g)=e_H}，是 G 的正规子群。像 im φ=φ(G)，是 H 的子群。",
                "difficulty": 0.7,
                "type": "concept",
            },
            {
                "question": "同态一定是同构吗？两者有什么区别？行列式映射 det:GL_n(R)→R* 是同构吗？",
                "answer": "同态不一定是同构——同构要求双射。det 是同态但非同构（非单射：不同矩阵可有相同行列式）。",
                "difficulty": 0.65,
                "type": "edge_case",
            },
        ],
        "isomorphism_theorem": [
            {
                "question": "第一同构定理的内容是什么？",
                "answer": "若 φ:G→H 是群同态，则 G/ker φ ≅ im φ。即同态的核决定的商群同构于同态的像。",
                "difficulty": 0.8,
                "type": "concept",
            },
            {
                "question": "用第一同构定理说明 R/Z ≅ S¹（圆周群）。",
                "answer": "考虑映射 φ:R→S¹, x↦e^(2πix)。这是满同态，ker φ=Z（因为 e^(2πix)=1 当且仅当 x∈Z）。由第一同构定理，R/Z ≅ S¹。",
                "difficulty": 0.85,
                "type": "application",
            },
        ],
        "symmetric_group": [
            {
                "question": "对称群 S_n 是什么？它的阶是多少？S₃ 是交换群吗？",
                "answer": "S_n 是 n 个元素上全体置换构成的群。|S_n|=n!。S₃（6阶）是最小非交换群。",
                "difficulty": 0.7,
                "type": "concept",
            },
            {
                "question": "将置换 (1→2, 2→3, 3→1, 4→4) 写成轮换形式，它的阶是多少？",
                "answer": "写成轮换 (1 2 3)。这是一个 3-轮换，阶为 3，即 (1 2 3)³=恒等。",
                "difficulty": 0.65,
                "type": "application",
            },
        ],
        "cauchy_theorem": [
            {
                "question": "Cauchy 定理的内容是什么？它和 Lagrange 定理有什么关系？",
                "answer": "Cauchy 定理：若素数 p 整除 |G|，则 G 中存在 p 阶元。它是 Lagrange 定理的部分逆——Lagrange 说子群阶整除群阶，Cauchy 说素数因子对应的元素一定存在。",
                "difficulty": 0.75,
                "type": "concept",
            },
            {
                "question": "一个 12 阶群一定有哪些阶的元素？",
                "answer": "12=2²×3。由 Cauchy 定理，必存在 2 阶元和 3 阶元。但不一定有 4 阶或 6 阶元。",
                "difficulty": 0.7,
                "type": "application",
            },
        ],
    }

    # Default question for concepts not in the bank
    _DEFAULT_QUESTION = {
        "question": "你能用自己的话解释「{name}」这个概念吗？",
        "answer": "{name}：{description}",
        "difficulty": 0.5,
        "type": "concept",
    }

    # Question banks for other curriculum levels
    _QUESTION_BANK_ELEMENTARY: dict[str, list[dict[str, Any]]] = {
        "number_recognition": [
            {
                "question": "自然数 0、1、2、3... 有什么共同特点？",
                "answer": "自然数从 0 或 1 开始，每个数比前一个多 1，可以无限延续。",
                "difficulty": 0.1,
                "type": "concept",
            },
            {
                "question": "最大的自然数是多少？",
                "answer": "没有最大的自然数。无论你选多大的数，总能再加 1 得到更大的数。",
                "difficulty": 0.2,
                "type": "edge_case",
            },
        ],
        "addition_subtraction": [
            {
                "question": "3 + 5 和 5 + 3 的结果一样吗？为什么？",
                "answer": "一样。3+5=8，5+3=8。这叫加法交换律：a+b = b+a。",
                "difficulty": 0.15,
                "type": "concept",
            },
            {
                "question": "12 - 5 = 7，那 12 - 7 等于多少？为什么？",
                "answer": "12 - 7 = 5。因为减法是加法的逆运算：12 - 5 = 7 意味着 5 + 7 = 12。",
                "difficulty": 0.2,
                "type": "concept",
            },
        ],
        "multiplication_division": [
            {
                "question": "6 × 7 = 42，那 42 ÷ 6 等于多少？为什么？",
                "answer": "42 ÷ 6 = 7。因为乘法和除法互为逆运算。",
                "difficulty": 0.25,
                "type": "application",
            },
            {
                "question": "为什么 0 不能做除数？",
                "answer": "因为如果 5 ÷ 0 = ?，那么 ? × 0 应该等于 5，但任何数乘 0 都等于 0，所以不存在这样的数。",
                "difficulty": 0.3,
                "type": "edge_case",
            },
        ],
        "arithmetic_laws": [
            {
                "question": "什么是分配律？用具体例子说明。",
                "answer": "a × (b+c) = a×b + a×c。例如 3×(2+4) = 3×2+3×4 = 6+12 = 18，也等于 3×6 = 18。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "交换律和结合律对所有运算都成立吗？减法和除法满足交换律吗？",
                "answer": "不成立。交换律和结合律只对加法和乘法成立。减法和除法不满足交换律：a-b≠b-a，a÷b≠b÷a（一般情况下）。除法也不满足结合律。",
                "difficulty": 0.3,
                "type": "edge_case",
            },
        ],
        "fraction_concept": [
            {
                "question": "1/2 和 2/4 哪个大？为什么？",
                "answer": "一样大。2/4 分子分母同除以 2 就得到 1/2。这叫约分。",
                "difficulty": 0.25,
                "type": "concept",
            },
            {
                "question": "分母不同的分数能直接比较大小吗？",
                "answer": "不能直接比较。需要先通分（找公分母），化为同分母分数后再比较分子。",
                "difficulty": 0.35,
                "type": "application",
            },
        ],
        "area": [
            {
                "question": "长方形的面积怎么算？如果长 5 米宽 3 米，面积是多少？",
                "answer": "面积 = 长 × 宽 = 5 × 3 = 15 平方米。",
                "difficulty": 0.2,
                "type": "application",
            },
            {
                "question": "面积和周长有什么区别？",
                "answer": "周长是图形一周的长度（一维），面积是图形内部的大小（二维）。单位也不同：周长用米，面积用平方米。",
                "difficulty": 0.3,
                "type": "concept",
            },
        ],
        "place_value": [
            {
                "question": "在数字 345 中，3、4、5 分别表示什么？这体现了什么原理？",
                "answer": "3 表示 3 个百，4 表示 4 个十，5 表示 5 个一。这体现了十进制位值原理：同一个数字在不同数位表示不同的值。",
                "difficulty": 0.12,
                "type": "concept",
            },
            {
                "question": "三百零五写成数字是多少？为什么中间的 0 不能省略？",
                "answer": "写成 305。0 起占位作用：省略后变成 35，表示三十五而非三百零五。0 的占位是位值制的核心。",
                "difficulty": 0.15,
                "type": "edge_case",
            },
        ],
        "perimeter": [
            {
                "question": "什么是周长？长方形周长怎么算？",
                "answer": "周长是封闭图形一周的长度。长方形周长 =（长+宽）×2。",
                "difficulty": 0.2,
                "type": "concept",
            },
            {
                "question": "正方形边长 5 厘米，周长是多少？用 20 厘米铁丝围成正方形，边长是多少？",
                "answer": "正方形周长 = 5×4 = 20 厘米。反过来，20 厘米铁丝围成正方形，边长 = 20÷4 = 5 厘米。",
                "difficulty": 0.2,
                "type": "application",
            },
        ],
        "angle": [
            {
                "question": "角的大小和边的长短有关系吗？为什么？",
                "answer": "没有关系。角的大小由两边张开的程度决定，与边的长短无关。边延长但张开程度不变，角的大小不变。",
                "difficulty": 0.25,
                "type": "concept",
            },
            {
                "question": "直角是多少度？锐角和钝角分别在什么范围？",
                "answer": "直角是 90°。锐角小于 90°，钝角大于 90° 且小于 180°。",
                "difficulty": 0.22,
                "type": "application",
            },
        ],
        "four_operations": [
            {
                "question": "四则混合运算的顺序规则是什么？",
                "answer": "先乘除后加减，同级运算从左到右。有括号时先算括号内，多层括号从内到外。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "计算 3 + 4 × 5 和（3 + 4）× 5，结果一样吗？为什么？",
                "answer": "不一样。3+4×5 = 3+20 = 23（先乘后加）；（3+4）×5 = 7×5 = 35（先算括号）。括号改变了运算顺序导致结果不同。",
                "difficulty": 0.3,
                "type": "application",
            },
        ],
        "decimal_concept": [
            {
                "question": "0.3 元等于几角？小数和分数有什么关系？",
                "answer": "0.3 元 = 3 角。小数是分数的另一种写法：0.3 = 3/10（十分之三）。",
                "difficulty": 0.36,
                "type": "concept",
            },
            {
                "question": "0.3 和 0.29 哪个大？为什么不能只看位数多少？",
                "answer": "0.3 更大。0.3 = 0.30，而 0.30 > 0.29。比较小数要从最高位开始逐位比较，不能只看小数位数的多少。",
                "difficulty": 0.35,
                "type": "edge_case",
            },
        ],
        "triangle_properties": [
            {
                "question": "三角形的内角和是多少度？为什么？",
                "answer": "180°。可以将三角形的三个角剪下拼在一起，正好拼成一个平角（180°），也可用平行线辅助证明。",
                "difficulty": 0.35,
                "type": "concept",
            },
            {
                "question": "三条边长分别是 3 厘米、4 厘米、8 厘米，能组成三角形吗？为什么？",
                "answer": "不能。三角形任意两边之和必须大于第三边，但 3+4=7 < 8，所以不能组成三角形。",
                "difficulty": 0.33,
                "type": "edge_case",
            },
        ],
        "bar_chart": [
            {
                "question": "条形统计图适合表示什么？它由哪些部分组成？",
                "answer": "适合表示各类数量的多少。由标题、横轴、纵轴、单位和条形组成，条形的高度反映数据大小。",
                "difficulty": 0.28,
                "type": "concept",
            },
            {
                "question": "从条形统计图中能看出什么信息？纵轴单位不一致会有什么问题？",
                "answer": "能看出各类数据的多少及大小比较。纵轴单位不一致会导致图形失真，误导判断，因此必须统一单位。",
                "difficulty": 0.3,
                "type": "edge_case",
            },
        ],
        "average": [
            {
                "question": "平均数怎么算？它表示什么？",
                "answer": "平均数 = 总数 ÷ 份数。它表示一组数据的整体水平（集中趋势）。",
                "difficulty": 0.32,
                "type": "concept",
            },
            {
                "question": "一组数据的平均数一定等于其中一个数据吗？极端值对平均数有什么影响？",
                "answer": "不一定等于某个数据。极端值（特别大或特别小）会拉高或拉低平均数，使平均数不能很好代表整体水平。",
                "difficulty": 0.35,
                "type": "edge_case",
            },
        ],
        "word_problems": [
            {
                "question": "解应用题的关键步骤是什么？",
                "answer": "1. 读懂题目提取关键信息；2. 分析数量关系确定运算方法；3. 正确列式计算；4. 检验结果的合理性。",
                "difficulty": 0.35,
                "type": "concept",
            },
            {
                "question": "鸡兔同笼，头共 10 个，脚共 28 只，鸡兔各几只？",
                "answer": "用假设法：假设全是鸡，则脚有 10×2=20 只，少了 28-20=8 只。每把一只鸡换成兔多 2 只脚，所以兔 = 8÷2=4 只，鸡 = 10-4=6 只。验算：6×2+4×4=12+16=28。",
                "difficulty": 0.38,
                "type": "application",
            },
        ],
        "percentage": [
            {
                "question": "百分数表示什么？及格率 85% 是什么意思？",
                "answer": "百分数表示一个数是另一个数的百分之几。及格率 85% 表示 100 人中约有 85 人及格。",
                "difficulty": 0.42,
                "type": "concept",
            },
            {
                "question": "一件商品打八折出售，是按原价的百分之几卖？如果原价 100 元，现价多少？",
                "answer": "八折 = 原价的 80%。现价 = 100×80% = 80 元。注意百分数不带单位。",
                "difficulty": 0.42,
                "type": "application",
            },
        ],
        "ratio_proportion": [
            {
                "question": "什么是比？糖和水的比是 1:10 是什么意思？",
                "answer": "比表示两个量之间的倍数关系。糖:水=1:10 表示糖占 1 份，水占 10 份，水是糖的 10 倍。",
                "difficulty": 0.45,
                "type": "concept",
            },
            {
                "question": "速度一定时，路程和时间成什么比例？路程一定时，速度和时间成什么比例？",
                "answer": "速度一定时路程和时间成正比例（比值一定）。路程一定时速度和时间成反比例（乘积一定）。",
                "difficulty": 0.45,
                "type": "application",
            },
        ],
        "volume": [
            {
                "question": "体积和面积有什么区别？体积的常用单位是什么？",
                "answer": "面积是二维的大小（平面），体积是三维的大小（空间）。体积单位有立方厘米、立方米等，相邻单位进率为 1000。",
                "difficulty": 0.6,
                "type": "concept",
            },
            {
                "question": "长方体长 5 厘米宽 4 厘米高 3 厘米，体积是多少？1 立方米等于多少立方分米？",
                "answer": "体积 = 5×4×3 = 60 立方厘米。1 立方米 = 1000 立方分米（相邻体积单位进率是 1000，不是 100）。",
                "difficulty": 0.58,
                "type": "application",
            },
        ],
    }

    _QUESTION_BANK_MIDDLE_SCHOOL: dict[str, list[dict[str, Any]]] = {
        "rational_numbers": [
            {
                "question": "有理数包括哪些数？-3、1/2、0.5、√2 中哪些是有理数？",
                "answer": "有理数 = 整数 + 分数。-3、1/2、0.5 是有理数，√2 不是（它不能写成 p/q 的形式）。",
                "difficulty": 0.25,
                "type": "concept",
            },
            {
                "question": "(-2)×(-3) 等于多少？负负得正的原理是什么？",
                "answer": "(-2)×(-3) = 6。可以用分配律证明：(-2)×(3+(-3)) = 0，展开后得 -6 + (-2)×(-3) = 0，所以 (-2)×(-3) = 6。",
                "difficulty": 0.35,
                "type": "concept",
            },
        ],
        "linear_equation": [
            {
                "question": "解方程 2x + 5 = 11，你是怎么想的？",
                "answer": "两边减5：2x = 6；两边除2：x = 3。核心是\"两边同时做相同运算保持等式成立\"。",
                "difficulty": 0.3,
                "type": "application",
            },
            {
                "question": "移项时为什么要注意变号？",
                "answer": "移项本质是在等式两边加减同一个数。从 2x+5=11 移5到右边：2x = 11-5，5 变成了 -5，因为做的是减法。",
                "difficulty": 0.35,
                "type": "concept",
            },
        ],
        "pythagorean_theorem": [
            {
                "question": "直角三角形两直角边 3 和 4，斜边多长？",
                "answer": "3²+4²=9+16=25=5²，所以斜边 = 5。这就是经典的勾三股四弦五。",
                "difficulty": 0.3,
                "type": "application",
            },
            {
                "question": "勾股定理的逆定理是什么？有什么用？",
                "answer": "如果 a²+b²=c²，则该三角形是直角三角形。用于判断三角形是否为直角三角形，如边长 5,12,13：25+144=169=13²。",
                "difficulty": 0.5,
                "type": "concept",
            },
        ],
        "function_concept": [
            {
                "question": "什么是函数？y=2x+1 是函数吗？",
                "answer": "函数是对每个输入 x 唯一对应一个输出 y 的规则。y=2x+1 是函数，每个 x 对应唯一的 y。",
                "difficulty": 0.35,
                "type": "concept",
            },
            {
                "question": "函数和方程有什么区别？",
                "answer": "方程是\"求解未知数使等式成立\"，函数是\"给定输入得到输出\"。方程 2x+1=5 求 x=2；函数 y=2x+1 描述 y 和 x 的整体关系。",
                "difficulty": 0.45,
                "type": "concept",
            },
        ],
        "congruent_triangles": [
            {
                "question": "两个三角形有三边对应相等，它们全等吗？这叫什么判定？",
                "answer": "全等。这叫 SSS 判定。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "SSA 能判定全等吗？为什么？",
                "answer": "不能。已知两边和其中一边的对角，可能画出两个不同的三角形，所以不能唯一确定。",
                "difficulty": 0.5,
                "type": "edge_case",
            },
        ],
        "real_numbers": [
            {
                "question": "什么是无理数？√2 是有理数还是无理数？",
                "answer": "无理数是无限不循环小数，不能表示为 p/q（p,q 为整数）的形式。√2 是无理数——可用反证法证明它不能写成既约分数。",
                "difficulty": 0.32,
                "type": "concept",
            },
            {
                "question": "81 的平方根是多少？算术平方根是多少？两者有何区别？",
                "answer": "平方根是 ±9，算术平方根是 9。平方根包含正负两个值，算术平方根只取非负的那个。",
                "difficulty": 0.33,
                "type": "application",
            },
        ],
        "absolute_value": [
            {
                "question": "绝对值的几何意义是什么？|-5| 等于多少？",
                "answer": "绝对值表示数轴上该点到原点的距离。|-5| = 5，因为 -5 到原点的距离是 5。",
                "difficulty": 0.34,
                "type": "concept",
            },
            {
                "question": "|a| = a 一定成立吗？什么情况下不成立？解方程 |x| = 4。",
                "answer": "不一定。当 a<0 时 |a| = -a，不是 a。解 |x| = 4 得 x = ±4（距原点为 4 的点有两个）。",
                "difficulty": 0.35,
                "type": "edge_case",
            },
        ],
        "polynomial": [
            {
                "question": "单项式 -3x²y 的系数和次数分别是什么？",
                "answer": "系数是 -3（字母前的数字因数）。次数是 2+1=3（所有字母指数之和）。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "合并同类项：3x²y + 2x²y = ？什么才算同类项？",
                "answer": "3x²y + 2x²y = 5x²y。同类项指字母部分完全相同（相同字母相同指数）的项，只对系数进行加减。",
                "difficulty": 0.3,
                "type": "application",
            },
        ],
        "polynomial_operations": [
            {
                "question": "去括号时要注意什么？-(a-b+c) 等于什么？",
                "answer": "括号前是负号时，去括号后括号内各项都要变号。-(a-b+c) = -a+b-c。",
                "difficulty": 0.4,
                "type": "concept",
            },
            {
                "question": "化简 (3x²+2x-1) + (2x²-x+4)。去括号容易犯什么错误？",
                "answer": "= 3x²+2x-1+2x²-x+4 = 5x²+x+3。常见错误：括号前是负号时忘记变号，或漏乘括号外的系数。",
                "difficulty": 0.38,
                "type": "application",
            },
        ],
        "factoring": [
            {
                "question": "因式分解和整式乘法是什么关系？",
                "answer": "互逆关系。整式乘法是把乘积展开成多项式，因式分解是把多项式化为若干整式的乘积。",
                "difficulty": 0.5,
                "type": "concept",
            },
            {
                "question": "把 x²-9 和 x²+5x+6 因式分解，分别用了什么方法？",
                "answer": "x²-9 = (x+3)(x-3)（平方差公式）。x²+5x+6 = (x+2)(x+3)（十字相乘法）。",
                "difficulty": 0.48,
                "type": "application",
            },
        ],
        "linear_inequality": [
            {
                "question": "解不等式时，什么时候要改变不等号方向？为什么？",
                "answer": "两边同乘或同除以一个负数时要变号。例如 -2x > 0 两边除以 -2 得 x < 0。因为乘除负数改变了大小关系。",
                "difficulty": 0.46,
                "type": "concept",
            },
            {
                "question": "解 -2x > 6，结果是什么？如果写成 x > -3 错在哪里？",
                "answer": "正确结果是 x < -3。错误原因：两边除以 -2 时忘记改变不等号方向。这是最常见的错误。",
                "difficulty": 0.45,
                "type": "edge_case",
            },
        ],
        "quadratic_equation": [
            {
                "question": "判别式 Δ = b²-4ac 如何判断一元二次方程根的情况？",
                "answer": "Δ>0：两个不相等实数根；Δ=0：两个相等实数根（重根）；Δ<0：无实数根。",
                "difficulty": 0.6,
                "type": "concept",
            },
            {
                "question": "解方程 x²-5x+6=0，可以用哪些方法？韦达定理如何验证？",
                "answer": "因式分解：(x-2)(x-3)=0，x=2 或 x=3。韦达定理验证：两根和 2+3=5=-(-5)/1 ✓，两根积 2×3=6 ✓。",
                "difficulty": 0.58,
                "type": "application",
            },
        ],
        "linear_function": [
            {
                "question": "一次函数 y=kx+b 中 k 和 b 的几何意义是什么？",
                "answer": "k 是斜率（直线的倾斜程度，决定增减性），b 是 y 轴截距（直线与 y 轴交点的纵坐标）。",
                "difficulty": 0.6,
                "type": "concept",
            },
            {
                "question": "k>0 时函数递增还是递减？正比例函数 y=kx 是一次函数的什么情况？",
                "answer": "k>0 时 y 随 x 增大而增大（递增）。正比例函数 y=kx 是 b=0 的特殊一次函数（过原点）。",
                "difficulty": 0.55,
                "type": "application",
            },
        ],
        "quadratic_function": [
            {
                "question": "二次函数 y=ax²+bx+c 的图像是什么？a 的正负决定什么？",
                "answer": "图像是抛物线。a>0 开口向上（有最小值），a<0 开口向下（有最大值）。",
                "difficulty": 0.7,
                "type": "concept",
            },
            {
                "question": "y=x²-2x-3 的顶点坐标和对称轴是什么？用配方法求。",
                "answer": "配方：y=(x-1)²-4。顶点 (1,-4)，对称轴 x=1。对称轴公式 x=-b/(2a)=-(-2)/2=1 也可验证。",
                "difficulty": 0.68,
                "type": "application",
            },
        ],
        "triangle": [
            {
                "question": "三角形三边关系是什么？判断 3、4、8 能否构成三角形。",
                "answer": "任意两边之和大于第三边。3+4=7<8，不满足，所以不能构成三角形。",
                "difficulty": 0.28,
                "type": "concept",
            },
            {
                "question": "已知三角形两个内角 50° 和 60°，第三个角是多少？钝角三角形的高一定在三角形内部吗？",
                "answer": "第三角 = 180°-50°-60° = 70°。钝角三角形有两条高在三角形外部（因为钝角的对边上的高需要向外延伸）。",
                "difficulty": 0.3,
                "type": "edge_case",
            },
        ],
        "similar_triangles": [
            {
                "question": "相似三角形的相似比和面积比是什么关系？全等是相似的特例吗？",
                "answer": "面积比 = 相似比的平方。例如相似比 1:2 则面积比 1:4。全等是相似比为 1:1 的特殊相似。",
                "difficulty": 0.62,
                "type": "concept",
            },
            {
                "question": "如何用相似三角形测量旗杆高度（影长法）？需要测量哪些量？",
                "answer": "同一时刻，物高与影长成正比。测出标杆高 h₁ 和影长 l₁，再测旗杆影长 l₂，则旗杆高 h₂ = h₁×l₂/l₁。依据是相似三角形对应边成比例。",
                "difficulty": 0.6,
                "type": "application",
            },
        ],
        "circle": [
            {
                "question": "圆周角定理是什么？圆周角和所对弧上的圆心角有什么关系？",
                "answer": "圆周角等于所对弧上圆心角的一半。例如直径所对的圆周角 = 180°/2 = 90°。",
                "difficulty": 0.65,
                "type": "concept",
            },
            {
                "question": "切线有什么性质？过切点的半径与切线是什么关系？",
                "answer": "切线垂直于过切点的半径。这是切线的核心性质，常用于证明垂直和计算距离。",
                "difficulty": 0.62,
                "type": "application",
            },
        ],
        "solid_geometry": [
            {
                "question": "圆柱和圆锥的体积公式分别是什么？圆锥体积是等底等高圆柱的几分之几？",
                "answer": "圆柱 V=πr²h，圆锥 V=(1/3)πr²h。圆锥体积是等底等高圆柱的 1/3。",
                "difficulty": 0.64,
                "type": "concept",
            },
            {
                "question": "球的体积和表面积公式是什么？计算时容易遗漏什么？",
                "answer": "体积 V=(4/3)πr³，表面积 S=4πr²。容易遗漏圆锥体积的 1/3 系数，以及混淆表面积和体积公式。",
                "difficulty": 0.62,
                "type": "application",
            },
        ],
        "data_analysis": [
            {
                "question": "平均数、中位数、众数各表示什么？它们一定相等吗？",
                "answer": "平均数是所有数据的平均值，中位数是排序后中间的数，众数是出现次数最多的数。它们不一定相等。",
                "difficulty": 0.35,
                "type": "concept",
            },
            {
                "question": "数据 80, 85, 90, 90, 95 的平均数、中位数、众数分别是什么？",
                "answer": "平均数 = (80+85+90+90+95)/5 = 88，中位数 = 90（排序后中间值），众数 = 90（出现两次最多）。",
                "difficulty": 0.35,
                "type": "application",
            },
        ],
        "probability": [
            {
                "question": "古典概型的概率怎么计算？必然事件和不可能事件的概率分别是多少？",
                "answer": "P(A) = 事件A包含的等可能结果数 / 总等可能结果数。必然事件概率 1，不可能事件概率 0。",
                "difficulty": 0.48,
                "type": "concept",
            },
            {
                "question": "掷一枚均匀骰子，出现偶数的概率是多少？掷两枚骰子点数和为 7 的概率呢？",
                "answer": "出现偶数：{2,4,6} 共 3 个，P=3/6=1/2。两骰子和为 7：共 36 种等可能，和为 7 有 (1,6),(2,5),(3,4),(4,3),(5,2),(6,1) 共 6 种，P=6/36=1/6。",
                "difficulty": 0.5,
                "type": "application",
            },
        ],
    }

    _QUESTION_BANK_HIGH_SCHOOL: dict[str, list[dict[str, Any]]] = {
        "set_theory": [
            {
                "question": "集合 {1,2,3} 和 {3,2,1} 是同一个集合吗？",
                "answer": "是的。集合中的元素无序，{1,2,3}={3,2,1}。",
                "difficulty": 0.3,
                "type": "concept",
            },
            {
                "question": "空集是任何集合的子集吗？为什么？",
                "answer": "是的。空集不含任何元素，自然满足\"空集的元素都在任何集合中\"这个条件（空集没有元素需要验证）。",
                "difficulty": 0.4,
                "type": "concept",
            },
        ],
        "function_concept_hs": [
            {
                "question": "f(x)=x² 和 f(x)=|x| 都是函数吗？它们的定义域和值域是什么？",
                "answer": "都是函数。f(x)=x² 定义域 R，值域 [0,+∞)；f(x)=|x| 定义域 R，值域 [0,+∞)。",
                "difficulty": 0.35,
                "type": "concept",
            },
            {
                "question": "如何判断一个对应关系是否为函数？",
                "answer": "每个输入必须有唯一输出。如果有 x 对应多个 y，则不是函数。可用竖线测试判断。",
                "difficulty": 0.4,
                "type": "concept",
            },
        ],
        "limit_concept": [
            {
                "question": "lim(x→0) sin(x)/x 等于多少？为什么？",
                "answer": "等于 1。这是重要极限。可用夹逼定理证明：当 x→0 时，cos(x) < sin(x)/x < 1，两侧极限都是 1。",
                "difficulty": 0.6,
                "type": "application",
            },
            {
                "question": "函数在某点的极限存在，但函数值可以不存在吗？",
                "answer": "可以。例如 f(x) = (x²-1)/(x-1) 在 x=1 处无定义（分母为0），但极限 lim(x→1) f(x) = 2 存在。",
                "difficulty": 0.55,
                "type": "edge_case",
            },
        ],
        "derivative_concept": [
            {
                "question": "导数的几何意义是什么？物理意义是什么？",
                "answer": "几何意义是切线斜率。物理意义是瞬时变化率（如速度是位移对时间的导数）。",
                "difficulty": 0.45,
                "type": "concept",
            },
            {
                "question": "f(x)=|x| 在 x=0 处可导吗？为什么？",
                "answer": "不可导。左导数 = -1，右导数 = +1，左右导数不相等，所以在 x=0 处不可导。但函数在 x=0 处连续。",
                "difficulty": 0.6,
                "type": "edge_case",
            },
        ],
        "conic_sections": [
            {
                "question": "椭圆和圆有什么关系？",
                "answer": "圆是椭圆的特例——当两个焦点重合时（即焦距为0），椭圆就变成了圆。",
                "difficulty": 0.4,
                "type": "concept",
            },
            {
                "question": "抛物线的离心率是多少？双曲线呢？",
                "answer": "抛物线离心率 e=1，双曲线 e>1，椭圆 0<e<1，圆 e=0。",
                "difficulty": 0.5,
                "type": "concept",
            },
        ],
        "set_operations": [
            {
                "question": "德摩根律的内容是什么？用集合符号表示。",
                "answer": "∁(A∪B) = (∁A)∩(∁B)，∁(A∩B) = (∁A)∪(∁B)。即并集的补等于补集的交集，交集的补等于补集的并集。",
                "difficulty": 0.35,
                "type": "concept",
            },
            {
                "question": "A={1,2,3}, B={2,3,4}，求 A∩B、A∪B 和 A-B（差集）。",
                "answer": "A∩B = {2,3}（公共元素），A∪B = {1,2,3,4}（所有元素），A-B = {1}（A 中有但 B 中没有的元素）。",
                "difficulty": 0.33,
                "type": "application",
            },
        ],
        "logic_propositions": [
            {
                "question": "充分条件和必要条件的区别是什么？用 p→q 解释。",
                "answer": "在 p→q 中，p 是 q 的充分条件（有 p 必有 q），q 是 p 的必要条件（有 q 不一定有 p，但没 q 必没 p）。充要条件是 p↔q。",
                "difficulty": 0.38,
                "type": "concept",
            },
            {
                "question": "「x>2」是「x²>4」的什么条件？反过来呢？",
                "answer": "「x>2」是「x²>4」的充分不必要条件（x>2 必有 x²>4，但 x²>4 时 x 也可能 <-2，如 x=-3）。反过来「x²>4」是「x>2」的必要不充分条件。",
                "difficulty": 0.42,
                "type": "edge_case",
            },
        ],
        "proof_by_contradiction": [
            {
                "question": "反证法的基本步骤是什么？它基于什么逻辑原理？",
                "answer": "步骤：假设结论不成立→推出矛盾（与已知、公理或定理矛盾）→假设错误，原结论成立。基于排中律：一个命题非真即假，否定被排除则原命题为真。",
                "difficulty": 0.45,
                "type": "concept",
            },
            {
                "question": "用反证法证明 √2 是无理数的核心思路是什么？",
                "answer": "假设 √2 是有理数 p/q（p,q 互质），则 p²=2q²，故 p² 是偶数，p 是偶数。设 p=2k，得 4k²=2q²，q²=2k²，q 也是偶数。p,q 都是偶数与互质矛盾，故假设错误。",
                "difficulty": 0.5,
                "type": "application",
            },
        ],
        "monotonicity": [
            {
                "question": "如何用定义法证明函数的单调性？关键步骤是什么？",
                "answer": "设 x₁<x₂ 在区间内，计算 f(x₁)-f(x₂) 的符号。若恒为负则递增（f(x₁)<f(x₂)），恒为正则递减。关键在于变形后判断差值的正负。",
                "difficulty": 0.48,
                "type": "concept",
            },
            {
                "question": "f(x)=x² 在哪个区间递减，哪个区间递增？奇函数一定单调吗？",
                "answer": "f(x)=x² 在 (-∞,0) 递减，在 (0,+∞) 递增。奇函数不一定单调——如 f(x)=x³-x 是奇函数但在某些区间递增、某些递减。",
                "difficulty": 0.48,
                "type": "edge_case",
            },
        ],
        "exponential_function": [
            {
                "question": "指数函数 y=aˣ 的底数 a 有什么限制？a>1 和 0<a<1 时图像有什么不同？",
                "answer": "要求 a>0 且 a≠1。a>1 时图像上升（递增），0<a<1 时图像下降（递减）。两者都过定点 (0,1)，值域都是 (0,+∞)。",
                "difficulty": 0.58,
                "type": "concept",
            },
            {
                "question": "指数函数和幂函数有什么区别？y=2ˣ 和 y=x² 一样吗？",
                "answer": "不同。指数函数 y=aˣ 中底数 a 是常数、指数 x 是变量；幂函数 y=xⁿ 中底数 x 是变量、指数 n 是常数。y=2ˣ 增长远快于 y=x²（x→∞ 时），且前者恒正。",
                "difficulty": 0.6,
                "type": "edge_case",
            },
        ],
        "logarithmic_function": [
            {
                "question": "对数函数和指数函数是什么关系？换底公式是什么？",
                "answer": "对数函数 y=log_a(x) 是指数函数 y=aˣ 的反函数（图像关于 y=x 对称）。换底公式：log_a(b) = log_c(b) / log_c(a)。",
                "difficulty": 0.62,
                "type": "concept",
            },
            {
                "question": "log_a(M+N) = log_a(M) + log_a(N) 成立吗？正确的对数运算性质是什么？",
                "answer": "不成立！正确的是 log_a(M·N) = log_a(M) + log_a(N)（积的对数=对数之和），log_a(M/N) = log_a(M) - log_a(N)，log_a(Mⁿ) = n·log_a(M)。log_a(M+N) 没有简化公式。",
                "difficulty": 0.6,
                "type": "edge_case",
            },
        ],
        "trig_definition": [
            {
                "question": "弧度制和角度制如何互化？30° 等于多少弧度？",
                "answer": "180° = π 弧度，所以 1° = π/180 弧度，1 弧度 = 180°/π。30° = 30×π/180 = π/6 弧度。",
                "difficulty": 0.52,
                "type": "concept",
            },
            {
                "question": "各象限中 sin、cos、tan 的符号是怎样的？tanα=0 时 α 可能是多少？",
                "answer": "一象限全正；二象限 sin 正、cos 负、tan 负；三象限 tan 正、sin cos 负；四象限 cos 正、sin 负、tan 负。tanα=0 当 α=kπ（k 为整数），此时 sinα=0，cosα=±1。",
                "difficulty": 0.5,
                "type": "application",
            },
        ],
        "trig_identities": [
            {
                "question": "两角差的余弦公式是什么？二倍角公式是什么？",
                "answer": "cos(α-β) = cosα·cosβ + sinα·sinβ。二倍角公式：sin2α=2sinα·cosα，cos2α=cos²α-sin²α=2cos²α-1=1-2sin²α。",
                "difficulty": 0.7,
                "type": "concept",
            },
            {
                "question": "sin(α+β) = sinα + sinβ 成立吗？给出反例。",
                "answer": "不成立！正确公式是 sin(α+β) = sinα·cosβ + cosα·sinβ。反例：α=β=π/2 时，sin(π/2+π/2)=sinπ=0，但 sin(π/2)+sin(π/2)=1+1=2≠0。",
                "difficulty": 0.68,
                "type": "edge_case",
            },
        ],
        "sequence_concept": [
            {
                "question": "数列的通项公式和递推公式有什么区别？",
                "answer": "通项公式 aₙ=f(n) 直接给出第 n 项与 n 的关系。递推公式给出 aₙ 与前面项的关系（如 aₙ=aₙ₋₁+d），需要逐步推出。递推公式不一定能写出通项公式。",
                "difficulty": 0.48,
                "type": "concept",
            },
            {
                "question": "斐波那契数列的递推公式是什么？它有通项公式吗？",
                "answer": "递推：a₁=a₂=1, aₙ=aₙ₋₁+aₙ₋₂ (n≥3)。有通项公式（比奈公式）：aₙ = [(1+√5)/2]ⁿ - [(1-√5)/2]ⁿ) / √5，涉及无理数但结果恒为整数。",
                "difficulty": 0.5,
                "type": "application",
            },
        ],
        "arithmetic_sequence": [
            {
                "question": "等差数列的通项公式和求和公式是什么？",
                "answer": "通项：aₙ = a₁ + (n-1)d。前 n 项和：Sₙ = n(a₁+aₙ)/2 = na₁ + n(n-1)d/2。",
                "difficulty": 0.55,
                "type": "concept",
            },
            {
                "question": "1+2+3+...+100 等于多少？用了什么方法？等差数列前 n 项和的推导思路是什么？",
                "answer": "等于 5050。用倒序相加法：S=1+2+...+100，S=100+99+...+1，2S=101×100，S=5050。推广得 Sₙ=n(a₁+aₙ)/2。",
                "difficulty": 0.52,
                "type": "application",
            },
        ],
        "geometric_sequence": [
            {
                "question": "等比数列的求和公式是什么？q=1 时怎么办？",
                "answer": "Sₙ = a₁(1-qⁿ)/(1-q)（q≠1）。当 q=1 时，每项相等，Sₙ = na₁。注意公式不适用于 q=1 的情况。",
                "difficulty": 0.58,
                "type": "concept",
            },
            {
                "question": "无穷等比数列求和需要什么条件？公式是什么？",
                "answer": "需要公比 |q|<1（收敛）。此时 S = a₁/(1-q)。若 |q|≥1 则级数发散，无穷和不存在。例如 1+1/2+1/4+... = 1/(1-1/2) = 2。",
                "difficulty": 0.6,
                "type": "edge_case",
            },
        ],
        "basic_inequality": [
            {
                "question": "均值不等式（基本不等式）的内容是什么？等号何时成立？",
                "answer": "a+b ≥ 2√(ab)（a,b>0），等号当且仅当 a=b 时成立。即算术平均 ≥ 几何平均。常用于求最值。",
                "difficulty": 0.57,
                "type": "concept",
            },
            {
                "question": "求 x + 1/x（x>0）的最小值，用了什么方法？",
                "answer": "由均值不等式：x + 1/x ≥ 2√(x·1/x) = 2，等号当 x=1/x 即 x=1 时成立。最小值为 2。注意 x>0 是使用条件。",
                "difficulty": 0.57,
                "type": "application",
            },
        ],
        "coordinate_system": [
            {
                "question": "两点间距离公式是什么？中点公式是什么？",
                "answer": "距离公式：d = √((x₂-x₁)² + (y₂-y₁)²)。中点公式：M = ((x₁+x₂)/2, (y₁+y₂)/2)。",
                "difficulty": 0.35,
                "type": "concept",
            },
            {
                "question": "点 (3,4) 到原点的距离是多少？点 (x,y) 关于原点对称的点是？",
                "answer": "距离 = √(3²+4²) = √25 = 5。关于原点对称的点为 (-x,-y)。",
                "difficulty": 0.35,
                "type": "application",
            },
        ],
        "line_equation": [
            {
                "question": "直线的点斜式和斜截式方程是什么？斜率不存在时怎么办？",
                "answer": "点斜式：y-y₀ = k(x-x₀)。斜截式：y = kx+b。当斜率不存在（垂直于 x 轴）时方程为 x = x₀。",
                "difficulty": 0.42,
                "type": "concept",
            },
            {
                "question": "两直线平行的斜率条件是什么？垂直呢？斜率不存在时呢？",
                "answer": "平行：斜率相等 k₁=k₂（且不重合）。垂直：k₁·k₂ = -1。斜率不存在（都垂直 x 轴）时平行；一条垂直一条水平时垂直。",
                "difficulty": 0.4,
                "type": "edge_case",
            },
        ],
        "probability_hs": [
            {
                "question": "互斥事件和对立事件有什么区别？加法公式是什么？",
                "answer": "互斥：A∩B=∅（不能同时发生）。对立：互斥且 A∪B=必然事件（必有且仅有一个发生）。加法公式：P(A∪B) = P(A)+P(B)-P(A∩B)，互斥时 P(A∩B)=0。",
                "difficulty": 0.5,
                "type": "concept",
            },
            {
                "question": "条件概率公式是什么？独立性如何定义？",
                "answer": "条件概率 P(A|B) = P(A∩B)/P(B)。独立事件：P(A∩B) = P(A)·P(B)，即 B 的发生不影响 A 的概率，P(A|B)=P(A)。",
                "difficulty": 0.52,
                "type": "application",
            },
        ],
        "random_variable": [
            {
                "question": "离散型随机变量的期望和方差怎么计算？二项分布 B(n,p) 的期望和方差是什么？",
                "answer": "期望 E(X)=Σxᵢ·pᵢ，方差 D(X)=E(X²)-[E(X)]²。二项分布 X~B(n,p)：E(X)=np，D(X)=np(1-p)。",
                "difficulty": 0.82,
                "type": "concept",
            },
            {
                "question": "正态分布的 3σ 原则是什么？正态曲线有什么特点？",
                "answer": "P(μ-σ < X < μ+σ) ≈ 0.683，P(μ-2σ,μ+2σ) ≈ 0.954，P(μ-3σ,μ+3σ) ≈ 0.997。曲线关于 x=μ 对称，σ 决定曲线胖瘦（σ 越大越扁平）。",
                "difficulty": 0.78,
                "type": "application",
            },
        ],
        "statistics_hs": [
            {
                "question": "简单随机抽样、分层抽样、系统抽样各适用于什么场景？",
                "answer": "简单随机：总体差异不大。分层抽样：总体有明显分层（各类差异大，层内差异小）。系统抽样：总体有序排列、数量大。",
                "difficulty": 0.48,
                "type": "concept",
            },
            {
                "question": "样本方差怎么计算？它和样本标准差有什么关系？为什么除以 n-1？",
                "answer": "s² = Σ(xᵢ-x̄)²/(n-1)，标准差 s=√(s²)。除以 n-1 而非 n 是为了无偏估计——用 n 会系统性低估总体方差。",
                "difficulty": 0.5,
                "type": "edge_case",
            },
        ],
        "derivative_rules": [
            {
                "question": "链式法则是什么？写出 (sin(x²))' 的计算过程。",
                "answer": "链式法则：复合函数 f(g(x))' = f'(g(x))·g'(x)。(sin(x²))' = cos(x²)·(x²)' = 2x·cos(x²)。",
                "difficulty": 0.7,
                "type": "concept",
            },
            {
                "question": "(uv)' = u'v' 成立吗？正确的乘法法则和除法法则是什么？",
                "answer": "不成立！正确乘法法则：(uv)' = u'v + uv'。除法法则：(u/v)' = (u'v - uv')/v²。(uv)'=u'v' 是常见错误。",
                "difficulty": 0.68,
                "type": "edge_case",
            },
        ],
        "derivative_applications": [
            {
                "question": "如何用导数判断函数的单调性和极值？",
                "answer": "f'(x)>0 时递增，f'(x)<0 时递减。极值点处 f'(x)=0 且左右导数变号（由正变负为极大值，由负变正为极小值）。",
                "difficulty": 0.85,
                "type": "concept",
            },
            {
                "question": "f'(x₀)=0 的点一定是极值点吗？举反例。",
                "answer": "不一定。反例：f(x)=x³，f'(0)=0，但 x=0 不是极值点（导数在 x=0 两侧同号，不改变单调性）。必须是 f'(x₀)=0 且导数变号才是极值点。",
                "difficulty": 0.82,
                "type": "edge_case",
            },
        ],
        "complex_numbers": [
            {
                "question": "复数 z=a+bi 的模怎么求？复数能比较大小吗？",
                "answer": "模 |z| = √(a²+b²)。复数不能比较大小（没有全序），只能判断是否相等（实部虚部分别相等）。",
                "difficulty": 0.6,
                "type": "concept",
            },
            {
                "question": "欧拉公式是什么？计算 (1+i)/(1-i) 等于多少？",
                "answer": "欧拉公式：e^(iθ) = cosθ + i·sinθ。(1+i)/(1-i) = (1+i)²/((1-i)(1+i)) = (1+2i+i²)/(1+1) = (1+2i-1)/2 = 2i/2 = i。",
                "difficulty": 0.62,
                "type": "application",
            },
        ],
        "spatial_vector": [
            {
                "question": "向量数量积（点积）的定义是什么？a·b=0 说明什么？",
                "answer": "a·b = |a||b|cosθ（θ 为夹角）。a·b=0 说明 θ=90°，即 a⊥b（或 a、b 中至少一个为零向量）。",
                "difficulty": 0.72,
                "type": "concept",
            },
            {
                "question": "a·b=0 能推出 a=0 或 b=0 吗？向量积和数量积有什么区别？",
                "answer": "不能。a·b=0 可能是 a⊥b（都非零）。数量积结果是标量（满足交换律），向量积结果是向量（不满足交换律，a×b = -(b×a)）。",
                "difficulty": 0.7,
                "type": "edge_case",
            },
        ],
    }

    def __init__(
        self,
        dag: ConceptDAG | None = None,
        current_node_id: str | None = None,
        llm_client: Any = None,
    ) -> None:
        self.dag = dag or get_dag()
        self.current_node_id = current_node_id or self._default_node()
        self.branches: dict[str, GrillBranch] = {}
        self.question_counter = 0
        self.conjecture_history: list[dict[str, Any]] = []
        self.cayley_tables_seen: list[list[list[int]]] = []
        self._active = False

        # Adaptive difficulty engine
        from .adaptive import AdaptiveDifficulty
        self.adaptive = AdaptiveDifficulty()

        # Encouragement engine
        from .encouragement import EncouragementEngine
        self.encouragement = EncouragementEngine()

        # Dynamic question generator (LLM-powered)
        from .generator import QuestionGenerator
        self.generator = QuestionGenerator(llm_client=llm_client)

        # Runtime store for dynamically generated questions
        self._generated_bank: dict[str, list[dict[str, Any]]] = {}
        self._total_answered: int = 0

        # Last response time for adaptive tracking
        self._last_response_time_ms: float = 5000.0

        self._init_branches()

    def _default_node(self) -> str:
        """Get the default starting node for the current curriculum level."""
        nodes = self.dag.get_all_nodes()
        if not nodes:
            return "group_definition"
        # Return the first node at the lowest abstraction level
        first = min(nodes, key=lambda n: n.abstraction_level)
        return first.id

    def _get_question_bank(self) -> dict[str, list[dict[str, Any]]]:
        """Get the question bank for the current curriculum level.

        Merges static bank with any dynamically generated questions.
        For new curriculum levels (calculus, linear_algebra, etc.) that
        don't have static question banks yet, returns empty dict and
        relies on the dynamic generator.
        """
        level = self.dag.get_level()
        banks = {
            "elementary": self._QUESTION_BANK_ELEMENTARY,
            "middle_school": self._QUESTION_BANK_MIDDLE_SCHOOL,
            "high_school": self._QUESTION_BANK_HIGH_SCHOOL,
            "group_theory": self._QUESTION_BANK,
        }
        # New curriculum levels use dynamic generation only
        static_bank = banks.get(level, {})

        # Merge with dynamically generated questions
        if self._generated_bank:
            merged = dict(static_bank)
            for cid, qs in self._generated_bank.items():
                if cid in merged:
                    merged[cid] = merged[cid] + qs
                else:
                    merged[cid] = qs
            return merged

        return static_bank

    async def ensure_questions_for(
        self,
        node_id: str,
        student_profile: dict[str, Any] | None = None,
    ) -> None:
        """Pre-generate questions for a concept if it has no static questions.

        Called by the orchestrator before next_question() to ensure
        every concept has at least one question available.
        """
        node = self.dag.get_node(node_id)
        if not node:
            return

        static_bank = self._get_static_bank()
        if node_id in static_bank and static_bank[node_id]:
            return  # Static questions exist, no need to generate

        # Check if already generated
        if node_id in self._generated_bank and self._generated_bank[node_id]:
            return

        # Generate questions for this concept
        target = self.adaptive.get_target_difficulty()
        profile = student_profile or {}
        if not profile and self._total_answered > 0:
            profile = {
                "mastery": self.adaptive.accuracy_rate,
                "weak_areas": [],
            }

        # Generate 2 questions: one concept, one application
        for q_type in ("concept", "application"):
            gen_q = await self.generator.generate(
                concept_node=node,
                target_difficulty=target,
                curriculum_level=self.dag.get_level(),
                student_profile=profile,
                question_type=q_type,
            )
            self._generated_bank.setdefault(node_id, []).append(gen_q.to_bank_format())

        logger.info(
            "Pre-generated %d questions for concept %s",
            len(self._generated_bank.get(node_id, [])),
            node_id,
        )

    def _get_static_bank(self) -> dict[str, list[dict[str, Any]]]:
        """Get only the static (non-generated) question bank."""
        level = self.dag.get_level()
        banks = {
            "elementary": self._QUESTION_BANK_ELEMENTARY,
            "middle_school": self._QUESTION_BANK_MIDDLE_SCHOOL,
            "high_school": self._QUESTION_BANK_HIGH_SCHOOL,
            "group_theory": self._QUESTION_BANK,
        }
        # New curriculum levels have no static bank
        return banks.get(level, {})

    def _init_branches(self) -> None:
        """Initialize branches from the concept DAG, starting from current node."""
        # Validate current_node_id exists in the DAG; fall back to default
        if not self.dag.get_node(self.current_node_id):
            fallback = self._default_node()
            logger.warning(
                "Grill: current_node_id '%s' not in DAG, falling back to '%s'",
                self.current_node_id, fallback,
            )
            self.current_node_id = fallback

        # Build branch tree: current node + its prerequisites + dependents
        nodes_to_cover: list[str] = []

        # Add prerequisites (foundational concepts)
        prereqs = self.dag.get_prerequisites(self.current_node_id)
        nodes_to_cover.extend(prereqs)

        # Add current node
        if self.current_node_id not in nodes_to_cover:
            nodes_to_cover.append(self.current_node_id)

        # Add immediate dependents (next concepts)
        dependents = self.dag.get_dependents(self.current_node_id)
        nodes_to_cover.extend(dependents[:2])  # limit to 2 next concepts

        for node_id in nodes_to_cover:
            node = self.dag.get_node(node_id)
            if node:
                self.branches[node_id] = GrillBranch(
                    concept_node_id=node_id,
                    concept_name=node.name,
                )

    def activate(self) -> None:
        """Activate grill mode."""
        self._active = True
        logger.info("Grill mode activated, %d branches to explore", len(self.branches))

    def deactivate(self) -> None:
        """Deactivate grill mode."""
        self._active = False

    @property
    def is_active(self) -> bool:
        return self._active

    def record_conjecture(
        self,
        text: str,
        verdict: str,
        counter_example: str | None = None,
    ) -> None:
        """Record a student conjecture and its verification result.

        Also feeds a conjecture signal to the adaptive difficulty engine.
        """
        self.conjecture_history.append({
            "text": text,
            "verdict": verdict,
            "counter_example": counter_example,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        # Feed conjecture signal to adaptive difficulty engine
        from .adaptive import PerformanceSignal
        self.adaptive.record_signal(PerformanceSignal(
            timestamp=datetime.now(timezone.utc).isoformat(),
            question_difficulty=self.adaptive.current_difficulty,
            is_correct=(verdict == "confirmed"),
            response_time_ms=self._last_response_time_ms,
            conjecture_verdict=verdict,
        ))

        logger.info("Conjecture recorded: verdict=%s, difficulty=%.2f", verdict, self.adaptive.current_difficulty)

    def record_cayley_table(self, table: list[list[int]]) -> None:
        """Record a Cayley table the student has submitted."""
        self.cayley_tables_seen.append(table)

    def _codebase_resolved(self, node_id: str) -> bool:
        """Check if a concept can be resolved from already-submitted Cayley tables.

        This is the "codebase-first" heuristic: if the student has already
        demonstrated understanding through their submitted tables, skip asking.
        """
        node = self.dag.get_node(node_id)
        if not node:
            return False

        # If student submitted 2+ Cayley tables that are valid groups,
        # they likely understand binary_operation and identity_element
        if len(self.cayley_tables_seen) >= 2:
            if node_id in ("binary_operation", "identity_element", "set_basics"):
                return True

        # If student submitted a non-abelian table, they understand abelian_group
        if len(self.cayley_tables_seen) >= 1:
            if node_id == "abelian_group":
                return True

        return False

    def next_question(
        self,
        student_recent_answers: list[dict[str, Any]] | None = None,
    ) -> GrillQuestion | None:
        """Generate the next grill question.

        Walks the decision tree:
        1. Skip branches resolved by codebase (already-submitted tables)
        2. Ask foundational concepts first (prerequisites)
        3. Then current concept
        4. Then edge cases and applications
        5. Then next concepts (dependents)

        Returns None if all branches are resolved.
        """
        student_recent_answers = student_recent_answers or []

        # Find the next pending branch
        for node_id, branch in self.branches.items():
            # Skip already answered
            if branch.status in ("answered_correct", "answered_wrong", "skipped"):
                continue

            # Codebase-first: skip if resolvable from prior tables
            if self._codebase_resolved(node_id):
                branch.status = "skipped"
                logger.info("Branch %s resolved by codebase (prior tables)", node_id)
                continue

            # Generate question for this branch
            question = self._make_question(node_id, branch)
            if question:
                branch.question = question
                branch.status = "asked"
                return question

        # All branches resolved
        return None

    def _make_question(self, node_id: str, branch: GrillBranch) -> GrillQuestion | None:
        """Create a question for a concept branch, using adaptive difficulty.

        Selects the question whose difficulty is closest to the adaptive
        engine's current target difficulty.
        """
        node = self.dag.get_node(node_id)
        if not node:
            return None

        # Check if we have questions for this concept (level-aware)
        question_bank = self._get_question_bank()
        questions = question_bank.get(node_id, [])
        if not questions:
            # Use default question
            default = self._DEFAULT_QUESTION
            self.question_counter += 1
            return GrillQuestion(
                qid=f"grill_{self.question_counter}",
                concept_node_id=node_id,
                concept_name=node.name,
                question=default["question"].format(name=node.name),
                recommended_answer=default["answer"].format(
                    name=node.name, description=node.description,
                ),
                difficulty=default["difficulty"],
                branch_type=default["type"],
            )

        # Filter unasked questions
        unasked = [
            q for q in questions
            if not any(
                b.question and b.question.question == q["question"]
                for b in self.branches.values()
            )
        ]
        if not unasked:
            return None

        # Adaptive difficulty: pick question closest to target difficulty
        target = self.adaptive.get_target_difficulty()
        best_q = min(unasked, key=lambda q: abs(q["difficulty"] - target))

        self.question_counter += 1
        return GrillQuestion(
            qid=f"grill_{self.question_counter}",
            concept_node_id=node_id,
            concept_name=node.name,
            question=best_q["question"],
            recommended_answer=best_q["answer"],
            difficulty=best_q["difficulty"],
            branch_type=best_q["type"],
        )

    def record_answer(
        self,
        qid: str,
        student_answer: str,
        is_correct: bool,
    ) -> None:
        """Record the student's answer to a grill question.

        Also feeds a PerformanceSignal to the adaptive difficulty engine.
        """
        for branch in self.branches.values():
            if branch.question and branch.question.qid == qid:
                branch.student_answer = student_answer
                branch.status = "answered_correct" if is_correct else "answered_wrong"
                self._total_answered += 1

                # Feed signal to adaptive difficulty engine
                from .adaptive import PerformanceSignal
                self.adaptive.record_signal(PerformanceSignal(
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    question_difficulty=branch.question.difficulty,
                    is_correct=is_correct,
                    response_time_ms=self._last_response_time_ms,
                    hint_used=False,
                ))

                logger.info(
                    "Grill answer recorded: qid=%s, correct=%s, difficulty=%.2f→%.2f",
                    qid, is_correct,
                    branch.question.difficulty,
                    self.adaptive.current_difficulty,
                )
                return

        logger.warning("Grill question %s not found", qid)

    def get_summary(self) -> dict[str, Any]:
        """Get a summary of the grill session state."""
        resolved = sum(
            1 for b in self.branches.values()
            if b.status in ("answered_correct", "answered_wrong", "skipped")
        )
        correct = sum(
            1 for b in self.branches.values()
            if b.status == "answered_correct"
        )
        total = len(self.branches)
        return {
            "active": self._active,
            "total_branches": total,
            "resolved_branches": resolved,
            "correct_answers": correct,
            "conjecture_count": len(self.conjecture_history),
            "cayley_tables_seen": len(self.cayley_tables_seen),
            "branches": {bid: b.to_dict() for bid, b in self.branches.items()},
            "progress": f"{resolved}/{total}",
            # Adaptive difficulty data
            "adaptive": self.adaptive.to_dict(),
            # Encouragement engine info
            "encouragement": self.encouragement.to_dict(),
        }

    def get_conjecture_history(self) -> list[dict[str, Any]]:
        """Return the student's conjecture history for multi-turn context."""
        return list(self.conjecture_history)

    def get_last_conjecture(self) -> dict[str, Any] | None:
        """Get the most recent conjecture, if any."""
        if self.conjecture_history:
            return self.conjecture_history[-1]
        return None
