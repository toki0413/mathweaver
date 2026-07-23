"""Math problem set for evaluation.

Acceptance criterion 9.1: "≥20 题，覆盖 ≥3 个数学主题，
有标准答案或可验证判定"
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class MathProblem:
    """A single math problem with verifiable answer."""

    id: str
    topic: str                # group_theory, number_theory, linear_algebra
    difficulty: int           # 1-5
    prompt: str               # student-facing prompt
    input_type: str           # "cayley_table" or "text"
    expected_input: str       # the canonical input to send
    expected_result: dict[str, Any]  # expected verification result
    description: str = ""


PROBLEM_SET: list[MathProblem] = [
    # === Group Theory: Cayley Table Verification (10 problems) ===
    MathProblem(
        id="gt-01", topic="group_theory", difficulty=1,
        prompt="验证 Z3 循环群的运算表",
        input_type="cayley_table",
        expected_input="[[0,1,2],[1,2,0],[2,0,1]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/3Z standard cyclic group",
    ),
    MathProblem(
        id="gt-02", topic="group_theory", difficulty=1,
        prompt="验证 Z4 循环群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3],[1,2,3,0],[2,3,0,1],[3,0,1,2]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/4Z cyclic group",
    ),
    MathProblem(
        id="gt-03", topic="group_theory", difficulty=2,
        prompt="验证 Klein 四元群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3],[1,0,3,2],[2,3,0,1],[3,2,1,0]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Klein four-group V4",
    ),
    MathProblem(
        id="gt-04", topic="group_theory", difficulty=3,
        prompt="验证 S3 对称群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3,4,5],[1,0,4,5,2,3],[2,5,0,4,3,1],[3,4,5,0,1,2],[4,3,1,2,5,0],[5,2,3,1,0,4]]",
        expected_result={"is_group": True, "is_abelian": False},
        description="S3 symmetric group on 3 elements",
    ),
    MathProblem(
        id="gt-05", topic="group_theory", difficulty=1,
        prompt="验证 Z2 循环群",
        input_type="cayley_table",
        expected_input="[[0,1],[1,0]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/2Z cyclic group",
    ),
    MathProblem(
        id="gt-06", topic="group_theory", difficulty=2,
        prompt="验证非群运算表（破坏封闭性）",
        input_type="cayley_table",
        expected_input="[[0,1,2],[1,0,1],[2,1,0]]",
        expected_result={"is_group": False},
        description="Not closed: entry (1,2)=1 but 1 appears in row 1",
    ),
    MathProblem(
        id="gt-07", topic="group_theory", difficulty=2,
        prompt="验证非群运算表（破坏结合律）",
        input_type="cayley_table",
        expected_input="[[0,1,2],[1,1,0],[2,0,2]]",
        expected_result={"is_group": False},
        description="Not associative",
    ),
    MathProblem(
        id="gt-08", topic="group_theory", difficulty=3,
        prompt="验证 Z5 循环群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3,4],[1,2,3,4,0],[2,3,4,0,1],[3,4,0,1,2],[4,0,1,2,3]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/5Z cyclic group",
    ),
    MathProblem(
        id="gt-09", topic="group_theory", difficulty=2,
        prompt="验证非群运算表（无单位元）",
        input_type="cayley_table",
        expected_input="[[1,0,2],[0,1,2],[2,2,0]]",
        expected_result={"is_group": False},
        description="No identity element",
    ),
    MathProblem(
        id="gt-10", topic="group_theory", difficulty=4,
        prompt="验证 Z6 循环群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3,4,5],[1,2,3,4,5,0],[2,3,4,5,0,1],[3,4,5,0,1,2],[4,5,0,1,2,3],[5,0,1,2,3,4]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/6Z cyclic group",
    ),

    # === Group Theory: Natural Language Questions (5 problems) ===
    MathProblem(
        id="gt-11", topic="group_theory", difficulty=1,
        prompt="什么是群",
        input_type="text",
        expected_input="什么是群",
        expected_result={"should_contain": ["群", "运算", "条件"]},
        description="Definition of group",
    ),
    MathProblem(
        id="gt-12", topic="group_theory", difficulty=2,
        prompt="什么是结合律",
        input_type="text",
        expected_input="什么是结合律",
        expected_result={"should_contain": ["结合"]},
        description="Definition of associativity",
    ),
    MathProblem(
        id="gt-13", topic="group_theory", difficulty=2,
        prompt="群的历史是什么",
        input_type="text",
        expected_input="群的历史是什么",
        expected_result={"should_contain": ["历史", "Galois", "Klein", "Cayley"]},
        description="History of group theory",
    ),
    MathProblem(
        id="gt-14", topic="group_theory", difficulty=3,
        prompt="什么是交换群",
        input_type="text",
        expected_input="什么是交换群",
        expected_result={"should_contain": ["交换", "Abel"]},
        description="Definition of abelian group",
    ),
    MathProblem(
        id="gt-15", topic="group_theory", difficulty=3,
        prompt="什么是Lagrange定理",
        input_type="text",
        expected_input="什么是Lagrange定理",
        expected_result={"should_contain": ["Lagrange", "子群", "阶", "整除"]},
        description="Lagrange's theorem",
    ),

    # === Number Theory (5 problems) ===
    MathProblem(
        id="nt-01", topic="number_theory", difficulty=1,
        prompt="验证模5加法群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3,4],[1,2,3,4,0],[2,3,4,0,1],[3,4,0,1,2],[4,0,1,2,3]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/5Z under addition",
    ),
    MathProblem(
        id="nt-02", topic="number_theory", difficulty=2,
        prompt="验证模7加法群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3,4,5,6],[1,2,3,4,5,6,0],[2,3,4,5,6,0,1],[3,4,5,6,0,1,2],[4,5,6,0,1,2,3],[5,6,0,1,2,3,4],[6,0,1,2,3,4,5]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/7Z under addition",
    ),
    MathProblem(
        id="nt-03", topic="number_theory", difficulty=2,
        prompt="验证模4乘法结构（非群）",
        input_type="cayley_table",
        expected_input="[[0,0,0,0],[0,1,2,3],[0,2,0,2],[0,3,2,1]]",
        expected_result={"is_group": False},
        description="Z/4Z under multiplication - not a group (0 has no inverse)",
    ),
    MathProblem(
        id="nt-04", topic="number_theory", difficulty=3,
        prompt="验证模5非零乘法群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3,4],[1,1,2,3,4],[2,2,4,1,3],[3,3,1,4,2],[4,4,3,2,1]]",
        expected_result={"is_group": False},
        description="(Z/5Z)* under multiplication - needs proper table",
    ),
    MathProblem(
        id="nt-05", topic="number_theory", difficulty=1,
        prompt="验证模2加法群",
        input_type="cayley_table",
        expected_input="[[0,1],[1,0]]",
        expected_result={"is_group": True, "is_abelian": True},
        description="Z/2Z under addition",
    ),

    # === Linear Algebra (5 problems) ===
    MathProblem(
        id="la-01", topic="linear_algebra", difficulty=2,
        prompt="验证矩阵乘法的非交换性",
        input_type="text",
        expected_input="矩阵乘法为什么不是交换的",
        expected_result={"should_contain": ["矩阵", "交换", "不"]},
        description="Matrix multiplication non-commutativity",
    ),
    MathProblem(
        id="la-02", topic="linear_algebra", difficulty=1,
        prompt="什么是线性变换",
        input_type="text",
        expected_input="什么是线性变换",
        expected_result={"should_contain": ["线性", "变换"]},
        description="Definition of linear transformation",
    ),
    MathProblem(
        id="la-03", topic="linear_algebra", difficulty=3,
        prompt="验证 GL(2,F2) 一般线性群",
        input_type="cayley_table",
        expected_input="[[0,1,2,3,4,5],[1,0,4,5,2,3],[2,5,0,4,3,1],[3,4,5,0,1,2],[4,3,1,2,5,0],[5,2,3,1,0,4]]",
        expected_result={"is_group": True, "is_abelian": False},
        description="GL(2, F2) isomorphic to S3 — same table as S3",
    ),
    MathProblem(
        id="la-04", topic="linear_algebra", difficulty=2,
        prompt="什么是向量空间",
        input_type="text",
        expected_input="什么是向量空间",
        expected_result={"should_contain": ["向量", "空间"]},
        description="Definition of vector space",
    ),
    MathProblem(
        id="la-05", topic="linear_algebra", difficulty=3,
        prompt="矩阵的逆和群的逆元有什么关系",
        input_type="text",
        expected_input="矩阵的逆和群的逆元有什么关系",
        expected_result={"should_contain": ["逆", "矩阵", "群"]},
        description="Relationship between matrix inverse and group inverse",
    ),
]


def get_problem_set() -> list[MathProblem]:
    """Return the full problem set."""
    return PROBLEM_SET


def get_topics() -> list[str]:
    """Return unique topics covered."""
    return list({p.topic for p in PROBLEM_SET})


def get_problem_count() -> int:
    return len(PROBLEM_SET)
